/**
 * fontSystem — 字体定义、配对、加载器。
 *
 * 三层字体来源：系统字体(零成本) / 嵌入 woff2 / Google Fonts CDN。
 * 花字/特效模板通过 var(--fx-font-title) / var(--fx-font-body) 引用，
 * 不再硬编码 font-family，实现字体与模板解耦。
 */

export interface FontDef {
  id: string;
  label: string;
  family: string;
  category: '黑体' | '宋体' | '楷体' | '手写' | '艺术' | '等宽';
  weight: number[];
  source: 'system' | 'embedded' | 'cdn';
  platform?: 'mac' | 'win' | 'all';
  tags: ('标题' | '正文' | '强调' | '综艺' | '文艺' | '商务')[];
}

export interface FontPairing {
  id: string;
  label: string;
  titleFont: string;
  bodyFont: string;
  tags: string[];
}

// ── 字体清单 ────────────────────────────────────────────────────────────────

export const FONTS: FontDef[] = [
  // 系统字体
  { id: 'pingfang', label: '苹方', family: "'PingFang SC'", category: '黑体', weight: [100, 200, 300, 400, 500, 600], source: 'system', platform: 'mac', tags: ['正文'] },
  { id: 'msyh', label: '微软雅黑', family: "'Microsoft YaHei'", category: '黑体', weight: [300, 400, 700], source: 'system', platform: 'win', tags: ['正文'] },
  { id: 'stsong', label: '华文宋体', family: "'STSongti-SC', 'STSong'", category: '宋体', weight: [300, 400, 700], source: 'system', platform: 'mac', tags: ['标题', '文艺'] },
  { id: 'stkaiti', label: '华文楷体', family: "'STKaiti', 'KaiTi'", category: '楷体', weight: [400], source: 'system', platform: 'mac', tags: ['文艺'] },
  { id: 'hiragino', label: 'Hiragino Sans', family: "'Hiragino Sans GB'", category: '黑体', weight: [300, 600], source: 'system', platform: 'mac', tags: ['正文', '商务'] },
  { id: 'stxihei', label: '华文细黑', family: "'STXihei'", category: '黑体', weight: [300], source: 'system', platform: 'mac', tags: ['标题'] },
  { id: 'simsun', label: '宋体', family: "'SimSun', 'NSimSun'", category: '宋体', weight: [400], source: 'system', platform: 'win', tags: ['标题', '文艺'] },

  // 嵌入 / CDN 开源中文字体
  { id: 'noto-serif', label: '思源宋体', family: "'Noto Serif SC'", category: '宋体', weight: [200, 300, 400, 500, 600, 700, 900], source: 'cdn', platform: 'all', tags: ['标题', '文艺', '商务'] },
  { id: 'noto-sans', label: '思源黑体', family: "'Noto Sans SC'", category: '黑体', weight: [100, 300, 400, 500, 700, 900], source: 'cdn', platform: 'all', tags: ['正文', '标题', '商务'] },
  { id: 'zcool-xiaowei', label: '站酷小薇', family: "'ZCOOL XiaoWei'", category: '手写', weight: [400], source: 'cdn', platform: 'all', tags: ['综艺', '文艺'] },
  { id: 'zcool-huangyou', label: '站酷庆科黄油体', family: "'ZCOOL QingKe HuangYou'", category: '艺术', weight: [400], source: 'cdn', platform: 'all', tags: ['综艺', '强调'] },
  { id: 'zcool-kuaile', label: '站酷快乐体', family: "'ZCOOL KuaiLe'", category: '艺术', weight: [400], source: 'cdn', platform: 'all', tags: ['综艺', '强调'] },
  { id: 'mashan', label: '马善政毛笔楷书', family: "'Ma Shan Zheng'", category: '楷体', weight: [400], source: 'cdn', platform: 'all', tags: ['文艺'] },
  { id: 'liujian', label: '柳建猫草', family: "'Liu Jian Mao Cao'", category: '手写', weight: [400], source: 'cdn', platform: 'all', tags: ['文艺'] },
  { id: 'longcang', label: '龙藏体', family: "'Long Cang'", category: '手写', weight: [400], source: 'cdn', platform: 'all', tags: ['标题', '文艺'] },

  // 西文搭配
  { id: 'dm-serif', label: 'DM Serif Display', family: "'DM Serif Display'", category: '宋体', weight: [400], source: 'cdn', platform: 'all', tags: ['标题'] },
  { id: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk'", category: '黑体', weight: [300, 400, 500, 600, 700], source: 'cdn', platform: 'all', tags: ['标题', '商务'] },
  { id: 'playfair', label: 'Playfair Display', family: "'Playfair Display'", category: '宋体', weight: [400, 500, 600, 700, 800, 900], source: 'cdn', platform: 'all', tags: ['标题', '商务'] },
  { id: 'jetbrains', label: 'JetBrains Mono', family: "'JetBrains Mono'", category: '等宽', weight: [400, 700], source: 'cdn', platform: 'all', tags: ['强调'] },
  { id: 'instrument-serif', label: 'Instrument Serif', family: "'Instrument Serif'", category: '宋体', weight: [400], source: 'cdn', platform: 'all', tags: ['标题', '文艺'] },
];

// ── 字体配对 ────────────────────────────────────────────────────────────────

export const FONT_PAIRINGS: FontPairing[] = [
  {
    id: 'minimal',
    label: '极简克制（苹方/思源黑，Apple 风）',
    titleFont: "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    bodyFont: "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    tags: ['苹果风', '商务', '极简', '默认'],
  },
  {
    id: 'editorial',
    label: '编辑杂志（思源宋标题）',
    titleFont: "'Noto Serif SC', 'Songti SC', 'STSongti-SC', serif",
    bodyFont: "-apple-system, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
    tags: ['高端', '品牌', '杂志'],
  },
  {
    id: 'tech',
    label: '科技理性（英文/数字用 Space Grotesk）',
    titleFont: "'Space Grotesk', -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
    bodyFont: "-apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
    tags: ['数码', '测评', '科技'],
  },
  {
    id: 'luxury',
    label: '奢华品牌（Playfair 衬线）',
    titleFont: "'Playfair Display', 'Noto Serif SC', 'Songti SC', serif",
    bodyFont: "-apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif",
    tags: ['品牌', 'TVC', '奢华'],
  },
  {
    id: 'variety',
    label: '综艺活力（庆科黄油体）',
    titleFont: "'ZCOOL QingKe HuangYou', -apple-system, 'PingFang SC', sans-serif",
    bodyFont: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    tags: ['短视频', '综艺', '活力'],
  },
  {
    id: 'literary',
    label: '文艺（思源宋）',
    titleFont: "'Noto Serif SC', 'Songti SC', 'STKaiti', serif",
    bodyFont: "'Noto Serif SC', 'Songti SC', 'STSongti-SC', serif",
    tags: ['故事', '情感', '文艺'],
  },
];

export const DEFAULT_FONT_PAIRING = 'minimal';

export function pairingOf(id?: string): FontPairing {
  return FONT_PAIRINGS.find((p) => p.id === id) ?? FONT_PAIRINGS.find((p) => p.id === DEFAULT_FONT_PAIRING)!;
}

// ── CSS 变量注入 ────────────────────────────────────────────────────────────

export function fontCssVars(pairing: FontPairing): string {
  return `--fx-font-title: ${pairing.titleFont}; --fx-font-body: ${pairing.bodyFont}`;
}

// ── 字体加载器 ──────────────────────────────────────────────────────────────

const GOOGLE_FONTS_BASE = 'https://fonts.googleapis.com/css2';

const CDN_FONT_SPECS: Record<string, string> = {
  'Noto Serif SC': 'Noto+Serif+SC:wght@200;300;400;500;600;700;900',
  'Noto Sans SC': 'Noto+Sans+SC:wght@100;300;400;500;700;900',
  'ZCOOL XiaoWei': 'ZCOOL+XiaoWei',
  'ZCOOL QingKe HuangYou': 'ZCOOL+QingKe+HuangYou',
  'ZCOOL KuaiLe': 'ZCOOL+KuaiLe',
  'Ma Shan Zheng': 'Ma+Shan+Zheng',
  'Liu Jian Mao Cao': 'Liu+Jian+Mao+Cao',
  'Long Cang': 'Long+Cang',
  'DM Serif Display': 'DM+Serif+Display',
  'Space Grotesk': 'Space+Grotesk:wght@300;400;500;600;700',
  'Playfair Display': 'Playfair+Display:wght@400;500;600;700;800;900',
  'JetBrains Mono': 'JetBrains+Mono:wght@400;700',
  'Instrument Serif': 'Instrument+Serif',
};

let _loadedFonts = new Set<string>();

/**
 * 按需加载字体配对中使用的 CDN 字体。
 * 通过 <link rel="stylesheet"> 注入 Google Fonts CSS，浏览器自动处理子集和缓存。
 */
export function loadFontPairing(pairing: FontPairing): void {
  const families = extractFamilies(pairing.titleFont).concat(extractFamilies(pairing.bodyFont));
  const toLoad = families.filter((f) => CDN_FONT_SPECS[f] && !_loadedFonts.has(f));
  if (toLoad.length === 0) return;

  const specs = toLoad.map((f) => CDN_FONT_SPECS[f]).filter(Boolean);
  if (specs.length === 0) return;

  const url = `${GOOGLE_FONTS_BASE}?family=${specs.join('&family=')}&display=swap`;
  if (document.querySelector(`link[href="${url}"]`)) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);

  for (const f of toLoad) _loadedFonts.add(f);
}

/**
 * 生成可嵌入 doc.css 的字体加载 CSS（@import Google Fonts）。
 * 预览端 <link> 注入只对 app document 生效；导出端 stage.html 是独立文档，
 * 必须把字体 CSS 随 doc.css 带过去（render-worker 已有 networkidle0 + fonts.ready 等待）。
 */
export function fontFaceCss(pairing: FontPairing): string {
  const families = extractFamilies(pairing.titleFont).concat(extractFamilies(pairing.bodyFont));
  const specs = [...new Set(families.map((f) => CDN_FONT_SPECS[f]).filter(Boolean))];
  if (specs.length === 0) return '';
  return `@import url('${GOOGLE_FONTS_BASE}?family=${specs.join('&family=')}&display=swap');`;
}

function extractFamilies(css: string): string[] {
  return css
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s && s !== 'serif' && s !== 'sans-serif' && s !== 'monospace');
}

/** 重置（测试用） */
export function _resetLoadedFonts(): void {
  _loadedFonts = new Set();
}
