import type { Tool } from '../types';
import { useTouliuStore } from '@/stores/touliuStore';
import type { TouliuDashboard } from '@/stores/touliuStore';
import { invoke } from '@tauri-apps/api/tauri';

function requireAccount(): { ok: true; aadvid: string } | { ok: false; error: string } {
  const acct = useTouliuStore.getState().getActiveAccount();
  if (!acct) return { ok: false, error: '没有活跃的巨量引擎账户，请先添加一个账户（提供名称和 aadvid）' };
  return { ok: true, aadvid: acct.aadvid };
}

async function runOsascript(js: string): Promise<string> {
  const escaped = js.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const result = await invoke('execute_command', {
    command: `osascript -e 'tell application "Safari" to do JavaScript "${escaped}" in current tab of window 1'`,
    requestId: `osa-${Date.now()}`,
  });
  return String((result as { stdout?: string })?.stdout ?? result ?? '');
}

const touliuGetStatusTool: Tool = {
  definition: {
    name: 'touliu_get_status',
    description: '获取投流模块当前状态：活跃账户、项目列表、运行中任务、Safari 登录状态。任何投流操作前必须先调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const s = useTouliuStore.getState();
    const acct = s.getActiveAccount();
    const runningTasks = s.tasks.filter((t) => t.status === 'running');

    let safariStatus = 'unknown';
    let pageTitle = '';
    if (acct) {
      try {
        pageTitle = await runOsascript('document.title');
        pageTitle = pageTitle.trim();
        if (pageTitle.includes('投放管理')) safariStatus = 'logged_in';
        else if (pageTitle.includes('404') || pageTitle.includes('Not Found')) safariStatus = 'url_error';
        else if (pageTitle.includes('登录') || pageTitle.includes('login')) safariStatus = 'not_logged_in';
        else safariStatus = 'unknown_page';
      } catch {
        safariStatus = 'safari_not_open';
      }
    }

    return {
      success: true,
      output: JSON.stringify({
        activeAccount: acct ? { name: acct.name, aadvid: acct.aadvid } : null,
        accounts: s.accounts.map((a) => ({ id: a.id, name: a.name, aadvid: a.aadvid, isActive: a.isActive })),
        projects: s.projects.slice(0, 20),
        runningTasks: runningTasks.length,
        safariStatus,
        pageTitle,
      }),
    };
  },
};

const touliuOpenSafariTool: Tool = {
  definition: {
    name: 'touliu_open_safari',
    description: '在 Safari 中打开巨量引擎指定页面。用于导航到创建项目、投放管理等页面。',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'string',
          enum: ['login', 'create-project', 'data', 'custom'],
          description: '页面类型：login=登录页, create-project=创建项目, data=投放管理/数据面板, custom=自定义URL',
        },
        customUrl: { type: 'string', description: '自定义 URL（page=custom 时使用）' },
      },
      required: ['page'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const page = params.page as string;
    const check = requireAccount();
    let url: string;

    switch (page) {
      case 'login':
        url = 'https://business.oceanengine.com/login';
        break;
      case 'create-project':
        if (!check.ok) return { success: false, output: '', error: check.error };
        url = `https://ad.oceanengine.com/superior/create-project?aadvid=${check.aadvid}&is_create=1&campaign_type=1`;
        break;
      case 'data':
        if (!check.ok) return { success: false, output: '', error: check.error };
        url = `https://ad.oceanengine.com/pages/index.html?aadvid=${check.aadvid}`;
        break;
      case 'custom':
        url = (params.customUrl as string) || 'https://ad.oceanengine.com';
        break;
      default:
        url = 'https://business.oceanengine.com/login';
    }

    try {
      await invoke('execute_command', {
        command: `open -a Safari "${url}"`,
        requestId: `safari-${Date.now()}`,
      });
      return { success: true, output: `已在 Safari 中打开: ${url}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  },
};

const EXTRACT_METRICS_JS = `(function(){
var t = document.body.innerText;
var lines = t.split("\\n");
var r = { account: {}, summary: {}, units: [] };
r.account = {
  dailyCost: parseFloat((lines[21]||"0").replace(/,/g, "")),
  dailyBudget: (lines[23]||"不限").trim(),
  balance: parseFloat((lines[25]||"0").replace(/,/g, ""))
};
r.summary = {
  cost: parseFloat((lines[38]||"0").replace(/,/g, "")),
  impressions: parseInt((lines[41]||"0").replace(/,/g, "")),
  cpm: parseFloat(lines[44]||"0"),
  clicks: parseInt((lines[47]||"0").replace(/,/g, ""))
};
for (var i = 100; i < lines.length; i++) {
  if (lines[i].trim() === "oCPM") {
    var u = { project: lines[i + 1].trim() };
    var dataLines = [];
    for (var j = i + 2; j < Math.min(i + 20, lines.length); j++) {
      var v = lines[j].trim();
      if (!v) continue;
      var numericPart = v.replace(/,/g, "");
      if (!isNaN(parseFloat(numericPart)) || v.indexOf("%") > -1 ||
          v.indexOf("暂无问题") > -1 || v.indexOf("不起量") > -1 ||
          v.indexOf("挤压") > -1) {
        dataLines.push(v);
      }
    }
    if (dataLines.length >= 10) {
      u.cost = parseFloat(dataLines[0].replace(/,/g, ""));
      u.impressions = parseInt(dataLines[1].replace(/,/g, ""));
      u.cpm = parseFloat(dataLines[2]);
      u.clicks = parseInt(dataLines[3].replace(/,/g, ""));
      u.ctr = dataLines[4];
      u.cpc = parseFloat(dataLines[5]);
      u.conversions = parseInt(dataLines[6].replace(/,/g, ""));
      u.cvr = dataLines[7];
      u.cpa = parseFloat(dataLines[8]);
      u.diagnosis = dataLines[9].replace("发现 1 个诊断问题", "").trim();
      if (u.diagnosis.indexOf("暂无问题") > -1) u.diagnosis = "正常";
      r.units.push(u);
    }
  }
}
return JSON.stringify(r);
})()`;

const touliuGetMetricsTool: Tool = {
  definition: {
    name: 'touliu_get_metrics',
    description: '从 Safari 当前打开的巨量引擎投放管理页面提取并解析数据指标，自动更新到投流数据面板。需要先用 touliu_open_safari page=data 打开投放管理页面并等待 4 秒加载完成。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    try {
      const title = (await runOsascript('document.title')).trim();
      if (!title.includes('投放管理')) {
        return {
          success: false,
          output: '',
          error: `当前页面不是投放管理（标题: "${title}"）。请先用 touliu_open_safari page=data 打开数据页面，等待 4 秒后再调用。`,
        };
      }

      const jsonStr = await runOsascript(EXTRACT_METRICS_JS);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonStr.trim());
      } catch {
        return { success: false, output: '', error: `Safari 返回的数据无法解析为 JSON。原始输出前500字符: ${jsonStr.slice(0, 500)}` };
      }

      if (parsed.error) {
        return { success: false, output: '', error: `页面解析失败: ${parsed.error}` };
      }

      const account = (parsed.account ?? {}) as Record<string, unknown>;
      const parsedSummary = (parsed.summary ?? {}) as Record<string, unknown>;
      const acct = useTouliuStore.getState().getActiveAccount();

      const totalCost = Number(account.dailyCost ?? parsedSummary.cost ?? 0);
      const totalImpressions = Number(parsedSummary.impressions ?? 0);
      const totalClicks = Number(parsedSummary.clicks ?? 0);
      const totalCpm = Number(parsedSummary.cpm ?? 0);

      const units = (parsed.units as Array<Record<string, unknown>> ?? []).map((u) => ({
        name: String(u.project ?? ''),
        type: '',
        id: '',
        projectName: String(u.project ?? ''),
        projectStatus: '',
        projectBudget: '',
        unitStatus: '',
        unitBudget: '',
        unitBid: '',
        cost: Number(u.cost ?? 0),
        impressions: Number(u.impressions ?? 0),
        cpm: Number(u.cpm ?? 0),
        clicks: Number(u.clicks ?? 0),
        ctr: parseFloat(String(u.ctr ?? '0').replace('%', '')) || 0,
        conversions: Number(u.conversions ?? 0),
        cvr: parseFloat(String(u.cvr ?? '0').replace('%', '')) || 0,
        cpa: Number(u.cpa ?? 0),
        diagnosis: String(u.diagnosis ?? ''),
      }));

      units.sort((a, b) => b.cost - a.cost);

      const dashboard: TouliuDashboard = {
        fetchedAt: Date.now(),
        accountName: acct?.name ?? '',
        aadvid: acct?.aadvid ?? '',
        totalCost,
        totalBudget: String(account.dailyBudget ?? '不限'),
        totalImpressions,
        totalClicks,
        totalCtr: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
        totalConversions: units.reduce((s, u) => s + u.conversions, 0),
        totalCpa: 0,
        totalCpm,
        balance: String(account.balance ?? ''),
        units,
      };
      dashboard.totalCpa = dashboard.totalConversions > 0 ? (totalCost / dashboard.totalConversions) : 0;

      useTouliuStore.getState().setDashboard(dashboard);

      const summary = {
        account: `${dashboard.accountName} (${dashboard.aadvid})`,
        totalCost: `¥${totalCost.toFixed(2)}`,
        totalBudget: dashboard.totalBudget,
        impressions: totalImpressions,
        clicks: totalClicks,
        ctr: `${dashboard.totalCtr.toFixed(2)}%`,
        conversions: dashboard.totalConversions,
        cpa: `¥${dashboard.totalCpa.toFixed(2)}`,
        cpm: `¥${dashboard.totalCpm.toFixed(2)}`,
        balance: dashboard.balance || '未知',
        unitCount: units.length,
        topUnits: units.slice(0, 5).map((u) => ({
          name: u.name,
          cost: `¥${u.cost.toFixed(2)}`,
          cpm: u.cpm.toFixed(2),
          ctr: `${u.ctr.toFixed(2)}%`,
          conversions: u.conversions,
          cpa: `¥${u.cpa.toFixed(2)}`,
          diagnosis: u.diagnosis,
        })),
      };

      return {
        success: true,
        output: `数据已解析并更新到投流面板。\n\n${JSON.stringify(summary, null, 2)}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `读取数据失败: ${msg}` };
    }
  },
};

const touliuNavigateTool: Tool = {
  definition: {
    name: 'touliu_navigate',
    description: '在 Safari 当前标签页导航到指定 URL（不新开标签页）。适合在已打开的 Safari 中跳转页面。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要导航到的完整 URL' },
      },
      required: ['url'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const url = params.url as string;
    try {
      const escaped = url.replace(/"/g, '\\"');
      await invoke('execute_command', {
        command: `osascript -e 'tell application "Safari" to set URL of current tab of window 1 to "${escaped}"'`,
        requestId: `nav-${Date.now()}`,
      });
      return { success: true, output: `已导航到: ${url}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  },
};

const touliuExecuteJsTool: Tool = {
  definition: {
    name: 'touliu_execute_js',
    description: '在 Safari 当前页面执行 JavaScript 并返回结果。用于读取页面数据或操作页面元素。代码会被包裹在 IIFE 中，用 return 返回结果。',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 JavaScript 代码。会被自动包裹在 (function(){ ... })() 中。使用 return 返回值。' },
      },
      required: ['code'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const code = params.code as string;
    try {
      const wrapped = `(function(){${code}})()`;
      const result = await runOsascript(wrapped);
      return { success: true, output: result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  },
};

const touliuSuggestKeywordsTool: Tool = {
  definition: {
    name: 'touliu_suggest_keywords',
    description: '根据投放内容描述，由 AI 生成行为关键词和兴趣关键词建议列表。返回提示词让 AI 生成关键词，用户确认后可通过 Safari 自动化添加。',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '投放内容描述（如"峡江号子非遗传承人纪录片"）' },
        industry: { type: 'string', description: '所属行业（如"文化/非遗/旅游"）' },
        count: { type: 'number', description: '每类关键词数量（默认 10）' },
      },
      required: ['description'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const desc = params.description as string;
    const industry = (params.industry as string) || '通用';
    const count = (params.count as number) || 10;

    return {
      success: true,
      output: [
        `请根据以下信息为巨量引擎广告投放生成关键词建议：`,
        `投放内容：${desc}`,
        `行业：${industry}`,
        ``,
        `请分别生成 ${count} 个行为关键词和 ${count} 个兴趣关键词。`,
        `行为关键词：用户近期的搜索/浏览/互动行为相关词（如"看过非遗纪录片"、"搜索过传统文化"）`,
        `兴趣关键词：用户长期兴趣标签相关词（如"民俗文化爱好者"、"旅游达人"）`,
        ``,
        `请以 JSON 格式返回：`,
        `{ "behaviorKeywords": [...], "interestKeywords": [...] }`,
        `每个关键词应该简短（2-6个字），且是巨量引擎平台实际可搜索到的类目词。`,
      ].join('\n'),
    };
  },
};

const touliuManageAccountTool: Tool = {
  definition: {
    name: 'touliu_manage_account',
    description: '管理巨量引擎投放账户：添加、删除或切换账户。删除时可通过 accountId 或 name 匹配。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'remove', 'switch'], description: '操作类型' },
        name: { type: 'string', description: '账户名称（add 时必填，remove 时可用于按名称匹配）' },
        aadvid: { type: 'string', description: '广告主 ID（add 时必填）' },
        accountId: { type: 'string', description: '账户 ID（remove/switch 时使用，remove 时也可用 name 代替）' },
      },
      required: ['action'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const action = params.action as string;
    const store = useTouliuStore.getState();

    if (action === 'add') {
      const name = params.name as string;
      const aadvid = params.aadvid as string;
      if (!name || !aadvid) return { success: false, output: '', error: '添加账户需要 name 和 aadvid' };
      store.addAccount({ name, aadvid });
      return { success: true, output: `已添加账户"${name}"(${aadvid})` };
    }

    if (action === 'remove') {
      let id = params.accountId as string;
      if (!id && params.name) {
        const found = store.accounts.find((a) => a.name === params.name);
        if (found) id = found.id;
        else return { success: false, output: '', error: `未找到名为"${params.name}"的账户` };
      }
      if (!id) return { success: false, output: '', error: '需要 accountId 或 name' };
      store.removeAccount(id);
      return { success: true, output: `已删除账户 ${id}` };
    }

    if (action === 'switch') {
      const id = params.accountId as string;
      if (!id) return { success: false, output: '', error: '需要 accountId' };
      store.setActiveAccount(id);
      return { success: true, output: `已切换到账户 ${id}` };
    }

    return { success: false, output: '', error: `未知操作: ${action}` };
  },
};

export const allTouliuTools: Tool[] = [
  touliuGetStatusTool,
  touliuOpenSafariTool,
  touliuGetMetricsTool,
  touliuNavigateTool,
  touliuExecuteJsTool,
  touliuSuggestKeywordsTool,
  touliuManageAccountTool,
];
