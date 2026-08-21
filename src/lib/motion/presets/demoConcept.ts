/**
 * presets/demoConcept — 概念演示库 A：把抽象概念"演出来"（15 个）。
 *
 * 导演思维实例化：讲机制/架构/流程/关系时，不做文字 PPT——
 * 让概念变成会动的角色（node）、关系变成会画的线（wire）、
 * 数据变成会飞的光点（pulse），观众"看见它运转"。
 * 全部基于 _scenekit 构件，agent 可拿任意一个当 few-shot 改造。
 */
import type { SceneLayer, SceneSpec } from '../spec';
import type { PresetDef } from './mg';
import { node, pulse, wire, line } from './_scenekit';

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function list(v: unknown, fb: string[]): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[；;\n、,，|]/).map((x) => x.trim()).filter(Boolean);
  return fb;
}

function num(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/* eslint-disable max-len */

const DARKBG = 'radial-gradient(ellipse 110% 90% at 50% 20%,#101624 0%,#090c14 70%)';

function title(text: string, y = 12, at = 0.2): SceneLayer {
  return {
    id: 'title', kind: 'text', text, class: 'kp-h3 kp-shadow',
    at: { x: '50%', y: `${y}%`, anchor: 'center' }, z: 6,
    effects: [{ type: 'kineticText', split: 'char', at, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
  };
}

function caption(id: string, text: string, x: number, y: number, at: number | string, size = 26): SceneLayer {
  return {
    id, kind: 'text', text, class: 'kp-shadow',
    style: { fontSize: `${size}px`, fontWeight: '600', color: 'rgba(240,246,255,.88)' },
    at: { x: `${x}%`, y: `${y}%`, anchor: 'center' }, z: 5, in: at,
    tracks: [
      { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: typeof at === 'number' ? at + 0.4 : at, v: 1, ease: 'outCubic' }] },
      { prop: 'y', kf: [{ t: at, v: 14 }, { t: typeof at === 'number' ? at + 0.4 : at, v: 0, ease: 'outCubic' }] },
    ],
  };
}

// ── 1. 多 agent 协作（主脑派单 → worker 干活 → 结果汇聚） ─────────────────────
const orchestra: PresetDef = {
  id: 'demo.orchestra',
  label: '演示·多agent协作',
  group: '概念演示',
  paramsDoc: '{ title?: string, brain?: string(主节点名,默认"主脑"), workers?: string[](2-4个子节点名) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '多 Agent 是怎么协作的');
    const brain = str(params.brain, '主脑');
    const workers = list(params.workers, ['检索', '写作', '审校']).slice(0, 4);
    const n = workers.length;
    const bx = 50, by = 40;
    const wy = 74;
    const wxs = workers.map((_, i) => 50 + (i - (n - 1) / 2) * Math.min(24, 76 / n));
    const layers: SceneLayer[] = [
      title(t),
      // 连线（先画关系）
      wire('wires', wxs.map((wx) => ({ d: line(bx, by, wx, wy, 30), color: 'rgba(120,160,255,.45)', width: 2.5 })), 1.0, { stagger: 0.15 }),
      // 主脑=空心环枢纽（无形的调度核心），workers=玻璃卡片模块（各配职能线性图标）
      node({ id: 'brain', x: bx, y: by, size: 170, color: '#7a8cff', label: brain, icon: 'brain', shape: 'ring', at: 0.4 }),
      ...workers.map((w, i) => node({ id: `w${i}`, x: wxs[i], y: wy, size: 110, color: '#3fd8c2', label: w, icon: (['search', 'pen', 'check', 'gear'] as const)[i % 4], shape: 'card', at: 1.6 + i * 0.2 })),
      // 派单：光点飞向每个 worker
      ...workers.map((_, i) => pulse({ id: `task${i}`, from: { x: bx, y: by }, to: { x: wxs[i], y: wy }, at: 2.6 + i * 0.25, dur: 0.65, color: '#7a8cff', bow: 30 })),
      // worker 工作状态：转圈小环
      ...workers.map((_, i): SceneLayer => ({
        id: `spin${i}`, kind: 'svg', z: 4,
        svg: `<svg width="150" height="150" viewBox="0 0 150 150" fill="none"><circle cx="75" cy="75" r="66" stroke="#3fd8c2" stroke-width="3" stroke-dasharray="80 340" stroke-linecap="round"/></svg>`,
        at: { x: `${wxs[i]}%`, y: `${wy}%`, anchor: 'center' }, in: 3.3 + i * 0.25, out: 5.4,
        tracks: [
          { prop: 'rotate', kf: [{ t: 3.3, v: 0 }, { t: 5.4, v: 720 }] },
          { prop: 'opacity', kf: [{ t: 3.3 + i * 0.25, v: 0 }, { t: 3.6 + i * 0.25, v: 1 }, { t: 5.2, v: 1 }, { t: 5.4, v: 0 }] },
        ],
      })),
      // 回收：结果光点飞回主脑
      ...workers.map((_, i) => pulse({ id: `res${i}`, from: { x: wxs[i], y: wy }, to: { x: bx, y: by }, at: 5.4 + i * 0.18, dur: 0.6, color: '#3fd8c2', bow: -30 })),
      // 主脑完成脉冲 + 结论
      {
        id: 'done-ring', kind: 'svg', z: 2,
        svg: `<svg width="360" height="360" viewBox="0 0 360 360" fill="none"><circle cx="180" cy="180" r="172" stroke="#7a8cff" stroke-width="3"/></svg>`,
        at: { x: `${bx}%`, y: `${by}%`, anchor: 'center' }, in: 6.2,
        tracks: [
          { prop: 'scale', kf: [{ t: 6.2, v: 0.5 }, { t: 7.0, v: 1.25, ease: 'outCubic' }] },
          { prop: 'opacity', kf: [{ t: 6.2, v: 0.9 }, { t: 7.0, v: 0 }] },
        ],
      },
      caption('concl', '拆解 → 并行 → 汇聚', 50, 92, 6.5, 30),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers, camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.05 }, { t: duration, v: 1, ease: 'outQuad' }] }] } };
  },
};

// ── 2. 流水线（元素沿管线逐环传递变形） ───────────────────────────────────────
const pipeline: PresetDef = {
  id: 'demo.pipeline',
  label: '演示·流程管线',
  group: '概念演示',
  paramsDoc: '{ title?: string, steps: string[](3-5个环节) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '一条内容的生产管线');
    const steps = list(params.steps, ['素材', '剪辑', '包装', '发布']).slice(0, 5);
    const n = steps.length;
    const xs = steps.map((_, i) => 14 + i * (72 / (n - 1)));
    const y = 50;
    const layers: SceneLayer[] = [
      title(t),
      wire('rail', xs.slice(1).map((x, i) => ({ d: line(xs[i], y, x, y), color: 'rgba(255,255,255,.25)', width: 3, dash: '2 10' })), 0.8, { stagger: 0.12 }),
      // 管线站点=六边形组件（流水线工位的机械感），终点站金色高亮
      ...steps.map((s, i) => node({ id: `n${i}`, x: xs[i], y, size: 116, color: i === n - 1 ? '#ffc94d' : '#5c8aff', label: s, shape: 'hex', at: 1.0 + i * 0.22 })),
      // 数据包沿管线逐段跳跃（每到一站脉冲一次）
      ...xs.slice(1).map((x, i) => pulse({ id: `p${i}`, from: { x: xs[i], y }, to: { x, y }, at: 2.4 + i * 0.9, dur: 0.7, color: '#ffc94d', size: 16 })),
      // 每站到达时的确认脉冲环
      ...xs.slice(1).map((x, i): SceneLayer => ({
        id: `ok${i}`, kind: 'svg', z: 2,
        svg: `<svg width="200" height="200" viewBox="0 0 200 200" fill="none"><circle cx="100" cy="100" r="94" stroke="#ffc94d" stroke-width="3"/></svg>`,
        at: { x: `${x}%`, y: `${y}%`, anchor: 'center' }, in: 3.1 + i * 0.9,
        tracks: [
          { prop: 'scale', kf: [{ t: 3.1 + i * 0.9, v: 0.5 }, { t: 3.7 + i * 0.9, v: 1.15, ease: 'outCubic' }] },
          { prop: 'opacity', kf: [{ t: 3.1 + i * 0.9, v: 0.85 }, { t: 3.7 + i * 0.9, v: 0 }] },
        ],
      })),
      caption('step-note', steps.join('  →  '), 50, 70, 2.2, 26),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 3. 网络效应（节点逐个加入，连接爆炸式增长） ───────────────────────────────
const network: PresetDef = {
  id: 'demo.network',
  label: '演示·网络效应',
  group: '概念演示',
  paramsDoc: '{ title?: string, conclusion?: string }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '为什么用户越多价值越大');
    const concl = str(params.conclusion, '节点 ×2，连接 ×4');
    // 6 节点固定布局（近似圆）
    const pos = [[50, 32], [67, 42], [64, 64], [50, 72], [34, 62], [35, 42]] as const;
    // 网络成员=user 图标小环（社交网络的"人"，比无名圆球有指代性）
    const nodeLayers = pos.map(([x, y], i) => node({ id: `u${i}`, x, y, size: 78, color: '#ff8a5c', icon: 'user', shape: 'ring', at: 0.6 + i * 0.55 }));
    // 全连接线：在第 i 个节点出现后画到已有节点
    const wires: { d: string; color?: string; width?: number }[] = [];
    for (let i = 1; i < pos.length; i++) {
      for (let j = 0; j < i; j++) {
        wires.push({ d: line(pos[i][0], pos[i][1], pos[j][0], pos[j][1]), color: 'rgba(255,138,92,.3)', width: 1.6 });
      }
    }
    const layers: SceneLayer[] = [
      title(t),
      wire('mesh', wires, 1.2, { stagger: 0.14, dur: 0.5 }),
      ...nodeLayers,
      // 连接计数滚动
      {
        id: 'count', kind: 'text', text: '0', class: 'kp-mega kp-accent kp-shadow',
        style: { fontSize: '120px', color: '#ff8a5c' },
        at: { x: '84%', y: '50%', anchor: 'center' }, z: 5, in: 1.4,
        effects: [
          { type: 'numberRoll', at: 1.4, dur: 3.6, from: 0, to: 15, suffix: ' 条连接', ease: 'outQuad' },
          { type: 'breathe', at: 5.2, period: 3, amount: 0.02, glowColor: 'rgba(255,138,92,.4)', glowRadius: 24 },
        ],
      },
      caption('concl', concl, 50, 90, 5.6, 30),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 4. 增长曲线（曲线生长 + 关键点标注 + 数字滚动） ───────────────────────────
const growth: PresetDef = {
  id: 'demo.growth',
  label: '演示·增长曲线',
  group: '概念演示',
  paramsDoc: '{ title?: string, value?: number(终值), suffix?: string(单位), milestone?: string(拐点标注) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '增长是怎么发生的');
    const value = num(params.value, 120);
    const suffix = str(params.suffix, '万');
    const milestone = str(params.milestone, '拐点：口碑传播启动');
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        title(t),
        // 坐标轴 + 指数曲线（lineDraw 生长是"增长"最直接的画法）
        {
          id: 'chart', kind: 'svg', z: 2,
          svg: `<svg width="1200" height="620" viewBox="0 0 1200 620" fill="none"><line x1="60" y1="560" x2="1160" y2="560" stroke="rgba(255,255,255,.3)" stroke-width="2"/><line x1="60" y1="560" x2="60" y2="30" stroke="rgba(255,255,255,.3)" stroke-width="2"/><path d="M60 545 C 320 535 520 510 700 430 C 860 358 1000 220 1130 70" stroke="#3fd8c2" stroke-width="6" stroke-linecap="round"/></svg>`,
          at: { x: '50%', y: '54%', anchor: 'center' },
          effects: [{ type: 'lineDraw', at: 0.8, dur: 2.6, stagger: 0.25, ease: 'inOutCubic' }],
        },
        // 拐点标记：脉冲圆 + 标注
        {
          id: 'dot', kind: 'html', z: 4,
          html: `<div style="width:22px;height:22px;border-radius:50%;background:#ffc94d;box-shadow:0 0 20px #ffc94d"></div>`,
          at: { x: '56%', y: '58%', anchor: 'center' }, in: 3.0,
          tracks: [{ prop: 'scale', kf: [{ t: 3.0, v: 0 }, { t: 3.4, v: 1, spring: { stiffness: 220, damping: 12 } }] }],
          effects: [{ type: 'breathe', at: 3.5, period: 2, amount: 0.14, glowColor: 'rgba(255,201,77,.6)', glowRadius: 18 }],
        },
        caption('mile', milestone, 56, 68, 3.4, 26),
        // 终值大数字
        {
          id: 'value', kind: 'text', text: '0', class: 'kp-mega kp-shadow',
          style: { fontSize: '150px', color: '#3fd8c2' },
          at: { x: '78%', y: '26%', anchor: 'center' }, z: 5, in: 3.8,
          tracks: [{ prop: 'scale', kf: [{ t: 3.8, v: 0.8 }, { t: 4.6, v: 1, spring: { stiffness: 170, damping: 13 } }] }],
          effects: [{ type: 'numberRoll', at: 3.8, dur: 1.6, to: value, suffix, ease: 'outExpo' }],
        },
      ],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
    };
  },
};

// ── 5. 漏斗转化（层层过滤，数字逐层缩水） ─────────────────────────────────────
const funnel: PresetDef = {
  id: 'demo.funnel',
  label: '演示·漏斗转化',
  group: '概念演示',
  paramsDoc: '{ title?: string, stages?: string[](3-4层如"曝光10000|点击800|下单120"，用|分隔名字和数) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '流量去哪儿了');
    const raw = list(params.stages, ['曝光 10000', '点击 800', '下单 120']).slice(0, 4);
    const n = raw.length;
    const widths = raw.map((_, i) => 760 - i * (520 / Math.max(1, n - 1)));
    const colors = ['#5c8aff', '#3fd8c2', '#ffc94d', '#ff8a5c'];
    const layers: SceneLayer[] = [
      title(t),
      ...raw.map((label, i): SceneLayer => ({
        id: `tier${i}`, kind: 'html', z: 3,
        html: `<div style="width:${widths[i]}px;height:96px;background:linear-gradient(180deg,color-mix(in srgb,${colors[i]} 90%,#fff),${colors[i]});clip-path:polygon(0 0,100% 0,${88 + i * 2}% 100%,${12 - i * 2}% 100%);display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:800;color:#0a0e18;box-shadow:0 12px 34px color-mix(in srgb,${colors[i]} 40%,transparent)">${label}</div>`,
        at: { x: '50%', y: `${30 + i * 17}%`, anchor: 'center' },
        tracks: [
          { prop: 'y', kf: [{ t: 0.6 + i * 0.8, v: -60 }, { t: 1.2 + i * 0.8, v: 0, ease: 'outBack' }] },
          { prop: 'opacity', kf: [{ t: 0.6 + i * 0.8, v: 0 }, { t: 1.0 + i * 0.8, v: 1 }] },
        ],
      })),
      // 层间漏下的光点（表示"流量在流失/沉淀"）
      ...raw.slice(1).map((_, i) => pulse({ id: `drop${i}`, from: { x: 50, y: 30 + i * 17 + 5 }, to: { x: 50, y: 30 + (i + 1) * 17 - 5 }, at: 1.5 + i * 0.8, dur: 0.5, color: colors[i + 1], size: 12 })),
      caption('concl', '每一层都在过滤，优化就是把口子放大', 50, 92, 4.2, 27),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 6. 对比天平（A vs B 权衡可视化） ──────────────────────────────────────────
const tradeoff: PresetDef = {
  id: 'demo.tradeoff',
  label: '演示·天平权衡',
  group: '概念演示',
  paramsDoc: '{ title?: string, left: string, right: string, winner?: "left"|"right"(倾向方,默认right) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '速度还是质量');
    const left = str(params.left, '快');
    const right = str(params.right, '好');
    const winner = params.winner === 'left' ? 'left' : 'right';
    const tilt = winner === 'right' ? 7 : -7;
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        title(t),
        // 天平横梁（group 旋转 = 倾斜）+ 两端托盘
        {
          id: 'beam', kind: 'group', z: 3,
          html: `<div style="width:900px;height:10px;border-radius:6px;background:linear-gradient(90deg,#5c8aff,#ffc94d)"></div>`,
          at: { x: '50%', y: '48%', anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.6, v: 0 }, { t: 1.1, v: 1, ease: 'outCubic' }] },
            { prop: 'rotate', kf: [{ t: 1.4, v: 0 }, { t: 2.6, v: -tilt * 0.6, ease: 'inOutQuad' }, { t: 3.8, v: tilt * 0.4, ease: 'inOutQuad' }, { t: 5.0, v: tilt, spring: { stiffness: 90, damping: 9 } }] },
          ],
        },
        // 支点三角
        {
          id: 'pivot', kind: 'html', z: 2,
          html: `<div style="width:0;height:0;border-left:36px solid transparent;border-right:36px solid transparent;border-bottom:110px solid rgba(255,255,255,.35)"></div>`,
          at: { x: '50%', y: '58%', anchor: 'center' }, in: 0.4,
          tracks: [{ prop: 'opacity', kf: [{ t: 0.4, v: 0 }, { t: 0.9, v: 1 }] }],
        },
        // 两端词
        {
          id: 'left', kind: 'text', text: left, class: 'kp-h2 kp-shadow',
          style: { color: '#5c8aff', fontWeight: '800' },
          at: { x: '28%', y: '38%', anchor: 'center' }, z: 4,
          tracks: [
            { prop: 'scale', kf: [{ t: 1.2, v: 0 }, { t: 1.7, v: 1, spring: { stiffness: 190, damping: 12 } }] },
            { prop: 'y', kf: [{ t: 1.4, v: 0 }, { t: 5.0, v: winner === 'left' ? 46 : -46, ease: 'inOutQuad' }] },
          ],
        },
        {
          id: 'right', kind: 'text', text: right, class: 'kp-h2 kp-shadow',
          style: { color: '#ffc94d', fontWeight: '800' },
          at: { x: '72%', y: '38%', anchor: 'center' }, z: 4,
          tracks: [
            { prop: 'scale', kf: [{ t: 1.4, v: 0 }, { t: 1.9, v: 1, spring: { stiffness: 190, damping: 12 } }] },
            { prop: 'y', kf: [{ t: 1.4, v: 0 }, { t: 5.0, v: winner === 'right' ? 46 : -46, ease: 'inOutQuad' }] },
          ],
        },
        // 胜者高亮环
        {
          id: 'win-ring', kind: 'svg', z: 2,
          svg: `<svg width="260" height="260" viewBox="0 0 260 260" fill="none"><circle cx="130" cy="130" r="120" stroke="${winner === 'right' ? '#ffc94d' : '#5c8aff'}" stroke-width="4" stroke-dasharray="14 10"/></svg>`,
          at: { x: winner === 'right' ? '72%' : '28%', y: '42%', anchor: 'center' }, in: 5.2,
          tracks: [
            { prop: 'opacity', kf: [{ t: 5.2, v: 0 }, { t: 5.6, v: 1, ease: 'outCubic' }] },
            { prop: 'rotate', kf: [{ t: 5.2, v: 0 }, { t: duration, v: 30 }] },
            { prop: 'scale', kf: [{ t: 5.2, v: 0.7 }, { t: 5.7, v: 1, ease: 'outBack' }] },
          ],
        },
        caption('concl', `${winner === 'right' ? right : left}，是更重的那一边`, 50, 90, 5.4, 28),
      ],
    };
  },
};

// ── 7. 闭环飞轮（环形循环，光点永续绕行加速） ─────────────────────────────────
const flywheel: PresetDef = {
  id: 'demo.flywheel',
  label: '演示·增长飞轮',
  group: '概念演示',
  paramsDoc: '{ title?: string, nodes?: string[](3-4个环节) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '飞轮是怎么转起来的');
    const items = list(params.nodes, ['内容', '流量', '变现', '投入']).slice(0, 4);
    const n = items.length;
    const cx = 50, cy = 52, rx = 22, ry = 26;
    const pos = items.map((_, i) => {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / n);
      return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
    });
    const colors = ['#5c8aff', '#3fd8c2', '#ffc94d', '#ff8a5c'];
    const layers: SceneLayer[] = [
      title(t),
      // 环形箭头轨道
      wire('loop', pos.map((p, i) => {
        const q = pos[(i + 1) % n];
        return { d: line(p.x, p.y, q.x, q.y, 60), color: 'rgba(255,255,255,.28)', width: 2.5, dash: '3 9' };
      }), 1.0, { stagger: 0.14 }),
      // 飞轮环节=菱形关卡（转起来的每一站），造型与圆形轨道形成方圆对比
      ...items.map((s, i) => node({ id: `n${i}`, x: pos[i].x, y: pos[i].y, size: 108, color: colors[i % colors.length], label: s, shape: 'diamond', at: 0.5 + i * 0.2 })),
      // 飞轮光点：orbit 持续绕行（伪加速用两个光点相位差）
      {
        id: 'wheel-dot', kind: 'html', z: 4,
        html: `<div style="width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 0 18px #fff,0 0 40px #5c8aff"></div>`,
        at: { x: `${cx}%`, y: `${cy}%`, anchor: 'center' }, in: 2.4,
        tracks: [{ prop: 'opacity', kf: [{ t: 2.4, v: 0 }, { t: 2.8, v: 1 }] }],
        effects: [{ type: 'orbit', at: 2.4, period: 3.2, rx: rx / 100 * 1920, ry: ry / 100 * 1080 }, { type: 'trail', copies: 4, lag: 0.05, fade: 0.55 }],
      },
      caption('concl', '每一环喂养下一环，转起来就停不下', 50, 92, 4.5, 27),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 8. 分层架构（三层依次点亮 + 层间数据流） ─────────────────────────────────
const stack: PresetDef = {
  id: 'demo.stack',
  label: '演示·分层架构',
  group: '概念演示',
  paramsDoc: '{ title?: string, tiers?: string[](3-4层,自底向上如"数据层|模型层|应用层") }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '系统是怎么分层的');
    const tiers = list(params.tiers, ['数据层', '模型层', '应用层']).slice(0, 4);
    const n = tiers.length;
    const colors = ['#5c8aff', '#3fd8c2', '#ffc94d', '#ff8a5c'];
    const layers: SceneLayer[] = [
      title(t),
      ...tiers.map((label, i): SceneLayer => {
        const y = 78 - i * (44 / Math.max(1, n - 1));
        return {
          id: `tier${i}`, kind: 'html', z: 3,
          html: `<div style="width:820px;height:104px;border-radius:18px;background:linear-gradient(180deg,color-mix(in srgb,${colors[i]} 24%,transparent),color-mix(in srgb,${colors[i]} 12%,transparent));border:2px solid ${colors[i]};display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:${colors[i]};box-shadow:0 14px 40px color-mix(in srgb,${colors[i]} 25%,transparent)">${label}</div>`,
          at: { x: '50%', y: `${y}%`, anchor: 'center' },
          tracks: [
            { prop: 'y', kf: [{ t: 0.6 + i * 0.6, v: 80 }, { t: 1.3 + i * 0.6, v: 0, ease: 'outExpo' }] },
            { prop: 'opacity', kf: [{ t: 0.6 + i * 0.6, v: 0 }, { t: 1.1 + i * 0.6, v: 1 }] },
          ],
          effects: [{ type: 'breathe', at: 3.4, period: 3.4 + i * 0.4, amount: 0.008 }],
        };
      }),
      // 层间上行数据流（底层供给上层）
      ...tiers.slice(1).map((_, i) => pulse({ id: `up${i}`, from: { x: 38 + i * 8, y: 78 - i * (44 / Math.max(1, n - 1)) - 5 }, to: { x: 38 + i * 8, y: 78 - (i + 1) * (44 / Math.max(1, n - 1)) + 5 }, at: 3.0 + i * 0.5, dur: 0.55, color: colors[i], size: 12 })),
      ...tiers.slice(1).map((_, i) => pulse({ id: `up2${i}`, from: { x: 62 - i * 8, y: 78 - i * (44 / Math.max(1, n - 1)) - 5 }, to: { x: 62 - i * 8, y: 78 - (i + 1) * (44 / Math.max(1, n - 1)) + 5 }, at: 3.3 + i * 0.5, dur: 0.55, color: colors[i], size: 12 })),
      caption('concl', '下层供能力，上层做体验', 50, 93, 4.6, 27),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 9. 一分为多（中心扇出分发） ──────────────────────────────────────────────
const fanout: PresetDef = {
  id: 'demo.fanout',
  label: '演示·一源多发',
  group: '概念演示',
  paramsDoc: '{ title?: string, source?: string(源名), targets?: string[](3-5个目标) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '一条内容，全网分发');
    const source = str(params.source, '一条视频');
    const targets = list(params.targets, ['抖音', '视频号', 'B站', '小红书']).slice(0, 5);
    const n = targets.length;
    const sxp = 22, syp = 50;
    const txs = 74;
    const tys = targets.map((_, i) => 24 + i * (52 / Math.max(1, n - 1)));
    const colors = ['#ff5252', '#3fd8c2', '#5c8aff', '#ff8a5c', '#ffc94d'];
    const layers: SceneLayer[] = [
      title(t),
      wire('fan', tys.map((ty) => ({ d: line(sxp, syp, txs, ty, 40), color: 'rgba(255,255,255,.22)', width: 2 })), 1.2, { stagger: 0.1 }),
      // 源=玻璃卡片（内容作品），目标=胶囊标签（分发渠道）——两类实体两种造型
      node({ id: 'src', x: sxp, y: syp, size: 130, color: '#8b9cff', label: source, labelSize: 26, icon: 'film', shape: 'card', at: 0.4 }),
      ...targets.map((s, i) => node({ id: `t${i}`, x: txs, y: tys[i], size: 96, color: colors[i % colors.length], label: s, labelSize: 24, shape: 'pill', at: 1.6 + i * 0.15 })),
      // 多波光点扇出（两轮，显示"持续分发"）
      ...targets.map((_, i) => pulse({ id: `f1-${i}`, from: { x: sxp, y: syp }, to: { x: txs, y: tys[i] }, at: 2.6 + i * 0.12, dur: 0.75, color: colors[i % colors.length], bow: 40 })),
      ...targets.map((_, i) => pulse({ id: `f2-${i}`, from: { x: sxp, y: syp }, to: { x: txs, y: tys[i] }, at: 4.2 + i * 0.12, dur: 0.75, color: colors[i % colors.length], bow: 40 })),
      caption('concl', '做一次，触达所有渠道', 50, 92, 5.0, 28),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 10. 多合一（汇聚融合） ───────────────────────────────────────────────────
const converge: PresetDef = {
  id: 'demo.converge',
  label: '演示·多源汇聚',
  group: '概念演示',
  paramsDoc: '{ title?: string, sources?: string[](3-5个来源), result?: string(汇聚产物) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '好决策从哪来');
    const sources = list(params.sources, ['数据', '经验', '用户反馈']).slice(0, 5);
    const result = str(params.result, '判断');
    const n = sources.length;
    const sxs = 22;
    const sys = sources.map((_, i) => 26 + i * (48 / Math.max(1, n - 1)));
    const txp = 72, typ = 50;
    const layers: SceneLayer[] = [
      title(t),
      wire('conv', sys.map((sy2) => ({ d: line(sxs, sy2, txp, typ, -40), color: 'rgba(255,255,255,.22)', width: 2 })), 1.0, { stagger: 0.12 }),
      // 来源=胶囊（输入素材），产物=发光球（结晶出的无形判断）——输入输出异形
      ...sources.map((s, i) => node({ id: `s${i}`, x: sxs, y: sys[i], size: 92, color: '#5c8aff', label: s, labelSize: 22, shape: 'pill', at: 0.5 + i * 0.15 })),
      // 汇聚光点
      ...sources.map((_, i) => pulse({ id: `c${i}`, from: { x: sxs, y: sys[i] }, to: { x: txp, y: typ }, at: 2.2 + i * 0.2, dur: 0.8, color: '#5c8aff', bow: -40 })),
      // 产物节点：光点到齐后才诞生（scale 弹出 + 金色）
      node({ id: 'result', x: txp, y: typ, size: 170, color: '#ffc94d', label: result, labelSize: 40, at: 3.4, ring: true }),
      {
        id: 'burst', kind: 'svg', z: 2,
        svg: `<svg width="380" height="380" viewBox="0 0 380 380" fill="none"><circle cx="190" cy="190" r="180" stroke="#ffc94d" stroke-width="3"/></svg>`,
        at: { x: `${txp}%`, y: `${typ}%`, anchor: 'center' }, in: 3.6,
        tracks: [
          { prop: 'scale', kf: [{ t: 3.6, v: 0.4 }, { t: 4.4, v: 1.2, ease: 'outCubic' }] },
          { prop: 'opacity', kf: [{ t: 3.6, v: 0.9 }, { t: 4.4, v: 0 }] },
        ],
      },
      caption('concl', '单一来源都是偏见，交叉验证才是判断', 50, 90, 4.6, 27),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 11. 时间线里程碑 ─────────────────────────────────────────────────────────
const milestones: PresetDef = {
  id: 'demo.milestones',
  label: '演示·时间线',
  group: '概念演示',
  paramsDoc: '{ title?: string, events?: string[](3-5个"年份 事件"如"2019 起步") }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '这一路是怎么走过来的');
    const events = list(params.events, ['2019 起步', '2021 转型', '2023 爆发', '2025 出海']).slice(0, 5);
    const n = events.length;
    const xs = events.map((_, i) => 14 + i * (72 / Math.max(1, n - 1)));
    const layers: SceneLayer[] = [
      title(t),
      // 主轴生长
      wire('axis', [{ d: line(10, 55, 90, 55), color: 'rgba(255,255,255,.35)', width: 3 }], 0.7, { dur: 1.6 }),
      // 里程碑点 + 标注（上下交错）
      ...events.flatMap((ev, i): SceneLayer[] => {
        const [year, ...rest] = ev.split(/\s+/);
        const label = rest.join(' ') || year;
        const up = i % 2 === 0;
        const at = 1.4 + i * 0.7;
        return [
          {
            id: `dot${i}`, kind: 'html', z: 4,
            html: `<div style="width:26px;height:26px;border-radius:50%;background:#ffc94d;border:4px solid #0a0e18;box-shadow:0 0 18px rgba(255,201,77,.8)"></div>`,
            at: { x: `${xs[i]}%`, y: '55%', anchor: 'center' },
            tracks: [{ prop: 'scale', kf: [{ t: at, v: 0 }, { t: at + 0.4, v: 1, spring: { stiffness: 230, damping: 12 } }] }],
          },
          {
            id: `year${i}`, kind: 'text', text: year, class: 'kp-num kp-shadow',
            style: { fontSize: '44px', color: '#ffc94d', fontWeight: '800' },
            at: { x: `${xs[i]}%`, y: up ? '42%' : '68%', anchor: 'center' }, z: 4, in: at + 0.15,
            tracks: [
              { prop: 'opacity', kf: [{ t: at + 0.15, v: 0 }, { t: at + 0.5, v: 1 }] },
              { prop: 'y', kf: [{ t: at + 0.15, v: up ? 20 : -20 }, { t: at + 0.55, v: 0, ease: 'outBack' }] },
            ],
          },
          {
            id: `ev${i}`, kind: 'text', text: label, class: 'kp-shadow',
            style: { fontSize: '27px', color: 'rgba(240,246,255,.85)', fontWeight: '600' },
            at: { x: `${xs[i]}%`, y: up ? '34%' : '76%', anchor: 'center' }, z: 4, in: at + 0.3,
            tracks: [{ prop: 'opacity', kf: [{ t: at + 0.3, v: 0 }, { t: at + 0.65, v: 1 }] }],
          },
        ];
      }),
    ];
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers,
      camera: { tracks: [{ prop: 'x', kf: [{ t: 1, v: 60 }, { t: 1.4 + n * 0.7, v: -60, ease: 'inOutQuad' }] }, { prop: 'scale', kf: [{ t: 0, v: 1.06 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
    };
  },
};

// ── 12. 占比对比条（份额此消彼长） ───────────────────────────────────────────
const shareShift: PresetDef = {
  id: 'demo.shareshift',
  label: '演示·份额消长',
  group: '概念演示',
  paramsDoc: '{ title?: string, a?: string(甲方名), b?: string(乙方名), aPct?: number(甲最终占比0-100) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const t = str(params.title, '格局正在反转');
    const a = str(params.a, '传统方式');
    const b = str(params.b, 'AI 方式');
    const aPct = Math.max(5, Math.min(95, num(params.aPct, 28)));
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        title(t),
        // 双色条：scaleX 反向变化（transform-origin 由内层控制）
        {
          id: 'bar-a', kind: 'html', z: 3,
          html: `<div style="width:1200px;height:120px;border-radius:20px 0 0 20px;background:linear-gradient(180deg,#6b7280,#4b5563);transform-origin:left center"></div>`,
          at: { x: '50%', y: '50%', anchor: 'right' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.6, v: 0 }, { t: 1.0, v: 1 }] },
            { prop: 'scaleX', kf: [{ t: 1.4, v: 1 }, { t: 4.2, v: aPct / 50, ease: 'inOutCubic' }] },
          ],
        },
        {
          id: 'bar-b', kind: 'html', z: 3,
          html: `<div style="width:1200px;height:120px;border-radius:0 20px 20px 0;background:linear-gradient(180deg,#3fd8c2,#18a888);transform-origin:right center;box-shadow:0 0 44px rgba(63,216,194,.35)"></div>`,
          at: { x: '50%', y: '50%', anchor: 'left' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.8, v: 0 }, { t: 1.2, v: 1 }] },
            { prop: 'scaleX', kf: [{ t: 1.4, v: 1 }, { t: 4.2, v: (100 - aPct) / 50, ease: 'inOutCubic' }] },
          ],
        },
        // 两侧标签 + 百分比滚动
        caption('label-a', a, 20, 34, 1.2, 30),
        caption('label-b', b, 80, 34, 1.4, 30),
        {
          id: 'pct-a', kind: 'text', text: '50%', class: 'kp-num kp-shadow',
          style: { fontSize: '56px', color: '#9ca3af', fontWeight: '800' },
          at: { x: '20%', y: '66%', anchor: 'center' }, z: 4, in: 1.4,
          effects: [{ type: 'numberRoll', at: 1.6, dur: 2.6, from: 50, to: aPct, format: 'percent', ease: 'inOutCubic' }],
        },
        {
          id: 'pct-b', kind: 'text', text: '50%', class: 'kp-num kp-shadow',
          style: { fontSize: '72px', color: '#3fd8c2', fontWeight: '800' },
          at: { x: '80%', y: '66%', anchor: 'center' }, z: 4, in: 1.4,
          tracks: [{ prop: 'scale', kf: [{ t: 4.0, v: 1 }, { t: 4.5, v: 1.18, spring: { stiffness: 170, damping: 12 } }] }],
          effects: [{ type: 'numberRoll', at: 1.6, dur: 2.6, from: 50, to: 100 - aPct, format: 'percent', ease: 'inOutCubic' }],
        },
      ],
    };
  },
};

// ── 13. 爆炸分解（整体拆成组件再复位） ───────────────────────────────────────
const explode: PresetDef = {
  id: 'demo.explode',
  label: '演示·拆解结构',
  group: '概念演示',
  paramsDoc: '{ title?: string, core?: string(整体名), parts?: string[](3-4个组成) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '拆开看看里面有什么');
    const core = str(params.core, '爆款视频');
    const parts = list(params.parts, ['选题', '脚本', '节奏', '包装']).slice(0, 4);
    const n = parts.length;
    const cx = 50, cy = 52;
    // 拆解目标位（四角/三角分布）
    const dest = parts.map((_, i) => {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / n) + Math.PI / n;
      return { x: cx + Math.cos(a) * 26, y: cy + Math.sin(a) * 28 };
    });
    const colors = ['#5c8aff', '#3fd8c2', '#ffc94d', '#ff8a5c'];
    const layers: SceneLayer[] = [
      title(t),
      // 整体节点（2.2s 时"炸开"缩小退场感）
      {
        ...node({ id: 'core', x: cx, y: cy, size: 190, color: '#e8e8ec', glow: 'rgba(255,255,255,.5)', label: core, labelSize: 38, at: 0.5, ring: true }),
        out: 2.6,
      },
      {
        id: 'boom', kind: 'svg', z: 2,
        svg: `<svg width="420" height="420" viewBox="0 0 420 420" fill="none"><circle cx="210" cy="210" r="200" stroke="rgba(255,255,255,.8)" stroke-width="3"/></svg>`,
        at: { x: `${cx}%`, y: `${cy}%`, anchor: 'center' }, in: 2.2,
        tracks: [
          { prop: 'scale', kf: [{ t: 2.2, v: 0.4 }, { t: 3.0, v: 1.3, ease: 'outCubic' }] },
          { prop: 'opacity', kf: [{ t: 2.2, v: 0.9 }, { t: 3.0, v: 0 }] },
        ],
      },
      // 组件从中心飞散到各自位置（pathMove 相对位移）
      ...parts.map((p, i): SceneLayer => {
        const d = { x: (dest[i].x - cx) / 100 * 1920, y: (dest[i].y - cy) / 100 * 1080 };
        return {
          id: `part${i}`, kind: 'html', z: 3, in: 2.3,
          html: `<div style="min-width:150px;height:88px;padding:0 28px;border-radius:16px;background:color-mix(in srgb,${colors[i]} 18%,transparent);border:2.5px solid ${colors[i]};display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:${colors[i]}">${p}</div>`,
          at: { x: `${cx}%`, y: `${cy}%`, anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 2.3, v: 0 }, { t: 2.5, v: 1 }] },
            { prop: 'scale', kf: [{ t: 2.3, v: 0.4 }, { t: 3.2, v: 1, spring: { stiffness: 150, damping: 12 } }] },
          ],
          effects: [
            { type: 'pathMove', at: 2.3, dur: 0.9, via: { x: d.x * 0.5, y: d.y * 0.5 - 40 }, to: d, ease: 'outExpo' },
            { type: 'breathe', at: 3.6, period: 3 + i * 0.3, amount: 0.02 },
          ],
        };
      }),
      // 拆解连线（虚线把组件连回中心记忆点）
      wire('links', dest.map((p2) => ({ d: line(cx, cy, p2.x, p2.y), color: 'rgba(255,255,255,.16)', width: 1.6, dash: '2 8' })), 3.4, { stagger: 0.1, dur: 0.5, z: 1 }),
      caption('concl', `${core} = ${parts.join(' + ')}`, 50, 92, 4.6, 28),
    ];
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers };
  },
};

// ── 14. 门槛跨越（before 卡住 → 钥匙出现 → 通过） ────────────────────────────
const unlock: PresetDef = {
  id: 'demo.unlock',
  label: '演示·破局钥匙',
  group: '概念演示',
  paramsDoc: '{ title?: string, blocker?: string(障碍名), key?: string(解法名) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '卡住你的其实是这个');
    const blocker = str(params.blocker, '没有方法论');
    const key = str(params.key, '一套 SOP');
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        title(t),
        // 行进小球：往右走 → 被墙挡住（shake）→ 墙开门 → 通过
        {
          id: 'walker', kind: 'html', z: 4,
          html: `<div style="width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 36% 30%,#8fb5ff,#5c8aff);box-shadow:0 0 26px rgba(92,138,255,.7)"></div>`,
          at: { x: '14%', y: '56%', anchor: 'center' },
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.4, v: 0 }, { t: 0.8, v: 1 }] },
            { prop: 'x', kf: [{ t: 0.8, v: 0 }, { t: 2.2, v: 520, ease: 'inOutQuad' }, { t: 4.8, v: 520 }, { t: 6.0, v: 1180, ease: 'inQuad' }] },
          ],
          effects: [
            { type: 'shake', at: 2.2, dur: 0.4, amp: 10, seed: 3 },
            { type: 'trail', copies: 3, lag: 0.05, fade: 0.5 },
          ],
        },
        // 墙：blocker 文字块，4.6s 时 maskReveal out 打开
        {
          id: 'wall', kind: 'html', z: 3,
          html: `<div style="width:36px;height:400px;border-radius:8px;background:linear-gradient(180deg,#6b7280,#374151);box-shadow:0 0 30px rgba(0,0,0,.5)"></div>`,
          at: { x: '52%', y: '56%', anchor: 'center' },
          tracks: [{ prop: 'opacity', kf: [{ t: 0.5, v: 0 }, { t: 0.9, v: 1 }] }],
          effects: [{ type: 'maskReveal', at: 4.6, dur: 0.7, dir: 'bottom', out: true, ease: 'inOutExpo' }],
        },
        caption('blocker-label', blocker, 52, 30, 2.5, 30),
        // 钥匙（解法）：3.4s 从上方降临到墙上
        {
          id: 'key', kind: 'html', z: 5, in: 3.4,
          html: `<div style="padding:14px 34px;border-radius:999px;background:linear-gradient(135deg,#ffc94d,#ff9e3d);color:#1a1408;font-size:34px;font-weight:900;box-shadow:0 0 44px rgba(255,201,77,.6)">${key}</div>`,
          at: { x: '52%', y: '56%', anchor: 'center' },
          tracks: [
            { prop: 'y', kf: [{ t: 3.4, v: -320 }, { t: 4.2, v: 0, ease: 'outBack' }] },
            { prop: 'opacity', kf: [{ t: 3.4, v: 0 }, { t: 3.7, v: 1 }, { t: 5.2, v: 1 }, { t: 5.6, v: 0 }] },
          ],
        },
        {
          id: 'flashring', kind: 'svg', z: 2,
          svg: `<svg width="300" height="300" viewBox="0 0 300 300" fill="none"><circle cx="150" cy="150" r="140" stroke="#ffc94d" stroke-width="3"/></svg>`,
          at: { x: '52%', y: '56%', anchor: 'center' }, in: 4.4,
          tracks: [
            { prop: 'scale', kf: [{ t: 4.4, v: 0.4 }, { t: 5.1, v: 1.3, ease: 'outCubic' }] },
            { prop: 'opacity', kf: [{ t: 4.4, v: 0.9 }, { t: 5.1, v: 0 }] },
          ],
        },
        caption('concl', '不是不够努力，是缺一把钥匙', 50, 88, 5.6, 28),
      ],
      flashes: [{ at: 4.5, dur: 0.25, color: '#ffc94d', peak: 0.3 }],
    };
  },
};

// ── 15. 复利叠加（小方块指数级堆积） ─────────────────────────────────────────
const compound: PresetDef = {
  id: 'demo.compound',
  label: '演示·复利叠加',
  group: '概念演示',
  paramsDoc: '{ title?: string, unit?: string(单位说明如"每天 1%"), conclusion?: string }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '复利到底有多可怕');
    const unit = str(params.unit, '每天进步一点点');
    const concl = str(params.conclusion, '1.01³⁶⁵ = 37.8');
    // 5 组柱：1,2,4,8,16 —— 每组一个 html 层（内部预排好格子），整柱 scaleY 从底部长出，
    // 顶部格子再单独弹一下（保持"逐块叠加"的感知但只用 2 层/组，控制图层预算）
    const groups = [1, 2, 4, 8, 16];
    const layers: SceneLayer[] = [title(t), caption('unit', unit, 50, 24, 0.8, 26)];
    groups.forEach((count, gi) => {
      const gx = 22 + gi * 14;
      const at = 1.2 + gi * 0.85;
      const stackHtml = Array.from({ length: count }).map(() =>
        `<div style="width:74px;height:26px;border-radius:6px;background:linear-gradient(90deg,#3fd8c2,#18a888);box-shadow:0 0 14px rgba(63,216,194,.4);margin-top:7px"></div>`,
      ).join('');
      layers.push({
        id: `col${gi}`, kind: 'html', z: 3,
        html: `<div style="display:flex;flex-direction:column-reverse">${stackHtml}</div>`,
        at: { x: `${gx}%`, y: '77%', anchor: 'bottom' },
        tracks: [
          { prop: 'scaleY', kf: [{ t: at, v: 0 }, { t: at + 0.6, v: 1, ease: 'outQuart' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.2, v: 1 }] },
        ],
        effects: [{ type: 'breathe', at: at + 0.9, period: 3 + gi * 0.3, amount: 0.012 }],
      });
      layers.push({
        id: `xlabel-${gi}`, kind: 'text', text: `${count}×`, class: 'kp-num kp-shadow',
        style: { fontSize: '30px', color: 'rgba(240,246,255,.7)', fontWeight: '700' },
        at: { x: `${gx}%`, y: '84%', anchor: 'center' }, z: 4, in: at,
        tracks: [{ prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.3, v: 1 }] }],
      });
    });
    layers.push({
      id: 'concl', kind: 'text', text: concl, class: 'kp-h2 kp-shadow',
      style: { color: '#ffc94d', fontWeight: '800' },
      at: { x: '50%', y: '38%', anchor: 'center' }, z: 5, in: 5.4,
      tracks: [{ prop: 'scale', kf: [{ t: 5.4, v: 0.7 }, { t: 6.0, v: 1, spring: { stiffness: 170, damping: 12 } }] }, { prop: 'opacity', kf: [{ t: 5.4, v: 0 }, { t: 5.7, v: 1 }] }],
      effects: [{ type: 'breathe', at: 6.1, period: 3, amount: 0.02, glowColor: 'rgba(255,201,77,.4)', glowRadius: 24 }],
    });
    return { v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers, flashes: [{ at: 5.4, dur: 0.22, color: '#ffc94d', peak: 0.25 }] };
  },
};

export const DEMO_CONCEPT_PRESETS: PresetDef[] = [
  orchestra, pipeline, network, growth, funnel, tradeoff, flywheel,
  stack, fanout, converge, milestones, shareShift, explode, unlock, compound,
];
