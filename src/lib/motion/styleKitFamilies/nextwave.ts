/**
 * styleKits/nextwave — 新浪潮族（6 种）。
 * 用户点名方向的补缺：生成式 AI 流体 / 次表面散射 / 动态分形 /
 * 扫描线全息 / 赛博酸性哥特 / Y2K 千禧辣妹。
 * 每种都为新原语（waveText/flicker/scanReveal/liquidBlob/orbit/sliceIn/breathe/jitter）
 * 设计了配套的运动性格。
 */
import type { StyleKit } from '../styleKits';

/* eslint-disable max-len */

export const NEXTWAVE_KITS: StyleKit[] = [
  {
    id: 'aiflux', family: '新浪潮', label: '生成式 AI 流体',
    vibe: '弥散极光光斑缓慢流动、有机 blob、光晕呼吸——AI 产品/前沿科技/智能感发布',
    cssVars: { '--fx-primary': '#07070d', '--fx-accent': '#8b7bff', '--fx-accent2': '#3fd8c2', '--fx-text': '#f2f0ff', '--fx-surface': 'rgba(139,123,255,0.08)' },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 120% 90% at 30% 0%,#12102a 0%,#07070d 60%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:8%;top:12%;width:760px;height:680px;background:radial-gradient(ellipse 50% 50% at 50% 50%,rgba(139,123,255,.34),transparent 70%);filter:blur(60px)"></div>
<div style="position:absolute;right:2%;bottom:-6%;width:820px;height:620px;background:radial-gradient(ellipse 50% 50% at 50% 50%,rgba(63,216,194,.26),transparent 70%);filter:blur(70px)"></div>
<div style="position:absolute;left:46%;top:40%;width:460px;height:420px;background:radial-gradient(ellipse,rgba(255,122,196,.16),transparent 68%);filter:blur(52px)"></div>
<div class="kp-noise" style="position:absolute;inset:0;opacity:.8"></div>
</div>`,
    css: `.kit-aiflux-blob{background:linear-gradient(135deg,rgba(139,123,255,.85),rgba(63,216,194,.75));filter:blur(2px) saturate(1.2);box-shadow:0 0 90px rgba(139,123,255,.4)}
.kit-aiflux-halo{text-shadow:0 0 32px rgba(139,123,255,.65),0 0 80px rgba(63,216,194,.3)}`,
    motionNotes: '一切都在缓慢呼吸：光斑 blob 用 liquidBlob(period 9-12)+orbit(period 14+,depth) 漂移；标题 kit-aiflux-halo+breathe(glowColor 紫)；入场 blur 12→0 慢 outExpo；忌硬切/shake，速度域全场最慢',
  },
  {
    id: 'subsurface', family: '新浪潮', label: '次表面散射',
    vibe: '玉质/蜡质半透明材质、光从内部透出、边缘透光——高端美妆/珠宝/材质感产品',
    cssVars: { '--fx-primary': '#101014', '--fx-accent': '#ffb9a3', '--fx-accent2': '#c8e8dc', '--fx-text': '#fff4ee', '--fx-surface': 'rgba(255,185,163,0.09)' },
    fontPairing: 'luxury',
    bgCss: 'radial-gradient(ellipse 90% 80% at 50% 30%,#1b1a20 0%,#101014 70%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:14%;top:22%;width:420px;height:420px;border-radius:52% 48% 55% 45% / 48% 55% 45% 52%;background:radial-gradient(circle at 35% 30%,rgba(255,185,163,.5) 0%,rgba(255,185,163,.16) 45%,rgba(255,185,163,.05) 75%);box-shadow:inset 0 0 80px rgba(255,185,163,.35),0 0 120px rgba(255,185,163,.14);filter:blur(1px)"></div>
<div style="position:absolute;right:16%;bottom:16%;width:300px;height:300px;border-radius:45% 55% 50% 50% / 55% 45% 55% 45%;background:radial-gradient(circle at 60% 35%,rgba(200,232,220,.4) 0%,rgba(200,232,220,.12) 50%,transparent 78%);box-shadow:inset 0 0 60px rgba(200,232,220,.3);filter:blur(1px)"></div>
<div class="kp-noise" style="position:absolute;inset:0;opacity:.7"></div>
</div>`,
    css: `.kit-sss-jade{background:radial-gradient(circle at 38% 32%,rgba(255,185,163,.55) 0%,rgba(255,185,163,.18) 48%,rgba(255,185,163,.06) 78%);box-shadow:inset 0 0 70px rgba(255,185,163,.4),0 0 90px rgba(255,185,163,.15)}
.kit-sss-glow{text-shadow:0 0 26px rgba(255,185,163,.55),0 0 2px rgba(255,244,238,.9)}`,
    motionNotes: '材质在呼吸发光：玉石 blob 用 liquidBlob(period 10,amount 0.15 微形变)+breathe(glowColor 蜜桃)；文字 kit-sss-glow 缓显（opacity+blur 8→0 1.2s outQuart）；shine 每 4s 缓扫一次像光穿过蜡；奢缓，忌快动作',
  },
  {
    id: 'fractal', family: '新浪潮', label: '动态分形',
    vibe: '递归几何嵌套旋转、黄金螺旋、数学纵深——科普/思维/意识流/抽象概念',
    cssVars: { '--fx-primary': '#0a0c14', '--fx-accent': '#ffc94d', '--fx-accent2': '#4d9fff', '--fx-text': '#eef2ff', '--fx-surface': 'rgba(255,201,77,0.07)' },
    fontPairing: 'tech',
    bgCss: 'radial-gradient(ellipse 100% 100% at 50% 50%,#10141f 0%,#0a0c14 75%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<svg style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:.4" width="1100" height="1100" viewBox="0 0 1100 1100" fill="none">
${Array.from({ length: 9 }).map((_, i) => { const s = 520 * Math.pow(0.78, i); const r = i * 11; return `<rect x="${(1100 - s) / 2}" y="${(1100 - s) / 2}" width="${s}" height="${s}" stroke="${i % 2 ? '#4d9fff' : '#ffc94d'}" stroke-width="1.1" opacity="${(0.65 - i * 0.05).toFixed(2)}" transform="rotate(${r} 550 550)"/>`; }).join('')}
</svg>
<div style="position:absolute;left:44px;bottom:40px;font-family:'JetBrains Mono',monospace;font-size:14px;line-height:1.9;color:rgba(238,242,255,.32)">depth=9 · ratio=0.78 · Δθ=11°</div>
</div>`,
    motionNotes: '递归性格：嵌套 group 层各配 rotate 轨道（内层快外层慢，如 6s/9s/14s 一圈）制造无限下坠感；camera scale 1→1.15 极慢推进像跌入分形；标题 sliceIn(4 片) 数学切分感；等宽小注参数',
  },
  {
    id: 'holoscan', family: '新浪潮', label: '扫描线全息',
    vibe: '青色全息投影、横向扫描线、体积光锥、轻微色散抖动——未来 UI/产品全息展示',
    cssVars: { '--fx-primary': '#020a10', '--fx-accent': '#2ee6ff', '--fx-accent2': '#8ab4ff', '--fx-text': '#dffaff', '--fx-surface': 'rgba(46,230,255,0.07)' },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(180deg,#020a10 0%,#04121c 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:50%;bottom:0;width:900px;height:760px;transform:translateX(-50%);background:linear-gradient(0deg,rgba(46,230,255,.2) 0%,rgba(46,230,255,.05) 45%,transparent 80%);clip-path:polygon(38% 100%,62% 100%,86% 0,14% 0)"></div>
<div style="position:absolute;left:50%;bottom:4%;width:560px;height:26px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(ellipse,rgba(46,230,255,.55),transparent 70%);filter:blur(6px)"></div>
<div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 5px,rgba(46,230,255,.05) 5px 6px)"></div>
</div>`,
    foregroundHtml: `<div style="position:absolute;inset:0;pointer-events:none">
<div style="position:absolute;left:48px;top:44px;font-family:'JetBrains Mono',monospace;font-size:14px;letter-spacing:.24em;color:rgba(46,230,255,.55)">HOLO·PROJ v3.1</div>
<div style="position:absolute;right:48px;bottom:44px;width:130px;height:130px;border-right:1.5px solid rgba(46,230,255,.45);border-bottom:1.5px solid rgba(46,230,255,.45)"></div>
</div>`,
    css: `.kit-holo-body{color:#dffaff;text-shadow:0 0 14px rgba(46,230,255,.8),0 0 44px rgba(46,230,255,.35);background:linear-gradient(0deg,rgba(46,230,255,.06) 0 2px,transparent 2px 4px)}`,
    motionNotes: '投影仪语法：主体必用 scanReveal(dir top,青色亮线) 像被投出来；成像后 breathe(微)+偶发 flicker(idle 0.12) 全息不稳定感；数据小字 typewriter；一次 glitch(amp 4) 点缀信号干扰；克制的科技蓝',
  },
  {
    id: 'acidgothic', family: '新浪潮', label: '赛博酸性哥特',
    vibe: '酸性荧光绿+哥特衬线+金属铬质感、尖锐符号——地下音乐/潮流/暗黑时尚',
    cssVars: { '--fx-primary': '#050505', '--fx-accent': '#b6ff2e', '--fx-accent2': '#c8c8d8', '--fx-text': '#eef0e8', '--fx-surface': 'rgba(182,255,46,0.07)' },
    fontPairing: 'luxury',
    bgCss: 'radial-gradient(ellipse 100% 80% at 50% 20%,#101208 0%,#050505 70%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<svg style="position:absolute;left:50%;top:48%;transform:translate(-50%,-50%);opacity:.5" width="760" height="760" viewBox="0 0 760 760" fill="none">
<circle cx="380" cy="380" r="290" stroke="#b6ff2e" stroke-width="1.2" opacity=".5"/>
<circle cx="380" cy="380" r="220" stroke="#b6ff2e" stroke-width=".8" opacity=".35"/>
<path d="M380 60 L 420 340 L 700 380 L 420 420 L 380 700 L 340 420 L 60 380 L 340 340 Z" stroke="#b6ff2e" stroke-width="1.4" opacity=".6"/>
</svg>
<div style="position:absolute;left:6%;bottom:8%;font-family:'Playfair Display',serif;font-style:italic;font-size:150px;color:transparent;-webkit-text-stroke:1px rgba(200,200,216,.22)">✠</div>
<div class="kp-noise" style="position:absolute;inset:0;opacity:1.4"></div>
</div>`,
    css: `.kit-acid-chrome{background:linear-gradient(175deg,#f4f6fa 0%,#8a90a8 38%,#dde2f0 50%,#5a5f75 62%,#eef0f8 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.kit-acid-neon{color:#b6ff2e;text-shadow:0 0 18px rgba(182,255,46,.85),0 0 60px rgba(182,255,46,.35)}`,
    motionNotes: '暗黑仪式感：哥特衬线标题 kit-acid-chrome（铬字）配 jitter(amp 1.5) 躁动；酸绿符号 kit-acid-neon+flicker 灯管点亮；星形徽记 rotate 慢转+lineDraw 显形；节奏落拍处 shake 一次；快脆与诡异并存',
  },
  {
    id: 'y2kgurl', family: '新浪潮', label: 'Y2K 千禧辣妹',
    vibe: '糖果粉紫渐变、金属光泽气泡字、星星闪钻贴纸——美妆穿搭/闺蜜向/甜酷内容',
    cssVars: { '--fx-primary': '#ffd9ec', '--fx-accent': '#ff4fa8', '--fx-accent2': '#8a5cff', '--fx-text': '#4a1440', '--fx-surface': 'rgba(255,255,255,0.55)' },
    fontPairing: 'variety',
    bgCss: 'linear-gradient(150deg,#ffd9ec 0%,#e8d4ff 55%,#cfe4ff 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden">
<div style="position:absolute;left:10%;top:14%;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.95) 0%,rgba(255,183,224,.55) 40%,rgba(255,79,168,.25) 75%);box-shadow:inset -14px -18px 44px rgba(255,79,168,.25),0 20px 60px rgba(255,79,168,.2)"></div>
<div style="position:absolute;right:14%;bottom:18%;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.9),rgba(138,92,255,.35) 60%,rgba(138,92,255,.15));box-shadow:inset -10px -12px 30px rgba(138,92,255,.25)"></div>
<svg style="position:absolute;right:22%;top:10%" width="90" height="90" viewBox="0 0 90 90"><path d="M45 4 L53 36 L86 45 L53 54 L45 86 L37 54 L4 45 L37 36 Z" fill="#fff" opacity=".95"/></svg>
<svg style="position:absolute;left:30%;bottom:10%" width="56" height="56" viewBox="0 0 90 90"><path d="M45 4 L53 36 L86 45 L53 54 L45 86 L37 54 L4 45 L37 36 Z" fill="#ff4fa8" opacity=".8"/></svg>
</div>`,
    css: `.kit-y2k-bubble{background:linear-gradient(178deg,#fff 4%,#ffb7e0 38%,#ff4fa8 52%,#ff8ec6 66%,#fff0f8 96%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;filter:drop-shadow(0 4px 0 rgba(74,20,64,.25)) drop-shadow(0 10px 24px rgba(255,79,168,.35))}
.kit-y2k-sticker{display:inline-block;background:#fff;border:3px solid #4a1440;border-radius:999px;padding:.2em .7em;box-shadow:4px 5px 0 rgba(74,20,64,.3);transform:rotate(-3deg)}`,
    motionNotes: '甜酷弹跳：气泡字 kineticText spring(st 220,damp 11) 大过冲入场→waveText(amp 6) 持续俏皮浮动；星星贴纸 orbit(depth)+自转；泡泡 liquidBlob 微形变；贴纸 kit-y2k-sticker outBack 甩入 rotate ±6°；快节奏高糖',
  },
];
