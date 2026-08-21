import type { PaletteColor, WsColorPalette } from '@/lib/workshop/types';
import { loadImageBitmap } from '@/lib/canvas/imageSource';

const COLOR_LABELS = [
  '环境主色',
  '天光底色',
  '空气远景',
  '中间调',
  '阴影层次',
  '深部轮廓',
  '材质暗面',
  '墙面基调',
  '织物色',
  '皮革色',
  '肤色暖调',
  '功能强调',
  '冷色反光',
];

export const COLOR_PALETTE_PROMPT_TEMPLATE = `请根据我提供的参考图，生成一段用于 AI 图像生成的「色卡参考图」提示词。
目标是把参考图中的整体色彩语言，转化成一张干净、专业、扁平化的数字色卡设计图。请不要描述成艺术插画、摄影照片或实物拍摄，而是描述成类似 Figma、Adobe Illustrator、电影美术设定集、设计系统文档、色彩管理参考页中的平面视觉资料。
请最终输出一段完整、可直接用于图像生成的中文提示词。提示词中必须包含：画面比例与风格说明、背景色、标题与副标题、色块数量、每个色块的 HEX、每个色块的功能标签，以及扁平化、无摄影、无纹理、无阴影等限制条件。`;

function palette(id: string, name: string, description: string, colors: PaletteColor[], source: WsColorPalette['source'] = 'default'): WsColorPalette {
  return {
    id,
    name,
    description,
    colors,
    assetPrompt: buildColorPalettePrompt(name, description, colors),
    usagePrompt: buildPaletteUsagePrompt(name, colors),
    assetEngine: 'gpt-image-2',
    source,
    createdAt: 0,
  };
}

export const DEFAULT_MASTER_COLOR_PALETTES: WsColorPalette[] = [
  palette('film-in-the-mood-for-love', '复古红金暗影色彩系统', '深红旗袍、琥珀廊灯、墨绿墙纸与潮湿夜色', [
    { hex: '#241512', label: '夜色暗底' },
    { hex: '#3A201C', label: '木墙阴影' },
    { hex: '#5C2A24', label: '旧红墙面' },
    { hex: '#842F2D', label: '旗袍深红' },
    { hex: '#B2473B', label: '唇色强调' },
    { hex: '#D08A47', label: '廊灯琥珀' },
    { hex: '#E3B96E', label: '丝绸高光' },
    { hex: '#A88C5B', label: '旧金反光' },
    { hex: '#5E5C3D', label: '墨绿墙纸' },
    { hex: '#2F3A2E', label: '潮湿绿影' },
    { hex: '#1C2422', label: '窄巷深处' },
    { hex: '#C8B8A0', label: '肤色柔光' },
    { hex: '#6D6A62', label: '烟雾灰调' },
  ]),
  palette('film-blade-runner-2049', '雾橙赛博色彩系统', '荒漠橙雾、冷青机械光、深蓝雨夜与霓虹警示', [
    { hex: '#0A1118', label: '雨夜深蓝' },
    { hex: '#132534', label: '城市暗面' },
    { hex: '#1B4650', label: '冷青反光' },
    { hex: '#2E6870', label: '机械屏光' },
    { hex: '#5B7F7D', label: '雾面金属' },
    { hex: '#B9A77D', label: '浑浊天光' },
    { hex: '#D1883F', label: '荒漠橙雾' },
    { hex: '#A75E2D', label: '沙尘中间调' },
    { hex: '#65351F', label: '建筑热影' },
    { hex: '#2B1B17', label: '轮廓黑位' },
    { hex: '#E3C07A', label: '暖屏高光' },
    { hex: '#B9324A', label: '红色警示' },
    { hex: '#6E4AA0', label: '紫色霓虹' },
  ]),
  palette('film-grand-budapest', '粉彩童话色彩系统', '粉墙、酒红制服、奶油高光与复古酒店金边', [
    { hex: '#F6D1CF', label: '粉墙主色' },
    { hex: '#E7A8B2', label: '玫瑰阴影' },
    { hex: '#C76E89', label: '织物中调' },
    { hex: '#7A2440', label: '酒红制服' },
    { hex: '#42182A', label: '深莓轮廓' },
    { hex: '#F3E7C9', label: '奶油墙面' },
    { hex: '#D9B46A', label: '酒店金边' },
    { hex: '#A67A45', label: '木框暖影' },
    { hex: '#94A9B8', label: '冷蓝窗光' },
    { hex: '#5E7384', label: '雪夜蓝灰' },
    { hex: '#D66B4C', label: '橙红点缀' },
    { hex: '#F1F0E8', label: '纸面留白' },
    { hex: '#2E2530', label: '黑色细线' },
  ]),
  palette('film-stalker', '沼泽绿灰色彩系统', '潮湿苔藓、锈水、病态黄绿与被污染的自然光', [
    { hex: '#D0C9A2', label: '浑浊天光' },
    { hex: '#A9A06D', label: '病态黄绿' },
    { hex: '#7E7C50', label: '苔藓中调' },
    { hex: '#5E6448', label: '湿草暗面' },
    { hex: '#3F4A38', label: '森林深绿' },
    { hex: '#1F2B24', label: '区域深影' },
    { hex: '#8B744C', label: '锈水反光' },
    { hex: '#6B4D34', label: '泥土暖影' },
    { hex: '#4A3326', label: '腐木暗面' },
    { hex: '#9A9A86', label: '水泥灰调' },
    { hex: '#6B7066', label: '金属氧化' },
    { hex: '#C7B27A', label: '旧照片高光' },
    { hex: '#2E302B', label: '黑绿轮廓' },
  ]),
  palette('film-godfather', '暗金棕经典色彩系统', '低照度室内、雪茄棕、黑西装与钨丝灯金色皮肤', [
    { hex: '#120C08', label: '黑西装底色' },
    { hex: '#24160E', label: '室内深影' },
    { hex: '#3A2415', label: '胡桃木墙' },
    { hex: '#5A351E', label: '雪茄棕调' },
    { hex: '#7C4E2A', label: '皮革中调' },
    { hex: '#A56E38', label: '钨丝灯边缘' },
    { hex: '#D09A57', label: '金色肤光' },
    { hex: '#E0BC7A', label: '暖黄高光' },
    { hex: '#8B1E1E', label: '暗红权力色' },
    { hex: '#4E1515', label: '红酒阴影' },
    { hex: '#6D6759', label: '烟雾灰层' },
    { hex: '#A89B83', label: '衬衫旧白' },
    { hex: '#0A0A08', label: '纯黑压暗' },
  ]),
  palette('film-fury-road', '沙橙青蓝末日色彩系统', '高对比沙漠橙、金属黑、爆炸暖光与冷青夜影', [
    { hex: '#F1C56D', label: '烈日沙光' },
    { hex: '#D88936', label: '沙漠橙调' },
    { hex: '#B65A24', label: '尘暴暗橙' },
    { hex: '#7A351F', label: '锈车阴影' },
    { hex: '#43251A', label: '焦土轮廓' },
    { hex: '#171717', label: '金属黑位' },
    { hex: '#6E6F65', label: '铬铁灰面' },
    { hex: '#BFB095', label: '沙尘高光' },
    { hex: '#E0562C', label: '爆炸红橙' },
    { hex: '#183A49', label: '夜战青蓝' },
    { hex: '#2E6B7C', label: '冷青反光' },
    { hex: '#91B8B8', label: '月光雾色' },
    { hex: '#F4E3B0', label: '热白天光' },
  ]),
  palette('film-amelie', '法式红绿暖黄色彩系统', '巴黎暖黄、饱和苹果绿、浆果红与童话式室内光', [
    { hex: '#F2C35B', label: '巴黎暖黄' },
    { hex: '#D89A35', label: '钨丝中调' },
    { hex: '#A65A22', label: '木纹暖影' },
    { hex: '#6D361C', label: '咖啡深色' },
    { hex: '#183B2A', label: '深绿墙面' },
    { hex: '#2F6F3E', label: '苹果绿调' },
    { hex: '#6FAF54', label: '植物亮面' },
    { hex: '#B9282E', label: '浆果红点' },
    { hex: '#8F1D2D', label: '红裙阴影' },
    { hex: '#E06C43', label: '橙红肤光' },
    { hex: '#F0D7A0', label: '奶油高光' },
    { hex: '#4C5A35', label: '橄榄暗面' },
    { hex: '#2B241B', label: '室内轮廓' },
  ]),
  palette('film-her', '柔粉橙红未来色彩系统', '柔粉城市、珊瑚橙、奶油白与低对比科技暖光', [
    { hex: '#F5D6C8', label: '柔粉空气' },
    { hex: '#ECA98E', label: '珊瑚肤光' },
    { hex: '#D96D5B', label: '橙红衣料' },
    { hex: '#B9483F', label: '情绪红调' },
    { hex: '#7A2D2D', label: '深红阴影' },
    { hex: '#F5E9D8', label: '奶油白面' },
    { hex: '#D7B98E', label: '木质暖光' },
    { hex: '#A88D6E', label: '室内中调' },
    { hex: '#AFC2C2', label: '雾蓝玻璃' },
    { hex: '#7F9999', label: '城市冷灰' },
    { hex: '#596A6B', label: '远景暗青' },
    { hex: '#F0B05C', label: '夕阳边缘' },
    { hex: '#2A2426', label: '低对比黑' },
  ]),
];

export function ensureDefaultColorPalettes(existing: WsColorPalette[] | undefined): WsColorPalette[] {
  const legacyDefaultIds = new Set(['master-cold-industrial', 'master-border-city', 'master-neon-noir']);
  const currentDefaultIds = new Set(DEFAULT_MASTER_COLOR_PALETTES.map((p) => p.id));
  const map = new Map(
    (existing ?? [])
      .filter((p) => !(p.source === 'default' && legacyDefaultIds.has(p.id)))
      .map((p) => [p.id, p]),
  );
  for (const p of DEFAULT_MASTER_COLOR_PALETTES) {
    const old = map.get(p.id);
    if (old && old.source === 'default') {
      map.set(p.id, {
        ...p,
        assetImagePath: old.assetImagePath,
        candidates: old.candidates ?? [],
        createdAt: old.createdAt,
      });
    } else if (!old) {
      map.set(p.id, { ...p, candidates: [] });
    }
  }
  return [...map.values()].sort((a, b) => {
    const ai = currentDefaultIds.has(a.id) ? DEFAULT_MASTER_COLOR_PALETTES.findIndex((p) => p.id === a.id) : 999;
    const bi = currentDefaultIds.has(b.id) ? DEFAULT_MASTER_COLOR_PALETTES.findIndex((p) => p.id === b.id) : 999;
    return ai - bi || a.createdAt - b.createdAt;
  });
}

export function buildColorPalettePrompt(name: string, description: string, colors: PaletteColor[], background = '#F1F0E8'): string {
  const lines = colors.map((c, i) => `${String(i + 1).padStart(2, '0')}：${c.hex}\n功能标签：${c.label}`).join('\n\n');
  return `一张干净的数字色卡参考设计图，16:9 横向构图，纯 2D 扁平化平面设计美学，没有任何摄影元素，不是照片，不是实物拍摄，不是纸张印刷品，不是桌面摆拍。

背景为纯色中性浅色填充：${background}。背景完全平面化，无纹理、无阴影、无纸张质感、无桌面、无表面材质。

元素 1 —— 顶部居中的标题文字：使用干净的无衬线字体，主标题为近黑色，文字内容为「${name.toUpperCase()}」。主标题下方有一行更小的浅灰色副标题，文字内容为「${description} · ${colors.length} color system」。

元素 2 —— 画面中部一排横向排列的 ${colors.length} 个矩形色块：所有色块在同一水平线上，均匀间距，垂直居中。每个色块都是干净的纯色矩形，尺寸完全一致，边缘锐利清晰。色块不能有渐变、阴影、描边、纹理、光泽、厚度、透视或任何立体效果。

${colors.length} 个色块从左到右依次为：

${lines}

元素 3 —— 每个色块下方的两行小字：第一行是对应 HEX 色值，使用干净的等宽字体，颜色为深灰色 #333333。第二行是该颜色的功能标签，使用更小的无衬线字体，颜色为中灰色 #777777。文字必须清晰可读，排版整齐，不出现乱码、不出现随机字母、不出现多余文字。

整体视觉要求：这是一张纯 2D 扁平化数字图形设计图，像 Figma、Adobe Illustrator、电影美术设定集、视觉开发文档、色彩管理参考页中的专业色彩系统说明页。风格精确、冷静、信息化、极简、专业，构图清晰、整齐、克制，强调色彩信息本身。

必须避免：摄影渲染、纸张纹理、桌面、阴影、景深、镜头虚化、胶片颗粒、写实材质、3D 渲染、色块上的光照效果、色块下方阴影、光泽表面、手绘感、水彩感、插画感、草图感、实物 mockup、真实世界物体模拟。`;
}

export function buildPaletteUsagePrompt(name: string, colors: PaletteColor[]): string {
  const roleText = colors.map((c) => `${c.hex} ${c.label}`).join('、');
  return `画面配色严格参考【色卡对应的@图片N】，全片统一使用「${name}」：${roleText}。人物、建筑、天空、地面、道具都必须被该色卡统一约束，整体低饱和、色彩逻辑稳定、不得偏离参考色卡。禁止无关高饱和色、禁止随机霓虹色、禁止不受控暖光、禁止颜色漂移。`;
}

export async function extractPaletteFromImageUrl(url: string, count = 13): Promise<PaletteColor[]> {
  // loadImageBitmap 而非 <img>：asset:// 图片画到 canvas 会 tainted，
  // getImageData 直接抛 SecurityError。ImageBitmap 从原始字节创建，干净。
  const img = await loadImageBitmap(url);
  const canvas = document.createElement('canvas');
  const maxSide = 360;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法读取图片像素');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map<string, { r: number; g: number; b: number; n: number; weight: number }>();
  for (let i = 0; i < data.length; i += 16) {
    const a = data[i + 3];
    if (a < 180) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 245 && min > 235) continue;
    const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`;
    const sat = max - min;
    const lightBalance = 1 - Math.abs((r + g + b) / 3 - 128) / 180;
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, weight: 0 };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.n += 1;
    cur.weight += 1 + sat / 64 + lightBalance;
    buckets.set(key, cur);
  }

  const ranked = [...buckets.values()]
    .map((b) => ({ r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n), score: b.weight }))
    .sort((a, b) => b.score - a.score);
  const chosen: { r: number; g: number; b: number }[] = [];
  for (const c of ranked) {
    if (chosen.every((x) => colorDistance(x, c) > 34)) chosen.push(c);
    if (chosen.length >= count) break;
  }
  while (chosen.length < Math.min(count, ranked.length)) chosen.push(ranked[chosen.length]);
  chosen.sort((a, b) => luminance(b) - luminance(a));
  return chosen.slice(0, count).map((c, i) => ({ hex: rgbToHex(c.r, c.g, c.b), label: COLOR_LABELS[i] ?? `色彩功能 ${i + 1}` }));
}

export function renderColorPaletteDataUrl(name: string, description: string, colors: PaletteColor[], background = '#F1F0E8'): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建色卡画布');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#171914';
  ctx.font = '700 38px Arial, Helvetica, sans-serif';
  ctx.fillText(name.toUpperCase(), 800, 145);
  ctx.fillStyle = '#8A8A82';
  ctx.font = '400 22px Arial, Helvetica, sans-serif';
  ctx.fillText(`${description} · ${colors.length} color system`, 800, 195);

  const swatchW = 86;
  const swatchH = 280;
  const gap = 18;
  const totalW = colors.length * swatchW + (colors.length - 1) * gap;
  const startX = (1600 - totalW) / 2;
  const y = 335;
  colors.forEach((c, i) => {
    const x = startX + i * (swatchW + gap);
    ctx.fillStyle = c.hex;
    ctx.fillRect(x, y, swatchW, swatchH);
    ctx.fillStyle = '#333333';
    ctx.font = '600 17px Menlo, Consolas, monospace';
    ctx.fillText(c.hex.toUpperCase(), x + swatchW / 2, y + swatchH + 40);
    ctx.fillStyle = '#777777';
    ctx.font = '400 15px Arial, Helvetica, sans-serif';
    wrapLabel(ctx, c.label, x + swatchW / 2, y + swatchH + 74, swatchW + 14);
  });
  return canvas.toDataURL('image/png');
}

function wrapLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, maxW: number) {
  if (ctx.measureText(label).width <= maxW) {
    ctx.fillText(label, x, y);
    return;
  }
  const chars = [...label];
  let line = '';
  let offset = 0;
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxW && line) {
      ctx.fillText(line, x, y + offset);
      line = ch;
      offset += 18;
    } else {
      line = next;
    }
  }
  if (line) ctx.fillText(line, x, y + offset);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function luminance(c: { r: number; g: number; b: number }): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}
