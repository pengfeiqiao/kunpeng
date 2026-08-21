import type { AigcProject } from './projectStore';
import { projectAbsPath } from './projectStore';

// ─── 7-stage prompt templates ─────────────────────────────────────────────
// Each stage returns a complete prompt that's sent verbatim to the agent.
// The agent invokes the relevant skills/CLIs and writes output back into
// the project directory at ~/.kunpeng/aigc-memory/projects/<id>/.

export type StageId =
  | 'parse-docs'
  | 'image-prompts'
  | 'video-prompts'
  | 'scene-images'
  | 'asset-images'
  | 'create-bitable'
  | 'video-poll';

export interface StageMeta {
  id: StageId;
  index: number;
  title: string;
  hint: string;
}

export const STAGES: StageMeta[] = [
  { id: 'parse-docs', index: 1, title: '解析文档', hint: '抽取分镜表 / 资产清单 / 风格' },
  { id: 'image-prompts', index: 2, title: '生成生图提示词', hint: '每镜一条提示词' },
  { id: 'video-prompts', index: 3, title: '生成视频提示词', hint: '配合 seedance 模板' },
  { id: 'scene-images', index: 4, title: '场景图（环境锚定法）', hint: '分组 → 锚定 → 变体' },
  { id: 'asset-images', index: 5, title: '资产图', hint: '车辆/角色/道具' },
  { id: 'create-bitable', index: 6, title: '创建飞书多维表格', hint: '20 字段 + 3 视图' },
  { id: 'video-poll', index: 7, title: '视频生成回写', hint: '轮询飞书 → 生成视频 → 回写' },
];

function header(p: AigcProject): string {
  return `当前 AIGC 项目：
- ID: ${p.id}
- 名称: ${p.name}
- slug: ${p.slug}
- 项目目录（绝对路径）: ${projectAbsPath(p.id)}
- 当前阶段: ${p.status}
- 视频引擎: ${p.videoEngine}
- 已上传文档: ${p.sources.map((s) => (s.type === 'link' ? `[link] ${s.url || s.name}` : s.name)).join(', ') || '（无）'}`;
}

export function buildStagePrompt(stage: StageId, p: AigcProject): string {
  switch (stage) {
    case 'parse-docs':
      return `${header(p)}

任务：解析 sources/ 下的所有文档 + 项目中登记的链接，抽取结构化数据。

执行步骤：
1. 列出 ${projectAbsPath(p.id)}/sources/ 下的所有文件
2. 对每个文件按类型调用对应 skill：
   - .docx → minimax-docx skill 读取全文
   - .md → 直接 cat 读取
   - .xlsx → minimax-xlsx skill 读取（资产清单类）
   - .pdf → minimax-pdf skill 读取
3. 对项目 sources 中 type === 'link' 的条目（见上方"已上传文档"中 [link] 前缀）：
   - 飞书 URL（larksuite.com / feishu.cn）→ lark-cli skill 抓正文
   - 其它公开网页 → web_fetch 抓正文
   - 抓取结果按"来自 <url> 的内容"作为一段并入下一步处理
4. 从读取内容中识别并产出：
   - **分镜表** → 写入 parsed/shots.json，结构：
     [{ shotNo, act, shotType, description, camera, duration, ... }]
   - **资产清单** → 写入 parsed/assets.json：
     [{ id, name, type, refImage? }]
   - **风格/导演 DNA 引用** → 写入 parsed/style.json：
     { directorRef?, keywords, palette, lighting, references }
5. 完成后向用户报告抽取到 N 个镜头、M 个资产，并展示前 2 条样例

重要：所有写入路径必须在 ${projectAbsPath(p.id)}/parsed/ 下，不要写到别处。`;

    case 'image-prompts':
      return `${header(p)}

任务：根据 parsed/shots.json + parsed/style.json，为每个镜头生成一条生图提示词。

执行步骤：
1. 读取 ${projectAbsPath(p.id)}/parsed/shots.json 和 parsed/style.json
2. 如 style.json 中含 directorRef，调用 aigc-memory 中对应的 director-dna 文件作风格参考
3. 调用 image-generation skill 的提示词规范
4. 产出 prompts/image-prompts.json，结构：
   { "01-①": { prompt, refImage?, params: { aspect, model } }, "02": {...} }
5. 完成后向用户展示前 3 条提示词样例供 review`;

    case 'video-prompts':
      return `${header(p)}

任务：根据 parsed/shots.json + prompts/image-prompts.json，为每个镜头生成视频提示词。

执行步骤：
1. 读取 shots.json 中的运镜/时长字段
2. 使用 ~/.kunpeng/aigc-memory/prompt-templates/seedance/ 下的权威 Seedance 模板：
   - 入口：prompt-templates/seedance/README.md
   - 单镜头：prompt-templates/seedance/single-shot.md
   - 多镜头合并/VO：prompt-templates/seedance/multi-shot.md
3. 继承 parsed/style.json 与项目四圣经（若存在）中的导演、角色、场景、连续性规则
4. 产出 prompts/video-prompts.json，结构：
   { "01-①": { prompt, duration, motion, params: { model: "seedance2.0_vip", aspect: "16:9" } } }
5. 完成后展示前 3 条供 review`;

    case 'scene-images':
      return `${header(p)}

任务：用环境锚定法批量生成所有镜头的场景图。

必读 skill：~/.kunpeng/skills/scene-image-anchor/SKILL.md（强制使用此 SOP）

执行步骤：
1. 读取 parsed/shots.json 中所有镜头
2. **第一步：环境分组**（空间/色调/光影三选二）
   → 产出 scenes/groups.json: [{ groupId, name, shotIds: [...], description }]
   → **必须先把分组结果给用户确认，等用户回复"继续"后再生图**
3. **第二步：Phase 1 锚定图** — 每组并行调用 image-generation（text-to-image）
   → 产出 scenes/anchors/<groupId>.jpg
4. **第三步：Phase 2 变体图** — 所有镜头并行调用 image-generation（image-to-image, --image <对应锚定图>）
   → 产出 scenes/variants/<shotNo>.jpg
5. 全部完成后调用项目 refreshCurrent，状态推到 scenes-ready，并向用户展示锚定图缩略图列表`;

    case 'asset-images':
      return `${header(p)}

任务：生成或上传项目所需的资产图（车辆、角色、道具）。

执行步骤：
1. 读取 parsed/assets.json
2. 对每个 asset：
   - 若 refImage 已存在 → 拷贝到 assets/<id>.jpg
   - 否则 → 调用 image-generation skill 生成（用 style.json 中的视觉规范）
3. 产出全部资产图到 ${projectAbsPath(p.id)}/assets/
4. 完成后展示缩略图列表`;

    case 'create-bitable':
      return `${header(p)}

任务：创建飞书多维表格"分镜管理"，写入所有镜头记录并上传场景图 + 资产图。

必读模板：~/.kunpeng/skills/lark-cli/templates/shot-bitable.md（20 字段 + 3 视图 + 仪表盘规范）

执行步骤（全部经 lark-cli，且加 --as user）：
1. lark-cli base +create → 拿到 base_token，记录到 ${projectAbsPath(p.id)}/bitable.json
2. 按模板创建 20 个字段（含自动编号前缀：${p.slug.toUpperCase().slice(0, 4)}-）
3. 创建 select 选项（幕、生成状态、视频引擎）
4. 创建 3 个视图：分镜总览(grid) / 场景画廊(gallery) / 制作看板(kanban)
5. 创建仪表盘"制作进度"（statistics + column + pie）
6. 批量 +record-create 写入 shots.json 中的镜头
7. 对每条 record 调 +record-upload-attachment 上传：
   - 场景图（来自 scenes/variants/<shotNo>.jpg）
   - 车辆资产图（来自 assets/<asset-id>.jpg）
8. 回写 bitable.json：{ baseToken, tableId, url, recordIds: { "<shotNo>": "<recId>" } }
9. 把 base_url 给用户，让其在浏览器打开确认`;

    case 'video-poll':
      return `${header(p)}

任务：轮询飞书多维表格，对已确认未生成的记录调用视频引擎生成 → 下载 → 回写。

视频引擎：${p.videoEngine}

执行步骤：
1. 读取 ${projectAbsPath(p.id)}/bitable.json 拿到 baseToken / tableId
2. lark-cli base +record-list --filter "确认=true AND 生成状态≠已完成"
3. 对每条命中记录：
   a. 取出"视频提示词"、"场景图"、"车辆资产图"、"视频引擎"字段
   b. **路由**：
      - 记录的"视频引擎"字段为 "rhtv" → python3 ~/.kunpeng/skills/rhtv/scripts/runninghub.py（seedance2.0 端点）
      - 否则 → dreamina multimodal2video --model seedance2.0_vip（注册到 background_task）
   c. 拿到结果视频 → 上传到该 record 的"生成视频"附件字段
   d. lark-cli +record-update 设置"生成状态"="已完成"
4. 全部完成后报告统计：本轮处理 N 条，剩余 M 条待确认`;
  }
}

export function getStageMeta(stage: StageId): StageMeta {
  return STAGES.find((s) => s.id === stage)!;
}
