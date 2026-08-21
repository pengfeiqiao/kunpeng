/**
 * exportTemplates — 飞书云文档统一格式渲染器。
 *
 * 每个步骤导出同一骨架：标题行 → 元信息 → 一、本步骤产出 →
 * 二、上下文摘要 → 三、修改记录。由 workshop_render_export 工具调用，
 * 渲染结果交给 agent 经 lark-cli 导入飞书。
 */
import type { AigcProject } from '@/lib/aigc/projectStore';
import {
  type WorkshopData,
  type WorkshopStepId,
  WORKSHOP_STEPS,
  STEP_ORDER,
} from './types';

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stepLabel(id: WorkshopStepId): string {
  return WORKSHOP_STEPS.find((s) => s.id === id)?.label ?? id;
}

function mdEscapeCell(s: string | undefined): string {
  return (s ?? '').replace(/\|/g, '＼').replace(/\n/g, ' ');
}

function renderBody(data: WorkshopData, project: AigcProject, step: WorkshopStepId): string {
  switch (step) {
    case 'script': {
      const rows = project.sources.map((s) =>
        `| ${mdEscapeCell(s.name)} | ${s.type} | ${(s.size / 1024).toFixed(0)} KB | ${fmtTime(s.uploadedAt)} |`,
      );
      return [
        '### 剧本来源',
        '',
        '| 文件 | 类型 | 大小 | 上传时间 |',
        '| --- | --- | --- | --- |',
        ...(rows.length ? rows : ['| （暂无） | | | |']),
      ].join('\n');
    }
    case 'breakdown': {
      const epRows = data.episodes.map((e) => `| ${e.no} | ${mdEscapeCell(e.title)} | ${mdEscapeCell(e.sceneList)} |`);
      const charBlocks = data.characters.map((c) => {
        const stages = (c.lifecycleStages ?? [])
          .map((st) => `| ${mdEscapeCell(st.stage)} | ${mdEscapeCell(st.appearance)} |`);
        return [
          `#### ${c.name}`,
          '',
          `- **性格**：${c.personality}`,
          `- **外形**：${c.appearance}`,
          ...(stages.length
            ? ['', '| 阶段 | 形象 |', '| --- | --- |', ...stages]
            : []),
        ].join('\n');
      });
      return [
        '### 故事梗概',
        '',
        data.synopsis || '（待填写）',
        '',
        '### 分集分场',
        '',
        '| 集 | 标题 | 场次 |',
        '| --- | --- | --- |',
        ...(epRows.length ? epRows : ['| （暂无） | | |']),
        '',
        '### 角色档案',
        '',
        ...(charBlocks.length ? charBlocks : ['（暂无）']),
      ].join('\n');
    }
    case 'assets': {
      const rows = [
        ...data.characters.map((c) =>
          `| 角色 | ${mdEscapeCell(c.name)} | ${mdEscapeCell(c.assetPrompt)} | ${c.assetImagePath ? '✅ 已生成' : '待生成'} |`),
        ...data.scenes.map((s) =>
          `| 场景 | ${mdEscapeCell(s.name)} | ${mdEscapeCell(s.assetPrompt)} | ${s.assetImagePath ? '✅ 已生成' : '待生成'} |`),
        ...(data.props ?? []).map((p) =>
          `| 道具 | ${mdEscapeCell(p.name)} | ${mdEscapeCell(p.assetPrompt)} | ${p.assetImagePath ? '✅ 已生成' : '待生成'} |`),
        ...(data.colorPalettes ?? []).map((p) =>
          `| 色卡 | ${mdEscapeCell(p.name)} | ${mdEscapeCell(p.usagePrompt || p.assetPrompt)} | ${p.assetImagePath ? '✅ 已生成' : '待生成'} |`),
      ];
      return [
        '### 资产清单',
        '',
        '| 类型 | 名称 | 提示词 | 状态 |',
        '| --- | --- | --- | --- |',
        ...(rows.length ? rows : ['| （暂无） | | | |']),
      ].join('\n');
    }
    case 'prompts': {
      const rows = data.shots.map((s) =>
        `| ${s.shotNo} | ${mdEscapeCell(s.description)} | ${mdEscapeCell(s.dialogue)} | ${mdEscapeCell(s.shotType)} | ${mdEscapeCell(s.camera)} | ${mdEscapeCell(s.mood)} | ${s.durationSec ?? ''} | ${mdEscapeCell(s.imagePrompt)} | ${mdEscapeCell(s.videoPrompt)} |`);
      return [
        '### 分镜表',
        '',
        '| 段号 | 画面描述 | 对白 | 景别 | 运镜 | 情绪 | 时长(s) | 生图提示词 | 视频提示词 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...(rows.length ? rows : ['| （暂无） | | | | | | | | |']),
      ].join('\n');
    }
    case 'generate': {
      const done = data.shots.filter((s) => s.videoPath).length;
      const imgDone = data.shots.filter((s) => s.imagePath).length;
      const rows = data.shots.map((s) =>
        `| ${s.shotNo} | ${s.imagePath ? '✅' : '—'} | ${s.videoPath ? '✅' : '—'} | ${s.genStatus ?? 'idle'} | ${mdEscapeCell(s.genError)} |`);
      return [
        `### 生成进度：图 ${imgDone}/${data.shots.length} ｜ 视频 ${done}/${data.shots.length}`,
        '',
        '| 段号 | 分镜图 | 视频 | 状态 | 错误 |',
        '| --- | --- | --- | --- | --- |',
        ...(rows.length ? rows : ['| （暂无） | | | | |']),
      ].join('\n');
    }
    case 'handoff': {
      const videos = data.shots.filter((s) => s.videoPath);
      return [
        '### 交付物',
        '',
        `- 成片片段：${videos.length} 段`,
        ...videos.map((s) => `  - ${s.shotNo}: \`${s.videoPath}\``),
      ].join('\n');
    }
  }
}

export function renderStepExport(project: AigcProject, data: WorkshopData, step: WorkshopStepId): string {
  const idx = STEP_ORDER.indexOf(step) + 1;
  const st = data.steps[step];
  const recent = data.changelog.slice(-15).reverse();
  return [
    `# 【鲲鹏创作工坊】${project.name} · ${stepLabel(step)}`,
    '',
    `> 项目 ID：${project.id} ｜ 导出时间：${fmtTime(Date.now())} ｜ 步骤：${idx}/6 ｜ 状态：${st.status}`,
    '',
    '## 一、本步骤产出',
    '',
    renderBody(data, project, step),
    '',
    '## 二、上下文摘要',
    '',
    `${data.synopsis ? data.synopsis.split('\n')[0].slice(0, 80) : '（梗概未填写）'} ｜ 角色 ${data.characters.length} ｜ 场景 ${data.scenes.length} ｜ 分镜 ${data.shots.length} ｜ 完成 ${data.shots.filter((s) => s.videoPath).length}/${data.shots.length}`,
    '',
    '## 三、修改记录',
    '',
    '| 时间 | 步骤 | 摘要 |',
    '| --- | --- | --- |',
    ...(recent.length
      ? recent.map((c) => `| ${fmtTime(c.at)} | ${stepLabel(c.step)} | ${mdEscapeCell(c.summary)} |`)
      : ['| （暂无） | | |']),
    '',
  ].join('\n');
}
