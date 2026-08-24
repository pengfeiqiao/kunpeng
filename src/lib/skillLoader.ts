import type { SkillManifest } from '@/types/skill';
import { readDir, readTextFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';

// ── 7 Built-in skill fallbacks ──────────────────────────────────────────────
// These are embedded so the app works even without ~/.kunpeng/skills/

const BUILTIN_SKILLS: SkillManifest[] = [
  // 1. Video Script Writer (no panel)
  {
    id: 'video-script-writer',
    name: '视频脚本',
    icon: 'scroll-text',
    description: '根据主题生成视频脚本',
    version: '1.0.0',
    hasPanel: false,
    accentColor: 'indigo',
    placeholder: '描述脚本主题和内容...',
    promptTemplate: `[视频脚本] 请参考 ~/.kunpeng/skills/video-script-writer/SKILL.md 规范生成视频脚本，输出 Excel (.xlsx)，保存到工作区 docs/。

{{userContent}}`,
  },

  {
    id: 'omni-mg-animation',
    name: 'Omni版MG动画',
    icon: 'sparkles',
    description: '使用 Gemini Omni Flash / APIMart 生成 MG 动画，支持文生视频、视频生视频图形动效、App 展示包装',
    version: '1.0.0',
    hasPanel: true,
    accentColor: '#06b6d4',
    placeholder: '描述你要做的 MG 动画、视频包装或 App 展示动效...',
    panel: {
      fields: [
        {
          key: 'mode',
          label: '使用场景',
          type: 'select',
          default: 'auto',
          options: [
            { value: 'auto', label: '自动判断' },
            { value: 'text', label: '文生 MG 动画' },
            { value: 'video', label: '视频加图形动效' },
          ],
        },
        {
          key: 'style',
          label: '风格',
          type: 'select',
          default: 'app-001',
          options: [
            { value: 'app-001', label: '应用功能展示' },
            { value: 'app-002', label: '手机 App 演示' },
            { value: 'tech-011', label: '赛博朋克 HUD' },
            { value: 'collage-021', label: '纸拼贴手账' },
            { value: 'minimal-031', label: '极简线条' },
            { value: 'playful-041', label: '孟菲斯图形' },
            { value: 'data-061', label: '信息图表' },
            { value: 'text-safe-101', label: '中文大字标题' },
            { value: 'text-safe-104', label: '口播保护' },
          ],
        },
        {
          key: 'duration',
          label: '时长',
          type: 'select',
          default: '10',
          options: [
            { value: '10', label: '10 秒' },
          ],
        },
        {
          key: 'aspectRatio',
          label: '画幅',
          type: 'select',
          default: '16:9',
          options: [
            { value: '16:9', label: '16:9 横屏' },
            { value: '9:16', label: '9:16 竖屏' },
          ],
        },
        {
          key: 'videoFile',
          label: '参考视频（可选）',
          type: 'file',
          default: '',
          extensions: ['mp4', 'mov', 'webm', 'm4v'],
        },
      ],
    },
    promptTemplate: `[鲲鹏付费MG动画]
请按鲲鹏统一 MG 工作流执行。默认引擎是 MiniMax H3；也可使用 Omni 或 Seedance Mini。API Key 必须从设置读取，禁止把 key 写进提示词或代码。

模式：{{mode}}
风格 ID：{{style}}
时长：{{duration}} 秒（H3 默认 10 秒，可在 5-15 秒内调整）
画幅：{{aspectRatio}}
参考视频：{{videoFile}}

执行规则：
1. 标准生成统一使用“母版概念图 → 2-4 张同风格关键帧 → 视频”流程。母版先收齐全部核心元素并锁定视觉系统，关键帧只变化构图、景别和动作阶段；普通对话调用 mg_generate_with_reference_boards。
2. 如果只有文案：理解文案，以应用展示、信息图、图标、物体和空间关系为主生成 MG 动画；尽量无字，只保留必要短词。
3. 如果提供参考图片或视频：图片按 @图片N、视频按 @视频一写进最终提示词。长视频先用鲲鹏 ASR/视频理解切成合适段落；人物身份、人脸、口型、动作、声音、文物/产品细节和背景主体必须保持，AI 母版不得覆盖用户原始主体。
4. 如果用户在剪辑窗口提出 MG 动画：第一问只问“网页特效还是付费 MG 动画”。选择付费 MG 后，第二问必须同时询问引擎、风格和视频生/文字生。引擎选项为 MiniMax H3（默认推荐，2K、5-15秒）、Omni（720p、固定10秒）、Seedance Mini（4-15秒）；禁止调用 Seedance 2.0 普通版。确认后再给计划和成本估算，生成结果覆盖到原视频上方轨。
5. 如果用户在画布里使用：创建或使用 MG动画节点（本质 video 节点），参考图/视频先连线进入节点；生成的母版和关键帧也必须显示为图片节点并连回 MG 节点。界面显示顺序、@编号和 API 提交顺序必须一致。
6. 路由约束：用户未选择时默认 H3；用户明确选择时所选引擎优先，失败后才进入 H3 → Omni → Mini 的剩余容灾链。Omni 内部仍按 ZexAPI → ZeroFall → APIMart 兼容通道路由。不依赖模型生成小字。

用户要求：
{{userContent}}`,
  },

  // 2. Video Style Replication (Wizard)
  {
    id: 'video-style-replication',
    name: '视频风格复刻',
    icon: 'film',
    description: '影视剧风格复刻与分镜生成系统，支持古装剧和废土风格',
    version: '1.0.0',
    hasPanel: false,
    accentColor: '#8b5cf6',
    placeholder: '描述你的创作需求...',
    promptTemplate: '{{userContent}}',
    wizard: {
      steps: [
        { id: 'init', title: '项目初始化', description: '选择风格并设置项目基本信息' },
        { id: 'characters', title: '角色建立', description: '定义角色信息，生成定妆照和三视图' },
        { id: 'scenes', title: '场景建立', description: '定义场景信息，生成场景概念图' },
        { id: 'storyboard', title: '分镜生成', description: '生成九宫格分镜图' },
        { id: 'review', title: '审查优化', description: '逐张审查分镜，不满意可重新生成' },
        { id: 'prompts', title: '视频提示词', description: '生成可直接用于 AI 视频平台的提示词' },
      ],
      persistState: true,
    },
  },

  // 3. Sketch to Image — 视频驱动草图分镜
  {
    id: 'sketch-to-image',
    name: '草图',
    icon: 'pen-tool',
    description: '视频分析 → 抽帧 → 草图 → 风格提取 → 电影感分镜',
    version: '2.0.0',
    hasPanel: true,
    accentColor: 'emerald',
    placeholder: '补充说明（场景替换、特定帧要求、已有 style_profile.json 路径等）...',
    panel: {
      fields: [
        {
          key: 'videoFile',
          label: '视频文件',
          type: 'file',
          default: '',
          extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
        },
        {
          key: 'characterRef',
          label: '人物参考图',
          type: 'file-multi',
          default: [],
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
        {
          key: 'ratio',
          label: '画面比例',
          type: 'select',
          default: '16:9',
          options: [
            { value: '16:9', label: '16:9 横屏' },
            { value: '9:16', label: '9:16 竖屏' },
            { value: '1:1', label: '1:1 方形' },
            { value: '2.39:1', label: '2.39:1 宽银幕' },
          ],
        },
        {
          key: 'resolution',
          label: '分辨率',
          type: 'select',
          default: '2k',
          options: [
            { value: '1k', label: '1K' },
            { value: '2k', label: '2K' },
            { value: '4k', label: '4K' },
          ],
        },
        {
          key: 'outputDir',
          label: '输出目录',
          type: 'directory',
          default: '',
        },
      ],
    },
    promptTemplate: `[草图分镜] 请参考 ~/.kunpeng/skills/storyboard-sketch/SKILL.md 规范执行视频风格复刻分镜生成。

视频文件：{{videoFile}}
人物参考图：{{characterRef}}
画面比例：{{ratio}}
分辨率：{{resolution}}
输出目录：{{outputDir}}

{{userContent}}

核心流程：视频分析→抽帧→草图→风格提取→校验→生成分镜→质量检查。
风格必须从视频分析中提取，保存为 style_profile.json 供复用。如果用户提供了已有的 style_profile.json 路径，直接使用。`,
  },

  // 4. Dreamina — 即梦 AI 图片/视频生成
  {
    id: 'dreamina-video',
    name: '即梦',
    icon: 'wand',
    description: '即梦 AI 生成图片和视频',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'violet',
    placeholder: '描述你想生成的内容...',
    panel: {
      fields: [
        {
          key: 'genMode',
          label: '生成模式',
          type: 'select',
          default: 'text2video',
          options: [
            { value: 'text2video', label: '文生视频' },
            { value: 'image2video', label: '图生视频' },
            { value: 'multimodal2video', label: '全能参考' },
            { value: 'text2image', label: '文生图' },
            { value: 'image2image', label: '图生图' },
          ],
          labelMap: {
            text2video: '文生视频：纯文字描述生成视频，seedance2.0 系列模型',
            image2video: '图生视频：单张图片 + 提示词生成视频',
            multimodal2video: '全能参考：图片+视频+音频混合输入，最强视频模式',
            text2image: '文生图：纯文字描述生成图片，支持 3.0-5.0 模型',
            image2image: '图生图：基于参考图 + 提示词生成新图片',
          },
        },
        {
          key: 'videoModel',
          label: '视频模型',
          type: 'select',
          default: 'seedance2.0fast',
          options: [
            { value: 'seedance2.0fast', label: 'Seedance 2.0 Fast' },
            { value: 'seedance2.0', label: 'Seedance 2.0' },
            { value: 'seedance2.0fast_vip', label: 'Fast VIP' },
            { value: 'seedance2.0_vip', label: '2.0 VIP' },
          ],
          labelMap: {
            'seedance2.0fast': 'Seedance 2.0 Fast — 速度与质量平衡，推荐日常使用',
            'seedance2.0': 'Seedance 2.0 — 最高质量，生成较慢',
            'seedance2.0fast_vip': 'Fast VIP — 速度优先，VIP排队通道',
            'seedance2.0_vip': '2.0 VIP — 最高质量，VIP排队通道',
          },
          showIf: { field: 'genMode', value: 'text2video' },
        },
        {
          key: 'videoModelImg',
          label: '视频模型',
          type: 'select',
          default: 'seedance2.0fast',
          options: [
            { value: 'seedance2.0fast', label: 'Seedance 2.0 Fast' },
            { value: 'seedance2.0', label: 'Seedance 2.0' },
            { value: '3.5pro', label: '3.5 Pro' },
            { value: '3.0pro', label: '3.0 Pro' },
          ],
          showIf: { field: 'genMode', value: 'image2video' },
        },
        {
          key: 'videoModelMulti',
          label: '视频模型',
          type: 'select',
          default: 'seedance2.0fast',
          options: [
            { value: 'seedance2.0fast', label: 'Seedance 2.0 Fast' },
            { value: 'seedance2.0', label: 'Seedance 2.0' },
            { value: 'seedance2.0fast_vip', label: 'Fast VIP' },
            { value: 'seedance2.0_vip', label: '2.0 VIP' },
          ],
          showIf: { field: 'genMode', value: 'multimodal2video' },
        },
        {
          key: 'imageModel',
          label: '图片模型',
          type: 'select',
          default: '5.0',
          options: [
            { value: '5.0', label: '5.0 最新' },
            { value: '4.6', label: '4.6' },
            { value: '4.5', label: '4.5' },
            { value: '4.0', label: '4.0' },
          ],
          showIf: { field: 'genMode', value: 'text2image' },
        },
        {
          key: 'imageModelI2I',
          label: '图片模型',
          type: 'select',
          default: '5.0',
          options: [
            { value: '5.0', label: '5.0 最新' },
            { value: '4.6', label: '4.6' },
            { value: '4.5', label: '4.5' },
            { value: '4.0', label: '4.0' },
          ],
          showIf: { field: 'genMode', value: 'image2image' },
        },
        {
          key: 'duration',
          label: '视频时长',
          type: 'select',
          default: '5',
          options: [
            { value: '4', label: '4s' },
            { value: '5', label: '5s' },
            { value: '6', label: '6s' },
            { value: '7', label: '7s' },
            { value: '8', label: '8s' },
            { value: '9', label: '9s' },
            { value: '10', label: '10s' },
            { value: '11', label: '11s' },
            { value: '12', label: '12s' },
            { value: '13', label: '13s' },
            { value: '14', label: '14s' },
            { value: '15', label: '15s' },
          ],
          showIf: { field: 'genMode', value: 'text2video' },
        },
        {
          key: 'durationImg',
          label: '视频时长',
          type: 'select',
          default: '5',
          options: [
            { value: '3', label: '3s' },
            { value: '4', label: '4s' },
            { value: '5', label: '5s' },
            { value: '6', label: '6s' },
            { value: '7', label: '7s' },
            { value: '8', label: '8s' },
            { value: '9', label: '9s' },
            { value: '10', label: '10s' },
            { value: '11', label: '11s' },
            { value: '12', label: '12s' },
            { value: '13', label: '13s' },
            { value: '14', label: '14s' },
            { value: '15', label: '15s' },
          ],
          showIf: { field: 'genMode', value: 'image2video' },
        },
        {
          key: 'durationMulti',
          label: '视频时长',
          type: 'select',
          default: '5',
          options: [
            { value: '4', label: '4s' },
            { value: '5', label: '5s' },
            { value: '6', label: '6s' },
            { value: '7', label: '7s' },
            { value: '8', label: '8s' },
            { value: '9', label: '9s' },
            { value: '10', label: '10s' },
            { value: '11', label: '11s' },
            { value: '12', label: '12s' },
            { value: '13', label: '13s' },
            { value: '14', label: '14s' },
            { value: '15', label: '15s' },
          ],
          showIf: { field: 'genMode', value: 'multimodal2video' },
        },
        {
          key: 'ratio',
          label: '画面比例',
          type: 'select',
          default: '16:9',
          options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
            { value: '4:3', label: '4:3' },
            { value: '3:4', label: '3:4' },
            { value: '21:9', label: '21:9' },
          ],
        },
        {
          key: 'imgResolution',
          label: '图片分辨率',
          type: 'select',
          default: '4k',
          options: [
            { value: '4k', label: '4K' },
            { value: '2k', label: '2K' },
          ],
          showIf: { field: 'genMode', value: 'text2image' },
        },
        {
          key: 'imgResolutionI2I',
          label: '图片分辨率',
          type: 'select',
          default: '4k',
          options: [
            { value: '4k', label: '4K' },
            { value: '2k', label: '2K' },
          ],
          showIf: { field: 'genMode', value: 'image2image' },
        },
        {
          key: 'refImage',
          label: '参考图片',
          type: 'file',
          default: '',
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
          showIf: { field: 'genMode', value: 'image2video' },
        },
        {
          key: 'refImages',
          label: '参考图片',
          type: 'file-multi',
          default: [],
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
          showIf: { field: 'genMode', value: 'image2image' },
        },
        {
          key: 'refImagesMulti',
          label: '参考素材(图片)',
          type: 'file-multi',
          default: [],
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
          showIf: { field: 'genMode', value: 'multimodal2video' },
        },
      ],
    },
    promptTemplate: `[即梦生成] 请参考 ~/.kunpeng/skills/jimeng-cli/SKILL.md 规范，使用 dreamina {{genMode}} 命令。

模型：{{videoModel}}{{videoModelImg}}{{videoModelMulti}}{{imageModel}}{{imageModelI2I}}
时长：{{duration}}{{durationImg}}{{durationMulti}}s
比例：{{ratio}}
分辨率：{{imgResolution}}{{imgResolutionI2I}}
参考图：{{refImage}}{{refImages}}{{refImagesMulti}}

{{userContent}}

组装完整命令后展示给用户确认再执行。`,
  },

  // 5. Geography Video Effects
  {
    id: 'geography-video-effects',
    name: '地理特效',
    icon: 'globe',
    description: '根据地理文案生成特效图片',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'indigo',
    placeholder: '输入地理文案内容...',
    panel: {
      fields: [
        {
          key: 'style',
          label: '视觉风格',
          type: 'select',
          default: 'epic-cold',
          options: [
            { value: 'epic-cold', label: '史诗冷峻' },
            { value: 'vitality', label: '活力迸发' },
            { value: 'seasonal-hybrid', label: '季节混合' },
            { value: 'mixed', label: '综合混搭' },
          ],
          labelMap: {
            'epic-cold': '史诗冷峻 (epic-cold)',
            'vitality': '活力迸发 (vitality)',
            'seasonal-hybrid': '季节混合 (seasonal-hybrid)',
            'mixed': '综合混搭 (mixed)',
          },
        },
        {
          key: 'layout',
          label: '布局模式',
          type: 'select',
          default: 'single',
          options: [
            { value: 'single', label: '单图' },
            { value: 'grid-3x3', label: '九宫格' },
          ],
          labelMap: { 'single': '单图', 'grid-3x3': '九宫格 (grid-3x3)' },
        },
        {
          key: 'ratio',
          label: '画面比例',
          type: 'select',
          default: '16:9',
          options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
          ],
        },
        {
          key: 'resolution',
          label: '输出分辨率',
          type: 'select',
          default: '2K',
          options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
          ],
        },
      ],
    },
    promptTemplate: `[地理特效] 请参考 ~/.kunpeng/skills/geography-video-effects/SKILL.md 规范生成地理特效图片。

风格：{{style}}　布局：{{layout}}　比例：{{ratio}}　分辨率：{{resolution}}

{{userContent}}`,
  },

  // 3. Car Commercial Storyboard
  {
    id: 'car-commercial-storyboard',
    name: '汽车广告分镜',
    icon: 'car',
    description: '生成汽车广告分镜图片',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'indigo',
    placeholder: '输入广告场景描述（品牌 + 路线）...',
    panel: {
      fields: [
        {
          key: 'cameraMove',
          label: '运镜方式',
          type: 'select',
          default: 'chase',
          options: [
            { value: 'aerial', label: '航拍' },
            { value: 'chase', label: '跟拍' },
            { value: 'lead', label: '前拍' },
            { value: 'tracking', label: '追拍' },
            { value: 'close-up', label: '特写' },
            { value: 'wide', label: '广角' },
            { value: 'low-angle', label: '低仰拍' },
            { value: 'overhead', label: '顶视' },
          ],
          labelMap: {
            'aerial': '航拍俯瞰 (aerial)',
            'chase': '动态跟拍 (chase)',
            'lead': '前置跟拍 (lead)',
            'tracking': '平稳跟拍 (tracking)',
            'close-up': '特写镜头 (close-up)',
            'wide': '广角镜头 (wide)',
            'low-angle': '低角度仰拍 (low-angle)',
            'overhead': '顶视镜头 (overhead)',
          },
        },
        {
          key: 'lens',
          label: '镜头焦距',
          type: 'select',
          default: '24mm',
          options: [
            { value: '14mm', label: '14mm' },
            { value: '16mm', label: '16mm' },
            { value: '24mm', label: '24mm' },
            { value: '35mm', label: '35mm' },
            { value: '50mm', label: '50mm' },
            { value: '85mm', label: '85mm' },
            { value: '135mm', label: '135mm' },
            { value: '200mm', label: '200mm' },
          ],
        },
        {
          key: 'lensStyle',
          label: '镜头风格',
          type: 'select',
          default: '',
          options: [
            { value: '', label: '无' },
            { value: 'cinematic', label: '电影感' },
            { value: 'sharp', label: '锐利' },
            { value: 'creamy', label: '奶油虚化' },
            { value: 'vintage', label: '复古' },
            { value: 'artistic', label: '艺术' },
            { value: 'bokeh-soft', label: '柔焦' },
            { value: 'flare-style', label: '炫光' },
            { value: 'robert-alblas', label: 'R.Alblas' },
            { value: 'robert-alblas-night', label: '夜景' },
            { value: 'geo-epic', label: '地理史诗' },
            { value: 'cooke-classic', label: 'Cooke经典' },
            { value: 'cooke-s2-s3', label: 'Cooke复古' },
            { value: 'cooke-s4-s5', label: 'Cooke现代' },
            { value: 'spherical', label: '球面' },
            { value: 'focus-control', label: '可控焦' },
            { value: 'low-dispersion', label: '低色散' },
          ],
          labelMap: {
            'cinematic': '电影感 (cinematic)',
            'sharp': '锐利 (sharp)',
            'creamy': '奶油虚化 (creamy)',
            'vintage': '复古 (vintage)',
            'artistic': '艺术 (artistic)',
            'spherical': '球面 (spherical)',
            'focus-control': '可控焦点 (focus-control)',
            'bokeh-soft': '柔焦 (bokeh-soft)',
            'flare-style': '炫光 (flare-style)',
            'low-dispersion': '低色散 (low-dispersion)',
            'robert-alblas': 'Robbert Alblas电影感 (robert-alblas)',
            'robert-alblas-night': 'Robbert Alblas夜景 (robert-alblas-night)',
            'geo-epic': '地理史诗 (geo-epic)',
            'cooke-classic': 'Cooke经典 (cooke-classic)',
            'cooke-s2-s3': 'Cooke复古 (cooke-s2-s3)',
            'cooke-s4-s5': 'Cooke现代 (cooke-s4-s5)',
          },
        },
        {
          key: 'camera',
          label: '相机型号',
          type: 'select',
          default: 'arri-alexa',
          options: [
            { value: 'arri-alexa', label: 'ARRI' },
            { value: 'red-v-raptor', label: 'RED' },
            { value: 'sony-venice', label: 'SONY' },
            { value: 'canon-c300', label: 'Canon' },
            { value: 'blackmagic-ursa', label: 'BM' },
            { value: 'iphone-15-pro', label: 'iPhone' },
            { value: 'gopro-hero', label: 'GoPro' },
            { value: 'dji-ronin', label: 'DJI' },
          ],
          labelMap: {
            'arri-alexa': 'ARRI Alexa 35',
            'red-v-raptor': 'RED V-Raptor XL',
            'sony-venice': 'SONY Venice 2',
            'canon-c300': 'Canon C300 Mark III',
            'blackmagic-ursa': 'Blackmagic Ursa Mini Pro',
            'iphone-15-pro': 'iPhone 15 Pro Max',
            'gopro-hero': 'GoPro Hero 12',
            'dji-ronin': 'DJI Ronin 4D',
          },
        },
        {
          key: 'layout',
          label: '布局模式',
          type: 'select',
          default: 'grid-3x3',
          options: [
            { value: 'single', label: '单图' },
            { value: 'grid-3x3', label: '九宫格' },
          ],
          labelMap: { 'single': '单图', 'grid-3x3': '九宫格 (grid-3x3)' },
        },
        {
          key: 'ratio',
          label: '画面比例',
          type: 'select',
          default: '16:9',
          options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
          ],
        },
        {
          key: 'resolution',
          label: '输出分辨率',
          type: 'select',
          default: '2K',
          options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
          ],
        },
        {
          key: 'refImages',
          label: '参考图',
          type: 'file-multi',
          default: [],
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    },
    promptTemplate: `[汽车广告分镜] 请参考 ~/.kunpeng/skills/car-commercial-storyboard/SKILL.md 规范生成汽车广告分镜。

运镜：{{cameraMove}}　焦距：{{lens}}　风格：{{lensStyle}}　相机：{{camera}}
布局：{{layout}}　比例：{{ratio}}　分辨率：{{resolution}}
参考图：{{refImages}}

{{userContent}}`,
  },

  // 4. Video Copy Analyzer
  {
    id: 'video-copy-analyzer',
    name: '视频文案分析',
    icon: 'file-search',
    description: '分析视频文案内容',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'indigo',
    placeholder: '粘贴视频链接（B站 / YouTube / 抖音）...',
    panel: {
      fields: [
        {
          key: 'dimensions',
          label: '分析维度',
          type: 'select',
          default: 'textcontent',
          options: [
            { value: 'textcontent', label: 'TextContent' },
            { value: 'viral', label: 'Viral-5D' },
            { value: 'brainstorming', label: '头脑风暴' },
          ],
        },
        {
          key: 'outputDir',
          label: '输出目录',
          type: 'directory',
          default: '',
        },
        {
          key: 'screenshotEnabled',
          label: '截帧分析',
          type: 'toggle',
          default: false,
        },
        {
          key: 'frameCount',
          label: '截帧数量',
          type: 'number',
          default: 25,
          min: 1,
          max: 200,
          showIf: { field: 'screenshotEnabled', value: 'true' },
        },
        {
          key: 'analysisDesc',
          label: '分析描述',
          type: 'textarea',
          default: '',
          placeholder: '描述你想分析什么（留空使用默认提示词）',
          showIf: { field: 'screenshotEnabled', value: 'true' },
        },
      ],
    },
    promptTemplate: `[视频文案分析] 请参考 ~/.kunpeng/skills/video-copy-analyzer/SKILL.md 规范分析视频。

视频链接：{{userContent}}
分析维度：{{dimensions}}
输出目录：{{outputDir}}
截帧分析：{{screenshotEnabled}}　截帧数量：{{frameCount}}
分析描述：{{analysisDesc}}`,
  },

  // 5. Car Model Skill
  {
    id: 'car-model-skill',
    name: '汽车模型',
    icon: 'sparkles',
    description: '生成汽车3D模型图片',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'indigo',
    placeholder: '补充说明（可选）...',
    panel: {
      fields: [
        {
          key: 'brand',
          label: '品牌',
          type: 'input',
          default: '',
          placeholder: 'BMW / Mercedes / Audi',
        },
        {
          key: 'carModel',
          label: '车型',
          type: 'input',
          default: '',
          placeholder: 'X3 / A4 / Model S',
        },
        {
          key: 'referenceDir',
          label: '参考图',
          type: 'directory',
          default: '',
        },
        {
          key: 'outputDir',
          label: '输出目录',
          type: 'directory',
          default: '',
        },
      ],
    },
    promptTemplate: `[汽车模型生成] 请参考 ~/.kunpeng/skills/car-model-skill/SKILL.md 规范生成汽车 3D 模型展示图。

品牌：{{brand}}　车型：{{carModel}}
参考图目录：{{referenceDir}}　输出目录：{{outputDir}}

{{userContent}}`,
  },

  // 6. Digital Human Skill
  {
    id: 'digital-human-skill',
    name: '数字人',
    icon: 'user-round',
    description: '生成数字人形象',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'indigo',
    placeholder: '补充说明（可选）...',
    panel: {
      fields: [
        {
          key: 'personName',
          label: '人物名称',
          type: 'input',
          default: '',
          placeholder: '输入人物名称',
        },
        {
          key: 'referenceDir',
          label: '参考图',
          type: 'directory',
          default: '',
        },
        {
          key: 'height',
          label: '身高',
          type: 'input',
          default: '',
          placeholder: '如 175cm',
        },
        {
          key: 'weight',
          label: '体重',
          type: 'input',
          default: '',
          placeholder: '如 65kg',
        },
      ],
    },
    promptTemplate: `[数字人生成] 请参考 ~/.kunpeng/skills/digital-human-skill/SKILL.md 规范，使用 main_v4.py 生成数字人。

人物：{{personName}}　身高：{{height}}　体重：{{weight}}
参考图目录：{{referenceDir}}

{{userContent}}`,
  },

  // 7. Film Master Skill
  {
    id: 'film-master-skill',
    name: '电影大师',
    icon: 'clapperboard',
    description: '专业电影视觉生成',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'amber',
    placeholder: '描述画面叙事内容...',
    panel: {
      fields: [
        {
          key: 'director',
          label: '导演/电影风格',
          type: 'input',
          default: '',
          placeholder: '输入导演名或电影名，AI 自动适配风格',
        },
        {
          key: 'mode',
          label: '模式',
          type: 'select',
          default: 'single',
          options: [
            { value: 'single', label: '单镜头' },
            { value: 'storyboard', label: '九宫格分镜' },
          ],
        },
        // ── Single shot fields ──
        {
          key: 'purpose',
          label: '画面用途',
          type: 'select',
          default: 'storyboard-shot',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'storyboard-shot', label: '电影分镜' },
            { value: 'poster', label: '院线海报' },
            { value: 'concept-art', label: '概念图' },
            { value: 'character-design', label: '角色定妆' },
          ],
          labelMap: {
            'storyboard-shot': '电影分镜',
            'poster': '院线电影海报',
            'concept-art': '电影概念图',
            'character-design': '角色定妆照',
          },
        },
        {
          key: 'shotType',
          label: '景别',
          type: 'select',
          default: 'medium',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'extreme-long', label: '大远景' },
            { value: 'full', label: '全景' },
            { value: 'medium', label: '中景' },
            { value: 'close', label: '近景' },
            { value: 'extreme-close', label: '特写' },
            { value: 'ecl', label: '极端特写' },
          ],
          labelMap: {
            'extreme-long': '大远景航拍镜头，交代整体环境与空间关系',
            'full': '全景镜头，完整展示主体全貌与所处环境的空间关系',
            'medium': '中景镜头，聚焦人物上半身动作与情绪，兼顾环境背景',
            'close': '近景镜头，聚焦人物面部表情，捕捉细微的情绪变化',
            'extreme-close': '特写镜头，聚焦核心细节，画面无多余元素',
            'ecl': '极端特写镜头，高度放大关键信息，制造强烈视觉冲击',
          },
        },
        {
          key: 'angle',
          label: '拍摄角度',
          type: 'select',
          default: 'eye-level',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'low-up', label: '低角仰拍' },
            { value: 'high-down', label: '高角俯拍' },
            { value: 'eye-level', label: '眼平平拍' },
            { value: 'dutch', label: '荷兰斜角' },
          ],
          labelMap: {
            'low-up': '低角度仰拍，从地面向上拍摄，强化主体的力量感与史诗感',
            'high-down': '高角度俯拍，上帝视角，展示主体在宏大环境中的渺小感',
            'eye-level': '眼平平拍角度，与人物视线齐平，营造真实的代入感',
            'dutch': '荷兰斜角拍摄，画面倾斜，营造紧张不安的失控感',
          },
        },
        {
          key: 'lens',
          label: '镜头类型',
          type: 'select',
          default: 'anamorphic-35mm',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'anamorphic-35mm', label: '变形35mm' },
            { value: 'spherical-50mm', label: '球面50mm' },
            { value: 'telephoto', label: '长焦200mm' },
            { value: 'wide-24mm', label: '广角24mm' },
          ],
          labelMap: {
            'anamorphic-35mm': '35mm变形宽银幕电影镜头，2.39:1宽幅，椭圆形焦外虚化，高光横向拉丝光晕',
            'spherical-50mm': '50mm球面标准镜头，画面无畸变，透视符合人眼观感，真实自然的电影质感',
            'telephoto': '70-200mm长焦镜头，极强的空间压缩感，浅景深虚化背景，聚焦核心主体',
            'wide-24mm': '24mm广角镜头，开阔的横向视野，强化空间纵深感，完整展示宏大环境',
          },
        },
        {
          key: 'lighting',
          label: '布光',
          type: 'select',
          default: 'three-point',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'three-point', label: '三点布光' },
            { value: 'rembrandt', label: '伦勃朗光' },
            { value: 'butterfly', label: '蝴蝶光' },
            { value: 'hard-single', label: '单光源硬光' },
          ],
          labelMap: {
            'three-point': '电影级三点布光，主光塑造主体体积感，辅光弱化阴影死黑，轮廓光勾勒边缘分离背景',
            'rembrandt': '伦勃朗布光，人物面部形成标志性三角高光区，明暗对比强烈，塑造立体感与故事感',
            'butterfly': '蝴蝶光布光，正面柔光，人物鼻子下方形成柔和蝴蝶形阴影，质感细腻高级',
            'hard-single': '单光源硬光，高反差明暗对比，阴影硬朗锐利，营造强烈戏剧冲突感',
          },
        },
        {
          key: 'colorLight',
          label: '色光',
          type: 'select',
          default: 'complementary',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'warm', label: '暖色调' },
            { value: 'cool', label: '冷色调' },
            { value: 'complementary', label: '互补色' },
            { value: 'monochromatic', label: '同色系' },
          ],
          labelMap: {
            'warm': '暖色调（橙/黄/金），传递温暖、热血、归属感',
            'cool': '冷色调（蓝/青/紫），传递孤独、冷静、疏离感',
            'complementary': '互补色对比（蓝+橙），好莱坞商业片标准冷暖对比，视觉冲击力强',
            'monochromatic': '同色系渐变，画面和谐统一，氛围感强，东方美学',
          },
        },
        {
          key: 'composition',
          label: '构图',
          type: 'select',
          default: 'rule-of-thirds',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'rule-of-thirds', label: '三分法' },
            { value: 'symmetrical', label: '对称式' },
            { value: 'diagonal', label: '对角线' },
            { value: 'framing', label: '框架式' },
            { value: 'leading-lines', label: '引导线' },
          ],
          labelMap: {
            'rule-of-thirds': '三分法构图，核心主体置于画面黄金分割点，视觉平衡',
            'symmetrical': '严格对称式构图，画面左右完全对称，秩序感极强',
            'diagonal': '对角线构图，主体沿画面对角线分布，强烈动态感与冲击力',
            'framing': '框架式构图，通过前景门窗/建筑/自然元素形成画框，聚焦核心主体',
            'leading-lines': '引导线构图，通过公路/山脉/光线形成视觉引导线，将视线引至核心主体',
          },
        },
        {
          key: 'tone',
          label: '影调',
          type: 'select',
          default: 'mid-tone',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'high-key', label: '高调' },
            { value: 'low-key', label: '低调' },
            { value: 'mid-tone', label: '中间调' },
            { value: 'low-sat', label: '低饱和' },
            { value: 'high-sat', label: '高饱和' },
          ],
          labelMap: {
            'high-key': '高调电影影调，画面整体明亮通透，阴影占比极低，色彩清新柔和',
            'low-key': '低调电影影调，画面整体偏暗，仅核心主体有高光点缀，明暗对比强烈',
            'mid-tone': '中间调电影影调，明暗平衡，高光阴影层次丰富，好莱坞标准色彩分级',
            'low-sat': '低饱和电影影调，色彩饱和度低，整体偏灰，胶片质感细腻',
            'high-sat': '高饱和电影影调，色彩浓郁鲜艳，对比强烈，画面通透不油腻',
          },
        },
        {
          key: 'film',
          label: '胶片',
          type: 'select',
          default: 'kodak-5207',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: 'kodak-5207', label: '5207 日光' },
            { value: 'kodak-5219', label: '5219 夜景' },
            { value: '16mm', label: '16mm 复古' },
            { value: '8mm', label: '8mm 家庭' },
          ],
          labelMap: {
            'kodak-5207': '柯达5207 250D日光电影胶片，细腻胶片颗粒感，暖调柔和自然，高光层次丰富',
            'kodak-5219': '柯达5219 500T夜景电影胶片，细腻夜景胶片颗粒，暗部细节丰富无死黑，冷调氛围感',
            '16mm': '16mm复古电影胶片，明显胶片颗粒感，轻微划痕与暗角，色彩怀旧暖调',
            '8mm': '8mm复古家庭胶片，粗糙胶片颗粒，轻微画面抖动，高光光晕，色彩偏色怀旧',
          },
        },
        {
          key: 'ratio',
          label: '画面比例',
          type: 'select',
          default: '2.39:1',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: '2.39:1', label: '2.39:1' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
          ],
          labelMap: {
            '2.39:1': '2.39:1院线电影宽幅（2560×1072）',
            '16:9': '16:9标准宽屏（1920×1080）',
            '9:16': '9:16竖屏（1080×1920）',
            '1:1': '1:1方形画幅（1024×1024）',
          },
        },
        {
          key: 'resolution',
          label: '输出分辨率',
          type: 'select',
          default: '2K',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
          ],
        },
        {
          key: 'imageCount',
          label: '生成张数',
          type: 'select',
          default: '1',
          showIf: { field: 'mode', value: 'single' },
          options: [
            { value: '1', label: '1张' },
            { value: '2', label: '2张' },
            { value: '4', label: '4张' },
          ],
        },
        {
          key: 'refImages',
          label: '参考图',
          type: 'file-multi',
          default: [],
          showIf: { field: 'mode', value: 'single' },
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
        {
          key: 'outputDir',
          label: '输出目录',
          type: 'directory',
          default: '',
          showIf: { field: 'mode', value: 'single' },
        },
        // ── Storyboard fields ──
        {
          key: 'movieGenre',
          label: '电影类型',
          type: 'select',
          default: 'road-movie',
          showIf: { field: 'mode', value: 'storyboard' },
          options: [
            { value: 'road-movie', label: '公路励志' },
            { value: 'action', label: '动作' },
            { value: 'art-film', label: '文艺' },
            { value: 'fantasy', label: '东方奇幻' },
            { value: 'thriller', label: '悬疑惊悚' },
          ],
          labelMap: {
            'road-movie': '公路励志电影',
            'action': '动作电影',
            'art-film': '文艺片',
            'fantasy': '东方奇幻电影',
            'thriller': '悬疑惊悚片',
          },
        },
        {
          key: 'sbFilm',
          label: '胶片',
          type: 'select',
          default: 'kodak-5207',
          showIf: { field: 'mode', value: 'storyboard' },
          options: [
            { value: 'kodak-5207', label: '5207 日光' },
            { value: 'kodak-5219', label: '5219 夜景' },
            { value: '16mm', label: '16mm 复古' },
            { value: '8mm', label: '8mm 家庭' },
          ],
          labelMap: {
            'kodak-5207': '柯达5207 250D日光电影胶片',
            'kodak-5219': '柯达5219 500T夜景电影胶片',
            '16mm': '16mm复古电影胶片',
            '8mm': '8mm复古家庭胶片',
          },
        },
        {
          key: 'sbRatio',
          label: '画面比例',
          type: 'select',
          default: '2.39:1',
          showIf: { field: 'mode', value: 'storyboard' },
          options: [
            { value: '2.39:1', label: '2.39:1' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
          ],
        },
        {
          key: 'sbResolution',
          label: '输出分辨率',
          type: 'select',
          default: '2K',
          showIf: { field: 'mode', value: 'storyboard' },
          options: [
            { value: '1K', label: '1K' },
            { value: '2K', label: '2K' },
            { value: '4K', label: '4K' },
          ],
        },
        {
          key: 'sbImageCount',
          label: '每格张数',
          type: 'select',
          default: '1',
          showIf: { field: 'mode', value: 'storyboard' },
          options: [
            { value: '1', label: '1张' },
            { value: '4', label: '4张' },
          ],
        },
        {
          key: 'sbRefImages',
          label: '参考图',
          type: 'file-multi',
          default: [],
          showIf: { field: 'mode', value: 'storyboard' },
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
        },
      ],
    },
    promptTemplate: `[电影分镜设计] 请参考 ~/.kunpeng/skills/film-master/SKILL.md，先完成导演判断和镜头连续性设计，再使用普通对话当前选择的生图模型。

导演/电影风格：{{director}}

{{userContent}}

模式：{{mode}}　用途：{{purpose}}　景别：{{shotType}}　角度：{{angle}}
镜头：{{lens}}　布光：{{lighting}}　色光：{{colorLight}}　构图：{{composition}}
影调：{{tone}}　胶片：{{film}}{{sbFilm}}　比例：{{ratio}}{{sbRatio}}　分辨率：{{resolution}}{{sbResolution}}
张数：{{imageCount}}{{sbImageCount}}　类型：{{movieGenre}}
参考图：{{refImages}}{{sbRefImages}}　输出目录：{{outputDir}}
单镜允许单独生成；多镜共享环境时自动使用内部场景一致性规则。生成前先给镜头方案并等待确认。`,
  },

  // 8. RunningHub — 多媒体 AI 生成
  {
    id: 'rhtv',
    name: 'RunningHub',
    icon: 'tv',
    description: 'RunningHub AI 多媒体生成（视频/图片/音频/3D/AI应用，294个端点）',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'cyan',
    placeholder: '描述你想生成的内容...',
    panel: {
      fields: [
        {
          key: 'director',
          label: '导演/电影风格',
          type: 'input',
          default: '',
          placeholder: '输入导演名或电影名，留空不使用',
        },
        {
          key: 'taskType',
          label: '任务类型',
          type: 'select',
          default: 'text-to-video',
          options: [
            { value: 'text-to-video', label: '文生视频' },
            { value: 'image-to-video', label: '图生视频' },
            { value: 'text-to-image', label: '文生图' },
            { value: 'tts', label: '语音合成' },
            { value: 'music', label: '音乐生成' },
            { value: '3d', label: '3D 模型' },
            { value: 'ai-app', label: 'AI 应用' },
          ],
        },
        // ── 视频模型选择 ──
        {
          key: 'videoModel',
          label: '视频模型',
          type: 'select',
          default: 'rhart-video-v3.1-fast',
          showIf: { field: 'taskType', value: ['text-to-video', 'image-to-video'] },
          options: [
            { value: 'rhart-video-v3.1-fast', label: '全能视频V3.1 Fast' },
            { value: 'rhart-video-v3.1-pro', label: '全能视频V3.1 Pro' },
            { value: 'rhart-video-g', label: '全能视频X' },
            { value: 'rhart-video-s', label: '全能视频S (Sora)' },
            { value: 'kling-v3.0-pro', label: '可灵 3.0 Pro' },
            { value: 'vidu/q3-pro', label: 'Vidu Q3 Pro' },
            { value: 'minimax/hailuo-02', label: '海螺 Hailuo 02' },
            { value: 'rhart-video/sparkvideo-2.0', label: 'Seedance 2.0' },
            { value: 'rhart-video/sparkvideo-2.0-mini', label: 'Seedance 2.0 Mini' },
          ],
          labelMap: {
            'rhart-video-v3.1-fast': '全能视频V3.1 Fast — 16:9/9:16, 720p-4k, 8s',
            'rhart-video-v3.1-pro': '全能视频V3.1 Pro — 16:9/9:16, 720p-4k, 8s',
            'rhart-video-g': '全能视频X (Grok) — 多比例, 480-720p, 6-30s',
            'rhart-video-s': '全能视频S (Sora) — 16:9/9:16, 10-15s',
            'kling-v3.0-pro': '可灵 3.0 Pro — 3-15s, 支持音效, 负向提示词',
            'vidu/q3-pro': 'Vidu Q3 Pro — 360-1080p, 1-16s, 支持音频+动漫风格',
            'minimax/hailuo-02': '海螺 Hailuo 02 Pro — 自动提示词扩展',
            'rhart-video/sparkvideo-2.0': 'Seedance 2.0 — 480p-4k, 4-15s, 支持音频+21:9',
            'rhart-video/sparkvideo-2.0-mini': 'Seedance 2.0 Mini — 480p-4k, 4-15s, 低价0.3毛/秒',
          },
        },
        // ── 图片模型选择 ──
        {
          key: 'imageModel',
          label: '图片模型',
          type: 'select',
          default: 'rhart-image-g-2',
          showIf: { field: 'taskType', value: 'text-to-image' },
          options: [
            { value: 'rhart-image-g-2', label: '全能图片 G-2 / GPT Image 2' },
            { value: 'rhart-image-g-2-official', label: '全能图片 G-2 官方版' },
            { value: 'rhart-image-n-pro', label: '全能图片 PRO' },
            { value: 'rhart-image-n-g31-flash', label: '全能图片 V2' },
            { value: 'rhart-image-g-3', label: '全能图片 X-3 (Grok)' },
            { value: 'youchuan/v7', label: '悠船 v7 (MJ风格)' },
            { value: 'seedream-v5-lite', label: 'Seedream v5' },
          ],
          labelMap: {
            'rhart-image-g-2': '全能图片 G-2 / GPT Image 2 — 1k/2k/4k, 多种比例, 当前热门',
            'rhart-image-g-2-official': '全能图片 G-2 官方版 — GPT Image 2 官方稳定通道',
            'rhart-image-n-pro': '全能图片 PRO — 1k/2k/4k, 多种比例',
            'rhart-image-n-g31-flash': '全能图片 V2 — 1k/2k/4k, 极速出图',
            'rhart-image-g-3': '全能图片 X-3 (Grok) — 纯文本驱动, 无参数限制',
            'youchuan/v7': '悠船 v7 (MJ风格) — Midjourney 风格, chaos/stylize 参数',
            'seedream-v5-lite': 'Seedream v5 — 高分辨率, 支持 web_search',
          },
        },
        // ── 画面比例 ──
        {
          key: 'aspectRatio',
          label: '画面比例',
          type: 'select',
          default: '16:9',
          showIf: { field: 'taskType', value: ['text-to-video', 'image-to-video', 'text-to-image'] },
          options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' },
            { value: '4:3', label: '4:3' },
            { value: '3:4', label: '3:4' },
            { value: '3:2', label: '3:2' },
            { value: '2:3', label: '2:3' },
            { value: '21:9', label: '21:9' },
          ],
        },
        // ── 视频时长 ──
        {
          key: 'duration',
          label: '视频时长',
          type: 'select',
          default: '5',
          showIf: { field: 'taskType', value: ['text-to-video', 'image-to-video'] },
          options: [
            { value: '3', label: '3s' },
            { value: '4', label: '4s' },
            { value: '5', label: '5s' },
            { value: '6', label: '6s' },
            { value: '7', label: '7s' },
            { value: '8', label: '8s' },
            { value: '10', label: '10s' },
            { value: '12', label: '12s' },
            { value: '15', label: '15s' },
          ],
        },
        // ── 分辨率 ──
        {
          key: 'resolution',
          label: '分辨率',
          type: 'select',
          default: '720p',
          showIf: { field: 'taskType', value: ['text-to-video', 'image-to-video', 'text-to-image'] },
          options: [
            { value: '480p', label: '480p' },
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p' },
            { value: '1k', label: '1K' },
            { value: '2k', label: '2K' },
            { value: '4k', label: '4K' },
          ],
        },
        // ── 生成音频 ──
        {
          key: 'generateAudio',
          label: '生成音效',
          type: 'toggle',
          default: true,
          showIf: { field: 'taskType', value: ['text-to-video', 'image-to-video'] },
        },
        // ── 参考图片（图生视频） ──
        {
          key: 'refImage',
          label: '参考图片',
          type: 'file',
          default: '',
          extensions: ['png', 'jpg', 'jpeg', 'webp'],
          showIf: { field: 'taskType', value: 'image-to-video' },
        },
        // ── AI 应用 ID ──
        {
          key: 'webappId',
          label: 'AI 应用 ID',
          type: 'input',
          default: '',
          placeholder: '输入 webappId 或粘贴应用链接',
          showIf: { field: 'taskType', value: 'ai-app' },
        },
      ],
    },
    promptTemplate: `[RunningHub] 请参考 ~/.kunpeng/skills/rhtv/SKILL.md 规范执行任务。

导演/电影风格：{{director}}

任务类型：{{taskType}}
视频模型：{{videoModel}}
图片模型：{{imageModel}}
画面比例：{{aspectRatio}}
视频时长：{{duration}}s
分辨率：{{resolution}}
生成音效：{{generateAudio}}
参考图片：{{refImage}}
AI应用ID：{{webappId}}

{{userContent}}

重要：先确认用户意图和参数，展示给用户确认后再执行脚本。生成结果必须同步到画布。

模型→端点映射（agent 内部使用）：
- 视频模型 endpoint 格式：{videoModel}/text-to-video 或 {videoModel}/image-to-video
  - 特殊：vidu/q3-pro → vidu/text-to-video-q3-pro 或 vidu/image-to-video-q3-pro
  - 特殊：minimax/hailuo-02 → minimax/hailuo-02/t2v-pro 或 minimax/hailuo-02/i2v-pro
- 图片模型 endpoint 格式：{imageModel}/text-to-image
  - 特殊：youchuan/v7 → youchuan/text-to-image-v7`,
  },

  // 9. Ocean Engine Ad (巨量投流)
  {
    id: 'ocean-engine-ad',
    name: '巨量投流',
    icon: 'megaphone',
    description: '巨量引擎广告投放自动化（内置 Chromium 浏览器，跨平台）',
    version: '1.0.0',
    hasPanel: true,
    accentColor: 'orange',
    placeholder: '补充说明（如目标人群、投放时段等）...',
    panel: {
      fields: [
        {
          key: 'operation',
          label: '操作类型',
          type: 'select',
          default: 'free-chat',
          options: [
            { value: 'free-chat', label: '自由对话' },
            { value: 'create-project', label: '创建项目' },
            { value: 'add-keywords', label: '添加关键词' },
            { value: 'select-video', label: '选择视频' },
            { value: 'view-data', label: '查看数据' },
            { value: 'full-pipeline', label: '全流程投放' },
          ],
          labelMap: {
            'free-chat': '自由对话 — 用自然语言描述你想做什么',
            'create-project': '创建项目 — 在巨量引擎中创建新投放项目',
            'add-keywords': '添加关键词 — 为项目添加行为/兴趣关键词',
            'select-video': '选择视频 — 选择要投放的视频素材',
            'view-data': '查看数据 — 查看投放效果数据指标',
            'full-pipeline': '全流程投放 — 从创建到投放一站式完成',
          },
        },
        {
          key: 'projectName',
          label: '项目名称',
          type: 'input',
          default: '',
          placeholder: '输入投放项目名称',
          showIf: { field: 'operation', value: ['create-project', 'full-pipeline'] },
        },
        {
          key: 'budget',
          label: '日预算（元）',
          type: 'number',
          default: 300,
          min: 100,
          max: 100000,
          presets: [100, 300, 500, 1000, 3000],
          showIf: { field: 'operation', value: ['create-project', 'full-pipeline'] },
        },
        {
          key: 'searchCoeff',
          label: '搜索系数',
          type: 'number',
          default: 1.0,
          min: 0.1,
          max: 3.0,
          presets: [0.5, 1.0, 1.5, 2.0],
          showIf: { field: 'operation', value: ['create-project', 'full-pipeline'] },
        },
        {
          key: 'contentDescription',
          label: '内容描述',
          type: 'textarea',
          default: '',
          placeholder: '描述投放内容，用于 AI 生成关键词建议',
          showIf: { field: 'operation', value: ['add-keywords', 'full-pipeline'] },
        },
        {
          key: 'videoTitle',
          label: '视频标题',
          type: 'input',
          default: '',
          placeholder: '输入要投放的视频标题关键词',
          showIf: { field: 'operation', value: ['select-video', 'full-pipeline'] },
        },
        {
          key: 'bid',
          label: '出价（元）',
          type: 'number',
          default: 0.2,
          min: 0.01,
          max: 100,
          presets: [0.1, 0.2, 0.5, 1.0],
          showIf: { field: 'operation', value: ['select-video', 'full-pipeline'] },
        },
      ],
    },
    promptTemplate: `[巨量投流] 操作类型：{{operation}}

项目名称：{{projectName}}
日预算：{{budget}} 元
搜索系数：{{searchCoeff}}
内容描述：{{contentDescription}}
视频标题：{{videoTitle}}
出价：{{bid}} 元

{{userContent}}

执行规则：
1. 先调用 touliu_get_status 读取账户、登录和页面状态。
2. 创建计划、修改预算、出价或正式投放前，展示关键参数并等待用户确认。
3. 优先使用 touliu_get_status / touliu_open_safari / touliu_get_metrics / touliu_navigate / touliu_suggest_keywords / touliu_manage_account 等专用工具。
4. 专用工具无法覆盖时才使用 touliu_execute_js 精确降级；页面变化后重新读取状态，不复用失效选择器。
5. 复盘必须解释异常、原因、下一步实验和暂时不应调整的项目，不只罗列数据。
详细约束参考 ~/.kunpeng/skills/ocean-engine-ad/SKILL.md。`,
  },
];

const KIMI_VIDEO_ANALYSIS_SKILL: SkillManifest = {
  id: 'kimi-video-analysis',
  name: 'Kimi 拉片',
  icon: 'file-search',
  description: '用 Kimi 理解参考视频，分析镜头、节奏、表演与剪辑结构',
  version: '1.0.0',
  hasPanel: false,
  category: 'writing',
  visibility: 'toolbar',
  placeholder: '上传参考视频，并说明希望重点分析什么...',
  promptTemplate: `[Kimi 参考视频分析]
请使用鲲鹏现有 Kimi 视频分析链路，不再使用旧 video-copy-analyzer 脚本。
在剪辑项目中优先调用 timeline_analyze_reference_video；需要剪辑方案时再调用 timeline_kimi_edit_plan，需要成片复盘时调用 timeline_kimi_review。
分析必须覆盖：叙事结构、镜头切分、景别与机位、人物表演、运镜、节奏、声音、字幕/图形包装，以及可复用的制作方法。不要只写泛泛总结。

{{userContent}}`,
};

const PRODUCT_META: Record<string, Partial<SkillManifest>> = {
  'video-script-writer': { category: 'writing', visibility: 'toolbar', description: 'VLOG、品牌口播与知识科普风格文案' },
  'internet-ad-director': { category: 'writing', visibility: 'toolbar', name: '广告创意', description: '从产品、人群和平台出发设计广告创意与分镜策略' },
  'omni-mg-animation': { category: 'video', visibility: 'toolbar' },
  'video-style-replication': { category: 'video', visibility: 'toolbar', name: '参考片复刻', description: '从参考片提取视觉、节奏与镜头语言，生成可执行复刻方案' },
  'sketch-to-image': { category: 'storyboard', visibility: 'toolbar' },
  'dreamina-video': { category: 'integration', visibility: 'library' },
  'geography-video-effects': { category: 'visual', visibility: 'toolbar', name: '地理视觉' },
  'car-commercial-storyboard': { category: 'visual', visibility: 'toolbar', name: '汽车视觉制作', description: '统一完成汽车定妆、广告视觉与电影分镜' },
  'video-copy-analyzer': { category: 'internal', visibility: 'internal' },
  'car-model-skill': { category: 'internal', visibility: 'internal' },
  'digital-human-skill': { category: 'internal', visibility: 'internal' },
  'film-master-skill': { category: 'storyboard', visibility: 'toolbar', name: '电影分镜设计', description: '按专业景别、机位、构图、光线与连续性设计分镜' },
  rhtv: { category: 'integration', visibility: 'library' },
  'ocean-engine-ad': { category: 'marketing', visibility: 'toolbar', description: '巨量引擎投放规划、执行与数据复盘' },
};

function applyProductMeta(skill: SkillManifest): SkillManifest {
  return { ...skill, ...PRODUCT_META[skill.id] };
}

/**
 * Load skills from ~/.kunpeng/skills/ directory, with built-in fallbacks.
 * Disk skills override built-in skills by ID.
 */
export async function loadSkills(): Promise<SkillManifest[]> {
  // Start with built-in skills as a map
  const skillMap = new Map<string, SkillManifest>();
  for (const skill of [...BUILTIN_SKILLS, KIMI_VIDEO_ANALYSIS_SKILL]) {
    const normalized = applyProductMeta(skill);
    skillMap.set(normalized.id, normalized);
  }

  // Try to scan disk skills
  try {
    const home = await homeDir();
    const skillsDir = `${home}.kunpeng/skills`;
    const entries = await readDir(skillsDir).catch(async () => {
      // Directory doesn't exist — try to create it
      try {
        await createDir('.kunpeng/skills', { dir: BaseDirectory.Home, recursive: true });
        console.log('[skillLoader] Created ~/.kunpeng/skills/ directory');
      } catch {
        // ignore creation failure
      }
      return [];
    });

    for (const entry of entries) {
      if (!entry.path) continue;

      // Skip files (entries with extensions in name)
      if (entry.name?.includes('.')) continue;

      // 只加载带 skill.json 的技能到 tool 栏；
      // 只有 SKILL.md 的目录（给 agent 参考用的那种）静默跳过，不再刷日志。
      try {
        const manifestPath = `${entry.path}/skill.json`;
        const content = await readTextFile(manifestPath);
        const manifest: SkillManifest = JSON.parse(content);
        if (manifest.id) {
          console.log('[skillLoader] 已加载技能:', manifest.id, manifest.name);
          skillMap.set(manifest.id, applyProductMeta(manifest));
        }
      } catch {
        // skill.json 不存在或解析失败 —— 静默跳过
      }
    }
  } catch (err) {
    // ~/.kunpeng/skills/ doesn't exist, use built-in fallbacks only
    console.log('[skillLoader] Skills directory not found, using built-in fallbacks', err);
  }

  return Array.from(skillMap.values());
}

/**
 * Get all built-in skills (for cases where we don't need to scan disk).
 */
export function getBuiltinSkills(): SkillManifest[] {
  return [...BUILTIN_SKILLS, KIMI_VIDEO_ANALYSIS_SKILL].map(applyProductMeta);
}
