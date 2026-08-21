/**
 * styleKits/texture — 材质实验族（12 种）。
 * 以一种"物理材质"为整场主角：液态金属、磨砂亚克力、全息箔、织物……
 * 用 CSS 渐变/滤镜/混合模式在 Chromium 里逼真地伪造材质。
 */
import type { StyleKit } from '../styleKits';

/* eslint-disable max-len */

export const TEXTURE_KITS: StyleKit[] = [
  {
    id: 'liquidmetal', family: '材质实验', label: '液态金属',
    vibe: '水银流动高光、镜面渐变字、暗室反射——工业设计/旗舰产品/T1000 质感',
    cssVars: { '--fx-primary': '#101114', '--fx-accent': '#dfe4ec', '--fx-accent2': '#7c8494', '--fx-text': '#eef1f6', '--fx-surface': 'rgba(223,228,236,0.06)' },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 80% 70% at 50% 30%,#191b20 0%,#0e0f12 75%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:50%;bottom:0;width:1400px;height:340px;transform:translateX(-50%);background:linear-gradient(180deg,transparent,rgba(223,228,236,.06));border-radius:50% 50% 0 0;filter:blur(20px)"></div><div style="position:absolute;left:14%;top:18%;width:400px;height:14px;border-radius:7px;background:linear-gradient(90deg,transparent,rgba(223,228,236,.5),transparent);filter:blur(3px)"></div></div>`,
    css: `.kit-liquid-chrome{background:linear-gradient(105deg,#5a6070 0%,#f4f7fb 22%,#8b93a5 40%,#e6eaf1 55%,#4d5260 75%,#c9cfda 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}`,
    motionNotes: '流动即生命：标题 kit-liquid-chrome 必配 gradientShift(period 5) 让金属高光流动 + shine 缓扫；入场 blur 14→0 如凝固成形；慢而重，忌弹跳',
  },
  {
    id: 'frostedacrylic', family: '材质实验', label: '磨砂亚克力',
    vibe: '多层半透彩色亚克力板叠放、边缘透光、柔和投影——设计感产品/色彩学/软萌科技',
    cssVars: { '--fx-primary': '#f2f0ee', '--fx-accent': '#ff7d6b', '--fx-accent2': '#6ba8ff', '--fx-text': '#33302e', '--fx-surface': 'rgba(255,255,255,0.6)' },
    fontPairing: 'minimal',
    bgCss: 'linear-gradient(165deg,#f5f3f1 0%,#eae7e3 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:8%;top:16%;width:420px;height:420px;border-radius:40px;background:rgba(255,125,107,.28);backdrop-filter:blur(8px);box-shadow:0 30px 70px rgba(255,125,107,.2);transform:rotate(-10deg)"></div><div style="position:absolute;left:20%;top:32%;width:380px;height:380px;border-radius:40px;background:rgba(107,168,255,.26);backdrop-filter:blur(8px);box-shadow:0 30px 70px rgba(107,168,255,.2);transform:rotate(6deg)"></div><div style="position:absolute;right:10%;bottom:12%;width:300px;height:300px;border-radius:50%;background:rgba(255,205,90,.3);backdrop-filter:blur(8px);transform:rotate(3deg)"></div></div>`,
    motionNotes: '板材滑叠：彩板各自从画外滑入相互叠上（stagger 0.25，重叠处颜色混合是看点）、常驻极慢漂移；文字深灰在最上层；柔和 outQuart',
  },
  {
    id: 'holofoil', family: '材质实验', label: '全息烫金箔',
    vibe: '斜向彩虹箔面、角度变色、卡牌闪光——收藏/开箱/稀有度叙事',
    cssVars: { '--fx-primary': '#15121c', '--fx-accent': '#c9b8ff', '--fx-accent2': '#7ee8d8', '--fx-text': '#f4f0ff', '--fx-surface': 'rgba(201,184,255,0.08)' },
    fontPairing: 'minimal',
    bgCss: 'linear-gradient(170deg,#181422 0%,#100d18 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:-10%;top:-20%;right:-10%;height:70%;background:linear-gradient(115deg,rgba(255,120,180,.13) 0%,rgba(120,220,255,.13) 25%,rgba(160,255,180,.11) 50%,rgba(255,220,120,.12) 75%,rgba(200,120,255,.13) 100%);filter:blur(30px);transform:rotate(-6deg)"></div></div>`,
    css: `.kit-holo-foil{background:linear-gradient(115deg,#ff9ecf 0%,#8fd8ff 20%,#a4f5c0 40%,#ffe79e 60%,#c9a4ff 80%,#ff9ecf 100%);background-size:280% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.kit-holo-card{background:linear-gradient(115deg,rgba(255,158,207,.14),rgba(143,216,255,.14),rgba(164,245,192,.12),rgba(255,231,158,.13));background-size:280% 100%;border:1.5px solid rgba(255,255,255,.25);border-radius:20px}`,
    motionNotes: '角度变色是灵魂：kit-holo-foil/card 必配 gradientShift(period 4) 模拟倾斜箔面 + shine(every 2.5) 反复闪卡；开箱瞬间可 flash+scale 冲击一次',
  },
  {
    id: 'claymorph', family: '材质实验', label: '黏土拟物',
    vibe: '厚实圆润泡芙感、双重内阴影、马卡龙色——亲子/教育/萌系产品',
    cssVars: { '--fx-primary': '#f3ede6', '--fx-accent': '#ff8e7a', '--fx-accent2': '#8bc8b8', '--fx-text': '#4e4238', '--fx-surface': '#faf6f0' },
    fontPairing: 'minimal',
    bgCss: 'linear-gradient(170deg,#f6f0e8 0%,#ece4d8 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:9%;top:14%;width:220px;height:220px;border-radius:46%;background:#ffd3c9;box-shadow:inset -14px -18px 30px rgba(200,120,100,.35),inset 12px 14px 26px rgba(255,255,255,.85),0 26px 50px rgba(200,120,100,.22)"></div><div style="position:absolute;right:11%;top:22%;width:150px;height:150px;border-radius:44%;background:#c4e5da;box-shadow:inset -10px -14px 24px rgba(100,160,140,.35),inset 10px 12px 22px rgba(255,255,255,.85),0 22px 44px rgba(100,160,140,.2);transform:rotate(14deg)"></div><div style="position:absolute;left:20%;bottom:12%;width:120px;height:120px;border-radius:48%;background:#ffe6a8;box-shadow:inset -9px -12px 20px rgba(200,160,80,.35),inset 8px 10px 18px rgba(255,255,255,.9),0 20px 40px rgba(200,160,80,.2);transform:rotate(-9deg)"></div></div>`,
    css: `.kit-clay-btn{border-radius:32px;background:#faf6f0;box-shadow:inset -10px -12px 24px rgba(160,130,110,.22),inset 10px 12px 22px rgba(255,255,255,.95),0 24px 48px rgba(160,130,110,.2)}`,
    motionNotes: '捏出来的弹性：spring(stiffness 240, damping 9) 大回弹 + scale 过冲 1.12；黏土球常驻极慢 rotate 漂浮；圆角一切 ≥30px；软萌无锐角',
  },
  {
    id: 'papercut', family: '材质实验', label: '剪纸层叠',
    vibe: '多层纸片景深、每层投影、镂空边缘——故事叙述/绘本/手作温度',
    cssVars: { '--fx-primary': '#f2e8dc', '--fx-accent': '#e26d5c', '--fx-accent2': '#5c8d89', '--fx-text': '#40352c', '--fx-surface': '#faf4ea' },
    fontPairing: 'literary',
    bgCss: '#f2e8dc',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><svg style="position:absolute;left:0;right:0;bottom:0" width="1920" height="560" viewBox="0 0 1920 560" preserveAspectRatio="none" fill="none"><path d="M0 240 Q 240 160 480 230 T 960 210 T 1440 250 T 1920 200 V 560 H 0 Z" fill="#e8d9c4" style="filter:drop-shadow(0 -10px 18px rgba(64,53,44,.14))"/><path d="M0 360 Q 320 280 640 350 T 1280 330 T 1920 370 V 560 H 0 Z" fill="#dcc9ae" style="filter:drop-shadow(0 -10px 18px rgba(64,53,44,.16))"/><path d="M0 470 Q 480 400 960 455 T 1920 445 V 560 H 0 Z" fill="#cdb693" style="filter:drop-shadow(0 -12px 20px rgba(64,53,44,.2))"/></svg></div>`,
    css: `.kit-paper-card{background:#faf4ea;border-radius:18px;box-shadow:0 16px 0 -6px #e0d2bd,0 30px 40px rgba(64,53,44,.18)}`,
    motionNotes: '层叠推入：纸层自下而上 stagger 入场（y 60→0），配 parallax(0.5/0.7/0.9) 制造纸雕景深；主体卡 kit-paper-card 如贴纸放上（scale 1.06→1）；温和',
  },
  {
    id: 'neonsign', family: '材质实验', label: '霓虹灯牌',
    vibe: '弯管灯字、通电闪烁、砖墙暗底、电流嗡鸣感——酒吧/夜宵/开场标题',
    cssVars: { '--fx-primary': '#141014', '--fx-accent': '#ff5e7a', '--fx-accent2': '#5ee8ff', '--fx-text': '#ffe9ef', '--fx-surface': 'rgba(255,94,122,0.07)' },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 85% 75% at 50% 40%,#1c151c 0%,#100c10 80%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;inset:0;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.028) 0 42px,transparent 42px 46px),repeating-linear-gradient(90deg,rgba(255,255,255,.02) 0 110px,transparent 110px 116px)"></div><div style="position:absolute;left:50%;top:60%;width:900px;height:500px;transform:translate(-50%,-50%);background:radial-gradient(ellipse,rgba(255,94,122,.13),transparent 65%)"></div></div>`,
    css: `.kit-neon-tube{color:#fff;text-shadow:0 0 6px #fff,0 0 16px #ff5e7a,0 0 42px #ff5e7a,0 0 86px rgba(255,94,122,.6)}
.kit-neon-tube-cyan{color:#eafcff;text-shadow:0 0 6px #fff,0 0 16px #5ee8ff,0 0 42px #5ee8ff,0 0 86px rgba(94,232,255,.6)}
.kit-neon-off{color:rgba(255,255,255,.12);text-shadow:none}`,
    motionNotes: '通电仪式：标题先 kit-neon-off 暗管，然后 opacity 方波抖 2-3 下（坏灯管感）最后稳定亮起 kit-neon-tube——这段用多关键帧 opacity 轨道实现；辅字青色管',
  },
  {
    id: 'marbleink', family: '材质实验', label: '大理石流墨',
    vibe: '奶白石纹金脉、流体墨花、奢石台面——婚礼/珠宝/高定',
    cssVars: { '--fx-primary': '#efece7', '--fx-accent': '#b9975b', '--fx-accent2': '#5c6470', '--fx-text': '#33363c', '--fx-surface': 'rgba(51,54,60,0.05)' },
    fontPairing: 'luxury',
    bgCss: 'linear-gradient(160deg,#f2efe9 0%,#e6e2da 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><svg style="position:absolute;inset:0;opacity:.6" width="1920" height="1080" fill="none"><path d="M -100 200 C 400 300 600 100 1000 260 S 1700 240 2020 160" stroke="#c5c9d1" stroke-width="70" opacity=".4" fill="none" style="filter:blur(22px)"/><path d="M -100 700 C 500 620 800 840 1300 700 S 1900 660 2020 720" stroke="#d4d8de" stroke-width="90" opacity=".38" fill="none" style="filter:blur(26px)"/><path d="M -50 340 C 420 420 700 260 1100 380 S 1750 360 1980 300" stroke="#b9975b" stroke-width="2.5" opacity=".55" fill="none"/><path d="M -50 760 C 520 700 860 880 1350 760" stroke="#b9975b" stroke-width="1.8" opacity=".45" fill="none"/></svg></div>`,
    motionNotes: '金脉先行：金线 lineDraw(dur 1.8) 蜿蜒画出，石纹云雾常驻极慢漂；标题衬线大字距 maskReveal center；奢而静，唯一亮色是金',
  },
  {
    id: 'blueprintfabric', family: '材质实验', label: '牛仔织物',
    vibe: '靛蓝斜纹布、缝线走边、皮标铆钉——服饰/穿搭/工装文化',
    cssVars: { '--fx-primary': '#2a3b52', '--fx-accent': '#e8aa54', '--fx-accent2': '#c8d4e4', '--fx-text': '#eef3fa', '--fx-surface': 'rgba(200,212,228,0.08)' },
    fontPairing: 'minimal',
    bgCss: 'linear-gradient(170deg,#2e4058 0%,#243349 100%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;inset:0;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.035) 0 2px,transparent 2px 6px)"></div><div class="kp-noise" style="position:absolute;inset:0;opacity:.8"></div><div style="position:absolute;left:6%;top:8%;right:6%;bottom:8%;border:2.5px dashed rgba(232,170,84,.6);border-radius:16px;pointer-events:none"></div><div style="position:absolute;right:9%;top:11%;width:120px;height:70px;background:#8a6540;border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,.3)"></div></div>`,
    motionNotes: '缝纫叙事：虚线边框感用 lineDraw 走线（如缝纫机跑边）；皮标 spring 拍上；文字可加 kp-chip 补丁感底托；节奏中速利落',
  },
  {
    id: 'gradientmesh', family: '材质实验', label: '弥散渐变',
    vibe: '多团柔焦色彩弥散、无边界融合、大字悬浮——App 发布/音乐/情绪流',
    cssVars: { '--fx-primary': '#f3f0fa', '--fx-accent': '#7a5cff', '--fx-accent2': '#ff7ab8', '--fx-text': '#2c2440', '--fx-surface': 'rgba(255,255,255,0.5)' },
    fontPairing: 'minimal',
    bgCss: '#f3f0fa',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:-8%;top:-12%;width:900px;height:800px;background:radial-gradient(ellipse,rgba(122,92,255,.4),transparent 62%);filter:blur(70px)"></div><div style="position:absolute;right:-10%;top:6%;width:800px;height:760px;background:radial-gradient(ellipse,rgba(255,122,184,.38),transparent 62%);filter:blur(76px)"></div><div style="position:absolute;left:24%;bottom:-16%;width:860px;height:700px;background:radial-gradient(ellipse,rgba(96,205,255,.34),transparent 62%);filter:blur(72px)"></div></div>`,
    motionNotes: '色团呼吸：三个弥散团各自极慢 x/y 漂移+scale 呼吸（错相位，20s 级周期用 duration 内单程即可）；深紫大字悬浮其上带 kp-shadow；柔和现代',
  },
  {
    id: 'obsidian', family: '材质实验', label: '黑曜石面',
    vibe: '漆黑镜面反光、锐利高光棱线、极简白字——旗舰发布/悬念预告/高端外设',
    cssVars: { '--fx-primary': '#0a0a0c', '--fx-accent': '#f2f2f4', '--fx-accent2': '#3e3e46', '--fx-text': '#f2f2f4', '--fx-surface': 'rgba(242,242,244,0.05)' },
    fontPairing: 'minimal',
    bgCss: 'radial-gradient(ellipse 90% 75% at 50% 20%,#141417 0%,#08080a 70%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><div style="position:absolute;left:-20%;top:30%;width:1600px;height:2.5px;background:linear-gradient(90deg,transparent,rgba(242,242,244,.4),transparent);transform:rotate(-18deg)"></div><div style="position:absolute;left:0%;top:52%;width:1400px;height:1.5px;background:linear-gradient(90deg,transparent,rgba(242,242,244,.22),transparent);transform:rotate(-18deg)"></div><div style="position:absolute;left:0;right:0;bottom:0;height:44%;background:linear-gradient(0deg,rgba(242,242,244,.035),transparent);transform:scaleY(-1)"></div></div>`,
    motionNotes: '棱线扫光：高光线沿对角 shine 缓扫（every 3.5）是唯一持续动效；白字极简大留白，一次 maskReveal 亮相；黑白纪律，慢而锋利（outExpo 但短促 0.5s）',
  },
  {
    id: 'stainedglass', family: '材质实验', label: '彩绘玻璃',
    vibe: '铅条分格、宝石色透光、教堂光斑——史诗感/传奇叙事/复古品牌',
    cssVars: { '--fx-primary': '#151020', '--fx-accent': '#e8b23d', '--fx-accent2': '#3d7ae8', '--fx-text': '#f6efdd', '--fx-surface': 'rgba(232,178,61,0.08)' },
    fontPairing: 'luxury',
    bgCss: 'radial-gradient(ellipse 80% 70% at 50% 30%,#1c1530 0%,#120e1c 75%)',
    backdropHtml: `<div style="position:absolute;inset:0;overflow:hidden"><svg style="position:absolute;right:5%;top:8%;opacity:.75" width="440" height="640" viewBox="0 0 440 640" fill="none"><path d="M220 10 A 210 210 0 0 1 430 220 V 630 H 10 V 220 A 210 210 0 0 1 220 10 Z" stroke="#4a4258" stroke-width="9" fill="rgba(61,122,232,.12)"/><path d="M220 10 V 630 M 10 300 H 430 M 10 460 H 430 M 115 155 L 325 460 M 325 155 L 115 460" stroke="#4a4258" stroke-width="7"/><path d="M 20 310 h 190 v 140 h -190 Z" fill="rgba(232,178,61,.16)"/><path d="M 230 470 h 190 v 150 h -190 Z" fill="rgba(200,61,90,.15)"/></svg><div style="position:absolute;right:8%;top:20%;width:400px;height:500px;background:radial-gradient(ellipse,rgba(232,178,61,.1),transparent 70%);filter:blur(24px)"></div></div>`,
    motionNotes: '透光仪式：玻璃窗格 opacity 依次点亮（如晨光渐入，stagger 0.3）+铅条 lineDraw 先行勾勒；标题金色衬线大字距缓慢浮现；庄重慢速',
  },
];
