/**
 * styleKits — 艺术方向套件层。
 *
 * 一个 Style Kit = 完整的美学人格：配色 + 字体 + 全场质感层（签名装饰）
 * + 专属 CSS + 运动性格。spec.style 一个字段激活整套语言，
 * 场景内所有维度（构图/质感/排版/色彩/运动）被同一美学协调。
 *
 * 每个 kit 的 signatureHtml 是插在 kp-cam 之外（不随镜头）与之内（随镜头）的
 * 装饰层；motionNotes 是给 agent 的运动性格提示（写进工具文档）。
 * 全部 Chromium 渲染安全（导出走真实 Chromium，backdrop-filter/mask/blend 均可用）。
 */

export interface StyleKit {
  id: string;
  label: string;
  /** 家族分组（doc 分组用） */
  family: string;
  /** 给 agent 的一句气质描述 */
  vibe: string;
  /** CSS 变量覆盖（在 theme 之上），--fx-* 与 --kp-* */
  cssVars: Record<string, string>;
  /** 字体配对 id（fontSystem） */
  fontPairing: string;
  /** opaque 时默认背景 */
  bgCss: string;
  /** 签名装饰层：插在场景底部（z 最低，不随镜头，parallax 0 语义） */
  backdropHtml?: string;
  /** 签名装饰层：插在场景顶部（z 最高，压在内容上，如暗角/扫描线/颗粒） */
  foregroundHtml?: string;
  /** kit 专属 CSS（类名带 kit 前缀避免冲突） */
  css?: string;
  /** 运动性格（给 agent）：速度域/常用原语/节奏 */
  motionNotes: string;
}

/* eslint-disable max-len */

export const CORE_KITS: StyleKit[] = [
  {
    id: 'guofeng',
    family: '东方美学',
    label: '国风墨韵',
    vibe: '宣纸底、墨色晕染、朱砂印章、竖排衬线、留白如画——东方叙事/文化/茶酒香',
    cssVars: {
      '--fx-primary': '#f5f1e8', '--fx-accent': '#b03a2e', '--fx-accent2': '#8a6f4d',
      '--fx-text': '#2b2620', '--fx-surface': 'rgba(43,38,32,0.06)',
    },
    fontPairing: 'literary',
    bgCss: 'radial-gradient(ellipse 90% 70% at 50% 30%, #f8f4ec 0%, #efe9db 70%, #e8e0cf 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div class="kp-noise" style="position:absolute;inset:0"></div>
<div style="position:absolute;right:-12%;top:-18%;width:900px;height:900px;border-radius:50%;background:radial-gradient(circle,rgba(43,38,32,0.07),transparent 65%);filter:blur(8px)"></div>
<div style="position:absolute;left:6%;bottom:10%;width:420px;height:2px;background:linear-gradient(90deg,rgba(43,38,32,0.35),transparent)"></div>
</div>`,
    foregroundHtml: `<div style="position:absolute;right:6.5%;bottom:9%;width:74px;height:74px;border:3px solid #b03a2e;border-radius:10px;display:flex;align-items:center;justify-content:center;font-family:'Noto Serif SC',serif;font-size:34px;font-weight:700;color:#b03a2e;transform:rotate(-3deg);opacity:.85">印</div>`,
    css: `.kit-guofeng-ink{position:absolute;background:radial-gradient(ellipse,rgba(43,38,32,0.12),transparent 70%);filter:blur(14px);border-radius:50%}
.kit-guofeng-rule{width:2px;background:linear-gradient(180deg,transparent,rgba(43,38,32,0.4),transparent)}`,
    motionNotes: '慢稳（outQuart 1.0-1.4s），maskReveal 如卷轴展开（dir:left/top），kp-vert 竖排+kp-serif，忌 shake/glitch；印章元素最后 scale 0.8→1 outBack 落款',
  },
  {
    id: 'cyber',
    family: '科技未来',
    label: '赛博霓虹',
    vibe: 'HUD 边框、霓虹辉光、故障字、扫描线、数据流——科技/游戏/未来感',
    cssVars: {
      '--fx-primary': '#07080f', '--fx-accent': '#00f0ff', '--fx-accent2': '#ff2d95',
      '--fx-text': '#e8faff', '--fx-surface': 'rgba(0,240,255,0.06)',
    },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(180deg,#07080f 0%,#0b0e1d 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div class="kp-grid" style="position:absolute;inset:0;opacity:.35"></div>
<div style="position:absolute;left:50%;bottom:-30%;width:1600px;height:800px;transform:translateX(-50%);background:radial-gradient(ellipse 50% 55% at 50% 100%,rgba(0,240,255,0.14),transparent 70%)"></div>
</div>`,
    foregroundHtml: `<div style="position:absolute;inset:0;pointer-events:none">
<div class="kp-scanline" style="position:absolute;inset:0;opacity:.5"></div>
<div style="position:absolute;left:56px;top:52px;width:120px;height:120px;border-left:2px solid rgba(0,240,255,.6);border-top:2px solid rgba(0,240,255,.6)"></div>
<div style="position:absolute;right:56px;bottom:52px;width:120px;height:120px;border-right:2px solid rgba(0,240,255,.6);border-bottom:2px solid rgba(0,240,255,.6)"></div>
<div style="position:absolute;right:60px;top:58px;font-family:'Space Grotesk',monospace;font-size:15px;letter-spacing:.22em;color:rgba(0,240,255,.55)">SYS//ONLINE</div>
</div>`,
    css: `.kit-cyber-neon{text-shadow:0 0 10px currentColor,0 0 34px color-mix(in srgb,currentColor 65%,transparent)}
.kit-cyber-hud{border:1.5px solid rgba(0,240,255,.4);background:rgba(0,240,255,.05);clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,22px 100%,0 calc(100% - 22px))}`,
    motionNotes: '快脆+电子感：typewriter 打数据、glitch 做转场点缀、shine 循环扫 HUD、kineticText from{x:-30,opacity:0} stagger 0.03 快速拼装；标题加 kit-cyber-neon',
  },
  {
    id: 'swiss',
    family: '编辑版式',
    label: '瑞士极简',
    vibe: '大网格、超大字重对比、红黑白、精确对齐、负空间——国际主义平面/宣言感',
    cssVars: {
      '--fx-primary': '#f4f2ee', '--fx-accent': '#e2261f', '--fx-accent2': '#111111',
      '--fx-text': '#111111', '--fx-surface': 'rgba(17,17,17,0.05)',
    },
    fontPairing: 'minimal',
    bgCss: '#f4f2ee',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:64px;right:64px;top:0;bottom:0;border-left:1.5px solid rgba(17,17,17,.14);border-right:1.5px solid rgba(17,17,17,.14)"></div>
<div style="position:absolute;left:0;right:0;top:88px;height:1.5px;background:rgba(17,17,17,.14)"></div>
</div>`,
    foregroundHtml: `<div style="position:absolute;left:64px;bottom:46px;font-size:15px;font-weight:600;letter-spacing:.2em;color:rgba(17,17,17,.5)">GRID·SYSTEM</div>`,
    css: `.kit-swiss-block{background:#e2261f;color:#f4f2ee}`,
    motionNotes: '干净利落：maskReveal 直切（inOutExpo 0.5s）、色块 scaleX 0→1、文字无弹簧直线入场；忌辉光/噪点/圆角，一切直角与直线；红色只给一个元素',
  },
  {
    id: 'immersive3d',
    family: '科技未来',
    label: '3D 沉浸',
    vibe: '真实透视深度、悬浮层叠卡、空间光影、缓慢轨道镜头——产品/概念/沉浸叙事',
    cssVars: {
      '--fx-primary': '#0a0c14', '--fx-accent': '#7c9fff', '--fx-accent2': '#b47cff',
      '--fx-text': '#eef1ff', '--fx-surface': 'rgba(124,159,255,0.07)',
    },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 70% 60% at 50% 35%,#131629 0%,#0a0c14 70%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden;perspective:1200px">
<div style="position:absolute;left:50%;top:62%;width:2400px;height:1400px;transform:translateX(-50%) rotateX(72deg);background-image:linear-gradient(rgba(124,159,255,.14) 1.5px,transparent 1.5px),linear-gradient(90deg,rgba(124,159,255,.14) 1.5px,transparent 1.5px);background-size:110px 110px;mask-image:radial-gradient(ellipse 55% 60% at 50% 30%,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse 55% 60% at 50% 30%,#000 30%,transparent 75%)"></div>
<div class="kp-glow" style="width:1000px;height:1000px;left:50%;top:20%;transform:translateX(-50%)"></div>
</div>`,
    foregroundHtml: `<div class="kp-vignette" style="position:absolute;inset:0"></div>`,
    css: `.kit-3d-card{transform-style:preserve-3d;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);border-radius:22px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 40px 120px rgba(0,0,0,.5)}
.kit-3d-tilt-l{transform:rotateY(14deg) rotateX(4deg)}
.kit-3d-tilt-r{transform:rotateY(-14deg) rotateX(4deg)}`,
    motionNotes: '空间感优先：camera 慢推(scale 1→1.08 全程 linear)+各层 parallax 拉开(0.3/0.7/1/1.15)；卡片用 kit-3d-card + html 内层 kit-3d-tilt-l/r 透视倾斜（导出 Chromium 支持 3D transform）；速度域慢稳',
  },
  {
    id: 'retro',
    family: '复古年代',
    label: '复古胶片',
    vibe: '暖褪色、粗颗粒、圆衬线、胶片边框、日期戳——回忆/生活/人文纪录',
    cssVars: {
      '--fx-primary': '#211c16', '--fx-accent': '#e8a33d', '--fx-accent2': '#c96f4a',
      '--fx-text': '#f3e9d8', '--fx-surface': 'rgba(243,233,216,0.08)',
    },
    fontPairing: 'editorial',
    bgCss: 'radial-gradient(ellipse 85% 75% at 50% 40%,#2a241c 0%,#1b1712 80%)',
    backdropHtml: `<div class="kp-noise" style="position:absolute;inset:0;opacity:1"></div>`,
    foregroundHtml: `<div style="position:absolute;inset:0;pointer-events:none">
<div class="kp-vignette" style="position:absolute;inset:0"></div>
<div style="position:absolute;right:70px;bottom:56px;font-family:'Space Grotesk',monospace;font-size:26px;letter-spacing:.1em;color:rgba(232,163,61,.75);text-shadow:0 0 8px rgba(232,163,61,.5)">'98 06 21</div>
<div style="position:absolute;left:0;top:0;bottom:0;width:26px;background:repeating-linear-gradient(0deg,transparent 0 34px,rgba(0,0,0,.5) 34px 54px)"></div>
<div style="position:absolute;right:0;top:0;bottom:0;width:26px;background:repeating-linear-gradient(0deg,transparent 0 34px,rgba(0,0,0,.5) 34px 54px)"></div>
</div>`,
    css: `.kit-retro-fade{filter:sepia(.22) saturate(.85) contrast(.94)}`,
    motionNotes: '柔和微晃：整体可加极轻 shake(amp 2, freq 4, 全程) 模拟手持；入场用 opacity+blur 显影感（blur 8→0, 1s）；kp-serif 标题；忌高饱和忌快切',
  },
  {
    id: 'brutal',
    family: '潮流活力',
    label: '粗野实验',
    vibe: '生硬色块、错位堆叠、系统字直排、超大描边、故意"丑"得有态度——街头/潮流/宣言',
    cssVars: {
      '--fx-primary': '#e8e434', '--fx-accent': '#1414e0', '--fx-accent2': '#111111',
      '--fx-text': '#111111', '--fx-surface': '#ffffff',
    },
    fontPairing: 'minimal',
    bgCss: '#e8e434',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:-4%;top:14%;width:560px;height:560px;background:#1414e0;transform:rotate(8deg)"></div>
<div style="position:absolute;right:-6%;bottom:-10%;width:700px;height:420px;background:#ffffff;border:5px solid #111"></div>
</div>`,
    foregroundHtml: `<div style="position:absolute;left:56px;top:44px;font-size:20px;font-weight:800;letter-spacing:.05em;color:#111;border:3.5px solid #111;padding:8px 18px;background:#fff;transform:rotate(-2deg)">RAW★POWER</div>`,
    css: `.kit-brutal-box{border:5px solid #111;background:#fff;box-shadow:12px 12px 0 #111}
.kit-brutal-strike{text-decoration:line-through;text-decoration-thickness:6px;text-decoration-color:#1414e0}`,
    motionNotes: '硬切无缓动：入场用 maskReveal linear 0.25s 或直接 in/out 帧切；元素故意错位重叠旋转 ±2-8°；shake 大幅(amp 20)做撞击；kp-outline 超粗描边字叠实心字',
  },
  {
    id: 'aurora',
    family: '材质实验',
    label: '极光高级',
    vibe: '流动极光渐变、玻璃悬浮、柔焦光斑、呼吸感——品牌/大促外包装/高端发布',
    cssVars: {
      '--fx-primary': '#0b0e18', '--fx-accent': '#7ef0d4', '--fx-accent2': '#8f7bff',
      '--fx-text': '#f0f4ff', '--fx-surface': 'rgba(255,255,255,0.07)',
    },
    fontPairing: 'minimal',
    bgCss: 'linear-gradient(160deg,#0b0e18 30%,#141b33 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:-10%;top:-25%;width:1300px;height:900px;background:radial-gradient(ellipse,rgba(126,240,212,0.22),transparent 65%);filter:blur(60px)"></div>
<div style="position:absolute;right:-12%;bottom:-30%;width:1200px;height:900px;background:radial-gradient(ellipse,rgba(143,123,255,0.25),transparent 65%);filter:blur(70px)"></div>
<div class="kp-noise" style="position:absolute;inset:0;opacity:.6"></div>
</div>`,
    css: `.kit-aurora-text{background:linear-gradient(110deg,#7ef0d4,#8f7bff,#7ef0d4);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}`,
    motionNotes: '呼吸慢动效：gradientShift(period 7, mode:bg 或标题 kit-aurora-text 配 gradientShift text)、blur 显影入场、camera 极慢推、kp-glass 卡悬浮(y 轨道 ±8px 极慢)；忌 shake/glitch',
  },
  {
    id: 'vapor',
    family: '复古年代',
    label: '蒸汽波',
    vibe: '粉紫日落渐变、镭射网格地平线、雕塑感衬线、千禧年像素装饰——梗文化/音乐/怀旧未来',
    cssVars: {
      '--fx-primary': '#1a0f2e', '--fx-accent': '#ff71ce', '--fx-accent2': '#01cdfe',
      '--fx-text': '#fff5fd', '--fx-surface': 'rgba(255,113,206,0.08)',
    },
    fontPairing: 'luxury',
    bgCss: 'linear-gradient(180deg,#2b1055 0%,#5b2a86 45%,#d3547e 78%,#ff9e6d 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:50%;top:26%;width:440px;height:440px;transform:translateX(-50%);border-radius:50%;background:linear-gradient(180deg,#ffd76d 0%,#ff71ce 100%);opacity:.9;mask-image:repeating-linear-gradient(0deg,#000 0 30px,transparent 30px 38px);-webkit-mask-image:repeating-linear-gradient(0deg,#000 0 30px,transparent 30px 38px)"></div>
<div style="position:absolute;left:50%;bottom:-24%;width:2600px;height:760px;transform:translateX(-50%) perspective(700px) rotateX(70deg);background-image:linear-gradient(rgba(1,205,254,.5) 2px,transparent 2px),linear-gradient(90deg,rgba(1,205,254,.5) 2px,transparent 2px);background-size:90px 90px"></div>
</div>`,
    foregroundHtml: `<div style="position:absolute;left:60px;top:52px;font-family:'Space Grotesk',monospace;font-size:17px;letter-spacing:.3em;color:rgba(1,205,254,.85)">ＶＩＢＥ▲ＷＡＶＥ</div>`,
    css: `.kit-vapor-chrome{background:linear-gradient(180deg,#fff 0%,#c9d6ff 38%,#5b2a86 55%,#ff71ce 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}`,
    motionNotes: '梦核漂浮：元素 y 轨道极慢漂移、glitch 偶发点缀(every 场景一次)、标题用 kit-vapor-chrome 镭射填充+kp-serif；镜头缓拉(scale 1.06→1)',
  },
  {
    id: 'memphis',
    family: '潮流活力',
    label: '孟菲斯撞色',
    vibe: '几何图形散落、波浪线、撞色块、俏皮弹跳——轻松/亲子/生活方式/开箱',
    cssVars: {
      '--fx-primary': '#fdf6ec', '--fx-accent': '#ff5d5d', '--fx-accent2': '#2ec4b6',
      '--fx-text': '#20242c', '--fx-surface': '#ffffff',
    },
    fontPairing: 'minimal',
    bgCss: '#fdf6ec',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:8%;top:12%;width:90px;height:90px;border-radius:50%;background:#ffbe3d;opacity:.9"></div>
<div style="position:absolute;right:12%;top:18%;width:0;height:0;border-left:52px solid transparent;border-right:52px solid transparent;border-bottom:92px solid #2ec4b6;transform:rotate(18deg);opacity:.85"></div>
<div style="position:absolute;left:14%;bottom:16%;width:150px;height:44px;background:repeating-linear-gradient(45deg,#ff5d5d 0 12px,transparent 12px 24px);transform:rotate(-10deg)"></div>
<div style="position:absolute;right:9%;bottom:12%;width:110px;height:110px;border:9px solid #6c63ff;border-radius:50%;opacity:.85"></div>
<svg style="position:absolute;left:42%;top:8%" width="180" height="40" viewBox="0 0 180 40" fill="none"><path d="M4 20 Q 26 0, 48 20 T 92 20 T 136 20 T 180 20" stroke="#20242c" stroke-width="6" stroke-linecap="round"/></svg>
</div>`,
    css: `.kit-memphis-sticker{background:#fff;border:4px solid #20242c;border-radius:22px;box-shadow:8px 8px 0 #20242c}`,
    motionNotes: '俏皮弹跳：spring(stiffness 260, damping 11) 大过冲、rotate ±6° 弹入、几何装饰各自 pathMove 漂移；stagger 0.12 依次蹦出；kit-memphis-sticker 贴纸卡',
  },
];

// 家族扩展包（8 族 × 12 种，手写美学人格）
import { EASTERN_KITS } from './styleKitFamilies/eastern';
import { TECH_KITS } from './styleKitFamilies/tech';
import { RETRO_KITS } from './styleKitFamilies/retrofuture';
import { EDITORIAL_KITS } from './styleKitFamilies/editorial';
import { TEXTURE_KITS } from './styleKitFamilies/texture';
import { POP_KITS } from './styleKitFamilies/pop';
import { NATURE_KITS } from './styleKitFamilies/nature';
import { CINEMA_KITS } from './styleKitFamilies/cinema';
import { COMMERCE_KITS } from './styleKitFamilies/commerce';
import { AVANTGARDE_KITS } from './styleKitFamilies/avantgarde';
import { NEXTWAVE_KITS } from './styleKitFamilies/nextwave';

export const STYLE_KITS: StyleKit[] = [
  ...CORE_KITS,
  ...EASTERN_KITS,
  ...TECH_KITS,
  ...RETRO_KITS,
  ...EDITORIAL_KITS,
  ...TEXTURE_KITS,
  ...POP_KITS,
  ...NATURE_KITS,
  ...CINEMA_KITS,
  ...COMMERCE_KITS,
  ...AVANTGARDE_KITS,
  ...NEXTWAVE_KITS,
];

export function styleKitOf(id?: string): StyleKit | undefined {
  return STYLE_KITS.find((k) => k.id === id);
}

/** 给 agent 的套件文档（按家族分组） */
export function styleKitsDoc(): string {
  const groups = new Map<string, StyleKit[]>();
  for (const k of STYLE_KITS) {
    if (!groups.has(k.family)) groups.set(k.family, []);
    groups.get(k.family)!.push(k);
  }
  return [...groups.entries()]
    .map(([fam, ks]) => `【${fam}】\n${ks.map((k) => `- ${k.id}（${k.label}）：${k.vibe}｜动效：${k.motionNotes}`).join('\n')}`)
    .join('\n');
}
