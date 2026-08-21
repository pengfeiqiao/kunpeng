/**
 * presets/signature — 签名场景库：15 个完整编排的高水准示范。
 *
 * 定位：这是引擎的"品味基准线"。每个场景 = 一种风格方向的代表作，
 * 多图层纵深（背景装置/主体/前景点缀）+ beats 节奏 + camera 运镜 +
 * 新旧原语组合 + 持续生命感（动完不死，waveText/breathe/orbit 待机）。
 *
 * agent 用法：直接 preset_id 调用出片；或把产出 spec 当 few-shot，
 * 换 style kit / 换文案 / 调 beats 复刻同等编排密度的新场景。
 */
import type { SceneLayer, SceneSpec } from '../spec';
import type { PresetDef } from './mg';

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function num(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/* eslint-disable max-len */

// ── 1. 科技赛博数据 ───────────────────────────────────────────────────────────
// 编排思路：数据从混沌中拼装成形。切片入场→打字机数据流→数字滚动→glitch 收束。
const cyberData: PresetDef = {
  id: 'sig.cyberdata',
  label: '签名·赛博数据舱',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), value?: number(核心数据), unit?: string(单位如"亿"), code?: string(数据流文案) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '数据核心');
    const value = num(params.value, 87.4);
    const unit = str(params.unit, '%');
    const code = str(params.code, 'link:established // stream 0x4F2A');
    return {
      v: 1, duration, style: 'cyber', bg: 'opaque',
      beats: [0, 0.3, 1.1, 2.0, 3.2, duration - 1.2],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.08 }, { t: 2.2, v: 1, ease: 'outQuart' }, { t: duration, v: 1.03, ease: 'inOutQuad' }] }] },
      flashes: [{ at: 'beat:3', dur: 0.22, color: '#00f0ff', peak: 0.35 }],
      layers: [
        // 背景装置：轨道环 + 呼吸光核
        {
          id: 'ring', kind: 'svg', z: 1, parallax: 0.7,
          svg: `<svg width="640" height="640" viewBox="0 0 640 640" fill="none"><circle cx="320" cy="320" r="290" stroke="rgba(0,240,255,.35)" stroke-width="1.5" stroke-dasharray="6 14"/><circle cx="320" cy="320" r="236" stroke="rgba(0,240,255,.22)" stroke-width="1"/><path d="M320 30 A290 290 0 0 1 610 320" stroke="#00f0ff" stroke-width="3" stroke-linecap="round"/></svg>`,
          at: { x: '50%', y: '50%', anchor: 'center' },
          tracks: [
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 40 }] },
            { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 0.8, v: 1, ease: 'outCubic' }] },
          ],
          effects: [{ type: 'lineDraw', at: 'beat:1', dur: 1.0, stagger: 0.12, ease: 'inOutExpo' }],
        },
        {
          id: 'core', kind: 'shape', z: 1, parallax: 0.6,
          html: `<div style="width:200px;height:200px;border-radius:50%;background:radial-gradient(circle,rgba(0,240,255,.35),transparent 70%)"></div>`,
          at: { x: '50%', y: '50%', anchor: 'center' },
          effects: [{ type: 'breathe', period: 2.8, amount: 0.12 }],
        },
        // 主体：标题切片拼装 + 核心数据滚动
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h2 kit-cyber-neon',
          at: { x: '50%', y: '36%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'sliceIn', at: 'beat:1', dur: 0.65, slices: 5, offset: 120, seed: 3 },
            { type: 'glitch', at: 'beat:5', dur: 0.5, amp: 7, seed: 11 },
          ],
        },
        {
          id: 'value', kind: 'text', text: '0', class: 'kp-mega kp-accent',
          style: { fontSize: '190px', textShadow: '0 0 40px rgba(0,240,255,.5)' },
          at: { x: '50%', y: '54%', anchor: 'center' }, z: 3, in: 'beat:2',
          tracks: [{ prop: 'scale', kf: [{ t: 'beat:2', v: 0.86 }, { t: 'beat:3', v: 1, spring: { stiffness: 160, damping: 13 } }] }],
          effects: [
            { type: 'numberRoll', at: 'beat:2', dur: 1.4, to: value, decimals: 1, suffix: unit, ease: 'outExpo' },
            { type: 'breathe', at: 'beat:4', period: 3.2, amount: 0.015, glowColor: 'rgba(0,240,255,.45)', glowRadius: 30 },
          ],
        },
        // 前景点缀：打字数据流 + 环绕粒子
        {
          id: 'code', kind: 'text', text: code, class: 'kp-label',
          style: { fontFamily: "'Space Grotesk',monospace", color: 'var(--fx-accent2)', fontSize: '20px', letterSpacing: '.14em' },
          at: { x: '50%', y: '70%', anchor: 'center' }, z: 3, in: 'beat:3',
          effects: [{ type: 'typewriter', at: 'beat:3', charDur: 0.035 }],
        },
        {
          id: 'dot1', kind: 'shape', z: 2, parallax: 1.15,
          html: `<div style="width:10px;height:10px;border-radius:50%;background:#00f0ff;box-shadow:0 0 12px #00f0ff"></div>`,
          at: { x: '50%', y: '50%', anchor: 'center' }, in: 1.2,
          tracks: [{ prop: 'opacity', kf: [{ t: 1.2, v: 0 }, { t: 1.7, v: 0.9 }] }],
          effects: [{ type: 'orbit', period: 5, rx: 330, ry: 130, depth: true }],
        },
        {
          id: 'dot2', kind: 'shape', z: 2, parallax: 1.15,
          html: `<div style="width:7px;height:7px;border-radius:50%;background:#ff2d95;box-shadow:0 0 10px #ff2d95"></div>`,
          at: { x: '50%', y: '50%', anchor: 'center' }, in: 1.5,
          tracks: [{ prop: 'opacity', kf: [{ t: 1.5, v: 0 }, { t: 2.0, v: 0.8 }] }],
          effects: [{ type: 'orbit', period: 7.5, rx: 330, ry: 130, phase: 0.45, dir: 'ccw', depth: true }],
        },
      ],
    };
  },
};

// ── 2. 肌理质感 MG ────────────────────────────────────────────────────────────
// 编排思路：黏土块软弹入场、错落呼吸；一切圆角、一切过冲、亲和治愈。
const textureMg: PresetDef = {
  id: 'sig.texturemg',
  label: '签名·黏土质感 MG',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), sub?: string, tag?: string(角标≤6字) }',
  defaultDuration: 5,
  build(params, duration): SceneSpec {
    const title = str(params.title, '软软的世界');
    const sub = str(params.sub, '治愈系内容指南');
    const tag = str(params.tag, 'NEW');
    return {
      v: 1, duration, style: 'claymorph', bg: 'opaque',
      beats: [0, 0.25, 0.7, 1.3, 1.9],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers: [
        // 背景装置：三个软块错落漂浮（各自 orbit 慢漂 + blob 形变）
        {
          id: 'blob-a', kind: 'shape', z: 1, parallax: 0.75,
          html: `<div style="width:320px;height:320px;background:linear-gradient(145deg,#ffd0b8,#ff9e7a);box-shadow:inset -12px -16px 28px rgba(180,90,50,.28),inset 10px 12px 22px rgba(255,255,255,.65),0 26px 60px rgba(180,90,50,.22)"></div>`,
          at: { x: '17%', y: '30%', anchor: 'center' },
          tracks: [{ prop: 'scale', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:1+0.6', v: 1, spring: { stiffness: 150, damping: 12 } }] }],
          effects: [{ type: 'liquidBlob', period: 9, amount: 0.3, seed: 2 }, { type: 'orbit', period: 13, rx: 16, ry: 22 }],
        },
        {
          id: 'blob-b', kind: 'shape', z: 1, parallax: 0.85,
          html: `<div style="width:210px;height:210px;background:linear-gradient(145deg,#c8ecd9,#8fd4b0);box-shadow:inset -10px -12px 22px rgba(60,140,100,.3),inset 8px 10px 18px rgba(255,255,255,.6),0 20px 44px rgba(60,140,100,.2)"></div>`,
          at: { x: '84%', y: '68%', anchor: 'center' },
          tracks: [{ prop: 'scale', kf: [{ t: 'beat:2', v: 0 }, { t: 'beat:2+0.6', v: 1, spring: { stiffness: 150, damping: 12 } }] }],
          effects: [{ type: 'liquidBlob', period: 8, amount: 0.32, seed: 7 }, { type: 'orbit', period: 11, rx: 20, ry: 14, dir: 'ccw' }],
        },
        {
          id: 'blob-c', kind: 'shape', z: 1, parallax: 0.65,
          html: `<div style="width:130px;height:130px;background:linear-gradient(145deg,#fde9a8,#f7c548);box-shadow:inset -8px -10px 18px rgba(190,140,30,.3),inset 6px 8px 14px rgba(255,255,255,.7),0 16px 36px rgba(190,140,30,.22)"></div>`,
          at: { x: '74%', y: '20%', anchor: 'center' },
          tracks: [{ prop: 'scale', kf: [{ t: 'beat:3', v: 0 }, { t: 'beat:3+0.6', v: 1, spring: { stiffness: 150, damping: 11 } }] }],
          effects: [{ type: 'liquidBlob', period: 7, amount: 0.35, seed: 13 }, { type: 'orbit', period: 9, rx: 14, ry: 18 }],
        },
        // 主体：标题软弹 + 持续波浪；副标缓入
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1',
          style: { color: 'var(--fx-text)', fontWeight: '800', textShadow: '0 6px 0 rgba(150,90,60,.14)' },
          at: { x: '50%', y: '44%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 'beat:2', stagger: 0.07, dur: 0.6, from: { y: 70, scale: 0.6, opacity: 0 }, spring: { stiffness: 175, damping: 12 } },
            { type: 'waveText', at: 'beat:4+0.6', amp: 6, period: 3.2, phaseStep: 0.1 },
          ],
        },
        {
          id: 'sub', kind: 'text', text: sub, class: 'kp-sub',
          style: { color: 'var(--fx-text)', opacity: '.75' },
          at: { x: '50%', y: '58%', anchor: 'center' }, z: 3, in: 'beat:4',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:4', v: 0 }, { t: 'beat:4+0.5', v: 0.85, ease: 'outCubic' }] },
            { prop: 'y', kf: [{ t: 'beat:4', v: 24 }, { t: 'beat:4+0.5', v: 0, ease: 'outCubic' }] },
          ],
        },
        // 前景：角标贴纸甩入
        {
          id: 'tag', kind: 'text', text: tag, z: 4, in: 'beat:4+0.3',
          style: { display: 'inline-block', background: '#ff7a59', color: '#fff', fontWeight: '800', fontSize: '30px', padding: '.32em .85em', borderRadius: '999px', boxShadow: '0 10px 24px rgba(255,122,89,.4), inset 0 -4px 8px rgba(150,40,20,.25)' },
          at: { x: '66%', y: '35%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 'beat:4+0.3', v: 0 }, { t: 'beat:4+0.85', v: 1, spring: { stiffness: 210, damping: 11 } }] },
            { prop: 'rotate', kf: [{ t: 'beat:4+0.3', v: -14 }, { t: 'beat:4+0.85', v: -6, ease: 'outBack' }] },
          ],
          effects: [{ type: 'breathe', at: 'beat:4+1', period: 2.6, amount: 0.04 }],
        },
      ],
    };
  },
};

// ── 3. 几何抽象流体 MG ────────────────────────────────────────────────────────
// 编排思路：渐变网格上，几何形与流体 blob 共舞——刚（旋转方块）柔（形变圆）对比。
const fluidGeo: PresetDef = {
  id: 'sig.fluidgeo',
  label: '签名·几何流体',
  group: '签名场景',
  paramsDoc: '{ title: string(≤12字), sub?: string }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '流动的秩序');
    const sub = str(params.sub);
    const layers: SceneLayer[] = [
      // 流体极：两团渐变 blob 缓慢形变漂移
      {
        id: 'fluid-a', kind: 'shape', z: 1, parallax: 0.7,
        html: `<div style="width:480px;height:460px;background:linear-gradient(135deg,rgba(122,90,248,.75),rgba(255,122,196,.6));filter:blur(3px)"></div>`,
        at: { x: '24%', y: '38%', anchor: 'center' },
        tracks: [{ prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 1.0, v: 0.9, ease: 'outCubic' }] }],
        effects: [{ type: 'liquidBlob', period: 10, amount: 0.4, seed: 4 }, { type: 'orbit', period: 16, rx: 40, ry: 26 }],
      },
      {
        id: 'fluid-b', kind: 'shape', z: 1, parallax: 0.8,
        html: `<div style="width:300px;height:300px;background:linear-gradient(200deg,rgba(66,200,244,.7),rgba(122,90,248,.5));filter:blur(3px)"></div>`,
        at: { x: '78%', y: '64%', anchor: 'center' },
        tracks: [{ prop: 'opacity', kf: [{ t: 0.4, v: 0 }, { t: 1.4, v: 0.85, ease: 'outCubic' }] }],
        effects: [{ type: 'liquidBlob', period: 8, amount: 0.42, seed: 9 }, { type: 'orbit', period: 13, rx: 30, ry: 40, dir: 'ccw' }],
      },
      // 几何极：线框方与圆持续自转（刚性对比）
      {
        id: 'geo-square', kind: 'shape', z: 2, parallax: 1.1,
        html: `<div style="width:230px;height:230px;border:2.5px solid rgba(255,255,255,.85)"></div>`,
        at: { x: '70%', y: '30%', anchor: 'center' }, in: 0.6,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.6, v: 0 }, { t: 1.2, v: 1 }] },
          { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 75 }] },
          { prop: 'scale', kf: [{ t: 0.6, v: 0.7 }, { t: 1.6, v: 1, ease: 'outExpo' }] },
        ],
      },
      {
        id: 'geo-circle', kind: 'shape', z: 2, parallax: 0.9,
        html: `<div style="width:120px;height:120px;border-radius:50%;border:2.5px dashed rgba(255,255,255,.55)"></div>`,
        at: { x: '30%', y: '72%', anchor: 'center' }, in: 0.9,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.9, v: 0 }, { t: 1.5, v: 1 }] },
          { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: -120 }] },
        ],
      },
      // 主体：标题遮罩揭示 + 待机呼吸
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h1 kp-shadow',
        style: { fontWeight: '700', letterSpacing: '-0.02em' },
        at: { x: '50%', y: '48%', anchor: 'center' }, z: 3,
        effects: [
          { type: 'maskReveal', at: 1.2, dur: 0.75, dir: 'left', ease: 'inOutExpo' },
          { type: 'gradientShift', period: 7, colors: ['#ffffff', '#c9b8ff', '#8be0ff', '#ffffff'], mode: 'text' },
        ],
      },
    ];
    if (sub) {
      layers.push({
        id: 'sub', kind: 'text', text: sub, class: 'kp-sub kp-shadow',
        at: { x: '50%', y: '60%', anchor: 'center' }, z: 3, in: 2.0,
        tracks: [
          { prop: 'opacity', kf: [{ t: 2.0, v: 0 }, { t: 2.6, v: 0.9, ease: 'outCubic' }] },
          { prop: 'y', kf: [{ t: 2.0, v: 18 }, { t: 2.6, v: 0, ease: 'outCubic' }] },
        ],
      });
    }
    return {
      v: 1, duration, style: 'gradientmesh', bg: 'opaque',
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1 }, { t: duration, v: 1.06, ease: 'inOutQuad' }] }] },
      layers,
    };
  },
};

// ── 4. 扁平化 MG ─────────────────────────────────────────────────────────────
// 编排思路：Memphis 式硬色块构成主义。色块直切卡拍、图形符号弹跳，节奏感强。
const flatMg: PresetDef = {
  id: 'sig.flatmg',
  label: '签名·扁平构成 MG',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), sub?: string, num?: string(编号如"04") }',
  defaultDuration: 5,
  build(params, duration): SceneSpec {
    const title = str(params.title, '构成主义');
    const sub = str(params.sub, 'FLAT MOTION DESIGN');
    const numLabel = str(params.num, '01');
    return {
      v: 1, duration, style: 'memphis', bg: 'opaque',
      beats: [0, 0.2, 0.45, 0.7, 0.95, 1.35],
      flashes: [{ at: 'beat:5', dur: 0.18, color: '#1a1a2e', peak: 0.2 }],
      layers: [
        // 色块矩阵：四块按拍硬切入场（inOutExpo 快切，扁平不弹）
        {
          id: 'block-red', kind: 'shape', z: 1,
          html: `<div style="width:400px;height:400px;background:#ff5252"></div>`,
          at: { x: '12%', y: '18%', anchor: 'top-left' },
          effects: [{ type: 'maskReveal', at: 'beat:1', dur: 0.4, dir: 'right', ease: 'inOutExpo' }],
          tracks: [{ prop: 'rotate', kf: [{ t: 'beat:5', v: 0 }, { t: 'beat:5+0.5', v: 6, ease: 'outBack' }] }],
        },
        {
          id: 'block-blue', kind: 'shape', z: 1,
          html: `<div style="width:280px;height:560px;background:#3d5afe"></div>`,
          at: { x: '88%', y: '82%', anchor: 'bottom-right' },
          effects: [{ type: 'maskReveal', at: 'beat:2', dur: 0.4, dir: 'top', ease: 'inOutExpo' }],
        },
        {
          id: 'ring-yellow', kind: 'shape', z: 2,
          html: `<div style="width:190px;height:190px;border-radius:50%;border:26px solid #ffd600"></div>`,
          at: { x: '76%', y: '24%', anchor: 'center' },
          tracks: [{ prop: 'scale', kf: [{ t: 'beat:3', v: 0 }, { t: 'beat:3+0.5', v: 1, spring: { stiffness: 200, damping: 13 } }] }],
          effects: [{ type: 'orbit', at: 'beat:5', period: 8, rx: 12, ry: 8 }],
        },
        {
          id: 'zigzag', kind: 'svg', z: 2,
          svg: `<svg width="300" height="80" viewBox="0 0 300 80" fill="none"><polyline points="6,64 48,16 90,64 132,16 174,64 216,16 258,64 294,24" stroke="#1a1a2e" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          at: { x: '22%', y: '78%', anchor: 'center' },
          effects: [{ type: 'lineDraw', at: 'beat:4', dur: 0.6, ease: 'inOutExpo' }],
          tracks: [{ prop: 'rotate', kf: [{ t: 0, v: -4 }] }],
        },
        // 主体：编号 + 标题逐词硬弹
        {
          id: 'num', kind: 'text', text: numLabel, class: 'kp-mega',
          style: { fontSize: '150px', color: 'transparent', WebkitTextStroke: '3px #1a1a2e' },
          at: { x: '14%', y: '48%', anchor: 'left' }, z: 3, in: 'beat:4',
          tracks: [
            { prop: 'x', kf: [{ t: 'beat:4', v: -80 }, { t: 'beat:4+0.45', v: 0, ease: 'outExpo' }] },
            { prop: 'opacity', kf: [{ t: 'beat:4', v: 0 }, { t: 'beat:4+0.3', v: 1 }] },
          ],
        },
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1',
          style: { fontWeight: '900', color: '#1a1a2e', letterSpacing: '-0.01em' },
          at: { x: '50%', y: '48%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 'beat:5', stagger: 0.05, dur: 0.4, from: { y: -50, opacity: 0 }, ease: 'outExpo' },
          ],
        },
        {
          id: 'sub', kind: 'text', text: sub, class: 'kp-label',
          style: { color: '#1a1a2e', fontSize: '22px', letterSpacing: '.3em' },
          at: { x: '50%', y: '60%', anchor: 'center' }, z: 3, in: 'beat:5+0.4',
          effects: [{ type: 'maskReveal', at: 'beat:5+0.4', dur: 0.45, dir: 'left', ease: 'inOutExpo' }],
        },
      ],
    };
  },
};

// ── 5. Y2K 千禧辣妹 ──────────────────────────────────────────────────────────
// 编排思路：高糖弹跳。气泡字大过冲、星星环绕自转、贴纸甩入、一切都在俏皮浮动。
const y2kGurl: PresetDef = {
  id: 'sig.y2kgurl',
  label: '签名·Y2K 辣妹',
  group: '签名场景',
  paramsDoc: '{ title: string(≤8字), sub?: string, sticker?: string(贴纸字≤6字) }',
  defaultDuration: 5,
  build(params, duration): SceneSpec {
    const title = str(params.title, '甜酷宣言');
    const sub = str(params.sub, "it girl's diary ♡");
    const sticker = str(params.sticker, 'so cute!');
    return {
      v: 1, duration, style: 'y2kgurl', bg: 'opaque',
      beats: [0, 0.3, 0.9, 1.5, 2.1],
      flashes: [{ at: 'beat:2', dur: 0.25, color: '#ffffff', peak: 0.45 }],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.05 }, { t: 1.8, v: 1, ease: 'outQuart' }] }] },
      layers: [
        // 环绕星星（orbit depth 伪 3D 转圈）
        {
          id: 'star-a', kind: 'svg', z: 2, parallax: 1.1,
          svg: `<svg width="72" height="72" viewBox="0 0 90 90"><path d="M45 4 L53 36 L86 45 L53 54 L45 86 L37 54 L4 45 L37 36 Z" fill="#fff"/></svg>`,
          at: { x: '50%', y: '46%', anchor: 'center' }, in: 'beat:2',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:2', v: 0 }, { t: 'beat:2+0.3', v: 1 }] },
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 220 }] },
          ],
          effects: [{ type: 'orbit', period: 6, rx: 420, ry: 150, depth: true }],
        },
        {
          id: 'star-b', kind: 'svg', z: 2, parallax: 1.1,
          svg: `<svg width="44" height="44" viewBox="0 0 90 90"><path d="M45 4 L53 36 L86 45 L53 54 L45 86 L37 54 L4 45 L37 36 Z" fill="#ff4fa8"/></svg>`,
          at: { x: '50%', y: '46%', anchor: 'center' }, in: 'beat:2+0.2',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:2+0.2', v: 0 }, { t: 'beat:2+0.5', v: 0.95 }] },
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: -260 }] },
          ],
          effects: [{ type: 'orbit', period: 8, rx: 420, ry: 150, phase: 0.5, dir: 'ccw', depth: true }],
        },
        // 糖果泡泡持续形变
        {
          id: 'bubble', kind: 'shape', z: 1, parallax: 0.8,
          html: `<div style="width:260px;height:260px;background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.95),rgba(255,183,224,.6) 45%,rgba(255,79,168,.3) 80%);box-shadow:inset -12px -16px 36px rgba(255,79,168,.3),0 18px 50px rgba(255,79,168,.25)"></div>`,
          at: { x: '80%', y: '26%', anchor: 'center' },
          tracks: [{ prop: 'scale', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:1+0.6', v: 1, spring: { stiffness: 170, damping: 12 } }] }],
          effects: [{ type: 'liquidBlob', period: 7, amount: 0.25, seed: 5 }, { type: 'orbit', period: 10, rx: 18, ry: 26 }],
        },
        // 主体：气泡铬字大过冲入场 → 持续波浪
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1 kit-y2k-bubble',
          style: { fontSize: '132px', fontWeight: '900' },
          at: { x: '50%', y: '44%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 'beat:2', stagger: 0.08, dur: 0.7, from: { y: 110, scale: 0.4, rotate: -10, opacity: 0 }, spring: { stiffness: 220, damping: 11 } },
            { type: 'waveText', at: 'beat:4+0.8', amp: 8, period: 2.6, phaseStep: 0.14, rotAmp: 2 },
          ],
        },
        {
          id: 'sub', kind: 'text', text: sub,
          style: { fontFamily: "'Playfair Display',serif", fontStyle: 'italic', fontSize: '34px', color: '#8a5cff', letterSpacing: '.06em' },
          at: { x: '50%', y: '59%', anchor: 'center' }, z: 3, in: 'beat:3',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:3', v: 0 }, { t: 'beat:3+0.5', v: 1, ease: 'outCubic' }] },
            { prop: 'y', kf: [{ t: 'beat:3', v: 16 }, { t: 'beat:3+0.5', v: 0, ease: 'outBack' }] },
          ],
        },
        // 贴纸甩入
        {
          id: 'sticker', kind: 'text', text: sticker, class: 'kit-y2k-sticker', z: 4, in: 'beat:4',
          style: { fontSize: '28px', fontWeight: '800', color: '#ff4fa8' },
          at: { x: '68%', y: '33%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 'beat:4', v: 0 }, { t: 'beat:4+0.5', v: 1, spring: { stiffness: 240, damping: 10 } }] },
            { prop: 'rotate', kf: [{ t: 'beat:4', v: 18 }, { t: 'beat:4+0.5', v: -4, ease: 'outBack' }] },
          ],
          effects: [{ type: 'jitter', at: 'beat:4+0.6', amp: 1.5, freq: 5, rotAmp: 1.2, seed: 3 }],
        },
      ],
    };
  },
};

// ── 6. 复古国潮东方 ──────────────────────────────────────────────────────────
// 编排思路：灯笼夜市的市井烟火气。竖排大字如灯牌点亮、灯笼漂浮、印章落款。
const guochao: PresetDef = {
  id: 'sig.guochao',
  label: '签名·国潮灯火',
  group: '签名场景',
  paramsDoc: '{ title: string(≤6字), sub?: string, seal?: string(印章字≤2字) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '人间烟火');
    const sub = str(params.sub, '巷子深处的老味道');
    const seal = str(params.seal, '潮');
    return {
      v: 1, duration, style: 'lanternnight', bg: 'opaque',
      beats: [0, 0.4, 1.2, 2.2, 3.0],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.07 }, { t: duration, v: 1, ease: 'outQuad' }] }, { prop: 'y', kf: [{ t: 0, v: 16 }, { t: duration, v: -10, ease: 'inOutQuad' }] }] },
      layers: [
        // 灯笼两盏：暖光呼吸 + 轻摆
        {
          id: 'lantern-a', kind: 'shape', z: 1, parallax: 0.75,
          html: `<div style="width:120px;height:150px;border-radius:46%/50%;background:radial-gradient(ellipse at 50% 38%,#ffb84d 0%,#e8483a 65%,#a32b20 100%);box-shadow:0 0 70px rgba(255,140,60,.55),inset 0 -14px 26px rgba(120,20,10,.4);border-top:8px solid #5a2a18;border-bottom:6px solid #5a2a18"></div>`,
          at: { x: '15%', y: '26%', anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:1+0.8', v: 1, ease: 'outCubic' }] },
            { prop: 'rotate', kf: [{ t: 0, v: -3 }, { t: duration / 2, v: 3, ease: 'inOutQuad' }, { t: duration, v: -3, ease: 'inOutQuad' }] },
          ],
          effects: [{ type: 'breathe', period: 3.4, amount: 0.025, glowColor: 'rgba(255,150,60,.6)', glowRadius: 34 }],
        },
        {
          id: 'lantern-b', kind: 'shape', z: 1, parallax: 0.85,
          html: `<div style="width:82px;height:104px;border-radius:46%/50%;background:radial-gradient(ellipse at 50% 38%,#ffb84d 0%,#e8483a 65%,#a32b20 100%);box-shadow:0 0 50px rgba(255,140,60,.5),inset 0 -10px 18px rgba(120,20,10,.4);border-top:6px solid #5a2a18;border-bottom:4px solid #5a2a18"></div>`,
          at: { x: '86%', y: '18%', anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:1+0.3', v: 0 }, { t: 'beat:1+1.1', v: 1, ease: 'outCubic' }] },
            { prop: 'rotate', kf: [{ t: 0, v: 4 }, { t: duration / 2, v: -3, ease: 'inOutQuad' }, { t: duration, v: 4, ease: 'inOutQuad' }] },
          ],
          effects: [{ type: 'breathe', period: 2.9, amount: 0.03, glowColor: 'rgba(255,150,60,.5)', glowRadius: 26 }],
        },
        // 主体：竖排大字灯牌点亮（flicker）
        {
          id: 'title', kind: 'text', text: title, class: 'kp-vert kp-serif',
          style: { fontSize: '170px', fontWeight: '700', color: '#ffd9a0', textShadow: '0 0 30px rgba(255,150,60,.75), 0 0 90px rgba(232,72,58,.4), 0 3px 6px rgba(0,0,0,.6)' },
          at: { x: '58%', y: '48%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 'beat:2', stagger: 0.22, dur: 0.8, from: { y: -40, opacity: 0 }, ease: 'outQuart' },
            { type: 'flicker', at: 'beat:2', dur: 1.6, idle: 0.06, seed: 6 },
          ],
        },
        // 副标横排小字
        {
          id: 'sub', kind: 'text', text: sub, class: 'kp-serif',
          style: { fontSize: '30px', color: 'rgba(255,217,160,.8)', letterSpacing: '.34em' },
          at: { x: '38%', y: '76%', anchor: 'center' }, z: 3, in: 'beat:4',
          effects: [{ type: 'maskReveal', at: 'beat:4', dur: 0.8, dir: 'left', ease: 'outExpo' }],
        },
        // 印章落款
        {
          id: 'seal', kind: 'text', text: seal, z: 4, in: 'beat:4+0.6',
          style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '92px', height: '92px', border: '4px solid #e8483a', borderRadius: '12px', fontFamily: "'Noto Serif SC',serif", fontSize: '52px', fontWeight: '700', color: '#e8483a', background: 'rgba(232,72,58,.08)', boxShadow: '0 0 24px rgba(232,72,58,.3)' },
          at: { x: '30%', y: '38%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 'beat:4+0.6', v: 1.6 }, { t: 'beat:4+0.95', v: 1, ease: 'inExpo' }] },
            { prop: 'opacity', kf: [{ t: 'beat:4+0.6', v: 0 }, { t: 'beat:4+0.8', v: 1 }] },
            { prop: 'rotate', kf: [{ t: 0, v: -5 }] },
          ],
          effects: [{ type: 'shake', at: 'beat:4+0.95', dur: 0.25, amp: 5, seed: 8 }],
        },
      ],
    };
  },
};

// ── 7. 生成式 AI 流体 ────────────────────────────────────────────────────────
// 编排思路：智能在苏醒。光斑呼吸流动、标题从模糊中凝聚、光点轨道环绕如神经元。
const aiFlux: PresetDef = {
  id: 'sig.aiflux',
  label: '签名·AI 流体苏醒',
  group: '签名场景',
  paramsDoc: '{ title: string(≤12字), sub?: string }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '智能觉醒时刻');
    const sub = str(params.sub, 'generative intelligence');
    return {
      v: 1, duration, style: 'aiflux', bg: 'opaque',
      beats: [0, 0.5, 1.6, 2.8],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.1 }, { t: duration, v: 1, ease: 'outQuart' }] }] },
      layers: [
        // 中央光核：形变+呼吸（AI 的"心跳"）
        {
          id: 'nucleus', kind: 'shape', z: 1, parallax: 0.7,
          html: `<div class="kit-aiflux-blob" style="width:340px;height:330px;opacity:.9"></div>`,
          at: { x: '50%', y: '48%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 0, v: 0.3 }, { t: 'beat:2', v: 1, ease: 'outQuart' }] },
            { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 'beat:1', v: 0.55, ease: 'outCubic' }] },
            { prop: 'blur', kf: [{ t: 0, v: 20 }, { t: 'beat:2', v: 4, ease: 'outQuart' }] },
          ],
          effects: [{ type: 'liquidBlob', period: 9, amount: 0.45, seed: 11 }, { type: 'breathe', period: 4, amount: 0.06 }],
        },
        // 神经元光点：三颗不同轨道环绕
        {
          id: 'n1', kind: 'shape', z: 2, parallax: 1.05,
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#8b7bff;box-shadow:0 0 16px #8b7bff"></div>`,
          at: { x: '50%', y: '48%', anchor: 'center' }, in: 'beat:1',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:1+0.6', v: 1 }] }],
          effects: [{ type: 'orbit', period: 7, rx: 300, ry: 110, depth: true }],
        },
        {
          id: 'n2', kind: 'shape', z: 2, parallax: 1.05,
          html: `<div style="width:9px;height:9px;border-radius:50%;background:#3fd8c2;box-shadow:0 0 14px #3fd8c2"></div>`,
          at: { x: '50%', y: '48%', anchor: 'center' }, in: 'beat:1+0.3',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:1+0.3', v: 0 }, { t: 'beat:1+0.9', v: 0.9 }] }],
          effects: [{ type: 'orbit', period: 10, rx: 300, ry: 110, phase: 0.35, dir: 'ccw', depth: true }],
        },
        {
          id: 'n3', kind: 'shape', z: 2, parallax: 1.05,
          html: `<div style="width:7px;height:7px;border-radius:50%;background:#ff7ac4;box-shadow:0 0 12px #ff7ac4"></div>`,
          at: { x: '50%', y: '48%', anchor: 'center' }, in: 'beat:1+0.6',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:1+0.6', v: 0 }, { t: 'beat:2', v: 0.85 }] }],
          effects: [{ type: 'orbit', period: 13, rx: 300, ry: 110, phase: 0.7, depth: true }],
        },
        // 主体：标题从模糊凝聚（AI 生成的过程感）
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1 kit-aiflux-halo',
          style: { fontWeight: '600', letterSpacing: '0.01em' },
          at: { x: '50%', y: '47%', anchor: 'center' }, z: 3,
          tracks: [
            { prop: 'blur', kf: [{ t: 'beat:2', v: 16 }, { t: 'beat:3', v: 0, ease: 'outExpo' }] },
            { prop: 'opacity', kf: [{ t: 'beat:2', v: 0 }, { t: 'beat:2+0.6', v: 1, ease: 'outCubic' }] },
            { prop: 'scale', kf: [{ t: 'beat:2', v: 1.06 }, { t: 'beat:3', v: 1, ease: 'outQuart' }] },
          ],
          effects: [{ type: 'breathe', at: 'beat:3+0.5', period: 4.2, amount: 0.012, glowColor: 'rgba(139,123,255,.5)', glowRadius: 30 }],
        },
        {
          id: 'sub', kind: 'text', text: sub, class: 'kp-label',
          style: { color: 'var(--fx-accent2)', fontSize: '21px', letterSpacing: '.32em' },
          at: { x: '50%', y: '60%', anchor: 'center' }, z: 3, in: 'beat:3',
          effects: [{ type: 'typewriter', at: 'beat:3', charDur: 0.045, cursorColor: 'var(--fx-accent2)' }],
        },
      ],
    };
  },
};

// ── 8. 程序几何生成 ──────────────────────────────────────────────────────────
// 编排思路：算法在作画。环阵逐圈 lineDraw 生成、参数打字、整体极慢旋转呼吸。
const generativeArt: PresetDef = {
  id: 'sig.generative',
  label: '签名·程序生成',
  group: '签名场景',
  paramsDoc: '{ title: string(≤12字), params?: string(参数注释文案) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const title = str(params.title, '算法之美');
    const paramText = str(params.params, 'seed=42 · n=16 · φ=1.618');
    const rings = Array.from({ length: 16 }).map((_, i) =>
      `<circle cx="400" cy="400" r="${34 + i * 21}" stroke="${i % 3 === 2 ? '#5c8aff' : '#e8e8ec'}" stroke-width="${i % 3 === 2 ? 1.4 : 0.9}" opacity="${(0.75 - i * 0.035).toFixed(3)}" transform="rotate(${i * 6} 400 400) translate(${i * 2.4} 0)"/>`,
    ).join('');
    return {
      v: 1, duration, style: 'generative', bg: 'opaque', styleBackdrop: false,
      beats: [0, 0.3, 2.2, 3.4],
      layers: [
        // 算法环阵：逐圈生成 + 极慢整体旋转
        {
          id: 'rings', kind: 'svg', z: 1, parallax: 0.85,
          svg: `<svg width="800" height="800" viewBox="0 0 800 800" fill="none">${rings}</svg>`,
          at: { x: '50%', y: '47%', anchor: 'center' },
          tracks: [
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 14 }] },
            { prop: 'scale', kf: [{ t: 0, v: 0.94 }, { t: duration / 2, v: 1, ease: 'inOutQuad' }, { t: duration, v: 0.97, ease: 'inOutQuad' }] },
          ],
          effects: [{ type: 'lineDraw', at: 'beat:1', dur: 1.4, stagger: 0.09, ease: 'inOutCubic' }],
        },
        // 中心点
        {
          id: 'dot', kind: 'shape', z: 2,
          html: `<div style="width:8px;height:8px;border-radius:50%;background:#5c8aff;box-shadow:0 0 14px #5c8aff"></div>`,
          at: { x: '50%', y: '47%', anchor: 'center' }, in: 'beat:1',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:1+0.4', v: 1 }] }],
          effects: [{ type: 'breathe', period: 2.4, amount: 0.3, glowColor: 'rgba(92,138,255,.7)', glowRadius: 20 }],
        },
        // 主体：标题切片 + 参数打字
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h2',
          style: { fontWeight: '500', letterSpacing: '0.06em', color: '#e8e8ec' },
          at: { x: '50%', y: '47%', anchor: 'center' }, z: 3, in: 'beat:2',
          effects: [{ type: 'sliceIn', at: 'beat:2', dur: 0.7, slices: 6, offset: 70, dir: 'h', seed: 5 }],
        },
        {
          id: 'params', kind: 'text', text: paramText,
          style: { fontFamily: "'JetBrains Mono',monospace", fontSize: '18px', color: 'rgba(232,232,236,.45)', letterSpacing: '.1em' },
          at: { x: '50%', y: '86%', anchor: 'center' }, z: 3, in: 'beat:3',
          effects: [{ type: 'typewriter', at: 'beat:3', charDur: 0.04, cursor: false }],
        },
      ],
    };
  },
};

// ── 9. 次表面散射质感 ────────────────────────────────────────────────────────
// 编排思路：光从玉里透出来。玉石 blob 微形变呼吸、标题内透光缓显、shine 如光穿蜡。
const subsurfaceGlow: PresetDef = {
  id: 'sig.subsurface',
  label: '签名·玉质透光',
  group: '签名场景',
  paramsDoc: '{ title: string(≤8字), sub?: string }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '温润之光');
    const sub = str(params.sub, 'SUBSURFACE · 高级质感');
    return {
      v: 1, duration, style: 'subsurface', bg: 'opaque', styleBackdrop: false,
      beats: [0, 0.6, 2.0, 3.2],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.05 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers: [
        // 主玉石：形变 + 内透光呼吸
        {
          id: 'jade', kind: 'shape', z: 1, parallax: 0.8,
          html: `<div class="kit-sss-jade" style="width:430px;height:420px"></div>`,
          at: { x: '50%', y: '47%', anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 'beat:1+0.8', v: 1, ease: 'outCubic' }] },
            { prop: 'scale', kf: [{ t: 0, v: 0.82 }, { t: 'beat:2', v: 1, ease: 'outQuart' }] },
          ],
          effects: [
            { type: 'liquidBlob', period: 11, amount: 0.16, seed: 3 },
            { type: 'breathe', period: 4.4, amount: 0.03, glowColor: 'rgba(255,185,163,.45)', glowRadius: 44 },
          ],
        },
        // 伴生小玉
        {
          id: 'jade-s', kind: 'shape', z: 1, parallax: 0.95,
          html: `<div style="width:140px;height:136px;border-radius:48% 52% 50% 50%/52% 48% 52% 48%;background:radial-gradient(circle at 55% 35%,rgba(200,232,220,.45) 0%,rgba(200,232,220,.14) 55%,transparent 80%);box-shadow:inset 0 0 40px rgba(200,232,220,.35)"></div>`,
          at: { x: '76%', y: '68%', anchor: 'center' }, in: 'beat:1',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:2', v: 0.9, ease: 'outCubic' }] }],
          effects: [{ type: 'liquidBlob', period: 9, amount: 0.2, seed: 8 }, { type: 'orbit', period: 15, rx: 16, ry: 22, dir: 'ccw' }],
        },
        // 主体：标题内透光缓显 + 周期扫光
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1 kit-sss-glow',
          style: { fontWeight: '500', letterSpacing: '0.12em' },
          at: { x: '50%', y: '46%', anchor: 'center' }, z: 3, in: 'beat:2',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:2', v: 0 }, { t: 'beat:2+1.1', v: 1, ease: 'outQuart' }] },
            { prop: 'blur', kf: [{ t: 'beat:2', v: 9 }, { t: 'beat:2+1.1', v: 0, ease: 'outQuart' }] },
          ],
          effects: [{ type: 'shine', at: 'beat:3+0.5', dur: 1.6, every: 4, angle: 110, strength: 0.4 }],
        },
        {
          id: 'sub', kind: 'text', text: sub, class: 'kp-label',
          style: { color: 'rgba(200,232,220,.7)', fontSize: '19px', letterSpacing: '.4em' },
          at: { x: '50%', y: '60%', anchor: 'center' }, z: 3, in: 'beat:3',
          effects: [{ type: 'maskReveal', at: 'beat:3', dur: 0.9, dir: 'center', ease: 'outExpo' }],
        },
      ],
    };
  },
};

// ── 10. 复古未来主义 ─────────────────────────────────────────────────────────
// 编排思路：80s 想象中的未来。合成器夕阳网格、铬字扫光、日落色渐变流动。
const retroFuture: PresetDef = {
  id: 'sig.retrofuture',
  label: '签名·复古未来',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), year?: string(年份如"2077") }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '未来往事');
    const year = str(params.year, "'86");
    return {
      v: 1, duration, style: 'synthgrid', bg: 'opaque',
      beats: [0, 0.4, 1.4, 2.6],
      flashes: [{ at: 'beat:2', dur: 0.3, color: '#ff6ec7', peak: 0.3 }],
      camera: { tracks: [{ prop: 'y', kf: [{ t: 0, v: 20 }, { t: duration, v: -14, ease: 'inOutQuad' }] }] },
      layers: [
        // 落日圆盘：升起 + 呼吸
        {
          id: 'sun', kind: 'shape', z: 1, parallax: 0.6,
          html: `<div style="width:380px;height:380px;border-radius:50%;background:linear-gradient(180deg,#ffd23d 0%,#ff6ec7 55%,#b8377f 100%);-webkit-mask:linear-gradient(180deg,#000 0 55%,transparent 55.5% 58%,#000 58.5% 64%,transparent 64.5% 68%,#000 69% 76%,transparent 76.5% 82%,#000 83%);mask:linear-gradient(180deg,#000 0 55%,transparent 55.5% 58%,#000 58.5% 64%,transparent 64.5% 68%,#000 69% 76%,transparent 76.5% 82%,#000 83%)"></div>`,
          at: { x: '50%', y: '40%', anchor: 'center' },
          tracks: [
            { prop: 'y', kf: [{ t: 0, v: 130 }, { t: 'beat:2+0.8', v: 0, ease: 'outQuart' }] },
            { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 'beat:1+0.6', v: 1, ease: 'outCubic' }] },
          ],
          effects: [{ type: 'breathe', at: 'beat:3', period: 4.6, amount: 0.02, glowColor: 'rgba(255,110,199,.55)', glowRadius: 60 }],
        },
        // 主体：铬字标题 + 持续渐变流动 + 扫光
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1',
          style: { fontSize: '124px', fontWeight: '900', fontStyle: 'italic', letterSpacing: '0.02em', textShadow: '0 4px 0 rgba(184,55,127,.6), 0 10px 34px rgba(255,110,199,.4)' },
          at: { x: '50%', y: '52%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 'beat:2', stagger: 0.055, dur: 0.5, from: { y: 80, scale: 1.4, opacity: 0 }, ease: 'outExpo' },
            { type: 'gradientShift', period: 6, angle: 175, colors: ['#fff6d8', '#ffd23d', '#ff6ec7', '#7a5af8'], mode: 'text' },
            { type: 'shine', at: 'beat:3+0.6', dur: 1.3, every: 3.4, angle: 118, strength: 0.55 },
          ],
        },
        // 年份角标：霓虹点亮
        {
          id: 'year', kind: 'text', text: year,
          style: { fontFamily: "'Space Grotesk',monospace", fontSize: '54px', fontWeight: '700', color: '#2ee6ff', textShadow: '0 0 16px rgba(46,230,255,.9), 0 0 50px rgba(46,230,255,.4)' },
          at: { x: '73%', y: '38%', anchor: 'center' }, z: 3, in: 'beat:3',
          tracks: [{ prop: 'rotate', kf: [{ t: 0, v: -8 }] }],
          effects: [{ type: 'flicker', at: 'beat:3', dur: 1.1, idle: 0.09, seed: 4 }],
        },
        // 底部速度线
        {
          id: 'speedline', kind: 'svg', z: 2,
          svg: `<svg width="720" height="10" viewBox="0 0 720 10" fill="none"><line x1="4" y1="5" x2="716" y2="5" stroke="#ff6ec7" stroke-width="4" stroke-linecap="round" stroke-dasharray="90 26 40 26"/></svg>`,
          at: { x: '50%', y: '68%', anchor: 'center' }, in: 'beat:2+0.4',
          effects: [{ type: 'lineDraw', at: 'beat:2+0.4', dur: 0.8, ease: 'outExpo' }],
        },
      ],
    };
  },
};

// ── 11. 超现实拼贴 ───────────────────────────────────────────────────────────
// 编排思路：勒索信式剪贴。单词白底块错位甩入、红笔箭头手绘、胶带贴纸、持续躁动。
const collagePunk: PresetDef = {
  id: 'sig.collage',
  label: '签名·超现实拼贴',
  group: '签名场景',
  paramsDoc: '{ words: string(标题,会按字/词拆成剪贴块,≤10字), note?: string(手写注释) }',
  defaultDuration: 5,
  build(params, duration): SceneSpec {
    const words = str(params.words, '打破常规');
    const note = str(params.note, '←就是这个!');
    const chars = [...words];
    const n = chars.length;
    // 每个字一个剪贴块图层：位置沿中轴排开、rotate 交替错位
    const charLayers: SceneLayer[] = chars.map((ch, i) => {
      const rot = (i % 2 === 0 ? -1 : 1) * (3 + (i * 7) % 6);
      const xPct = 50 + (i - (n - 1) / 2) * Math.min(13, 78 / n);
      return {
        id: `cut-${i}`, kind: 'text', text: ch, class: 'kit-collage-cut',
        style: { fontFamily: "'Noto Serif SC',serif", fontSize: '120px', fontWeight: '900', color: i === Math.floor(n / 2) ? '#d7301f' : '#1c1a16' },
        at: { x: `${xPct}%`, y: '45%', anchor: 'center' }, z: 3,
        tracks: [
          { prop: 'scale', kf: [{ t: 0.3 + i * 0.14, v: 0 }, { t: 0.65 + i * 0.14, v: 1, ease: 'outExpo' }] },
          { prop: 'rotate', kf: [{ t: 0.3 + i * 0.14, v: rot * 3 }, { t: 0.65 + i * 0.14, v: rot, ease: 'outBack' }] },
          { prop: 'opacity', kf: [{ t: 0.3 + i * 0.14, v: 0 }, { t: 0.45 + i * 0.14, v: 1 }] },
        ],
        effects: [{ type: 'jitter', at: 1.2 + i * 0.1, amp: 1.8, freq: 4, rotAmp: 0.7, seed: i + 1 }],
      };
    });
    return {
      v: 1, duration, style: 'collagepunk', bg: 'opaque',
      beats: [0, 0.3, 1.6, 2.4],
      flashes: [{ at: 'beat:2', dur: 0.16, color: '#1c1a16', peak: 0.18 }],
      layers: [
        ...charLayers,
        // 红笔圈注箭头（手绘感 lineDraw）
        {
          id: 'arrow', kind: 'svg', z: 4,
          svg: `<svg width="360" height="160" viewBox="0 0 360 160" fill="none"><path d="M340 30 Q 240 130 60 96" stroke="#d7301f" stroke-width="8" stroke-linecap="round" fill="none"/><path d="M96 62 L 60 96 L 108 112" stroke="#d7301f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
          at: { x: '64%', y: '66%', anchor: 'center' }, in: 'beat:2',
          effects: [{ type: 'lineDraw', at: 'beat:2', dur: 0.55, ease: 'outQuart' }],
        },
        // 手写注释：马克笔高亮
        {
          id: 'note', kind: 'text', text: note, class: 'kp-mark',
          style: { fontFamily: "'ZCOOL XiaoWei',cursive", fontSize: '44px', color: '#1c1a16' },
          at: { x: '76%', y: '74%', anchor: 'center' }, z: 4, in: 'beat:3',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:3', v: 0 }, { t: 'beat:3+0.25', v: 1 }] },
            { prop: 'rotate', kf: [{ t: 0, v: -4 }] },
          ],
          effects: [{ type: 'jitter', at: 'beat:3+0.3', amp: 1.2, freq: 3.5, rotAmp: 0.5, seed: 21 }],
        },
        // 胶带贴块
        {
          id: 'tape', kind: 'shape', z: 5,
          html: `<div style="width:150px;height:42px;background:rgba(212,200,160,.85);box-shadow:0 2px 6px rgba(0,0,0,.18);transform:rotate(8deg)"></div>`,
          at: { x: '28%', y: '30%', anchor: 'center' }, in: 'beat:2+0.3',
          tracks: [
            { prop: 'scale', kf: [{ t: 'beat:2+0.3', v: 1.5 }, { t: 'beat:2+0.55', v: 1, ease: 'inExpo' }] },
            { prop: 'opacity', kf: [{ t: 'beat:2+0.3', v: 0 }, { t: 'beat:2+0.45', v: 1 }] },
          ],
        },
      ],
    };
  },
};

// ── 12. 玻璃态微拟物 ─────────────────────────────────────────────────────────
// 编排思路：visionOS 的空气感。毛玻璃卡片悬浮呼吸、光斑背景、一切轻盈克制。
const glassMorph: PresetDef = {
  id: 'sig.glassmorph',
  label: '签名·玻璃悬浮',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), sub?: string, badge?: string(徽标字≤4字) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '空气感界面');
    const sub = str(params.sub, '轻盈 · 通透 · 悬浮');
    const badge = str(params.badge, 'PRO');
    return {
      v: 1, duration, style: 'glassos', bg: 'opaque',
      beats: [0, 0.5, 1.4, 2.4],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers: [
        // 背景光斑：慢漂
        {
          id: 'glow-a', kind: 'shape', z: 1, parallax: 0.55,
          html: `<div style="width:560px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(122,162,255,.4),transparent 68%);filter:blur(50px)"></div>`,
          at: { x: '26%', y: '30%', anchor: 'center' },
          effects: [{ type: 'orbit', period: 17, rx: 46, ry: 30 }],
        },
        {
          id: 'glow-b', kind: 'shape', z: 1, parallax: 0.55,
          html: `<div style="width:480px;height:460px;border-radius:50%;background:radial-gradient(circle,rgba(255,148,222,.3),transparent 68%);filter:blur(56px)"></div>`,
          at: { x: '76%', y: '70%', anchor: 'center' },
          effects: [{ type: 'orbit', period: 14, rx: 38, ry: 44, dir: 'ccw' }],
        },
        // 主玻璃卡：悬浮呼吸（group 内含标题/副标/徽标）
        {
          id: 'card', kind: 'group', z: 3,
          html: `<div class="kp-glass" style="width:760px;height:340px;border-radius:36px"></div>`,
          at: { x: '50%', y: '48%', anchor: 'center' },
          tracks: [
            { prop: 'y', kf: [{ t: 'beat:1', v: 90 }, { t: 'beat:2', v: 0, ease: 'outQuart' }] },
            { prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:1+0.7', v: 1, ease: 'outCubic' }] },
            { prop: 'blur', kf: [{ t: 'beat:1', v: 10 }, { t: 'beat:2', v: 0, ease: 'outQuart' }] },
          ],
          effects: [
            { type: 'breathe', at: 'beat:2+0.5', period: 4.8, amount: 0.008 },
            { type: 'orbit', at: 'beat:2+0.5', period: 12, rx: 0, ry: 9 },
            { type: 'shine', at: 'beat:3+0.8', dur: 1.8, every: 4.5, angle: 120, strength: 0.22 },
          ],
        },
        // 卡上内容（独立图层叠在卡上方，跟随同步入场）
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h2',
          style: { fontWeight: '600', color: '#f4f7ff', letterSpacing: '0.01em' },
          at: { x: '50%', y: '44%', anchor: 'center' }, z: 4, in: 'beat:2',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:2', v: 0 }, { t: 'beat:2+0.6', v: 1, ease: 'outCubic' }] },
            { prop: 'y', kf: [{ t: 'beat:2', v: 22 }, { t: 'beat:2+0.6', v: 0, ease: 'outQuart' }] },
          ],
          effects: [{ type: 'orbit', at: 'beat:2+1.1', period: 12, rx: 0, ry: 9 }],
        },
        {
          id: 'sub', kind: 'text', text: sub, class: 'kp-sub',
          style: { color: 'rgba(244,247,255,.65)' },
          at: { x: '50%', y: '55%', anchor: 'center' }, z: 4, in: 'beat:2+0.3',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:2+0.3', v: 0 }, { t: 'beat:2+0.9', v: 0.85, ease: 'outCubic' }] }],
          effects: [{ type: 'orbit', at: 'beat:2+1.1', period: 12, rx: 0, ry: 9 }],
        },
        // 徽标小玻璃片：延迟悬浮入
        {
          id: 'badge', kind: 'text', text: badge, z: 5, in: 'beat:3',
          style: { display: 'inline-block', padding: '.4em 1em', borderRadius: '999px', background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.28)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', fontSize: '24px', fontWeight: '700', letterSpacing: '.18em', color: '#fff' },
          at: { x: '67%', y: '36%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 'beat:3', v: 0.6 }, { t: 'beat:3+0.6', v: 1, spring: { stiffness: 160, damping: 14 } }] },
            { prop: 'opacity', kf: [{ t: 'beat:3', v: 0 }, { t: 'beat:3+0.4', v: 1 }] },
          ],
          effects: [{ type: 'orbit', at: 'beat:3+0.7', period: 9, rx: 0, ry: 7, phase: 0.3 }],
        },
      ],
    };
  },
};

// ── 13. 赛博酸性哥特 ─────────────────────────────────────────────────────────
// 编排思路：地下俱乐部海报活了。铬字躁动、酸绿灯管点亮、星徽显形、暗黑仪式感。
const acidGothic: PresetDef = {
  id: 'sig.acidgothic',
  label: '签名·酸性哥特',
  group: '签名场景',
  paramsDoc: '{ title: string(≤8字), sub?: string(英文小字) }',
  defaultDuration: 5.5,
  build(params, duration): SceneSpec {
    const title = str(params.title, '暗夜狂欢');
    const sub = str(params.sub, 'UNDERGROUND ††† ACID');
    return {
      v: 1, duration, style: 'acidgothic', bg: 'opaque',
      beats: [0, 0.4, 1.3, 2.2, 3.0],
      flashes: [{ at: 'beat:3', dur: 0.2, color: '#b6ff2e', peak: 0.28 }],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1 }, { t: 'beat:3', v: 1.04, ease: 'inQuad' }, { t: duration, v: 1.02, ease: 'outQuad' }] }] },
      layers: [
        // 星形徽记：lineDraw 显形 + 慢转
        {
          id: 'sigil', kind: 'svg', z: 1, parallax: 0.8,
          svg: `<svg width="560" height="560" viewBox="0 0 760 760" fill="none"><circle cx="380" cy="380" r="290" stroke="#b6ff2e" stroke-width="1.6"/><path d="M380 60 L 420 340 L 700 380 L 420 420 L 380 700 L 340 420 L 60 380 L 340 340 Z" stroke="#b6ff2e" stroke-width="2"/><circle cx="380" cy="380" r="180" stroke="#b6ff2e" stroke-width="1" stroke-dasharray="4 10"/></svg>`,
          at: { x: '50%', y: '48%', anchor: 'center' },
          tracks: [
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 24 }] },
            { prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:2', v: 0.55, ease: 'outCubic' }] },
          ],
          effects: [{ type: 'lineDraw', at: 'beat:1', dur: 1.2, stagger: 0.15, ease: 'inOutCubic' }],
        },
        // 主体：哥特铬字 + 持续躁动
        {
          id: 'title', kind: 'text', text: title, class: 'kit-acid-chrome',
          style: { fontFamily: "'Playfair Display','Noto Serif SC',serif", fontSize: '150px', fontWeight: '900', letterSpacing: '0.04em' },
          at: { x: '50%', y: '45%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'sliceIn', at: 'beat:2', dur: 0.6, slices: 4, offset: 140, seed: 7 },
            { type: 'jitter', at: 'beat:3', amp: 2, freq: 8, rotAmp: 0.5, seed: 13 },
            { type: 'glitch', at: 'beat:4+0.6', dur: 0.4, amp: 6, seed: 17 },
          ],
        },
        // 酸绿灯管小字：flicker 点亮
        {
          id: 'sub', kind: 'text', text: sub, class: 'kit-acid-neon',
          style: { fontFamily: "'Space Grotesk',monospace", fontSize: '26px', letterSpacing: '.4em', fontWeight: '600' },
          at: { x: '50%', y: '61%', anchor: 'center' }, z: 3, in: 'beat:3',
          effects: [{ type: 'flicker', at: 'beat:3', dur: 1.3, idle: 0.1, seed: 9 }],
        },
        // 尖锐装饰符号两枚
        {
          id: 'cross-l', kind: 'text', text: '✠',
          style: { fontSize: '64px', color: '#b6ff2e', textShadow: '0 0 20px rgba(182,255,46,.7)' },
          at: { x: '20%', y: '46%', anchor: 'center' }, z: 2, in: 'beat:4',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:4', v: 0 }, { t: 'beat:4+0.3', v: 0.85 }] },
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 90 }] },
          ],
          effects: [{ type: 'breathe', period: 2.2, amount: 0.06, glowColor: 'rgba(182,255,46,.5)', glowRadius: 22 }],
        },
        {
          id: 'cross-r', kind: 'text', text: '✠',
          style: { fontSize: '64px', color: '#b6ff2e', textShadow: '0 0 20px rgba(182,255,46,.7)' },
          at: { x: '80%', y: '46%', anchor: 'center' }, z: 2, in: 'beat:4+0.15',
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:4+0.15', v: 0 }, { t: 'beat:4+0.45', v: 0.85 }] },
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: -90 }] },
          ],
          effects: [{ type: 'breathe', period: 2.2, amount: 0.06, glowColor: 'rgba(182,255,46,.5)', glowRadius: 22 }],
        },
      ],
    };
  },
};

// ── 14. 动态分形 ─────────────────────────────────────────────────────────────
// 编排思路：跌入无限。嵌套方框各速旋转制造递归下坠感、camera 缓推、标题数学切片。
const fractalDive: PresetDef = {
  id: 'sig.fractal',
  label: '签名·分形深渊',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), note?: string(参数小注) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const title = str(params.title, '无限递归');
    const note = str(params.note, 'depth=∞ · ratio=0.78');
    // 三层嵌套方框组：内层转得快，外层慢 → 视觉递归
    const frameLayer = (id: string, size: number, rotDur: number, sw: number, color: string, op: number): SceneLayer => ({
      id, kind: 'svg', z: 1, parallax: 0.9,
      svg: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none"><rect x="${sw}" y="${sw}" width="${size - sw * 2}" height="${size - sw * 2}" stroke="${color}" stroke-width="${sw}" opacity="${op}"/></svg>`,
      at: { x: '50%', y: '47%', anchor: 'center' },
      tracks: [
        { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 360 * (duration / rotDur) }] },
        { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 1.0, v: 1, ease: 'outCubic' }] },
      ],
    });
    return {
      v: 1, duration, style: 'fractal', bg: 'opaque', styleBackdrop: false,
      beats: [0, 0.3, 2.4, 3.6],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1 }, { t: duration, v: 1.22, ease: 'inOutQuad' }] }, { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: -6 }] }] },
      layers: [
        frameLayer('f1', 860, 60, 2, '#ffc94d', 0.5),
        frameLayer('f2', 640, 38, 2, '#4d9fff', 0.55),
        frameLayer('f3', 470, 24, 2, '#ffc94d', 0.6),
        frameLayer('f4', 340, 15, 2, '#4d9fff', 0.7),
        frameLayer('f5', 240, 9.5, 2, '#eef2ff', 0.8),
        // 主体：标题切片 + 微呼吸
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h2',
          style: { fontWeight: '600', color: '#eef2ff', letterSpacing: '0.08em', textShadow: '0 0 34px rgba(77,159,255,.4)' },
          at: { x: '50%', y: '47%', anchor: 'center' }, z: 3, in: 'beat:2',
          effects: [
            { type: 'sliceIn', at: 'beat:2', dur: 0.75, slices: 5, offset: 90, dir: 'v', seed: 6 },
            { type: 'breathe', at: 'beat:3', period: 3.8, amount: 0.015, glowColor: 'rgba(255,201,77,.35)', glowRadius: 26 },
          ],
        },
        {
          id: 'note', kind: 'text', text: note,
          style: { fontFamily: "'JetBrains Mono',monospace", fontSize: '17px', color: 'rgba(238,242,255,.4)', letterSpacing: '.16em' },
          at: { x: '50%', y: '88%', anchor: 'center' }, z: 3, in: 'beat:3', parallax: 0,
          effects: [{ type: 'typewriter', at: 'beat:3', charDur: 0.05, cursor: false }],
        },
      ],
    };
  },
};

// ── 15. 扫描线全息 ───────────────────────────────────────────────────────────
// 编排思路：投影仪开机。光锥亮起、主体被扫描线投出、成像不稳定闪烁、数据注解。
const holoScan: PresetDef = {
  id: 'sig.holoscan',
  label: '签名·全息投影',
  group: '签名场景',
  paramsDoc: '{ title: string(≤10字), data?: string(数据注解), value?: number(可选数据) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const title = str(params.title, '全息影像');
    const data = str(params.data, 'PROJ.STABLE // 98.2%');
    return {
      v: 1, duration, style: 'holoscan', bg: 'opaque',
      beats: [0, 0.5, 1.3, 2.6, 3.6],
      flashes: [{ at: 'beat:1', dur: 0.3, color: '#2ee6ff', peak: 0.25 }],
      layers: [
        // 全息主体：扫描揭示 + 成像后轻微不稳定
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1 kit-holo-body',
          style: { fontWeight: '600', letterSpacing: '0.1em' },
          at: { x: '50%', y: '44%', anchor: 'center' }, z: 3, in: 'beat:1',
          effects: [
            { type: 'scanReveal', at: 'beat:1', dur: 1.2, dir: 'top', color: '#2ee6ff', lineWidth: 3 },
            { type: 'flicker', at: 'beat:2+0.6', idle: 0.1, seed: 5, dur: 0.3 },
            { type: 'breathe', at: 'beat:3', period: 4, amount: 0.012 },
            { type: 'glitch', at: 'beat:4+0.5', dur: 0.35, amp: 4, seed: 12 },
          ],
        },
        // 全息基座圆环：旋转
        {
          id: 'base', kind: 'svg', z: 2,
          svg: `<svg width="620" height="150" viewBox="0 0 620 150" fill="none"><ellipse cx="310" cy="75" rx="290" ry="52" stroke="rgba(46,230,255,.5)" stroke-width="1.6" stroke-dasharray="10 16"/><ellipse cx="310" cy="75" rx="220" ry="38" stroke="rgba(46,230,255,.3)" stroke-width="1"/></svg>`,
          at: { x: '50%', y: '78%', anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 'beat:1', v: 0 }, { t: 'beat:2', v: 1, ease: 'outCubic' }] },
            { prop: 'rotate', kf: [{ t: 0, v: 0 }, { t: duration, v: 10 }] },
          ],
          effects: [{ type: 'breathe', period: 3, amount: 0.02, glowColor: 'rgba(46,230,255,.4)', glowRadius: 18 }],
        },
        // 环绕检测点
        {
          id: 'probe', kind: 'shape', z: 2,
          html: `<div style="width:10px;height:10px;border-radius:50%;background:#2ee6ff;box-shadow:0 0 14px #2ee6ff"></div>`,
          at: { x: '50%', y: '78%', anchor: 'center' }, in: 'beat:2',
          tracks: [{ prop: 'opacity', kf: [{ t: 'beat:2', v: 0 }, { t: 'beat:2+0.4', v: 1 }] }],
          effects: [{ type: 'orbit', period: 5.5, rx: 290, ry: 52, depth: true }],
        },
        // 数据注解：打字 + 侧边标定线
        {
          id: 'data', kind: 'text', text: data,
          style: { fontFamily: "'JetBrains Mono',monospace", fontSize: '20px', color: 'rgba(46,230,255,.75)', letterSpacing: '.2em' },
          at: { x: '50%', y: '60%', anchor: 'center' }, z: 3, in: 'beat:3',
          effects: [{ type: 'typewriter', at: 'beat:3', charDur: 0.04, cursorColor: '#2ee6ff' }],
        },
        {
          id: 'caliper', kind: 'svg', z: 2,
          svg: `<svg width="70" height="330" viewBox="0 0 70 330" fill="none"><line x1="35" y1="6" x2="35" y2="324" stroke="rgba(46,230,255,.45)" stroke-width="1.4"/><line x1="18" y1="6" x2="52" y2="6" stroke="rgba(46,230,255,.45)" stroke-width="1.4"/><line x1="18" y1="324" x2="52" y2="324" stroke="rgba(46,230,255,.45)" stroke-width="1.4"/><line x1="24" y1="165" x2="46" y2="165" stroke="#2ee6ff" stroke-width="2"/></svg>`,
          at: { x: '20%', y: '46%', anchor: 'center' }, in: 'beat:2',
          effects: [{ type: 'lineDraw', at: 'beat:2', dur: 0.7, stagger: 0.1, ease: 'inOutCubic' }],
        },
      ],
    };
  },
};

export const SIGNATURE_PRESETS: PresetDef[] = [
  cyberData, textureMg, fluidGeo, flatMg, y2kGurl, guochao,
  aiFlux, generativeArt, subsurfaceGlow, retroFuture, collagePunk,
  glassMorph, acidGothic, fractalDive, holoScan,
];
