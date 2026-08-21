/**
 * projectTemplates — 成片结构模板（片头/内容槽/片尾骨架 + 预置转场/花字/BGM 位）。
 *
 * 应用 = 时间轴生成占位槽（PlaceholderSlot 渲染在主轨，无媒体路径），
 * 素材拖入自动填槽并裁剪到槽长。模板是结构性数据，不含媒体文件。
 */
import { useEditorStore } from '@/stores/editorStore';

export interface TemplateSlot {
  /** 槽位用途说明（显示在占位块上） */
  label: string;
  /** 建议时长（秒），素材填入后裁到此长度 */
  duration: number;
  /** 该槽结束后的转场（TransitionPreset id 或 'cut'） */
  transitionAfter: string;
  transitionDuration?: number;
}

export interface ProjectTemplateDef {
  id: string;
  label: string;
  desc: string;
  aspect: '16:9' | '9:16';
  slots: TemplateSlot[];
  /** 预置花字（相对模板时间轴的位置） */
  texts?: { templateId: string; text: string; startSec: number; endSec: number; position: 'top' | 'center' | 'bottom' }[];
  /** BGM 提示（不带媒体，应用后字幕提示用户挂 BGM） */
  bgmHint?: string;
}

export const PROJECT_TEMPLATES: ProjectTemplateDef[] = [
  {
    id: 'product-promo',
    label: '产品种草',
    desc: '钩子开场 → 3 个卖点 → 行动号召，竖屏带货节奏',
    aspect: '9:16',
    slots: [
      { label: '开场钩子（痛点/悬念）', duration: 3, transitionAfter: 'fadeblack', transitionDuration: 0.3 },
      { label: '卖点 1', duration: 5, transitionAfter: 'slideleft', transitionDuration: 0.4 },
      { label: '卖点 2', duration: 5, transitionAfter: 'slideleft', transitionDuration: 0.4 },
      { label: '卖点 3', duration: 5, transitionAfter: 'fade', transitionDuration: 0.4 },
      { label: '行动号召（购买/关注）', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'shake-impact', text: '别再踩坑了！', startSec: 0.3, endSec: 2.8, position: 'center' },
      { templateId: 'box-label', text: '卖点一', startSec: 3.2, endSec: 7.8, position: 'top' },
      { templateId: 'box-label', text: '卖点二', startSec: 8.2, endSec: 12.8, position: 'top' },
      { templateId: 'box-label', text: '卖点三', startSec: 13.2, endSec: 17.8, position: 'top' },
      { templateId: 'pop-bounce', text: '点击关注', startSec: 18.5, endSec: 21.5, position: 'center' },
    ],
    bgmHint: '建议节奏感强的电音/流行 BGM，卡转场点',
  },
  {
    id: 'knowledge-talk',
    label: '知识口播',
    desc: '观点开场 → 分论点展开 → 总结，横屏知识区节奏',
    aspect: '16:9',
    slots: [
      { label: '核心观点抛出', duration: 6, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '论点 1 展开', duration: 12, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '论点 2 展开', duration: 12, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '案例/演示', duration: 10, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '总结收尾', duration: 6, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'title-slide-up', text: '今天讲一个关键问题', startSec: 0.5, endSec: 4, position: 'bottom' },
      { templateId: 'underline-sweep', text: '论点一', startSec: 6.5, endSec: 10, position: 'top' },
      { templateId: 'underline-sweep', text: '论点二', startSec: 18.5, endSec: 22, position: 'top' },
      { templateId: 'big-quote', text: '记住这一点就够了', startSec: 41, endSec: 45, position: 'center' },
    ],
    bgmHint: '建议轻量 Lo-fi/钢琴底乐，音量 20% 以下',
  },
  {
    id: 'vlog-day',
    label: '日常 Vlog',
    desc: '标题卡 → 4 段生活片段 → 收尾，治愈系剪辑',
    aspect: '16:9',
    slots: [
      { label: '开场空镜/标题卡', duration: 4, transitionAfter: 'fadewhite', transitionDuration: 0.4 },
      { label: '片段 1（上午）', duration: 8, transitionAfter: 'fade', transitionDuration: 0.6 },
      { label: '片段 2（午后）', duration: 8, transitionAfter: 'fade', transitionDuration: 0.6 },
      { label: '片段 3（傍晚）', duration: 8, transitionAfter: 'dissolve', transitionDuration: 0.6 },
      { label: '片段 4（夜晚）', duration: 8, transitionAfter: 'fadeblack', transitionDuration: 0.8 },
      { label: '收尾定格', duration: 3, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'fade-letter', text: '平凡的一天', startSec: 0.8, endSec: 3.6, position: 'center' },
      { templateId: 'sub-clean', text: '又是被阳光叫醒的早晨', startSec: 5, endSec: 9, position: 'bottom' },
    ],
    bgmHint: '建议原声吉他/治愈钢琴，整段铺底',
  },
  {
    id: 'highlight-cut',
    label: '高光快剪',
    desc: '8 段短切快节奏，配踩点卡点，适合赛事/活动集锦',
    aspect: '9:16',
    slots: [
      { label: '冲击开场', duration: 2, transitionAfter: 'fadewhite', transitionDuration: 0.2 },
      { label: '高光 1', duration: 2.5, transitionAfter: 'zoomin', transitionDuration: 0.3 },
      { label: '高光 2', duration: 2.5, transitionAfter: 'slideleft', transitionDuration: 0.3 },
      { label: '高光 3', duration: 2.5, transitionAfter: 'circleopen', transitionDuration: 0.3 },
      { label: '高光 4', duration: 2.5, transitionAfter: 'slideright', transitionDuration: 0.3 },
      { label: '高光 5', duration: 2.5, transitionAfter: 'pixelize', transitionDuration: 0.3 },
      { label: '终极高光（慢放位）', duration: 4, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '落版 LOGO/口号', duration: 3, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'shake-impact', text: '高燃时刻', startSec: 0.2, endSec: 1.9, position: 'center' },
      { templateId: 'neon-glow', text: 'THE BEST', startSec: 19.5, endSec: 22.3, position: 'center' },
    ],
    bgmHint: '强节奏 BGM 必备——先挂 BGM 再点「智能踩点」，把切点吸到节拍上',
  },
  {
    id: 'ecom-review',
    label: '商品测评',
    desc: '开箱拆封 → 外观展示 → 功能实测 → 同类对比 → 评分总结，竖屏测评节奏',
    aspect: '9:16',
    slots: [
      { label: '开箱钩子', duration: 3, transitionAfter: 'fadeblack', transitionDuration: 0.3 },
      { label: '外观展示', duration: 6, transitionAfter: 'slideleft', transitionDuration: 0.4 },
      { label: '功能实测', duration: 8, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '同类对比', duration: 6, transitionAfter: 'fade', transitionDuration: 0.4 },
      { label: '评分总结', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'shake-impact', text: '开箱！', startSec: 0.3, endSec: 2.8, position: 'center' },
      { templateId: 'box-label', text: '外观', startSec: 3.2, endSec: 8.8, position: 'top' },
      { templateId: 'underline-sweep', text: '实测', startSec: 9.2, endSec: 16.8, position: 'top' },
      { templateId: 'big-quote', text: '值得入手', startSec: 23.5, endSec: 26.5, position: 'center' },
    ],
    bgmHint: '建议轻快电子/流行 BGM，卡开箱节奏',
  },
  {
    id: 'ecom-promo',
    label: '限时促销',
    desc: '倒计时制造紧迫 → 产品亮点 → 优惠详情 → 限时提醒 → 行动号召',
    aspect: '9:16',
    slots: [
      { label: '倒计时开场', duration: 3, transitionAfter: 'fadewhite', transitionDuration: 0.3 },
      { label: '产品亮点', duration: 5, transitionAfter: 'zoomin', transitionDuration: 0.4 },
      { label: '优惠详情', duration: 5, transitionAfter: 'slideleft', transitionDuration: 0.4 },
      { label: '限时提醒', duration: 4, transitionAfter: 'fade', transitionDuration: 0.4 },
      { label: '行动号召', duration: 3, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'neon-glow', text: '限时抢购', startSec: 0.2, endSec: 2.8, position: 'center' },
      { templateId: 'pop-bounce', text: '立省XX元', startSec: 8.2, endSec: 12.8, position: 'center' },
      { templateId: 'shake-impact', text: '最后1天', startSec: 13.2, endSec: 16.8, position: 'center' },
      { templateId: 'flash-cut', text: '立即下单', startSec: 17.5, endSec: 19.5, position: 'center' },
    ],
    bgmHint: '紧张感强的电音 BGM，节奏递进',
  },
  {
    id: 'tutorial-step',
    label: '分步教程',
    desc: '目标说明 → 步骤1-4 逐步拆解 → 总结回顾 → 资源引导',
    aspect: '16:9',
    slots: [
      { label: '今天学什么', duration: 5, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '步骤 1', duration: 10, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '步骤 2', duration: 10, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '步骤 3', duration: 10, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '步骤 4', duration: 8, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '总结回顾', duration: 5, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '资源&关注', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'title-slide-up', text: '跟我学', startSec: 0.5, endSec: 4, position: 'bottom' },
      { templateId: 'box-label', text: 'Step 1', startSec: 5.5, endSec: 14, position: 'top' },
      { templateId: 'box-label', text: 'Step 2', startSec: 15.5, endSec: 24, position: 'top' },
      { templateId: 'box-label', text: 'Step 3', startSec: 25.5, endSec: 34, position: 'top' },
      { templateId: 'box-label', text: 'Step 4', startSec: 35.5, endSec: 42, position: 'top' },
      { templateId: 'big-quote', text: '今天就学会了', startSec: 43.5, endSec: 47, position: 'center' },
    ],
    bgmHint: '轻量 Lo-fi/钢琴底乐，音量 15% 以下不抢解说',
  },
  {
    id: 'brand-story',
    label: '品牌故事',
    desc: '痛点共鸣 → 品牌理念 → 产品展示 → 数据背书 → 愿景展望',
    aspect: '16:9',
    slots: [
      { label: '痛点引入', duration: 6, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '品牌理念', duration: 8, transitionAfter: 'dissolve', transitionDuration: 0.6 },
      { label: '产品/服务展示', duration: 10, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '数据&成就', duration: 8, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '愿景展望', duration: 6, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '品牌落版', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'fade-letter', text: '每个人都值得...', startSec: 0.8, endSec: 5, position: 'center' },
      { templateId: 'title-slide-up', text: '我们的答案', startSec: 6.5, endSec: 12, position: 'bottom' },
      { templateId: 'underline-sweep', text: '已服务10000+用户', startSec: 24.5, endSec: 31, position: 'top' },
      { templateId: 'big-quote', text: '未来可期', startSec: 32.5, endSec: 37, position: 'center' },
    ],
    bgmHint: '大气弦乐/钢琴叙事配乐，情绪层层递进',
  },
  {
    id: 'interview-cut',
    label: '对谈采访',
    desc: '嘉宾介绍 → 核心问答 ×3 → 金句集锦 → 收尾感谢',
    aspect: '16:9',
    slots: [
      { label: '嘉宾介绍', duration: 5, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '问答 1', duration: 10, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '问答 2', duration: 10, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '问答 3', duration: 10, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '金句集锦', duration: 6, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '收尾感谢', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'title-slide-up', text: '对话嘉宾', startSec: 0.5, endSec: 4, position: 'bottom' },
      { templateId: 'sub-clean', text: 'Q1', startSec: 5.5, endSec: 14, position: 'bottom' },
      { templateId: 'sub-clean', text: 'Q2', startSec: 15.5, endSec: 24, position: 'bottom' },
      { templateId: 'sub-clean', text: 'Q3', startSec: 25.5, endSec: 34, position: 'bottom' },
      { templateId: 'big-quote', text: '金句', startSec: 35.5, endSec: 40, position: 'center' },
    ],
    bgmHint: '轻柔爵士/原声吉他，音量 10% 铺底不干扰对话',
  },
  {
    id: 'food-explore',
    label: '美食探店',
    desc: '外观吸引 → 环境介绍 → 招牌菜展示 → 品尝反应 → 打分推荐',
    aspect: '9:16',
    slots: [
      { label: '外观封面', duration: 3, transitionAfter: 'fadewhite', transitionDuration: 0.3 },
      { label: '店铺环境', duration: 5, transitionAfter: 'dissolve', transitionDuration: 0.5 },
      { label: '招牌菜 1', duration: 5, transitionAfter: 'zoomin', transitionDuration: 0.4 },
      { label: '招牌菜 2', duration: 5, transitionAfter: 'zoomin', transitionDuration: 0.4 },
      { label: '品尝', duration: 5, transitionAfter: 'fade', transitionDuration: 0.4 },
      { label: '打分推荐', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'pop-bounce', text: '必吃！', startSec: 0.3, endSec: 2.8, position: 'center' },
      { templateId: 'sub-clean', text: '环境', startSec: 3.2, endSec: 7.8, position: 'bottom' },
      { templateId: 'box-label', text: '招牌', startSec: 8.2, endSec: 12.8, position: 'top' },
      { templateId: 'box-label', text: '招牌', startSec: 13.2, endSec: 17.8, position: 'top' },
      { templateId: 'shake-impact', text: '绝了！', startSec: 18.5, endSec: 22, position: 'center' },
      { templateId: 'number-tag', text: '9.2', startSec: 23.5, endSec: 26.5, position: 'center' },
    ],
    bgmHint: '欢快/治愈系 BGM，让人感到温馨',
  },
  {
    id: 'travel-vlog',
    label: '旅行Vlog',
    desc: '出发期待 → 到达惊喜 → 景点精华 ×3 → 感悟收尾',
    aspect: '16:9',
    slots: [
      { label: '出发', duration: 4, transitionAfter: 'fadewhite', transitionDuration: 0.4 },
      { label: '到达', duration: 5, transitionAfter: 'dissolve', transitionDuration: 0.5 },
      { label: '景点 1', duration: 8, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '景点 2', duration: 8, transitionAfter: 'dissolve', transitionDuration: 0.5 },
      { label: '景点 3', duration: 8, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '旅途感悟', duration: 5, transitionAfter: 'fadeblack', transitionDuration: 0.6 },
      { label: '收尾定格', duration: 3, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'fade-letter', text: '出发吧', startSec: 0.8, endSec: 3.5, position: 'center' },
      { templateId: 'sub-clean', text: '到达', startSec: 4.5, endSec: 8.5, position: 'bottom' },
      { templateId: 'title-slide-up', text: '景点', startSec: 9.5, endSec: 13, position: 'bottom' },
      { templateId: 'big-quote', text: '旅行的意义', startSec: 34, endSec: 38, position: 'center' },
    ],
    bgmHint: '轻快/民谣原声配乐，整段铺底',
  },
  {
    id: 'year-review',
    label: '年度总结',
    desc: '开场回顾 → 数据里程碑 → 高光时刻 × 3 → 新年展望 → 感谢',
    aspect: '16:9',
    slots: [
      { label: '年度开场', duration: 5, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '数据回顾', duration: 8, transitionAfter: 'smoothleft', transitionDuration: 0.5 },
      { label: '高光 1', duration: 6, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '高光 2', duration: 6, transitionAfter: 'dissolve', transitionDuration: 0.5 },
      { label: '高光 3', duration: 6, transitionAfter: 'fade', transitionDuration: 0.5 },
      { label: '新年展望', duration: 5, transitionAfter: 'fadeblack', transitionDuration: 0.5 },
      { label: '感谢致辞', duration: 4, transitionAfter: 'cut' },
    ],
    texts: [
      { templateId: 'title-slide-up', text: '2024 年度回顾', startSec: 0.5, endSec: 4, position: 'center' },
      { templateId: 'underline-sweep', text: '里程碑', startSec: 5.5, endSec: 12, position: 'top' },
      { templateId: 'neon-glow', text: 'THE BEST', startSec: 13.5, endSec: 18, position: 'center' },
      { templateId: 'big-quote', text: '感谢每一位', startSec: 36, endSec: 39.5, position: 'center' },
    ],
    bgmHint: '大气/史诗感配乐，从舒缓到激昂递进',
  },
];

export function findProjectTemplate(id: string): ProjectTemplateDef | undefined {
  return PROJECT_TEMPLATES.find((t) => t.id === id);
}

/**
 * 应用成片模板：清空时间轴 → 生成占位槽（clips 用空路径 + 槽 label）+ 预置花字。
 * 占位槽 path='' 由时间轴渲染为虚线槽位块；素材拖到槽上调用 fillTemplateSlot。
 */
export function applyProjectTemplate(tpl: ProjectTemplateDef): void {
  const s = useEditorStore.getState();
  s.clearAll();
  s.setAspect(tpl.aspect);
  const clips = tpl.slots.map((slot, i) => ({
    id: `slot-${Date.now()}-${i}`,
    path: '',
    label: `🎬 ${slot.label}`,
    duration: slot.duration,
    inSec: 0,
    outSec: slot.duration,
    transitionAfter: {
      type: slot.transitionAfter,
      duration: slot.transitionAfter === 'cut' ? 0 : (slot.transitionDuration ?? 0.5),
    },
  }));
  useEditorStore.setState({ clips });
  for (const t of tpl.texts ?? []) {
    s.addTextClip({ text: t.text, templateId: t.templateId, startSec: t.startSec, endSec: t.endSec, position: t.position });
  }
}

/** 素材填入占位槽：保留槽长与转场，写入媒体路径并按槽长裁剪 */
export async function fillTemplateSlot(slotClipId: string, mediaPath: string): Promise<boolean> {
  const { probeDuration } = await import('@/lib/canvas/videoCompose');
  const s = useEditorStore.getState();
  const slot = s.clips.find((c) => c.id === slotClipId && c.path === '');
  if (!slot) return false;
  const mediaDur = (await probeDuration(mediaPath)) || slot.duration;
  const slotLen = slot.outSec - slot.inSec;
  s.updateClip(slotClipId, {
    path: mediaPath,
    label: slot.label.replace(/^🎬 /, ''),
    duration: mediaDur,
    inSec: 0,
    outSec: Math.min(mediaDur, slotLen),
  });
  return true;
}
