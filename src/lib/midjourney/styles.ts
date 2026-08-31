import type { StyleCategory, StylePreset } from '@/lib/styleLibrary';
import { BaseDirectory, createDir, writeBinaryFile } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import testedStyleData from './testedStyles.json';
import {
  getMidjourneyParameterDefaults,
  normalizeMidjourneyVersion,
  type MidjourneyVersion,
} from './prompt';

export type MidjourneyCreativityMode = 'faithful' | 'balanced' | 'exploratory';

export interface MidjourneyStylePreset extends StylePreset {
  library: 'midjourney';
  creativityMode: MidjourneyCreativityMode;
  stylize?: number;
  chaos?: number;
  raw?: boolean;
  negativePrompt?: string;
  recommendedVersion?: MidjourneyVersion;
  referenceStrategy?: 'prompt' | 'style-reference';
  styleWeight?: number;
  imageWeight?: number;
  weird?: number;
  calibration: 'api-tested' | 'director-calibrated';
  defaultAspectRatio?: string;
}

export const MIDJOURNEY_STYLE_CATEGORIES: StyleCategory[] = [
  { id: 'oriental', name: '东方美学', dir: 'oriental' },
  { id: 'cinematic', name: '电影叙事', dir: 'cinematic' },
  { id: 'photography', name: '真实摄影', dir: 'photography' },
  { id: 'world', name: '世界构建', dir: 'world' },
  { id: 'illustration', name: '插画动画', dir: 'illustration' },
  { id: 'commercial', name: '商业设计', dir: 'commercial' },
  { id: 'experimental', name: '实验创意', dir: 'experimental' },
];

// Every director preset owns a dedicated, visually reviewed cover. Do not fall
// back to another preset: duplicate covers make distinct styles look identical.
const preview = (id: string) => `/midjourney-styles/director/${id}.jpg`;

const style = (
  id: string,
  name: string,
  category: string,
  promptTemplate: string,
  visualDNA: string,
  cameraLanguage: string,
  creativityMode: MidjourneyCreativityMode = 'balanced',
  overrides: Partial<MidjourneyStylePreset> = {},
): MidjourneyStylePreset => ({
  id,
  name,
  category: ({ portrait: 'photography', cinema: 'cinematic', fantasy: 'oriental', design: 'commercial' } as Record<string, string>)[category] ?? category,
  thumbnailPath: preview(id),
  promptTemplate,
  visualDNA,
  cameraLanguage,
  promptSuffix: promptTemplate,
  library: 'midjourney',
  creativityMode,
  calibration: 'director-calibrated',
  ...overrides,
});

interface TestedStyleRecord {
  id: string;
  name: string;
  category: 'oriental' | 'cinematic' | 'photoreal' | 'anime' | 'commercial' | 'creative';
  promptTemplate: string;
  visualDNA?: string;
  cameraLanguage?: string;
  promptSuffix?: string;
  negativeHints?: string;
  mjParams?: {
    version?: string;
    stylize?: number;
    chaos?: number;
    raw?: boolean;
    ar?: string;
  };
}

const TESTED_CATEGORY_MAP: Record<TestedStyleRecord['category'], string> = {
  oriental: 'oriental',
  cinematic: 'cinematic',
  photoreal: 'photography',
  anime: 'illustration',
  commercial: 'commercial',
  creative: 'experimental',
};

const testedStylePresets: MidjourneyStylePreset[] = (testedStyleData.styles as TestedStyleRecord[]).map((item) => {
  const params = item.mjParams ?? {};
  const creativityMode: MidjourneyCreativityMode = params.raw
    ? 'faithful'
    : Number(params.chaos ?? 0) >= 20
      ? 'exploratory'
      : 'balanced';
  return {
    id: item.id,
    name: item.name,
    category: TESTED_CATEGORY_MAP[item.category],
    thumbnailPath: `/midjourney-styles/tested/${item.id}.jpg`,
    promptTemplate: item.promptTemplate,
    visualDNA: item.visualDNA,
    cameraLanguage: item.cameraLanguage,
    promptSuffix: item.promptSuffix,
    library: 'midjourney',
    creativityMode,
    stylize: params.stylize,
    chaos: params.chaos,
    raw: params.raw,
    negativePrompt: item.negativeHints,
    recommendedVersion: normalizeMidjourneyVersion(params.version),
    defaultAspectRatio: params.ar,
    referenceStrategy: 'prompt',
    calibration: 'api-tested',
  };
});

/**
 * Technique-led presets. Names deliberately avoid living artists and protected
 * franchises: the library teaches visual mechanisms instead of imitation.
 */
const DIRECTOR_STYLE_PRESETS: MidjourneyStylePreset[] = [
  style('raw-flash-intimacy', '生猛闪光人像', 'portrait',
    'raw direct-flash editorial portrait, truthful skin texture, damp flyaway hair, imperfect human detail, immediate eye contact, restrained color',
    '近距离直闪、真实皮肤、汗光与碎发；保留毛孔和轻微瑕疵，拒绝塑料磨皮。',
    '85mm close portrait, shallow depth of field, slight foreground occlusion, direct on-camera flash', 'faithful',
    { stylize: 140, chaos: 4, raw: true }),
  style('kinetic-fashion-frame', '动态时装抓拍', 'portrait',
    'kinetic fashion editorial, fabric caught mid-motion, candid asymmetry, selective motion blur, tactile styling, spontaneous luxury',
    '让衣料、头发和肢体形成动势，奢华但不摆拍。',
    'handheld medium close shot, oblique framing, shutter drag on secondary movement', 'balanced',
    { stylize: 260, chaos: 10 }),
  style('ceremonial-jewelry', '东方珠玉盛装', 'portrait',
    'ceremonial East Asian couture portrait, dense handcrafted metal filigree, pearls and gemstone details, lacquer-black depth, red textile accents, museum-grade material realism',
    '珠玉、金属丝、漆黑与深红组成高密度层次，人物五官仍是视觉中心。',
    'compressed telephoto portrait, narrow focus plane, warm practical highlights in deep shadow', 'balanced',
    { stylize: 260, chaos: 4, referenceStrategy: 'style-reference', styleWeight: 230, imageWeight: 0 }),
  style('nocturnal-crimson-armor', '暗夜猩红铠甲', 'portrait',
    'nocturnal black armor portrait, wet reflective metal, sparse crimson edge light, drifting ground fog, severe silhouette, tactile battle wear',
    '大面积黑中保留盔甲轮廓，红光只作结构锚点，材质必须可触摸。',
    'low-angle full figure, centered but not symmetrical, long-lens background compression', 'balanced',
    { stylize: 280, chaos: 6 }),

  style('ruined-mecha-archaeology', '废墟机甲考古', 'cinema',
    'monumental weathered mecha discovered in a collapsed concrete megastructure, chipped painted armor, exposed cables, dust and mineral deposits, documentary realism',
    '把巨型机械当作真实遗址拍摄，重点是尺度、重量、剥落漆面与城市残骸。',
    'extreme low-angle 28mm lens, foreground rubble, hard daylight, occasional tilted frame', 'faithful',
    { stylize: 260, chaos: 8, raw: true, recommendedVersion: 'v8.2' }),
  style('epic-negative-space', '史诗留白远景', 'cinema',
    'vast cinematic landscape with tiny human silhouettes, monumental negative space, one readable destination, wind-carved terrain, quiet narrative tension',
    '用极小人物和巨大环境建立尺度，构图克制，只有一个清晰叙事目标。',
    'ultra-wide establishing shot, low horizon or high horizon chosen for scale, restrained atmospheric perspective', 'balanced',
    { stylize: 240, chaos: 7 }),
  style('ritual-procession', '仪式性群像', 'cinema',
    'ritual procession in a monumental space, readable group hierarchy, repeated silhouettes, restrained theatrical blocking, smoke and directional light',
    '群像不是堆人，而是用队列、间距、姿态和光线组织权力关系。',
    'symmetrical wide shot broken by one moving subject, deep staging, hard cut visual clarity', 'balanced',
    { stylize: 260, chaos: 8 }),
  style('urban-myth-thriller', '都市神话惊悚', 'cinema',
    'contemporary urban location interrupted by an ancient mythic presence, believable street detail, sodium-vapor and fluorescent light, uneasy realism',
    '现实城市保持可信，仅让一个神话元素侵入，避免满屏奇观。',
    '35mm street-level frame, hidden observer angle, practical lighting, deep shadow pockets', 'balanced',
    { stylize: 210, chaos: 9 }),

  style('living-terrace-city', '生态层叠未来城', 'world',
    'biophilic terraced city grown across a mountain valley, translucent canopies, water circulation, cultivated forests, plausible civic infrastructure, inhabited scale',
    '未来建筑与山体、水系、植被形成生态循环，奇观背后仍有可生活的尺度。',
    'layered aerial establishing view, strong foreground framing, atmospheric depth across three planes', 'exploratory',
    { stylize: 420, chaos: 14 }),
  style('celestial-garden-collage', '宇宙花园拼贴', 'world',
    'surreal celestial garden assembled as a seamless editorial collage, flowering valleys, reflective rivers, cosmic void apertures, one poetic animal figure',
    '真实风景、宇宙孔洞与植物以拼贴逻辑衔接，层次丰富但叙事焦点单一。',
    'vertical journey composition, nested horizons, soft impossible transitions between scales', 'exploratory',
    { stylize: 360, chaos: 12, referenceStrategy: 'style-reference', styleWeight: 420, imageWeight: 0 }),
  style('impossible-museum', '不可能的自然博物馆', 'world',
    'impossible natural-history museum embedded inside a living landscape, geological halls, specimen-scale architecture, quiet visitors, scientific wonder',
    '博物馆、地貌和生命样本互相嵌套，具有科普秩序与梦境尺度。',
    'one-point perspective interrupted by organic openings, measured architectural photography', 'exploratory',
    { stylize: 390, chaos: 16 }),
  style('silent-brutalist-future', '静默粗粝未来', 'world',
    'silent brutalist future settlement, monolithic concrete, weathered surfaces, sparse human traces, fog-softened depth, functional details',
    '冷静、少元素、强尺度，未来感来自结构与使用痕迹而不是霓虹装饰。',
    '24mm architectural frame, disciplined vanishing lines, overcast diffuse light', 'faithful',
    { stylize: 160, chaos: 4, raw: true }),

  style('mythic-winged-regalia', '神话翼甲华服', 'fantasy',
    'mythic winged ceremonial armor, hand-forged dark metal feathers, ancient textile underlayers, restrained supernatural presence, historical material credibility',
    '羽翼、甲片和古代织物形成真实可制作的服装系统，人物身份清晰。',
    'three-quarter hero portrait, layered foreground figures, shallow depth, warm backlight', 'balanced',
    { stylize: 350, chaos: 8 }),
  style('cosmic-dynasty', '宇宙王朝遗迹', 'fantasy',
    'ancient dynasty ruins drifting through a cosmic environment, monumental gates, eroded inscriptions without readable text, celestial dust, solemn scale',
    '东方宫阙与宇宙尺度结合，强调遗迹感和庄严秩序，避免廉价仙侠光效。',
    'wide anamorphic composition, slow depth layers, silhouette-first lighting', 'exploratory',
    { stylize: 430, chaos: 15 }),
  style('folk-ritual-night', '民俗夜祭', 'fantasy',
    'night folk ritual with handmade masks, paper structures, ember light, smoke, worn textiles, documentary authenticity and uncanny restraint',
    '民俗材料必须真实，奇异感来自行为、面具与火光，不靠随机怪物。',
    'handheld 35mm observational frame, mixed firelight and moonlight, imperfect focus', 'balanced',
    { stylize: 230, chaos: 10 }),
  style('ancient-machine-reliquary', '古机械圣龛', 'fantasy',
    'ancient mechanical reliquary, oxidized bronze mechanisms, carved stone housing, ritual wear, tiny functional joints, sacred industrial atmosphere',
    '古代器物与机械结构融合，铜锈、石材和活动关节都要有功能依据。',
    'macro-to-medium product archaeology, raking side light, dark neutral environment', 'balanced',
    { stylize: 310, chaos: 9 }),

  style('sculptural-product-stage', '雕塑产品舞台', 'design',
    'sculptural commercial product stage, one hero object, precise material contrast, engineered shadow, restrained accent color, premium art direction',
    '单一产品成为雕塑主体，用材质对比和阴影组织高级感，拒绝装饰堆砌。',
    '70mm product lens, controlled three-quarter view, clean studio falloff', 'faithful',
    { stylize: 170, chaos: 3, raw: true }),
  style('translucent-biomaterial', '半透明生物材质', 'design',
    'translucent biomaterial objects, soft membranes, glass and gel interfaces, internal light scattering, clinical yet sensual product visualization',
    '玻璃、凝胶和柔性薄膜有真实折射与厚度，色彩克制。',
    'macro product photography, grazing light, shallow focus with precise edge detail', 'balanced',
    { stylize: 290, chaos: 8 }),
  style('editorial-archive-grid', '编辑部档案拼贴', 'design',
    'editorial archive composition, contact sheets, material swatches, cropped evidence photographs, disciplined grid, tactile paper depth, no readable text',
    '用档案照片、样本、纸张和网格讲清设计过程，避免 PPT 卡片感。',
    'top-down reprographic view mixed with one cinematic hero crop', 'balanced',
    { stylize: 220, chaos: 11 }),
  style('luminous-tech-minimal', '冷光科技极简', 'design',
    'luminous technology still life, dark neutral field, thin optical light paths, precise glass and machined metal, controlled negative space',
    '科技感来自光学路径、玻璃与精密金属，不用满屏蓝紫霓虹。',
    'telephoto still life, compressed layers, narrow rim lighting, clean reflections', 'faithful',
    { stylize: 150, chaos: 4, raw: true }),

  style('scale-rupture', '尺度断裂奇观', 'experimental',
    'a believable everyday scene ruptured by one impossible change of scale, seamless material continuity, clear human reference, cinematic wonder',
    '只改变一个尺度关系，其他物理与材质保持真实，使奇观更可信。',
    'wide perspective with a foreground scale cue, deep focus, one decisive vanishing point', 'exploratory',
    { stylize: 360, chaos: 18 }),
  style('analog-dream-transfer', '模拟介质梦境', 'experimental',
    'analog dream transfer, optical printing artifacts, soft halation, layered exposures, tactile grain, recognizable subject preserved through abstraction',
    '多重曝光、光晕和介质颗粒围绕主体发生，不能把主体完全溶解。',
    'close cinematic crop, layered focal planes, in-camera transition feeling', 'exploratory',
    { stylize: 400, chaos: 17 }),
  style('material-mutation-study', '材质异变研究', 'experimental',
    'material mutation study where one object transitions through stone, textile, glass and living tissue, scientific sequencing, coherent silhouette',
    '同一轮廓跨材质演化，像严谨的视觉实验，不是随机材质拼盘。',
    'orthographic sequence with one hero perspective insert, even reference lighting', 'exploratory',
    { stylize: 340, chaos: 16 }),
  style('poetic-surveillance', '诗性监控视角', 'experimental',
    'poetic surveillance image, distant human behavior, obstructed viewpoint, timestamp-free institutional framing, quiet emotional anomaly',
    '疏离的观察角度与细小人物行为构成情绪，不生成时间码或界面文字。',
    'high corner angle or long-lens exterior view, partial occlusion, flat ambient light', 'faithful',
    { stylize: 130, chaos: 5, raw: true }),
];

export const MIDJOURNEY_STYLE_PRESETS: MidjourneyStylePreset[] = [
  ...testedStylePresets,
  ...DIRECTOR_STYLE_PRESETS,
];

function appendNegativePrompt(prompt: string, negativePrompt: string | undefined): string {
  const negative = String(negativePrompt ?? '').trim();
  if (!negative || /(?:^|\s)--no\s/i.test(prompt)) return prompt;
  return `${prompt} --no ${negative}`;
}

/**
 * Compile a subject into a style without leaving `{subject}` in the paid API
 * request. Medium-led templates deliberately own sentence order; director
 * presets without a placeholder are appended as visual direction.
 */
export function applyMidjourneyStylePrompt(
  subject: string,
  preset: MidjourneyStylePreset | undefined,
): string {
  const cleanSubject = subject.trim();
  if (!preset) return cleanSubject;
  const template = preset.promptTemplate.trim();
  const anchors = String(preset.promptSuffix ?? template)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length >= 5)
    .slice(0, 4);
  const normalizedSubject = cleanSubject.toLowerCase();
  const alreadyStyled = anchors.length > 0
    && anchors.filter((anchor) => normalizedSubject.includes(anchor)).length >= Math.min(2, anchors.length);
  if (alreadyStyled) return appendNegativePrompt(cleanSubject, preset.negativePrompt);
  const composed = template.includes('{subject}')
    ? template.replaceAll('{subject}', cleanSubject)
    : [cleanSubject, template].filter(Boolean).join(', ');
  return appendNegativePrompt(composed, preset.negativePrompt);
}

export function resolveMidjourneyStyleParameters(
  preset: MidjourneyStylePreset | undefined,
  mode: MidjourneyCreativityMode = preset?.creativityMode ?? 'balanced',
  overrides: Partial<{
    version: MidjourneyVersion;
    stylize: number;
    chaos: number;
    raw: boolean;
    weird: number;
    styleWeight: number;
    imageWeight: number;
    aspectRatio: string;
  }> = {},
) {
  const defaults = getMidjourneyParameterDefaults(mode);
  return {
    version: overrides.version ?? normalizeMidjourneyVersion(preset?.recommendedVersion),
    stylize: overrides.stylize ?? preset?.stylize ?? defaults.stylize,
    chaos: overrides.chaos ?? preset?.chaos ?? defaults.chaos,
    raw: overrides.raw ?? preset?.raw ?? defaults.raw,
    weird: overrides.weird ?? preset?.weird ?? 0,
    styleWeight: overrides.styleWeight ?? preset?.styleWeight ?? 100,
    imageWeight: overrides.imageWeight ?? preset?.imageWeight ?? 1,
    aspectRatio: overrides.aspectRatio ?? preset?.defaultAspectRatio,
  };
}

export function getMidjourneyStyle(id: string | undefined): MidjourneyStylePreset | undefined {
  return MIDJOURNEY_STYLE_PRESETS.find((item) => item.id === id);
}

export async function loadMidjourneyStyleLibrary(): Promise<{
  categories: StyleCategory[];
  styles: MidjourneyStylePreset[];
}> {
  return { categories: MIDJOURNEY_STYLE_CATEGORIES, styles: MIDJOURNEY_STYLE_PRESETS };
}

/**
 * Materialize a bundled preview as a local file for RunningHub upload.
 * Only presets calibrated as style-reference use this path; prompt-led styles
 * stay text-only so their composition is not accidentally copied.
 */
export async function ensureMidjourneyStyleReference(
  preset: MidjourneyStylePreset | undefined,
): Promise<string | undefined> {
  if (!preset || preset.referenceStrategy !== 'style-reference') return undefined;
  const response = await fetch(preset.thumbnailPath);
  if (!response.ok) throw new Error(`无法读取 Midjourney 风格母图：${preset.name}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const relativeDir = '.kunpeng/midjourney-styles';
  const relativePath = `${relativeDir}/${preset.id}.jpg`;
  await createDir(relativeDir, { dir: BaseDirectory.Home, recursive: true });
  await writeBinaryFile(relativePath, bytes, { dir: BaseDirectory.Home });
  return `${await homeDir()}${relativePath}`;
}
