/**
 * styleKits/tech — 科技未来族（12 种）。
 * 从终端绿到量子紫：每种是一个具体的"未来"想象，不是笼统的"科技蓝"。
 */
import type { StyleKit } from '../styleKits';

/* eslint-disable max-len */

export const TECH_KITS: StyleKit[] = [
  {
    id: 'terminal', family: '科技未来', label: '终端黑客',
    vibe: '純黑底荧光绿等宽字、命令行光标、ASCII 框线——极客/教程/揭秘',
    cssVars: { '--fx-primary': '#050805', '--fx-accent': '#2aff6a', '--fx-accent2': '#0f8f3a', '--fx-text': '#c9ffd9', '--fx-surface': 'rgba(42,255,106,0.05)' },
    fontPairing: 'tech',
    bgCss: '#050805',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:40px;top:36px;font-family:'JetBrains Mono','Space Grotesk',monospace;font-size:16px;line-height:1.9;color:rgba(42,255,106,.28);white-space:pre">$ init --render kunpeng.scene\n$ loading modules ............ ok\n$ compositor: chromium/deterministic\n$ _</div><div style="position:absolute;left:0;right:0;top:0;height:34px;background:rgba(42,255,106,.06);border-bottom:1px solid rgba(42,255,106,.25)"></div><div style="position:absolute;left:14px;top:11px;display:flex;gap:8px"><div style="width:11px;height:11px;border-radius:50%;background:rgba(42,255,106,.5)"></div><div style="width:11px;height:11px;border-radius:50%;background:rgba(42,255,106,.28)"></div><div style="width:11px;height:11px;border-radius:50%;background:rgba(42,255,106,.16)"></div></div></div>`,
    foregroundHtml: `<div class="kp-scanline" style="position:absolute;inset:0;opacity:.4"></div>`,
    css: `.kit-terminal-mono{font-family:'JetBrains Mono','Space Grotesk',monospace}`,
    motionNotes: 'typewriter 是灵魂（charDur 0.045，全部文字都打出来）；光标常驻；glitch 偶发一次；忌一切圆角与衬线，全部等宽字 kit-terminal-mono',
  },
  {
    id: 'hologram', family: '科技未来', label: '全息投影',
    vibe: '青色半透明层叠、水平干涉条纹、投影基座光锥——产品悬浮展示/未来接口',
    cssVars: { '--fx-primary': '#020a12', '--fx-accent': '#4fd8ff', '--fx-accent2': '#87f0e8', '--fx-text': '#dcf6ff', '--fx-surface': 'rgba(79,216,255,0.07)' },
    fontPairing: 'tech',
    bgCss: 'radial-gradient(ellipse 70% 60% at 50% 60%,#04121f 0%,#020a12 75%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:50%;bottom:6%;width:640px;height:220px;transform:translateX(-50%);background:radial-gradient(ellipse 50% 100% at 50% 100%,rgba(79,216,255,.3),transparent 70%)"></div><div style="position:absolute;left:50%;bottom:9%;width:420px;height:14px;transform:translateX(-50%);border-radius:50%;background:rgba(79,216,255,.5);filter:blur(6px)"></div><div style="position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 5px,rgba(79,216,255,.045) 5px 6px)"></div></div>`,
    css: `.kit-holo-layer{background:rgba(79,216,255,.08);border:1px solid rgba(79,216,255,.4);box-shadow:0 0 30px rgba(79,216,255,.25),inset 0 0 30px rgba(79,216,255,.08);backdrop-filter:blur(4px)}
.kit-holo-text{color:#4fd8ff;text-shadow:0 0 14px rgba(79,216,255,.8)}`,
    motionNotes: '悬浮开机感：主体从光锥升起（y 60→0 + opacity）+常驻 y ±5 慢漂；开场可 glitch 0.3s 如信号接通；层叠面板 kit-holo-layer 依次亮起（stagger 0.2）',
  },
  {
    id: 'quantum', family: '科技未来', label: '量子深空',
    vibe: '深紫粒子星云、发光轨道环、引力透镜感——AI/宇宙/前沿科学',
    cssVars: { '--fx-primary': '#0b0618', '--fx-accent': '#a06bff', '--fx-accent2': '#4fc3f7', '--fx-text': '#efe9ff', '--fx-surface': 'rgba(160,107,255,0.08)' },
    fontPairing: 'tech',
    bgCss: 'radial-gradient(ellipse 80% 70% at 60% 30%,#160c2e 0%,#0b0618 70%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><svg style="position:absolute;right:4%;top:8%;opacity:.7" width="560" height="560" viewBox="0 0 560 560" fill="none"><ellipse cx="280" cy="280" rx="250" ry="90" stroke="#a06bff" stroke-width="1.5" opacity=".5" transform="rotate(-24 280 280)"/><ellipse cx="280" cy="280" rx="190" ry="64" stroke="#4fc3f7" stroke-width="1" opacity=".45" transform="rotate(-24 280 280)"/><circle cx="280" cy="280" r="30" fill="#a06bff" opacity=".5" filter="blur(4px)"/></svg><div style="position:absolute;left:12%;top:20%;width:3px;height:3px;border-radius:50%;background:#fff;box-shadow:200px 90px 0 rgba(255,255,255,.7),90px 300px 0 rgba(255,255,255,.5),420px 180px 0 rgba(255,255,255,.8),640px 60px 0 rgba(255,255,255,.4),330px 440px 0 rgba(255,255,255,.6),760px 340px 0 rgba(255,255,255,.5),80px 60px 0 rgba(160,107,255,.8),520px 420px 0 rgba(79,195,247,.7)"></div><div style="position:absolute;left:-14%;bottom:-30%;width:1100px;height:800px;background:radial-gradient(ellipse,rgba(160,107,255,.16),transparent 65%);filter:blur(30px)"></div></div>`,
    motionNotes: '失重慢速：全元素 parallax 强分层(0.2/0.6/1) + camera 极慢推；数字/术语 numberRoll+typewriter；星点 opacity 闪烁（错相位轨道）；紫色辉光标题',
  },
  {
    id: 'blueprint', family: '科技未来', label: '工程蓝图',
    vibe: '蓝晒图底白色细线、尺寸标注、十字基准点——拆解/原理/参数讲解',
    cssVars: { '--fx-primary': '#123667', '--fx-accent': '#ffffff', '--fx-accent2': '#8fb8e8', '--fx-text': '#eaf2fc', '--fx-surface': 'rgba(255,255,255,0.06)' },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(180deg,#144077 0%,#0f3161 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div class="kp-grid" style="position:absolute;inset:0;opacity:.8"></div><svg style="position:absolute;inset:0" width="1920" height="1080" fill="none"><path d="M 140 140 h 26 M 153 127 v 26 M 1780 140 h 26 M 1793 127 v 26 M 140 940 h 26 M 153 927 v 26 M 1780 940 h 26 M 1793 927 v 26" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/><path d="M 240 980 H 640 M 240 972 v 16 M 640 972 v 16" stroke="rgba(255,255,255,.4)" stroke-width="1.2"/><text x="415" y="1004" fill="rgba(255,255,255,.5)" font-size="15" font-family="'Space Grotesk',monospace">1920 × 1080 · SCALE 1:1</text></svg></div>`,
    css: `.kit-blueprint-dim{border-top:1.2px solid rgba(255,255,255,.5);position:relative}
.kit-blueprint-dim::before,.kit-blueprint-dim::after{content:'';position:absolute;top:-5px;width:1.2px;height:11px;background:rgba(255,255,255,.5)}
.kit-blueprint-dim::before{left:0}.kit-blueprint-dim::after{right:0}`,
    motionNotes: '绘图仪叙事：一切图形 lineDraw（这是主角，stagger 0.15 层层画出）；标注文字 typewriter；忌填充色块——线框为王；速度中等匀速感（linear/inOutCubic）',
  },
  {
    id: 'dashboard', family: '科技未来', label: '数据驾驶舱',
    vibe: '深底发光图表、指标卡阵列、进度环——年报/复盘/量化叙事',
    cssVars: { '--fx-primary': '#0d1220', '--fx-accent': '#38e1c6', '--fx-accent2': '#5b8cff', '--fx-text': '#e8f0ff', '--fx-surface': 'rgba(91,140,255,0.07)' },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(180deg,#0f1526 0%,#0b101c 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div class="kp-dots" style="position:absolute;inset:0;opacity:.4"></div><svg style="position:absolute;left:0;right:0;bottom:0;opacity:.35" width="1920" height="320" viewBox="0 0 1920 320" preserveAspectRatio="none" fill="none"><path d="M0 260 L 160 220 L 320 245 L 480 180 L 640 200 L 800 120 L 960 160 L 1120 90 L 1280 130 L 1440 60 L 1600 100 L 1760 40 L 1920 70" stroke="#38e1c6" stroke-width="2.5"/><path d="M0 260 L 160 220 L 320 245 L 480 180 L 640 200 L 800 120 L 960 160 L 1120 90 L 1280 130 L 1440 60 L 1600 100 L 1760 40 L 1920 70 V 320 H 0 Z" fill="url(#g)" opacity=".4"/><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#38e1c6" stop-opacity=".5"/><stop offset="1" stop-color="#38e1c6" stop-opacity="0"/></linearGradient></defs></svg></div>`,
    css: `.kit-dash-card{background:rgba(255,255,255,.035);border:1px solid rgba(91,140,255,.25);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}`,
    motionNotes: 'numberRoll 是主角（多个指标错开滚动）；折线可 lineDraw 从左画到右；卡片 kit-dash-card Bento 排布 stagger 入场；进度环 SVG lineDraw；快而精准',
  },
  {
    id: 'aerospace', family: '科技未来', label: '航天任务',
    vibe: 'NASA 风白蓝橙、任务徽章、倒计时刻度、遥测数据——发射/里程碑/重大发布',
    cssVars: { '--fx-primary': '#0a0e16', '--fx-accent': '#ff6a2b', '--fx-accent2': '#7fa8d9', '--fx-text': '#f0f4fa', '--fx-surface': 'rgba(127,168,217,0.08)' },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(180deg,#0c111c 0%,#080b12 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(127,168,217,.25)"></div><div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(127,168,217,.18)"></div><div style="position:absolute;left:0;right:0;top:calc(50% - 5px);display:flex;justify-content:space-between;padding:0 40px">${Array.from({ length: 24 }).map(() => '<div style="width:1px;height:11px;background:rgba(127,168,217,.4)"></div>').join('')}</div><div style="position:absolute;right:44px;bottom:40px;font-family:'Space Grotesk',monospace;font-size:14px;letter-spacing:.18em;color:rgba(127,168,217,.6);text-align:right;line-height:2">ALT 408.2 KM<br/>VEL 7.66 KM/S<br/>T+ 00:00:00</div></div>`,
    motionNotes: '倒计时叙事：numberRoll 做 T- 倒数、大标题 maskReveal bottom 如火箭升起 + camera 轻微 y 抖动(shake amp 3 freq 8)模拟推进震动；橙色只给关键动作',
  },
  {
    id: 'synthgrid', family: '科技未来', label: '合成器夜驰',
    vibe: '紫红地平线疾驰网格、速度线、镀铬字——竞速/健身/高能 BGM 卡点',
    cssVars: { '--fx-primary': '#12041f', '--fx-accent': '#ff3d81', '--fx-accent2': '#3dc8ff', '--fx-text': '#ffeef7', '--fx-surface': 'rgba(255,61,129,0.09)' },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(180deg,#180529 0%,#2b0a3d 55%,#4d1140 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:50%;bottom:-20%;width:2800px;height:700px;transform:translateX(-50%) perspective(600px) rotateX(74deg);background-image:linear-gradient(rgba(255,61,129,.55) 2.5px,transparent 2.5px),linear-gradient(90deg,rgba(255,61,129,.55) 2.5px,transparent 2.5px);background-size:100px 100px"></div><div style="position:absolute;left:0;right:0;top:48%;height:5px;background:linear-gradient(90deg,transparent,#ff3d81,transparent);filter:blur(2px)"></div><div style="position:absolute;left:0;right:0;top:0;height:48%;background:linear-gradient(180deg,#180529 40%,transparent)"></div></div>`,
    css: `.kit-synth-chrome{background:linear-gradient(180deg,#fff 10%,#3dc8ff 48%,#12041f 52%,#ff3d81 90%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}`,
    motionNotes: '速度与卡点：trail 疾驰残影、beats 密集对齐 BGM、闪白配 shake 打重拍；标题 kit-synth-chrome 镀铬斜体（html 内层 skew -8deg）；快脆 inExpo',
  },
  {
    id: 'biotech', family: '科技未来', label: '生物科技',
    vibe: '培养皿青绿、细胞圆斑、DNA 螺旋线、显微质感——医疗/健康/生命科学',
    cssVars: { '--fx-primary': '#071614', '--fx-accent': '#3ee6a0', '--fx-accent2': '#8ff5d2', '--fx-text': '#e4fbf1', '--fx-surface': 'rgba(62,230,160,0.07)' },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 80% 70% at 40% 30%,#0a201c 0%,#071614 70%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:6%;top:12%;width:280px;height:280px;border-radius:50%;border:1.5px solid rgba(62,230,160,.3);background:radial-gradient(circle at 40% 36%,rgba(62,230,160,.12),transparent 65%)"></div><div style="position:absolute;left:16%;top:48%;width:130px;height:130px;border-radius:50%;border:1px solid rgba(62,230,160,.22)"></div><svg style="position:absolute;right:4%;top:6%;opacity:.5" width="300" height="760" viewBox="0 0 300 760" fill="none"><path d="M80 0 Q 220 95 80 190 T 80 380 T 80 570 T 80 760 M 220 0 Q 80 95 220 190 T 220 380 T 220 570 T 220 760" stroke="#3ee6a0" stroke-width="2.5"/><path d="M96 60 h 108 M 96 130 h 108 M 96 250 h 108 M 96 320 h 108 M 96 440 h 108 M 96 510 h 108 M 96 630 h 108 M 96 700 h 108" stroke="#3ee6a0" stroke-width="1.5" opacity=".55"/></svg></div>`,
    motionNotes: '有机呼吸：细胞圆 scale 1↔1.05 慢呼吸（错相位）；DNA lineDraw 自上而下生长；数据 numberRoll；柔和 outCubic，忌硬切忌 glitch',
  },
  {
    id: 'radar', family: '科技未来', label: '雷达监控',
    vibe: '军绿扫描扇面、目标点闪烁、坐标网格——追踪/排查/紧张叙事',
    cssVars: { '--fx-primary': '#0a120c', '--fx-accent': '#7dff4f', '--fx-accent2': '#3d7a2c', '--fx-text': '#e4ffd9', '--fx-surface': 'rgba(125,255,79,0.06)' },
    fontPairing: 'tech',
    bgCss: '#0a120c',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><svg style="position:absolute;right:6%;top:50%;transform:translateY(-50%);opacity:.7" width="520" height="520" viewBox="0 0 520 520" fill="none"><circle cx="260" cy="260" r="240" stroke="#3d7a2c" stroke-width="1.5"/><circle cx="260" cy="260" r="160" stroke="#3d7a2c" stroke-width="1"/><circle cx="260" cy="260" r="80" stroke="#3d7a2c" stroke-width="1"/><path d="M 260 20 V 500 M 20 260 H 500" stroke="#3d7a2c" stroke-width="1" opacity=".7"/><path d="M 260 260 L 260 20 A 240 240 0 0 1 430 90 Z" fill="url(#sweep)"/><defs><linearGradient id="sweep" x1="260" y1="20" x2="430" y2="90"><stop stop-color="#7dff4f" stop-opacity=".4"/><stop offset="1" stop-color="#7dff4f" stop-opacity="0"/></linearGradient></defs><circle cx="350" cy="180" r="5" fill="#7dff4f"/><circle cx="170" cy="330" r="4" fill="#7dff4f" opacity=".7"/></svg><div class="kp-grid" style="position:absolute;inset:0;opacity:.25"></div></div>`,
    foregroundHtml: `<div class="kp-vignette" style="position:absolute;inset:0;opacity:.8"></div><div class="kp-scanline" style="position:absolute;inset:0;opacity:.3"></div>`,
    motionNotes: '锁定叙事：目标点 opacity 闪烁(方波感——两个 kf 硬切循环)；关键词入场配 shake 短促(amp 6, dur 0.2)如警报；typewriter 打坐标；紧凑快速',
  },
  {
    id: 'chipcore', family: '科技未来', label: '芯片电路',
    vibe: '硅晶深蓝、电路走线发光、焊点阵列——硬件/性能/算力',
    cssVars: { '--fx-primary': '#080d18', '--fx-accent': '#ffb547', '--fx-accent2': '#4f7cff', '--fx-text': '#eef2ff', '--fx-surface': 'rgba(79,124,255,0.07)' },
    fontPairing: 'tech',
    bgCss: 'linear-gradient(160deg,#0a1020 0%,#070b14 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><svg style="position:absolute;inset:0;opacity:.55" width="1920" height="1080" fill="none"><path d="M 0 200 H 300 V 380 H 560 M 560 380 H 760 V 200 M 0 760 H 240 V 620 H 480 M 1920 300 H 1600 V 480 H 1380 M 1920 860 H 1700 V 700 H 1500 V 560" stroke="#4f7cff" stroke-width="2" opacity=".5"/><circle cx="300" cy="200" r="5" fill="#ffb547"/><circle cx="560" cy="380" r="5" fill="#ffb547"/><circle cx="240" cy="760" r="5" fill="#ffb547" opacity=".8"/><circle cx="1600" cy="300" r="5" fill="#ffb547"/><circle cx="1500" cy="560" r="5" fill="#ffb547" opacity=".8"/></svg></div>`,
    motionNotes: '电流叙事：走线 lineDraw 如电流通电（金色焊点在线到达时亮起 opacity 0→1）；核心数值 numberRoll + 到位 shine；精准快速 outExpo',
  },
  {
    id: 'glassos', family: '科技未来', label: '玻璃系统',
    vibe: 'visionOS 式毛玻璃层叠、柔光环境、圆润悬浮——产品 UI/App 演示/未来生活',
    cssVars: { '--fx-primary': '#1a1d26', '--fx-accent': '#9db8ff', '--fx-accent2': '#e0c9ff', '--fx-text': '#f4f6ff', '--fx-surface': 'rgba(255,255,255,0.09)' },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 90% 80% at 30% 20%,#2b3044 0%,#191c28 65%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:-8%;top:-14%;width:800px;height:800px;border-radius:50%;background:radial-gradient(circle,rgba(157,184,255,.2),transparent 65%);filter:blur(40px)"></div><div style="position:absolute;right:-6%;bottom:-18%;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(224,201,255,.16),transparent 65%);filter:blur(46px)"></div></div>`,
    css: `.kit-glassos-panel{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:28px;backdrop-filter:blur(30px) saturate(1.4);-webkit-backdrop-filter:blur(30px) saturate(1.4);box-shadow:0 30px 90px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.25)}`,
    motionNotes: 'visionOS 手感：面板 kit-glassos-panel scale 0.94→1 + blur 8→0 呼出（outQuart 0.7s）；悬浮 y ±6 极慢漂；一切圆润柔和，光影是主角，忌锐利动作',
  },
  {
    id: 'darkpro', family: '科技未来', label: '专业暗黑',
    vibe: 'IDE 暗色主题、语法高亮点缀、状态栏、等宽注释——程序员/开发者内容',
    cssVars: { '--fx-primary': '#12141c', '--fx-accent': '#7aa2f7', '--fx-accent2': '#9ece6a', '--fx-text': '#c0caf5', '--fx-surface': 'rgba(122,162,247,0.07)' },
    fontPairing: 'tech',
    bgCss: '#12141c',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:0;top:0;bottom:0;width:64px;background:rgba(0,0,0,.25);border-right:1px solid rgba(122,162,247,.12)"></div><div style="position:absolute;left:78px;top:44px;font-family:'JetBrains Mono',monospace;font-size:15px;line-height:2.1;color:rgba(192,202,245,.22);white-space:pre"><span style="color:rgba(158,206,106,.35)">// scene: deterministic by design</span>\n<span style="color:rgba(187,154,247,.3)">const</span> frame = (t) =&gt; compose(t)\n<span style="color:rgba(187,154,247,.3)">export</span> { frame }</div><div style="position:absolute;left:0;right:0;bottom:0;height:30px;background:#1a1e2e;border-top:1px solid rgba(122,162,247,.15)"></div><div style="position:absolute;left:16px;bottom:7px;font-family:'JetBrains Mono',monospace;font-size:13px;color:rgba(122,162,247,.55)">⎇ main · UTF-8 · Ln 42</div></div>`,
    motionNotes: '代码感克制：typewriter 打关键句、语法色只用 accent/accent2 两种点缀；面板滑入如分屏（x 40→0 outExpo 0.4s）；忌花哨光效',
  },
];
