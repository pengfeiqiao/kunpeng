/**
 * presets/demoMedia — 概念演示库 B：媒介模拟与展示（15 个）。
 *
 * 把口播里"提到的东西"直接演出来：聊天记录逐条弹出、网页文章高亮划线、
 * 名人语录卡、手机通知轰炸、搜索联想、弹幕刷屏、评分卡、代码打字、
 * 倒计时、榜单揭晓……观众看到的是那个"场景"，不是文字转述。
 */
import type { SceneLayer, SceneSpec } from '../spec';
import type { PresetDef } from './mg';

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function list(v: unknown, fb: string[]): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(/[；;\n|]/).map((x) => x.trim()).filter(Boolean);
  return fb;
}

function num(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* eslint-disable max-len */

const DARKBG = 'radial-gradient(ellipse 110% 90% at 50% 20%,#101624 0%,#090c14 70%)';
const PAPERBG = 'linear-gradient(170deg,#f7f5f0 0%,#efece4 100%)';

// ── 1. 聊天对话模拟（微信式气泡逐条弹出） ─────────────────────────────────────
const chatSim: PresetDef = {
  id: 'demo.chat',
  label: '演示·聊天模拟',
  group: '媒介演示',
  paramsDoc: '{ title?: string(顶栏名字), messages: string[]("L:文本"对方/"R:文本"自己，按顺序3-6条) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const name = str(params.title, '甲方爸爸');
    const msgs = list(params.messages, ['L:这个能不能明天上线？', 'R:内容还没定稿…', 'L:内容你看着写就行', 'R:？？？']).slice(0, 6);
    const layers: SceneLayer[] = [
      // 手机壳框架
      {
        id: 'phone', kind: 'html', z: 1,
        html: `<div style="width:640px;height:920px;border-radius:44px;background:#ededed;box-shadow:0 40px 120px rgba(0,0,0,.55),inset 0 0 0 10px #1a1a1e;overflow:hidden"><div style="height:96px;background:#f7f7f7;border-bottom:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:600;color:#111;padding-top:14px">${esc(name)}</div></div>`,
        at: { x: '50%', y: '52%', anchor: 'center' },
        tracks: [
          { prop: 'y', kf: [{ t: 0.2, v: 120 }, { t: 0.9, v: 0, ease: 'outQuart' }] },
          { prop: 'opacity', kf: [{ t: 0.2, v: 0 }, { t: 0.7, v: 1 }] },
        ],
      },
      // 气泡逐条弹出
      ...msgs.map((raw, i): SceneLayer => {
        const isRight = raw.startsWith('R:') || raw.startsWith('r:');
        const text = raw.replace(/^[LRlr]:/, '').trim();
        const at = 1.4 + i * 1.0;
        const bubbleColor = isRight ? '#95ec69' : '#ffffff';
        return {
          id: `msg${i}`, kind: 'html', z: 3, in: at,
          html: `<div style="max-width:420px;padding:18px 24px;border-radius:16px;background:${bubbleColor};color:#111;font-size:28px;line-height:1.45;box-shadow:0 3px 10px rgba(0,0,0,.12);${isRight ? 'border-top-right-radius:4px' : 'border-top-left-radius:4px'}">${esc(text)}</div>`,
          at: { x: isRight ? '63.5%' : '36.5%', y: `${25 + i * 11}%`, anchor: isRight ? 'top-right' : 'top-left' },
          tracks: [
            { prop: 'scale', kf: [{ t: at, v: 0.6 }, { t: at + 0.4, v: 1, spring: { stiffness: 240, damping: 14 } }] },
            { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.2, v: 1 }] },
            { prop: 'x', kf: [{ t: at, v: isRight ? 30 : -30 }, { t: at + 0.4, v: 0, ease: 'outCubic' }] },
          ],
        };
      }),
    ];
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers,
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.02 }, { t: duration, v: 1.08, ease: 'inOutQuad' }] }] },
    };
  },
};

// ── 2. 网页文章高亮（浏览器窗口 + 荧光笔划重点） ──────────────────────────────
const webHighlight: PresetDef = {
  id: 'demo.webhighlight',
  label: '演示·网页划重点',
  group: '媒介演示',
  paramsDoc: '{ url?: string(地址栏), headline: string(文章标题), body?: string(正文一段≤60字), highlight: string(要划亮的短语,必须是 body 的子串) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const url = str(params.url, 'example.com/article');
    const headline = str(params.headline, '研究表明：短视频正在重塑注意力');
    const body = str(params.body, '实验显示，连续观看短视频 30 分钟后，受试者的持续专注时长平均下降了 41%，而恢复到基线水平需要 24 小时以上。');
    const highlight = str(params.highlight, '平均下降了 41%');
    const parts = body.split(highlight);
    const bodyHtml = parts.length > 1
      ? `${esc(parts[0])}<mark style="background:linear-gradient(transparent 42%,#ffe066 42%);padding:0 2px">${esc(highlight)}</mark>${esc(parts.slice(1).join(highlight))}`
      : esc(body);
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        // 浏览器窗口
        {
          id: 'browser', kind: 'html', z: 2,
          html: `<div style="width:1280px;height:780px;border-radius:20px;background:#ffffff;box-shadow:0 44px 130px rgba(0,0,0,.6);overflow:hidden">
<div style="height:76px;background:#f1f3f4;display:flex;align-items:center;gap:14px;padding:0 28px;border-bottom:1px solid #e0e0e0">
<span style="width:16px;height:16px;border-radius:50%;background:#ff5f57"></span><span style="width:16px;height:16px;border-radius:50%;background:#febc2e"></span><span style="width:16px;height:16px;border-radius:50%;background:#28c840"></span>
<div style="flex:1;height:44px;margin-left:16px;border-radius:22px;background:#fff;border:1px solid #dcdcdc;display:flex;align-items:center;padding:0 22px;font-size:20px;color:#5f6368">🔒 ${esc(url)}</div>
</div>
<div style="padding:52px 84px">
<div style="font-size:44px;font-weight:800;color:#1a1a1a;line-height:1.25;margin-bottom:34px">${esc(headline)}</div>
<div style="width:180px;height:14px;border-radius:7px;background:#e8e8e8;margin-bottom:38px"></div>
<div id="kp-web-body" style="font-size:30px;line-height:1.9;color:#333">${bodyHtml}</div>
<div style="margin-top:36px"><div style="height:14px;border-radius:7px;background:#efefef;margin-bottom:16px"></div><div style="height:14px;width:82%;border-radius:7px;background:#efefef"></div></div>
</div></div>`,
          at: { x: '50%', y: '52%', anchor: 'center' },
          tracks: [
            { prop: 'y', kf: [{ t: 0.2, v: 90 }, { t: 1.0, v: 0, ease: 'outQuart' }] },
            { prop: 'opacity', kf: [{ t: 0.2, v: 0 }, { t: 0.8, v: 1 }] },
            { prop: 'scale', kf: [{ t: 2.8, v: 1 }, { t: 4.0, v: 1.22, ease: 'inOutCubic' }] },
          ],
        },
        // 荧光笔划线动画：黄色条从左到右扫过高亮位置（maskReveal 模拟手划）
        {
          id: 'marker-stroke', kind: 'html', z: 3, in: 3.6,
          html: `<div style="width:430px;height:52px;background:rgba(255,224,102,.5);border-radius:8px;mix-blend-mode:multiply"></div>`,
          at: { x: '50%', y: '63%', anchor: 'center' },
          effects: [{ type: 'maskReveal', at: 3.6, dur: 0.8, dir: 'left', ease: 'inOutCubic' }],
          tracks: [{ prop: 'opacity', kf: [{ t: 3.6, v: 0.9 }] }],
        },
        // 圈注放大镜
        {
          id: 'zoom-note', kind: 'text', text: '↑ 关键在这', class: 'kp-shadow',
          style: { fontSize: '34px', fontWeight: '800', color: '#ffe066' },
          at: { x: '50%', y: '76%', anchor: 'center' }, z: 5, in: 4.6,
          tracks: [
            { prop: 'opacity', kf: [{ t: 4.6, v: 0 }, { t: 5.0, v: 1 }] },
            { prop: 'y', kf: [{ t: 4.6, v: 20 }, { t: 5.0, v: 0, ease: 'outBack' }] },
          ],
        },
      ],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.03 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
    };
  },
};

// ── 3. 名人语录卡（衬线引言 + 逐词显现 + 署名） ───────────────────────────────
const quoteCard: PresetDef = {
  id: 'demo.quote',
  label: '演示·名人语录',
  group: '媒介演示',
  paramsDoc: '{ quote: string(语录≤40字), author: string(署名), role?: string(头衔) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const quote = str(params.quote, '简单是终极的复杂。');
    const author = str(params.author, '达·芬奇');
    const role = str(params.role);
    return {
      v: 1, duration, bg: 'opaque', bgCss: PAPERBG, fonts: ['literary'],
      layers: [
        // 超大引号装饰
        {
          id: 'mark', kind: 'text', text: '“', class: 'kp-quote-mark',
          style: { color: '#b03a2e', opacity: '.9', fontSize: '300px' },
          at: { x: '16%', y: '24%', anchor: 'center' }, z: 2,
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 1.0, v: 0.22, ease: 'outCubic' }] },
            { prop: 'y', kf: [{ t: 0.3, v: -40 }, { t: 1.0, v: 0, ease: 'outQuart' }] },
          ],
        },
        // 语录：逐词浮现（word split 慢稳）
        {
          id: 'quote', kind: 'text', text: quote, class: 'kp-serif',
          style: { fontSize: '68px', fontWeight: '600', color: '#2b2620', lineHeight: '1.5', maxWidth: '1240px', textAlign: 'center' },
          at: { x: '50%', y: '46%', anchor: 'center' }, w: 1240, z: 3,
          effects: [{ type: 'kineticText', split: 'char', at: 0.8, stagger: 0.05, dur: 0.8, from: { y: 26, opacity: 0 }, ease: 'outQuart' }],
        },
        // 分隔线描线
        {
          id: 'rule', kind: 'svg', z: 2,
          svg: `<svg width="320" height="6" viewBox="0 0 320 6" fill="none"><line x1="3" y1="3" x2="317" y2="3" stroke="#b03a2e" stroke-width="3" stroke-linecap="round"/></svg>`,
          at: { x: '50%', y: '66%', anchor: 'center' },
          effects: [{ type: 'lineDraw', at: 3.2, dur: 0.7, ease: 'inOutExpo' }],
        },
        // 署名
        {
          id: 'author', kind: 'text', text: `—— ${author}${role ? ' · ' + role : ''}`, class: 'kp-serif',
          style: { fontSize: '34px', color: '#8a6f4d', letterSpacing: '.12em' },
          at: { x: '50%', y: '74%', anchor: 'center' }, z: 3, in: 3.8,
          tracks: [
            { prop: 'opacity', kf: [{ t: 3.8, v: 0 }, { t: 4.5, v: 1, ease: 'outCubic' }] },
            { prop: 'x', kf: [{ t: 3.8, v: -30 }, { t: 4.5, v: 0, ease: 'outQuart' }] },
          ],
        },
      ],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.05 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
    };
  },
};

// ── 4. 手机通知轰炸（推送横幅一条条砸下来） ───────────────────────────────────
const notifyStorm: PresetDef = {
  id: 'demo.notify',
  label: '演示·通知轰炸',
  group: '媒介演示',
  paramsDoc: '{ title?: string, notifications: string[]("App名|内容"3-5条) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '你的注意力是这样被偷走的');
    const notes = list(params.notifications, ['短视频|你关注的主播开播啦！', '购物|限时秒杀最后 10 分钟', '社交|有人赞了你的照片', '游戏|体力已恢复，快来战斗']).slice(0, 5);
    const icons = ['📱', '🛒', '💬', '🎮', '📧'];
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        {
          id: 'title', kind: 'text', text: t, class: 'kp-h3 kp-shadow',
          at: { x: '50%', y: '12%', anchor: 'center' }, z: 6,
          effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
        },
        // 通知横幅逐条从顶部砸下（越来越快、错位堆叠）
        ...notes.map((raw, i): SceneLayer => {
          const [app, ...rest] = raw.split('|');
          const content = rest.join('|') || app;
          const at = 1.0 + i * 0.85 - i * i * 0.03;
          return {
            id: `note${i}`, kind: 'html', z: 3 + i, in: at,
            html: `<div style="width:760px;padding:22px 30px;border-radius:22px;background:rgba(250,250,252,.96);box-shadow:0 18px 50px rgba(0,0,0,.45);display:flex;gap:20px;align-items:center"><div style="width:64px;height:64px;border-radius:16px;background:linear-gradient(145deg,#5c8aff,#3a5fd8);display:flex;align-items:center;justify-content:center;font-size:34px">${icons[i % icons.length]}</div><div><div style="font-size:22px;font-weight:700;color:#666;letter-spacing:.04em">${esc(app)} · 现在</div><div style="font-size:28px;font-weight:600;color:#111;margin-top:2px">${esc(content)}</div></div></div>`,
            at: { x: `${48 + (i % 2 === 0 ? -2 : 3)}%`, y: `${26 + i * 12}%`, anchor: 'center' },
            tracks: [
              { prop: 'y', kf: [{ t: at, v: -160 }, { t: at + 0.5, v: 0, spring: { stiffness: 210, damping: 15 } }] },
              { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.2, v: 1 }] },
              { prop: 'rotate', kf: [{ t: at, v: 0 }, { t: at + 0.5, v: i % 2 === 0 ? -1.6 : 2 }] },
            ],
            effects: i === notes.length - 1 ? [{ type: 'shake', at: at + 0.5, dur: 0.3, amp: 6, seed: 5 }] : undefined,
          };
        }),
        // 结论
        {
          id: 'concl', kind: 'text', text: '平均每 4 分钟，一次打断', class: 'kp-shadow',
          style: { fontSize: '34px', fontWeight: '800', color: '#ff8a5c' },
          at: { x: '50%', y: '90%', anchor: 'center' }, z: 8, in: 5.2,
          tracks: [{ prop: 'opacity', kf: [{ t: 5.2, v: 0 }, { t: 5.6, v: 1 }] }, { prop: 'scale', kf: [{ t: 5.2, v: 0.85 }, { t: 5.7, v: 1, spring: { stiffness: 180, damping: 13 } }] }],
        },
      ],
      flashes: [{ at: 5.2, dur: 0.2, color: '#ff8a5c', peak: 0.2 }],
    };
  },
};

// ── 5. 搜索联想（搜索框打字 + 联想下拉逐条出现） ─────────────────────────────
const searchSuggest: PresetDef = {
  id: 'demo.search',
  label: '演示·搜索联想',
  group: '媒介演示',
  paramsDoc: '{ query: string(搜索词), suggestions: string[](3-5条联想) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const query = str(params.query, '为什么总是存不下钱');
    const sugg = list(params.suggestions, ['为什么总是存不下钱 知乎', '为什么总是存不下钱 心理学', '月薪2万为什么存不下钱', '存不下钱怎么办']).slice(0, 5);
    const typeDur = query.length * 0.09;
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        // 搜索框
        {
          id: 'box', kind: 'html', z: 3,
          html: `<div style="width:1000px;height:96px;border-radius:48px;background:#fff;box-shadow:0 24px 80px rgba(0,0,0,.5);display:flex;align-items:center;padding:0 40px;gap:22px"><span style="font-size:38px">🔍</span></div>`,
          at: { x: '50%', y: '30%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 0.3, v: 0.9 }, { t: 0.9, v: 1, spring: { stiffness: 170, damping: 14 } }] },
            { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 0.7, v: 1 }] },
          ],
        },
        // 打字层（覆盖在框内）
        {
          id: 'query', kind: 'text', text: query,
          style: { fontSize: '36px', fontWeight: '600', color: '#111' },
          at: { x: '39%', y: '30%', anchor: 'left' }, z: 4, in: 1.0,
          effects: [{ type: 'typewriter', at: 1.0, charDur: 0.09, cursorColor: '#4285f4' }],
        },
        // 联想下拉
        ...sugg.map((s, i): SceneLayer => {
          const at = 1.2 + typeDur + i * 0.22;
          return {
            id: `sug${i}`, kind: 'html', z: 3, in: at,
            html: `<div style="width:1000px;padding:22px 44px;background:${i === sugg.length - 1 ? '#eef4ff' : '#fff'};display:flex;gap:20px;align-items:center;font-size:29px;color:#333;border-top:1px solid #f0f0f0;${i === sugg.length - 1 ? 'border-radius:0 0 24px 24px;font-weight:700;color:#1a56db' : ''}"><span style="opacity:.4;font-size:24px">🔍</span>${esc(s)}</div>`,
            at: { x: '50%', y: `${39.5 + i * 7.4}%`, anchor: 'top' },
            tracks: [
              { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.25, v: 1 }] },
              { prop: 'y', kf: [{ t: at, v: -14 }, { t: at + 0.3, v: 0, ease: 'outCubic' }] },
            ],
          };
        }),
        // 结论标注
        {
          id: 'note', kind: 'text', text: '几百万人在搜同一个问题', class: 'kp-shadow',
          style: { fontSize: '32px', fontWeight: '800', color: '#3fd8c2' },
          at: { x: '50%', y: '88%', anchor: 'center' }, z: 5, in: 2.4 + typeDur + sugg.length * 0.22,
          tracks: [{ prop: 'opacity', kf: [{ t: 2.4 + typeDur + sugg.length * 0.22, v: 0 }, { t: 2.9 + typeDur + sugg.length * 0.22, v: 1 }] }],
        },
      ],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
    };
  },
};

// ── 6. 弹幕刷屏（多行弹幕横飞 + 主文案定格） ─────────────────────────────────
const danmaku: PresetDef = {
  id: 'demo.danmaku',
  label: '演示·弹幕刷屏',
  group: '媒介演示',
  paramsDoc: '{ title: string(定格主文案), danmaku?: string[](5-8条弹幕) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '全网都在问这个问题');
    const dm = list(params.danmaku, ['真的假的？', '学到了学到了', '这也行？？', '码住慢慢看', '前排！', '哈哈哈哈哈哈', '太真实了', '已转发']).slice(0, 8);
    const colors = ['rgba(255,255,255,.9)', 'rgba(122,207,255,.9)', 'rgba(255,224,102,.9)', 'rgba(255,140,160,.9)'];
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        // 弹幕层：各行不同速度横穿（x 轨道从右到左；末帧钳在场景时长内）
        ...dm.map((text, i): SceneLayer => {
          const row = i % 4;
          const startT = 0.2 + i * 0.5;
          const endT = Math.min(duration, startT + 5 + (i % 3));
          const dist = 2400 * ((endT - startT) / (5 + (i % 3)));
          return {
            id: `dm${i}`, kind: 'text', text,
            style: { fontSize: `${30 + (i % 3) * 6}px`, fontWeight: '700', color: colors[i % colors.length], textShadow: '0 2px 6px rgba(0,0,0,.7)', whiteSpace: 'nowrap' },
            at: { x: '105%', y: `${14 + row * 12}%`, anchor: 'left' }, z: 2, in: startT,
            tracks: [{ prop: 'x', kf: [{ t: startT, v: 0 }, { t: endT, v: -dist }] }],
          };
        }),
        // 半透明压暗层（3s 起,让主文案浮出）
        {
          id: 'dim', kind: 'shape', z: 3,
          html: `<div style="width:1920px;height:1080px;background:rgba(6,8,14,.55)"></div>`,
          at: { x: '50%', y: '50%', anchor: 'center' }, in: 3.0,
          tracks: [{ prop: 'opacity', kf: [{ t: 3.0, v: 0 }, { t: 3.7, v: 1, ease: 'outCubic' }] }],
        },
        // 主文案冲入定格
        {
          id: 'title', kind: 'text', text: t, class: 'kp-h1 kp-shadow',
          style: { fontWeight: '900' },
          at: { x: '50%', y: '48%', anchor: 'center' }, z: 5,
          tracks: [{ prop: 'scale', kf: [{ t: 3.4, v: 2.1 }, { t: 3.75, v: 1, ease: 'inExpo' }] }, { prop: 'opacity', kf: [{ t: 3.4, v: 0 }, { t: 3.6, v: 1 }] }],
          effects: [
            { type: 'shake', at: 3.75, dur: 0.3, amp: 10, seed: 4 },
            { type: 'waveText', at: 4.6, amp: 5, period: 3, phaseStep: 0.1 },
          ],
        },
      ],
      flashes: [{ at: 3.75, dur: 0.22, color: '#ffffff', peak: 0.5 }],
    };
  },
};

// ── 7. 评分卡揭晓（星星逐颗点亮 + 分数滚动） ─────────────────────────────────
const scoreCard: PresetDef = {
  id: 'demo.score',
  label: '演示·评分揭晓',
  group: '媒介演示',
  paramsDoc: '{ subject: string(被评对象), score?: number(0-10,默认9.2), verdict?: string(一句话评语) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const subject = str(params.subject, '这款新工具');
    const score = Math.max(0, Math.min(10, num(params.score, 9.2)));
    const verdict = str(params.verdict, '值得马上上手');
    const fullStars = Math.round(score / 2);
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        {
          id: 'subject', kind: 'text', text: subject, class: 'kp-h3 kp-shadow',
          at: { x: '50%', y: '20%', anchor: 'center' }, z: 4,
          effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.045, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
        },
        // 大分数滚动
        {
          id: 'score', kind: 'text', text: '0', class: 'kp-mega kp-shadow',
          style: { fontSize: '240px', color: '#ffc94d', fontWeight: '900' },
          at: { x: '50%', y: '47%', anchor: 'center' }, z: 4, in: 0.8,
          tracks: [{ prop: 'scale', kf: [{ t: 2.6, v: 1 }, { t: 3.1, v: 1.12, spring: { stiffness: 180, damping: 11 } }] }],
          effects: [
            { type: 'numberRoll', at: 0.8, dur: 2.0, to: score, decimals: 1, ease: 'outExpo' },
            { type: 'breathe', at: 3.2, period: 3, amount: 0.015, glowColor: 'rgba(255,201,77,.5)', glowRadius: 40 },
          ],
        },
        // 五颗星逐颗点亮
        ...Array.from({ length: 5 }).map((_, i): SceneLayer => ({
          id: `star${i}`, kind: 'text', text: '★',
          style: { fontSize: '64px', color: i < fullStars ? '#ffc94d' : 'rgba(255,255,255,.18)', textShadow: i < fullStars ? '0 0 24px rgba(255,201,77,.7)' : 'none' },
          at: { x: `${38 + i * 6}%`, y: '68%', anchor: 'center' }, z: 4, in: 2.2 + i * 0.18,
          tracks: [
            { prop: 'scale', kf: [{ t: 2.2 + i * 0.18, v: 0 }, { t: 2.6 + i * 0.18, v: 1, spring: { stiffness: 260, damping: 12 } }] },
            { prop: 'rotate', kf: [{ t: 2.2 + i * 0.18, v: -30 }, { t: 2.6 + i * 0.18, v: 0, ease: 'outBack' }] },
          ],
        })),
        // 评语
        {
          id: 'verdict', kind: 'text', text: verdict, class: 'kp-sub kp-shadow',
          style: { color: 'rgba(240,246,255,.85)' },
          at: { x: '50%', y: '80%', anchor: 'center' }, z: 4, in: 3.6,
          effects: [{ type: 'maskReveal', at: 3.6, dur: 0.55, dir: 'left', ease: 'outExpo' }],
        },
      ],
      flashes: [{ at: 2.8, dur: 0.22, color: '#ffc94d', peak: 0.3 }],
    };
  },
};

// ── 8. 代码敲击（编辑器窗口逐行打字 + 运行成功） ─────────────────────────────
const codeType: PresetDef = {
  id: 'demo.code',
  label: '演示·代码敲击',
  group: '媒介演示',
  paramsDoc: '{ lines: string[](2-4行代码), output?: string(运行结果一行) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const lines = list(params.lines, ["const agent = new Agent('writer')", "await agent.run('写一条爆款文案')"]).slice(0, 4);
    const output = str(params.output, '✓ 完成 · 用时 3.2s');
    let cursor = 1.0;
    const lineLayers: SceneLayer[] = lines.map((code, i) => {
      const at = cursor;
      cursor += code.length * 0.045 + 0.35;
      return {
        id: `line${i}`, kind: 'text', text: code,
        style: { fontFamily: "'JetBrains Mono',monospace", fontSize: '30px', color: '#d8e3f0', whiteSpace: 'pre' },
        at: { x: '22%', y: `${37 + i * 7.5}%`, anchor: 'left' }, z: 3, in: at,
        effects: [{ type: 'typewriter', at, charDur: 0.045, cursorColor: '#3fd8c2' }],
      };
    });
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['tech'],
      layers: [
        // 编辑器窗口
        {
          id: 'editor', kind: 'html', z: 2,
          html: `<div style="width:1280px;height:640px;border-radius:20px;background:#12161f;border:1px solid rgba(255,255,255,.09);box-shadow:0 44px 130px rgba(0,0,0,.6);overflow:hidden"><div style="height:64px;background:#1a1f2c;display:flex;align-items:center;gap:12px;padding:0 26px"><span style="width:15px;height:15px;border-radius:50%;background:#ff5f57"></span><span style="width:15px;height:15px;border-radius:50%;background:#febc2e"></span><span style="width:15px;height:15px;border-radius:50%;background:#28c840"></span><span style="margin-left:18px;font-family:'JetBrains Mono',monospace;font-size:19px;color:rgba(255,255,255,.45)">agent.ts</span></div></div>`,
          at: { x: '50%', y: '52%', anchor: 'center' },
          tracks: [
            { prop: 'scale', kf: [{ t: 0.2, v: 0.94 }, { t: 0.9, v: 1, ease: 'outQuart' }] },
            { prop: 'opacity', kf: [{ t: 0.2, v: 0 }, { t: 0.8, v: 1 }] },
          ],
        },
        // 行号
        ...lines.map((_, i): SceneLayer => ({
          id: `ln${i}`, kind: 'text', text: String(i + 1),
          style: { fontFamily: "'JetBrains Mono',monospace", fontSize: '26px', color: 'rgba(255,255,255,.25)' },
          at: { x: '19%', y: `${37 + i * 7.5}%`, anchor: 'center' }, z: 3, in: 0.9 + i * 0.1,
          tracks: [{ prop: 'opacity', kf: [{ t: 0.9 + i * 0.1, v: 0 }, { t: 1.2 + i * 0.1, v: 1 }] }],
        })),
        ...lineLayers,
        // 运行输出：绿色成功行 + 闪光
        {
          id: 'output', kind: 'text', text: output,
          style: { fontFamily: "'JetBrains Mono',monospace", fontSize: '30px', fontWeight: '700', color: '#3fd8c2', textShadow: '0 0 18px rgba(63,216,194,.6)' },
          at: { x: '22%', y: `${40 + lines.length * 7.5}%`, anchor: 'left' }, z: 3, in: cursor + 0.3,
          tracks: [
            { prop: 'opacity', kf: [{ t: cursor + 0.3, v: 0 }, { t: cursor + 0.5, v: 1 }] },
            { prop: 'x', kf: [{ t: cursor + 0.3, v: -20 }, { t: cursor + 0.6, v: 0, ease: 'outExpo' }] },
          ],
          effects: [{ type: 'breathe', at: cursor + 0.8, period: 2.6, amount: 0.01, glowColor: 'rgba(63,216,194,.4)', glowRadius: 14 }],
        },
      ],
      flashes: [{ at: cursor + 0.35, dur: 0.2, color: '#3fd8c2', peak: 0.18 }],
    };
  },
};

// ── 9. 倒计时紧迫（大数字砸下 + 最后归零爆发） ───────────────────────────────
const countdown: PresetDef = {
  id: 'demo.countdown',
  label: '演示·倒计时',
  group: '媒介演示',
  paramsDoc: '{ from?: number(默认3), message: string(归零后出现的主文案) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const from = Math.max(2, Math.min(5, Math.round(num(params.from, 3))));
    const message = str(params.message, '现在开始');
    const layers: SceneLayer[] = [];
    for (let i = 0; i < from; i++) {
      const numText = String(from - i);
      const at = 0.4 + i * 1.0;
      layers.push({
        id: `cd${i}`, kind: 'text', text: numText, class: 'kp-mega kp-shadow',
        style: { fontSize: '380px', fontWeight: '900', color: i === from - 1 ? '#ff5252' : '#e8e8ec' },
        at: { x: '50%', y: '48%', anchor: 'center' }, z: 3, in: at, out: at + 1.0,
        tracks: [
          { prop: 'scale', kf: [{ t: at, v: 2.4 }, { t: at + 0.28, v: 1, ease: 'inExpo' }, { t: at + 0.95, v: 0.92, ease: 'inQuad' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.15, v: 1 }, { t: at + 0.85, v: 1 }, { t: at + 1.0, v: 0 }] },
        ],
        effects: [{ type: 'shake', at: at + 0.28, dur: 0.22, amp: 8, seed: i + 1 }],
      });
    }
    const boomAt = 0.4 + from * 1.0;
    layers.push({
      id: 'msg', kind: 'text', text: message, class: 'kp-h1 kp-shadow',
      style: { fontWeight: '900' },
      at: { x: '50%', y: '48%', anchor: 'center' }, z: 4, in: boomAt,
      effects: [
        { type: 'kineticText', split: 'char', at: boomAt, stagger: 0.05, dur: 0.5, from: { y: 90, scale: 0.5, opacity: 0 }, spring: { stiffness: 220, damping: 12 } },
        { type: 'waveText', at: boomAt + 1.0, amp: 5, period: 3, phaseStep: 0.1 },
      ],
    });
    return {
      v: 1, duration, bg: 'opaque', bgCss: 'radial-gradient(ellipse 100% 100% at 50% 50%,#1a1010 0%,#0c0808 75%)', fonts: ['minimal'], layers,
      flashes: [{ at: boomAt, dur: 0.3, color: '#ff5252', peak: 0.55 }],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: boomAt - 0.1, v: 1 }, { t: boomAt + 0.35, v: 1.06, ease: 'outExpo' }, { t: duration, v: 1.02, ease: 'outQuad' }] }] },
    };
  },
};

// ── 10. 榜单揭晓（Top N 从末位到榜首依次滑入，第一名高亮） ────────────────────
const ranking: PresetDef = {
  id: 'demo.ranking',
  label: '演示·榜单揭晓',
  group: '媒介演示',
  paramsDoc: '{ title?: string, items: string[](3-5个,从第1名开始写), values?: string[](对应数值,可省) }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '本月增长最快的赛道');
    const items = list(params.items, ['AI 工具测评', '本地生活探店', '职场干货', '硬核科普']).slice(0, 5);
    const values = list(params.values, []);
    const n = items.length;
    const medal = ['🥇', '🥈', '🥉', '4', '5'];
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        {
          id: 'title', kind: 'text', text: t, class: 'kp-h3 kp-shadow',
          at: { x: '50%', y: '12%', anchor: 'center' }, z: 5,
          effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
        },
        // 从末位开始揭晓（倒序入场，第一名最后压轴）
        ...items.map((item, rank): SceneLayer => {
          const revealOrder = n - 1 - rank;
          const at = 1.0 + revealOrder * 0.9;
          const isFirst = rank === 0;
          const y = 24 + rank * 13.5;
          return {
            id: `rank${rank}`, kind: 'html', z: 3, in: at,
            html: `<div style="width:${isFirst ? 960 : 860}px;height:${isFirst ? 110 : 92}px;border-radius:20px;background:${isFirst ? 'linear-gradient(90deg,rgba(255,201,77,.25),rgba(255,201,77,.08))' : 'rgba(255,255,255,.06)'};border:2px solid ${isFirst ? '#ffc94d' : 'rgba(255,255,255,.14)'};display:flex;align-items:center;gap:28px;padding:0 40px;${isFirst ? 'box-shadow:0 0 44px rgba(255,201,77,.3)' : ''}"><span style="font-size:${isFirst ? 48 : 38}px;min-width:64px">${medal[rank] ?? rank + 1}</span><span style="font-size:${isFirst ? 40 : 32}px;font-weight:800;color:${isFirst ? '#ffc94d' : '#e8eef8'};flex:1">${esc(item)}</span>${values[rank] ? `<span style="font-size:${isFirst ? 36 : 28}px;font-weight:700;color:${isFirst ? '#ffc94d' : 'rgba(232,238,248,.6)'}">${esc(values[rank])}</span>` : ''}</div>`,
            at: { x: '50%', y: `${y}%`, anchor: 'center' },
            tracks: [
              { prop: 'x', kf: [{ t: at, v: revealOrder % 2 === 0 ? 480 : -480 }, { t: at + 0.55, v: 0, ease: 'outExpo' }] },
              { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.3, v: 1 }] },
            ],
            effects: isFirst ? [
              { type: 'shine', at: at + 0.8, dur: 1.2, every: 3, angle: 115, strength: 0.35 },
              { type: 'breathe', at: at + 0.8, period: 3, amount: 0.012 },
            ] : undefined,
          };
        }),
      ],
      flashes: [{ at: 1.0 + (n - 1) * 0.9 + 0.4, dur: 0.25, color: '#ffc94d', peak: 0.3 }],
    };
  },
};

// ── 11. 价格对比卡（两方案卡片对峙，推荐方胜出） ─────────────────────────────
const priceCards: PresetDef = {
  id: 'demo.pricecards',
  label: '演示·方案对比卡',
  group: '媒介演示',
  paramsDoc: '{ title?: string, left: string("方案名|价格|一句说明"), right: string(同左,推荐方) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '两种做法，差在哪');
    const [lName, lPrice, lDesc] = str(params.left, '自己摸索|时间成本 1 年|踩完所有的坑').split('|');
    const [rName, rPrice, rDesc] = str(params.right, '直接抄作业|3 天上手|别人的坑就是你的路').split('|');
    const card = (nm: string, pr: string, ds: string, win: boolean): string =>
      `<div style="width:520px;height:480px;border-radius:28px;background:${win ? 'linear-gradient(180deg,rgba(63,216,194,.16),rgba(63,216,194,.05))' : 'rgba(255,255,255,.05)'};border:2.5px solid ${win ? '#3fd8c2' : 'rgba(255,255,255,.15)'};padding:52px 44px;display:flex;flex-direction:column;gap:26px;${win ? 'box-shadow:0 0 60px rgba(63,216,194,.25)' : ''}">
<div style="font-size:38px;font-weight:800;color:${win ? '#3fd8c2' : 'rgba(232,238,248,.85)'}">${esc(nm ?? '')}</div>
<div style="font-size:56px;font-weight:900;color:${win ? '#fff' : 'rgba(232,238,248,.6)'}">${esc(pr ?? '')}</div>
<div style="font-size:28px;line-height:1.6;color:rgba(232,238,248,.6)">${esc(ds ?? '')}</div>
${win ? '<div style="margin-top:auto;align-self:flex-start;padding:12px 30px;border-radius:999px;background:#3fd8c2;color:#06251f;font-size:26px;font-weight:900">推荐 ✓</div>' : ''}</div>`;
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        {
          id: 'title', kind: 'text', text: t, class: 'kp-h3 kp-shadow',
          at: { x: '50%', y: '13%', anchor: 'center' }, z: 5,
          effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
        },
        // VS 徽标
        {
          id: 'vs', kind: 'text', text: 'VS',
          style: { fontSize: '76px', fontWeight: '900', fontStyle: 'italic', color: 'rgba(255,255,255,.3)' },
          at: { x: '50%', y: '52%', anchor: 'center' }, z: 4, in: 1.6,
          tracks: [{ prop: 'scale', kf: [{ t: 1.6, v: 0 }, { t: 2.0, v: 1, spring: { stiffness: 220, damping: 12 } }] }],
        },
        // 左右卡片滑入
        {
          id: 'card-l', kind: 'html', z: 3, html: card(lName, lPrice, lDesc, false),
          at: { x: '29%', y: '55%', anchor: 'center' },
          tracks: [
            { prop: 'x', kf: [{ t: 0.8, v: -420 }, { t: 1.5, v: 0, ease: 'outExpo' }] },
            { prop: 'opacity', kf: [{ t: 0.8, v: 0 }, { t: 1.3, v: 1 }] },
            { prop: 'scale', kf: [{ t: 3.8, v: 1 }, { t: 4.4, v: 0.94, ease: 'inOutQuad' }] },
          ],
        },
        {
          id: 'card-r', kind: 'html', z: 3, html: card(rName, rPrice, rDesc, true),
          at: { x: '71%', y: '55%', anchor: 'center' },
          tracks: [
            { prop: 'x', kf: [{ t: 1.0, v: 420 }, { t: 1.7, v: 0, ease: 'outExpo' }] },
            { prop: 'opacity', kf: [{ t: 1.0, v: 0 }, { t: 1.5, v: 1 }] },
            { prop: 'scale', kf: [{ t: 3.8, v: 1 }, { t: 4.4, v: 1.05, spring: { stiffness: 150, damping: 13 } }] },
          ],
          effects: [{ type: 'shine', at: 4.4, dur: 1.3, every: 3.4, angle: 115, strength: 0.3 }],
        },
      ],
      flashes: [{ at: 4.1, dur: 0.22, color: '#3fd8c2', peak: 0.22 }],
    };
  },
};

// ── 12. 提问卡（弹幕式提问定格 → 回答揭示） ──────────────────────────────────
const qaCard: PresetDef = {
  id: 'demo.qa',
  label: '演示·问答揭示',
  group: '媒介演示',
  paramsDoc: '{ question: string(问题), answer: string(核心答案≤14字), from?: string(提问者如"@粉丝提问") }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const q = str(params.question, '零基础多久能做出第一条视频？');
    const a = str(params.answer, '7 天，但方法要对');
    const from = str(params.from, '@粉丝提问');
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        // 提问气泡卡
        {
          id: 'q-card', kind: 'html', z: 3,
          html: `<div style="max-width:900px;padding:44px 56px;border-radius:28px;border-top-left-radius:6px;background:rgba(255,255,255,.07);border:1.5px solid rgba(255,255,255,.16)"><div style="font-size:22px;font-weight:700;color:#5c8aff;letter-spacing:.08em;margin-bottom:16px">${esc(from)}</div><div style="font-size:42px;font-weight:700;color:#eef3fb;line-height:1.5">${esc(q)}</div></div>`,
          at: { x: '50%', y: '32%', anchor: 'center' },
          tracks: [
            { prop: 'y', kf: [{ t: 0.4, v: 60 }, { t: 1.1, v: 0, ease: 'outQuart' }] },
            { prop: 'opacity', kf: [{ t: 0.4, v: 0 }, { t: 0.9, v: 1 }] },
          ],
        },
        // 思考点点点
        {
          id: 'dots', kind: 'text', text: '· · ·',
          style: { fontSize: '60px', fontWeight: '900', color: 'rgba(255,255,255,.5)', letterSpacing: '.2em' },
          at: { x: '50%', y: '56%', anchor: 'center' }, z: 3, in: 1.6, out: 3.2,
          tracks: [{ prop: 'opacity', kf: [{ t: 1.6, v: 0 }, { t: 2.0, v: 1 }, { t: 3.0, v: 1 }, { t: 3.2, v: 0 }] }],
          effects: [{ type: 'waveText', at: 1.8, amp: 10, period: 1.2, phaseStep: 0.25 }],
        },
        // 答案大字揭示
        {
          id: 'answer', kind: 'text', text: a, class: 'kp-h1 kp-shadow',
          style: { color: '#ffc94d', fontWeight: '900' },
          at: { x: '50%', y: '62%', anchor: 'center' }, z: 4,
          effects: [
            { type: 'kineticText', split: 'char', at: 3.4, stagger: 0.06, dur: 0.55, from: { y: 80, scale: 0.6, opacity: 0 }, spring: { stiffness: 200, damping: 12 } },
            { type: 'breathe', at: 4.8, period: 3.2, amount: 0.012, glowColor: 'rgba(255,201,77,.4)', glowRadius: 28 },
          ],
        },
        // 下划强调线
        {
          id: 'rule', kind: 'svg', z: 3,
          svg: `<svg width="560" height="10" viewBox="0 0 560 10" fill="none"><line x1="5" y1="5" x2="555" y2="5" stroke="#ffc94d" stroke-width="5" stroke-linecap="round"/></svg>`,
          at: { x: '50%', y: '71%', anchor: 'center' }, in: 4.0,
          effects: [{ type: 'lineDraw', at: 4.0, dur: 0.5, ease: 'inOutExpo' }],
        },
      ],
      flashes: [{ at: 3.4, dur: 0.2, color: '#ffc94d', peak: 0.25 }],
    };
  },
};

// ── 13. 屏幕使用时间（手机屏幕使用报告条形图揭示） ───────────────────────────
const screenTime: PresetDef = {
  id: 'demo.screentime',
  label: '演示·屏幕时间报告',
  group: '媒介演示',
  paramsDoc: '{ title?: string, apps?: string[]("App名|小时数"3-4条,由高到低), total?: string(总时长文案) }',
  defaultDuration: 7,
  build(params, duration): SceneSpec {
    const t = str(params.title, '你的一天去哪了');
    const apps = list(params.apps, ['短视频|4.5', '社交|2.8', '游戏|1.6', '学习|0.4']).slice(0, 4);
    const total = str(params.total, '日均亮屏 9.3 小时');
    const maxH = Math.max(...apps.map((a2) => Number(a2.split('|')[1]) || 1));
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'],
      layers: [
        {
          id: 'title', kind: 'text', text: t, class: 'kp-h3 kp-shadow',
          at: { x: '50%', y: '13%', anchor: 'center' }, z: 5,
          effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
        },
        // 条形图：scaleX 生长（origin left）
        ...apps.flatMap((raw, i): SceneLayer[] => {
          const [nm, hs] = raw.split('|');
          const hours = Number(hs) || 1;
          const w = Math.round(920 * (hours / maxH));
          const at = 1.0 + i * 0.55;
          const isTop = i === 0;
          const color = isTop ? '#ff5252' : ['#5c8aff', '#3fd8c2', '#9ca3af'][i - 1] ?? '#9ca3af';
          const y = 28 + i * 13;
          return [
            {
              id: `bar${i}`, kind: 'html', z: 3,
              html: `<div style="width:${w}px;height:66px;border-radius:14px;background:linear-gradient(90deg,color-mix(in srgb,${color} 85%,#fff),${color});transform-origin:left center;${isTop ? `box-shadow:0 0 34px color-mix(in srgb,${color} 45%,transparent)` : ''}"></div>`,
              at: { x: '24%', y: `${y}%`, anchor: 'left' },
              tracks: [
                { prop: 'scaleX', kf: [{ t: at, v: 0 }, { t: at + 0.8, v: 1, ease: 'outQuart' }] },
                { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.25, v: 1 }] },
              ],
              effects: isTop ? [{ type: 'breathe', at: 4.2, period: 2.6, amount: 0.012 }] : undefined,
            },
            {
              id: `app${i}`, kind: 'text', text: nm,
              style: { fontSize: '30px', fontWeight: '700', color: 'rgba(240,246,255,.85)' },
              at: { x: '22%', y: `${y}%`, anchor: 'right' }, z: 4, in: at,
              tracks: [{ prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.35, v: 1 }] }],
            },
            {
              id: `hrs${i}`, kind: 'text', text: '0',
              style: { fontSize: '32px', fontWeight: '800', color: isTop ? '#ff5252' : 'rgba(240,246,255,.7)', fontVariantNumeric: 'tabular-nums' },
              at: { x: `${25 + (w / 1920) * 100 + 2}%`, y: `${y}%`, anchor: 'left' }, z: 4, in: at + 0.2,
              effects: [{ type: 'numberRoll', at: at + 0.2, dur: 0.9, to: hours, decimals: 1, suffix: 'h', ease: 'outExpo' }],
            },
          ];
        }),
        // 总结大字
        {
          id: 'total', kind: 'text', text: total, class: 'kp-shadow',
          style: { fontSize: '40px', fontWeight: '900', color: '#ff5252' },
          at: { x: '50%', y: '88%', anchor: 'center' }, z: 5, in: 4.4,
          tracks: [{ prop: 'scale', kf: [{ t: 4.4, v: 0.8 }, { t: 4.9, v: 1, spring: { stiffness: 190, damping: 12 } }] }, { prop: 'opacity', kf: [{ t: 4.4, v: 0 }, { t: 4.7, v: 1 }] }],
        },
      ],
      flashes: [{ at: 4.5, dur: 0.2, color: '#ff5252', peak: 0.22 }],
    };
  },
};

// ── 14. 金句海报（大字金句 + 描边字底纹 + 印刷感） ───────────────────────────
const posterQuote: PresetDef = {
  id: 'demo.poster',
  label: '演示·金句海报',
  group: '媒介演示',
  paramsDoc: '{ line1: string(第一行≤8字), line2: string(第二行强调句≤8字), tag?: string(角签) }',
  defaultDuration: 6,
  build(params, duration): SceneSpec {
    const line1 = str(params.line1, '慢慢来');
    const line2 = str(params.line2, '比较快');
    const tag = str(params.tag, 'VOL.07');
    return {
      v: 1, duration, bg: 'opaque', bgCss: PAPERBG, fonts: ['literary'],
      layers: [
        // 底层超大描边字（纹理装置）
        {
          id: 'ghost', kind: 'text', text: line2, class: 'kp-mega kp-outline',
          style: { fontSize: '420px', WebkitTextStroke: '2px rgba(43,38,32,.12)', color: 'transparent', whiteSpace: 'nowrap' },
          at: { x: '54%', y: '58%', anchor: 'center' }, z: 1, parallax: 0.75,
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 1.2, v: 1, ease: 'outCubic' }] },
            { prop: 'x', kf: [{ t: 0, v: 40 }, { t: duration, v: -40 }] },
          ],
        },
        // 主文案两行：错位排布
        {
          id: 'line1', kind: 'text', text: line1, class: 'kp-serif',
          style: { fontSize: '120px', fontWeight: '600', color: '#2b2620', letterSpacing: '.06em' },
          at: { x: '38%', y: '38%', anchor: 'center' }, z: 3,
          effects: [{ type: 'kineticText', split: 'char', at: 0.6, stagger: 0.12, dur: 0.7, from: { y: 50, opacity: 0 }, ease: 'outQuart' }],
        },
        {
          id: 'line2', kind: 'text', text: line2, class: 'kp-serif',
          style: { fontSize: '150px', fontWeight: '900', color: '#b03a2e', letterSpacing: '.04em' },
          at: { x: '58%', y: '58%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 1.5, stagger: 0.14, dur: 0.7, from: { y: 60, opacity: 0 }, ease: 'outQuart' },
            { type: 'breathe', at: 3.4, period: 4, amount: 0.008 },
          ],
        },
        // 朱砂杠
        {
          id: 'dash', kind: 'html', z: 2,
          html: `<div style="width:130px;height:18px;background:#b03a2e"></div>`,
          at: { x: '30%', y: '50%', anchor: 'center' }, in: 1.2,
          effects: [{ type: 'maskReveal', at: 1.2, dur: 0.4, dir: 'left', ease: 'inOutExpo' }],
        },
        // 角签
        {
          id: 'tag', kind: 'text', text: tag,
          style: { fontFamily: "'Space Grotesk',monospace", fontSize: '22px', letterSpacing: '.3em', color: 'rgba(43,38,32,.5)' },
          at: { x: '88%', y: '90%', anchor: 'center' }, z: 3, in: 3.0,
          tracks: [{ prop: 'opacity', kf: [{ t: 3.0, v: 0 }, { t: 3.5, v: 1 }] }],
        },
      ],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
    };
  },
};

// ── 15. 收益计算器（输入参数逐项敲定 → 结果爆出） ────────────────────────────
const calculator: PresetDef = {
  id: 'demo.calc',
  label: '演示·算账计算器',
  group: '媒介演示',
  paramsDoc: '{ title?: string, items?: string[]("名目|数值"2-4条), result: string("结论名|数值"), }',
  defaultDuration: 8,
  build(params, duration): SceneSpec {
    const t = str(params.title, '这笔账算给你看');
    const items = list(params.items, ['单条视频收益|300 元', '每周产出|5 条', '一年 52 周|×52']).slice(0, 4);
    const [resName, resValue] = str(params.result, '一年副业收入|78,000 元').split('|');
    const layers: SceneLayer[] = [
      {
        id: 'title', kind: 'text', text: t, class: 'kp-h3 kp-shadow',
        at: { x: '50%', y: '12%', anchor: 'center' }, z: 5,
        effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outExpo' }],
      },
      // 算式行：逐条敲上去（左名目右数值）
      ...items.flatMap((raw, i): SceneLayer[] => {
        const [nm, val] = raw.split('|');
        const at = 1.0 + i * 0.8;
        const y = 27 + i * 11;
        return [
          {
            id: `k${i}`, kind: 'text', text: nm,
            style: { fontSize: '34px', fontWeight: '600', color: 'rgba(240,246,255,.75)' },
            at: { x: '30%', y: `${y}%`, anchor: 'left' }, z: 3, in: at,
            tracks: [
              { prop: 'x', kf: [{ t: at, v: -40 }, { t: at + 0.4, v: 0, ease: 'outExpo' }] },
              { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.3, v: 1 }] },
            ],
          },
          {
            id: `v${i}`, kind: 'text', text: val ?? '',
            style: { fontSize: '38px', fontWeight: '800', color: '#3fd8c2', fontVariantNumeric: 'tabular-nums' },
            at: { x: '70%', y: `${y}%`, anchor: 'right' }, z: 3, in: at + 0.15,
            tracks: [
              { prop: 'scale', kf: [{ t: at + 0.15, v: 0.6 }, { t: at + 0.5, v: 1, spring: { stiffness: 240, damping: 13 } }] },
              { prop: 'opacity', kf: [{ t: at + 0.15, v: 0 }, { t: at + 0.35, v: 1 }] },
            ],
          },
        ];
      }),
      // 分隔横线（算完划线）
      {
        id: 'sum-line', kind: 'svg', z: 3,
        svg: `<svg width="800" height="8" viewBox="0 0 800 8" fill="none"><line x1="4" y1="4" x2="796" y2="4" stroke="rgba(255,255,255,.5)" stroke-width="4" stroke-linecap="round"/></svg>`,
        at: { x: '50%', y: `${29 + items.length * 11}%`, anchor: 'center' }, in: 1.2 + items.length * 0.8,
        effects: [{ type: 'lineDraw', at: 1.2 + items.length * 0.8, dur: 0.5, ease: 'inOutExpo' }],
      },
      // 结果行：名目 + 大数字爆出
      {
        id: 'res-name', kind: 'text', text: resName, class: 'kp-shadow',
        style: { fontSize: '38px', fontWeight: '800', color: '#ffc94d' },
        at: { x: '30%', y: `${37 + items.length * 11}%`, anchor: 'left' }, z: 4, in: 1.9 + items.length * 0.8,
        tracks: [{ prop: 'opacity', kf: [{ t: 1.9 + items.length * 0.8, v: 0 }, { t: 2.2 + items.length * 0.8, v: 1 }] }],
      },
      {
        id: 'res-val', kind: 'text', text: resValue ?? '', class: 'kp-shadow',
        style: { fontSize: '76px', fontWeight: '900', color: '#ffc94d', fontVariantNumeric: 'tabular-nums' },
        at: { x: '70%', y: `${37 + items.length * 11}%`, anchor: 'right' }, z: 4, in: 2.1 + items.length * 0.8,
        tracks: [{ prop: 'scale', kf: [{ t: 2.1 + items.length * 0.8, v: 0.5 }, { t: 2.7 + items.length * 0.8, v: 1, spring: { stiffness: 190, damping: 11 } }] }, { prop: 'opacity', kf: [{ t: 2.1 + items.length * 0.8, v: 0 }, { t: 2.35 + items.length * 0.8, v: 1 }] }],
        effects: [{ type: 'breathe', at: 3.0 + items.length * 0.8, period: 3, amount: 0.015, glowColor: 'rgba(255,201,77,.45)', glowRadius: 30 }],
      },
    ];
    return {
      v: 1, duration, bg: 'opaque', bgCss: DARKBG, fonts: ['minimal'], layers,
      flashes: [{ at: 2.3 + items.length * 0.8, dur: 0.25, color: '#ffc94d', peak: 0.3 }],
    };
  },
};

export const DEMO_MEDIA_PRESETS: PresetDef[] = [
  chatSim, webHighlight, quoteCard, notifyStorm, searchSuggest, danmaku,
  scoreCard, codeType, countdown, ranking, priceCards, qaCard,
  screenTime, posterQuote, calculator,
];
