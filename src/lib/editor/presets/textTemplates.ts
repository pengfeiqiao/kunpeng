/**
 * textTemplates — 花字样式模板（HyperFrames 管线渲染：预览 CSS 动画，
 * 导出逐帧栅格化）。模板只输出一个 .tt 根元素（inline-block），定位由
 * 预览层/渲染层按 TextClip.position 包裹处理。
 *
 * 全部使用设计 token（var(--fx-*) + 字阶），html2canvas 安全子集。
 */
import { FX_FONT_SCALE } from '../fxDesignSystem';

export interface TextStyleOverrides {
  color?: string;
  accent?: string;
  fontScale?: number; // 1 = 模板默认
}

export interface TextTemplateDef {
  id: string;
  label: string;
  category: '标题' | '综艺' | '强调' | '字幕风';
  render: (text: string, ov?: TextStyleOverrides) => { html: string; css: string };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 逐字 span（stagger 动画用），保留空格 */
function chars(text: string, delayBase: number, step: number): string {
  return [...text].map((ch, i) =>
    ch === ' ' ? '<span>&nbsp;</span>' : `<span style="animation-delay:${(delayBase + i * step).toFixed(2)}s">${esc(ch)}</span>`,
  ).join('');
}

function vars(ov?: TextStyleOverrides): string {
  const parts: string[] = [];
  if (ov?.color) parts.push(`--tt-color:${ov.color}`);
  if (ov?.accent) parts.push(`--tt-accent:${ov.accent}`);
  if (ov?.fontScale) parts.push(`--tt-scale:${ov.fontScale}`);
  return parts.length ? ` style="${parts.join(';')}"` : '';
}

// 公共基底：默认色回退到主题 token
const BASE = `
.tt{display:inline-block;font-family:var(--fx-font-title,'PingFang SC','Microsoft YaHei',sans-serif);font-weight:800;
  --tt-color:var(--fx-text);--tt-accent:var(--fx-accent);--tt-scale:1}`;

const T = (px: number) => `calc(${px}px * var(--tt-scale, 1))`;

export const TEXT_TEMPLATES: TextTemplateDef[] = [
  {
    id: 'title-slide-up', label: '标题上滑', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-tsu"${vars(ov)}><div class="tsu-clip"><div class="tsu-in">${esc(text)}</div></div><div class="tsu-bar"></div></div>`,
      css: `${BASE}
.tt-tsu{text-align:center}
.tsu-clip{overflow:hidden}
.tsu-in{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);animation:tsuUp .6s var(--fx-ease-enter) both}
.tsu-bar{width:0;height:8px;margin:14px auto 0;background:var(--tt-accent);border-radius:4px;animation:tsuBar .5s var(--fx-ease-enter) .3s both}
@keyframes tsuUp{from{transform:translateY(110%)}to{transform:translateY(0)}}
@keyframes tsuBar{to{width:62%}}`,
    }),
  },
  {
    id: 'pop-bounce', label: '弹跳强调', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-pb"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-pb{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-accent);animation:pbPop .55s var(--fx-ease-enter) both}
@keyframes pbPop{0%{opacity:0;transform:scale(.3)}65%{transform:scale(1.15)}100%{opacity:1;transform:scale(1)}}`,
    }),
  },
  {
    id: 'typewriter', label: '打字机', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-tw"${vars(ov)}>${chars(text, 0.1, 0.08)}<i class="tw-cursor"></i></div>`,
      css: `${BASE}
.tt-tw{font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-color);font-weight:600}
.tt-tw>span{opacity:0;animation:twIn .05s linear both;animation-delay:inherit}
.tw-cursor{display:inline-block;width:4px;height:1em;background:var(--tt-accent);vertical-align:-0.12em;margin-left:4px;animation:twBlink 1s step-end infinite}
@keyframes twIn{to{opacity:1}}
@keyframes twBlink{0%,100%{opacity:1}50%{opacity:0}}`,
    }),
  },
  {
    id: 'karaoke', label: '逐字卡拉OK', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-ka"${vars(ov)}>${chars(text, 0.15, 0.14)}</div>`,
      css: `${BASE}
.tt-ka{font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-color)}
.tt-ka>span{display:inline-block;animation:kaFill .25s var(--fx-ease-pulse) both;animation-delay:inherit}
@keyframes kaFill{0%{color:var(--tt-color);transform:scale(1)}55%{color:var(--tt-accent);transform:scale(1.22)}100%{color:var(--tt-accent);transform:scale(1)}}`,
    }),
  },
  {
    id: 'variety-sticker', label: '综艺花字', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-vs"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-vs{font-size:${T(FX_FONT_SCALE.title)};font-weight:900;color:var(--tt-accent);
  text-shadow:3px 3px 0 var(--fx-primary),-3px 3px 0 var(--fx-primary),3px -3px 0 var(--fx-primary),-3px -3px 0 var(--fx-primary),6px 6px 0 rgba(0,0,0,0.35);
  animation:vsIn .5s var(--fx-ease-enter) both}
@keyframes vsIn{0%{opacity:0;transform:rotate(-14deg) scale(.4)}70%{transform:rotate(4deg) scale(1.1)}100%{opacity:1;transform:rotate(-2deg) scale(1)}}`,
    }),
  },
  {
    id: 'neon-glow', label: '霓虹光晕', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-ng"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-ng{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);
  text-shadow:0 0 12px var(--tt-accent),0 0 32px var(--tt-accent);
  animation:ngIn .5s both,ngPulse 1.6s var(--fx-ease-pulse) .5s infinite alternate}
@keyframes ngIn{from{opacity:0}to{opacity:1}}
@keyframes ngPulse{from{text-shadow:0 0 12px var(--tt-accent),0 0 32px var(--tt-accent)}to{text-shadow:0 0 22px var(--tt-accent),0 0 56px var(--tt-accent)}}`,
    }),
  },
  {
    id: 'underline-sweep', label: '划线强调', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-us"${vars(ov)}><span class="us-text">${esc(text)}</span><span class="us-line"></span></div>`,
      css: `${BASE}
.tt-us{position:relative;font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-color)}
.us-text{position:relative;z-index:1;animation:usIn .4s both}
.us-line{position:absolute;left:0;bottom:2px;height:38%;width:0;background:var(--tt-accent);opacity:.45;animation:usSweep .5s var(--fx-ease-enter) .3s both}
@keyframes usIn{from{opacity:0}to{opacity:1}}
@keyframes usSweep{to{width:100%}}`,
    }),
  },
  {
    id: 'box-label', label: '底板标签', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-bl"${vars(ov)}><span class="bl-box">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-bl{overflow:hidden}
.bl-box{display:inline-block;padding:14px 32px;background:var(--fx-surface);border-left:8px solid var(--tt-accent);border-radius:12px;font-size:${T(FX_FONT_SCALE.body)};font-weight:600;color:var(--tt-color);animation:blSlide .5s var(--fx-ease-enter) both}
@keyframes blSlide{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:translateX(0)}}`,
    }),
  },
  {
    id: 'shake-impact', label: '震动冲击', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-si"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-si{font-size:${T(FX_FONT_SCALE.display)};font-weight:900;color:var(--tt-accent);animation:siIn .3s var(--fx-ease-exit) both,siShake .4s linear .3s}
@keyframes siIn{from{opacity:0;transform:scale(2.4)}to{opacity:1;transform:scale(1)}}
@keyframes siShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-6px,4px)}40%{transform:translate(6px,-4px)}60%{transform:translate(-4px,-3px)}80%{transform:translate(4px,3px)}}`,
    }),
  },
  {
    id: 'fade-letter', label: '逐字渐显', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-fl"${vars(ov)}>${chars(text, 0.1, 0.1)}</div>`,
      css: `${BASE}
.tt-fl{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);font-weight:700}
.tt-fl>span{display:inline-block;opacity:0;animation:flIn .5s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes flIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}`,
    }),
  },
  {
    id: 'wave-letter', label: '波浪跳动', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-wl"${vars(ov)}>${chars(text, 0, 0.09)}</div>`,
      css: `${BASE}
.tt-wl{font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-accent);font-weight:800}
.tt-wl>span{display:inline-block;animation:wlWave 1.1s var(--fx-ease-pulse) infinite;animation-delay:inherit}
@keyframes wlWave{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}`,
    }),
  },
  {
    id: 'rotate-in', label: '旋转入场', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-ri"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-ri{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);animation:riIn .65s var(--fx-ease-enter) both}
@keyframes riIn{from{opacity:0;transform:rotate(-90deg) scale(.5)}to{opacity:1;transform:rotate(0) scale(1)}}`,
    }),
  },
  {
    id: 'big-quote', label: '大字引言', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-bq"${vars(ov)}><span class="bq-mark">“</span>${esc(text)}<span class="bq-mark">”</span></div>`,
      css: `${BASE}
.tt-bq{font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-color);font-weight:600;animation:bqIn .6s var(--fx-ease-enter) both}
.bq-mark{color:var(--tt-accent);font-size:1.5em;font-weight:900;vertical-align:-0.2em}
@keyframes bqIn{from{opacity:0;letter-spacing:.4em}to{opacity:1;letter-spacing:.05em}}`,
    }),
  },
  {
    id: 'number-tag', label: '数字角标', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-nt"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-nt{font-size:${T(FX_FONT_SCALE.display)};font-weight:900;color:var(--fx-primary);text-shadow:2px 2px 0 var(--tt-accent),-2px 2px 0 var(--tt-accent),2px -2px 0 var(--tt-accent),-2px -2px 0 var(--tt-accent);animation:ntIn .5s var(--fx-ease-enter) both}
@keyframes ntIn{from{opacity:0;transform:translateX(-40px)}to{opacity:.9;transform:translateX(0)}}`,
    }),
  },
  {
    id: 'flash-cut', label: '闪切标题', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-fc"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-fc{font-size:${T(FX_FONT_SCALE.title)};font-weight:900;color:var(--tt-color);background:var(--tt-accent);padding:10px 28px;border-radius:8px;animation:fcIn .35s step-end both}
@keyframes fcIn{0%{opacity:0}33%{opacity:1}66%{opacity:0}100%{opacity:1}}`,
    }),
  },
  {
    id: 'sub-clean', label: '简洁字幕', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-sc"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-sc{font-size:${T(FX_FONT_SCALE.body)};font-weight:600;color:var(--tt-color);background:rgba(0,0,0,0.45);padding:10px 24px;border-radius:10px;animation:scIn .3s both}
@keyframes scIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`,
    }),
  },

  // ── 标题类（新增） ──────────────────────────────────────────────────────────
  {
    id: 'gradient-title', label: '渐变大标题', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-gt"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-gt{font-size:${T(FX_FONT_SCALE.title)};font-weight:900;
  background:linear-gradient(135deg,var(--tt-accent),var(--fx-accent2,var(--tt-accent)));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
  text-shadow:0 4px 18px rgba(0,0,0,0.12);
  animation:gtIn .6s cubic-bezier(0.22,1.2,0.36,1) both}
@keyframes gtIn{from{opacity:0;transform:scale(0.92)}to{opacity:1;transform:scale(1)}}`,
    }),
  },
  {
    id: 'split-line-title', label: '分割线标题', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-sl"${vars(ov)}><span class="sl-text">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-sl{text-align:center;position:relative;padding:18px 0}
.tt-sl::before,.tt-sl::after{content:'';display:block;height:2px;background:var(--tt-accent);margin:0 auto;transform:scaleX(0);transform-origin:center}
.tt-sl::before{margin-bottom:14px;animation:slLine .5s cubic-bezier(0.22,1.2,0.36,1) .1s both}
.tt-sl::after{margin-top:14px;animation:slLine .5s cubic-bezier(0.22,1.2,0.36,1) .25s both}
.sl-text{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);display:inline-block;opacity:0;animation:slText .5s var(--fx-ease-enter) .2s both}
@keyframes slLine{to{transform:scaleX(0.6)}}
@keyframes slText{to{opacity:1}}`,
    }),
  },
  {
    id: 'mask-reveal-title', label: '遮罩揭示', category: '标题',
    render: (text, ov) => ({
      html: `<div class="tt tt-mr"${vars(ov)}><span class="mr-text">${esc(text)}</span><span class="mr-mask"></span></div>`,
      css: `${BASE}
.tt-mr{position:relative;overflow:hidden;display:inline-block}
.mr-text{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);display:inline-block;font-weight:900}
.mr-mask{position:absolute;top:0;left:0;width:100%;height:100%;background:var(--tt-accent);animation:mrReveal .8s cubic-bezier(0.77,0,0.175,1) both}
@keyframes mrReveal{0%{transform:translateX(-101%)}40%{transform:translateX(0)}100%{transform:translateX(101%)}}`,
    }),
  },

  // ── 综艺类（新增） ──────────────────────────────────────────────────────────
  {
    id: 'comic-burst', label: '漫画爆炸', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-cb"${vars(ov)}><span class="cb-inner">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-cb{display:inline-block}
.cb-inner{display:inline-block;font-size:${T(FX_FONT_SCALE.title)};font-weight:900;color:var(--tt-accent);
  text-shadow:3px 0 0 var(--fx-primary),-3px 0 0 var(--fx-primary),0 3px 0 var(--fx-primary),0 -3px 0 var(--fx-primary),
    2px 2px 0 var(--fx-primary),-2px 2px 0 var(--fx-primary),2px -2px 0 var(--fx-primary),-2px -2px 0 var(--fx-primary);
  background:var(--fx-surface);padding:12px 28px;border-radius:42% 58% 55% 45% / 50% 44% 56% 50%;
  transform:rotate(-3deg);animation:cbIn .55s cubic-bezier(0.22,1.2,0.36,1) both}
@keyframes cbIn{0%{opacity:0;transform:rotate(-8deg) scale(0.4)}70%{transform:rotate(1deg) scale(1.08)}100%{opacity:1;transform:rotate(-3deg) scale(1)}}`,
    }),
  },
  {
    id: 'emoji-bounce', label: '表情弹跳', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-eb"${vars(ov)}>${chars(text, 0.05, 0.08)}</div>`,
      css: `${BASE}
.tt-eb{font-size:${T(FX_FONT_SCALE.subtitle)};font-weight:900;color:var(--tt-accent);
  text-shadow:2px 3px 0 rgba(0,0,0,0.18)}
.tt-eb>span{display:inline-block;animation:ebBounce .7s cubic-bezier(0.34,1.56,0.64,1) both;animation-delay:inherit}
@keyframes ebBounce{0%{opacity:0;transform:translateY(24px) scale(0.85)}50%{transform:translateY(-8px) scale(1.1)}100%{opacity:1;transform:translateY(0) scale(1)}}`,
    }),
  },
  {
    id: 'retro-pixel', label: '像素风', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-rp"${vars(ov)}><span class="rp-box">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-rp{display:inline-block}
.rp-box{display:inline-block;font-size:${T(FX_FONT_SCALE.subtitle)};font-weight:900;color:var(--tt-color);
  background:var(--tt-accent);padding:10px 28px;border-radius:0;letter-spacing:0.12em;
  animation:rpType .6s steps(8) both}
@keyframes rpType{from{opacity:0;clip-path:inset(0 100% 0 0)}to{opacity:1;clip-path:inset(0 0 0 0)}}`,
    }),
  },
  {
    id: 'stamp-seal', label: '印章效果', category: '综艺',
    render: (text, ov) => ({
      html: `<div class="tt tt-ss"${vars(ov)}><span class="ss-circle">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-ss{display:inline-block}
.ss-circle{display:inline-flex;align-items:center;justify-content:center;
  width:${T(FX_FONT_SCALE.display * 2)};height:${T(FX_FONT_SCALE.display * 2)};
  border:4px double var(--tt-accent);border-radius:50%;
  font-size:${T(FX_FONT_SCALE.subtitle)};font-weight:900;color:var(--tt-accent);
  animation:ssStamp .5s cubic-bezier(0.22,1.2,0.36,1) both}
@keyframes ssStamp{from{opacity:0;transform:rotate(-20deg) scale(1.1)}to{opacity:1;transform:rotate(2deg) scale(1)}}`,
    }),
  },

  // ── 强调类（新增） ──────────────────────────────────────────────────────────
  {
    id: 'spotlight-focus', label: '聚光灯', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-sf"${vars(ov)}><span class="sf-text">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-sf{display:inline-block;position:relative;padding:32px 48px;
  background:radial-gradient(ellipse at center,var(--fx-surface) 0%,rgba(0,0,0,0.85) 100%);
  border-radius:12px;
  box-shadow:inset 0 0 60px 20px rgba(0,0,0,0.6);
  animation:sfIn .7s cubic-bezier(0.22,1.2,0.36,1) both}
.sf-text{font-size:${T(FX_FONT_SCALE.title)};color:var(--tt-color);font-weight:800;position:relative;z-index:1}
@keyframes sfIn{from{opacity:0;box-shadow:inset 0 0 120px 60px rgba(0,0,0,0.9)}to{opacity:1;box-shadow:inset 0 0 60px 20px rgba(0,0,0,0.6)}}`,
    }),
  },
  {
    id: 'bracket-quote', label: '方括号引用', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-bkq"${vars(ov)}><span class="bkq-l">【</span><span class="bkq-text">${esc(text)}</span><span class="bkq-r">】</span></div>`,
      css: `${BASE}
.tt-bkq{font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-color);font-weight:700}
.bkq-l,.bkq-r{display:inline-block;color:var(--tt-accent);font-size:1.4em;font-weight:900;vertical-align:-0.1em;
  animation:bkqBracket .4s cubic-bezier(0.22,1.2,0.36,1) both}
.bkq-r{animation-delay:0.05s}
.bkq-text{display:inline-block;opacity:0;animation:bkqText .5s var(--fx-ease-enter) .2s both}
@keyframes bkqBracket{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
@keyframes bkqText{to{opacity:1}}`,
    }),
  },
  {
    id: 'gradient-underline', label: '渐变下划线', category: '强调',
    render: (text, ov) => ({
      html: `<div class="tt tt-gu"${vars(ov)}><span class="gu-text">${esc(text)}</span><span class="gu-line"></span></div>`,
      css: `${BASE}
.tt-gu{position:relative;display:inline-block}
.gu-text{font-size:${T(FX_FONT_SCALE.subtitle)};color:var(--tt-color);font-weight:700;display:inline-block;
  animation:guTextIn .4s cubic-bezier(0.22,1.2,0.36,1) both}
.gu-line{display:block;height:6px;border-radius:3px;margin-top:6px;
  background:linear-gradient(90deg,var(--tt-accent),var(--fx-accent2,var(--tt-accent)));
  transform:scaleX(0);transform-origin:left;animation:guSweep .5s var(--fx-ease-enter) .35s both}
@keyframes guTextIn{from{opacity:0}to{opacity:1}}
@keyframes guSweep{to{transform:scaleX(1)}}`,
    }),
  },

  // ── 字幕风（新增） ──────────────────────────────────────────────────────────
  {
    id: 'cinema-subtitle', label: '电影字幕', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-cs"${vars(ov)}><span class="cs-strip"><span class="cs-text">${esc(text)}</span></span></div>`,
      css: `${BASE}
.tt-cs{display:inline-block}
.cs-strip{display:inline-block;background:rgba(0,0,0,0.55);padding:14px 40px;min-height:60px;
  display:inline-flex;align-items:center}
.cs-text{font-size:${T(FX_FONT_SCALE.body)};color:var(--tt-color);font-weight:600;
  letter-spacing:0.15em;animation:csIn .6s cubic-bezier(0.22,1.2,0.36,1) both}
@keyframes csIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`,
    }),
  },
  {
    id: 'news-ticker', label: '新闻滚动条', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-ntk"${vars(ov)}><span class="ntk-badge">快讯</span><span class="ntk-text">${esc(text)}</span></div>`,
      css: `${BASE}
.tt-ntk{display:inline-flex;align-items:center;background:var(--fx-surface);border-left:4px solid var(--tt-accent);
  padding:12px 24px;border-radius:0 8px 8px 0;overflow:hidden}
.ntk-badge{display:inline-block;background:var(--tt-accent);color:var(--fx-primary);font-size:${T(FX_FONT_SCALE.caption)};
  font-weight:900;padding:4px 10px;border-radius:4px;margin-right:14px;flex-shrink:0;
  animation:ntkBadge .4s var(--fx-ease-enter) both}
.ntk-text{font-size:${T(FX_FONT_SCALE.body)};color:var(--tt-color);font-weight:600;white-space:nowrap;
  animation:ntkSlide .6s cubic-bezier(0.22,1.2,0.36,1) .15s both}
@keyframes ntkBadge{from{opacity:0;transform:scale(0.85)}to{opacity:1;transform:scale(1)}}
@keyframes ntkSlide{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:translateX(0)}}`,
    }),
  },
  {
    id: 'dialogue-bubble', label: '对话气泡', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-db"${vars(ov)}><div class="db-bubble">${esc(text)}</div><div class="db-tail"></div></div>`,
      css: `${BASE}
.tt-db{position:relative;display:inline-block}
.db-bubble{background:var(--fx-surface);padding:16px 28px;border-radius:16px;
  font-size:${T(FX_FONT_SCALE.body)};color:var(--tt-color);font-weight:600;
  animation:dbIn .5s cubic-bezier(0.22,1.2,0.36,1) both}
.db-tail{position:absolute;bottom:-8px;left:22px;width:0;height:0;
  border-left:8px solid transparent;border-right:8px solid transparent;
  border-top:10px solid var(--fx-surface);animation:dbIn .5s cubic-bezier(0.22,1.2,0.36,1) both}
@keyframes dbIn{from{opacity:0;transform:scale(0.85)}to{opacity:1;transform:scale(1)}}`,
    }),
  },
  {
    id: 'handwritten-note', label: '手写便签', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-hw"${vars(ov)}><div class="hw-pin"></div><div class="hw-card">${esc(text)}</div></div>`,
      css: `${BASE}
.tt-hw{position:relative;display:inline-block}
.hw-pin{width:24px;height:8px;background:var(--tt-accent);border-radius:2px;margin:0 auto 0;position:relative;z-index:1}
.hw-card{background:var(--fx-surface);padding:20px 32px;border-radius:4px;
  font-size:${T(FX_FONT_SCALE.body)};color:var(--tt-color);font-weight:600;
  transform:rotate(-2deg);box-shadow:2px 3px 12px rgba(0,0,0,0.18);
  animation:hwIn .6s cubic-bezier(0.22,1.2,0.36,1) both}
@keyframes hwIn{from{opacity:0;transform:rotate(-5deg) translateY(12px)}to{opacity:1;transform:rotate(-2deg) translateY(0)}}`,
    }),
  },
  {
    id: 'minimal-fade', label: '极简渐显', category: '字幕风',
    render: (text, ov) => ({
      html: `<div class="tt tt-mf"${vars(ov)}>${esc(text)}</div>`,
      css: `${BASE}
.tt-mf{font-size:${T(FX_FONT_SCALE.body)};font-weight:400;color:var(--tt-color);
  letter-spacing:0.2em;line-height:1.8;animation:mfIn 1.2s cubic-bezier(0.45,0,0.55,1) both}
@keyframes mfIn{from{opacity:0}to{opacity:1}}`,
    }),
  },
];

export function findTextTemplate(id: string): TextTemplateDef | undefined {
  return TEXT_TEMPLATES.find((t) => t.id === id);
}

/** agent 工具 description 用的模板清单 */
export function textTemplatesDoc(): string {
  return TEXT_TEMPLATES.map((t) => `${t.id}（${t.label}/${t.category}）`).join('、');
}
