export interface MgStylePreset {
  id: string;
  name: string;
  category: string;
  prompt: string;
  guidance: string;
  tags?: string[];
  bestFor?: string;
}

export type MgStyleCategoryId =
  | 'product'
  | 'tech'
  | 'editorial'
  | 'information'
  | 'speaker'
  | 'handmade'
  | 'viral'
  | 'material';

export interface MgStyleCategory {
  id: MgStyleCategoryId;
  name: string;
  description: string;
}

export interface MgMotionRecipe {
  density: 'balanced' | 'rich' | 'maximal';
  spatial: '2d' | '2.5d' | '3d';
  rhythm: 'steady' | 'narrative' | 'punchy';
  relationship: 'around-subject' | 'full-stage' | 'replace-background';
  material: 'follow-style' | 'glass' | 'paper' | 'soft-3d' | 'graphic';
}

export const DEFAULT_MG_MOTION_RECIPE: MgMotionRecipe = {
  density: 'rich',
  spatial: '2.5d',
  rhythm: 'narrative',
  relationship: 'around-subject',
  material: 'follow-style',
};

export const MG_STYLE_CATEGORIES: MgStyleCategory[] = [
  { id: 'product', name: '产品与应用', description: 'App、SaaS、AI 工具和功能演示' },
  { id: 'tech', name: '科技与未来', description: '玻璃、轨道、芯片、粒子和空间界面' },
  { id: 'editorial', name: '平面与品牌', description: '瑞士、包豪斯、海报和高级视觉包装' },
  { id: 'information', name: '信息与科普', description: '数据、流程、结构、地图和知识解释' },
  { id: 'speaker', name: '口播安全区', description: '保护人物和背景的多元素口播包装' },
  { id: 'handmade', name: '手工与文化', description: '拼贴、纸艺、涂鸦、印刷和东方绘画' },
  { id: 'viral', name: '社媒与爆款', description: '高能开场、荒诞广告、Vlog 和节目包装' },
  { id: 'material', name: '三维与材质', description: '微缩、玻璃、软体、晶体和机械装配' },
];

const curatedStyles: MgStylePreset[] = [
  {
    id: 'app-premium-3d',
    name: '高级应用展示',
    category: 'app',
    prompt: 'premium 3D app showcase, soft studio lighting, rounded square app tiles, elegant UI cards, shallow depth, clean gray-white stage, product launch quality',
    guidance: 'Use a diagonal parade of floating app tiles, exact logos/icons when provided, soft shadows, green/blue accent glow, slow camera dolly, tile flip/reorder/reveal. It should feel like a polished product keynote, never like a PPT slide.',
  },
  {
    id: 'app-search-glass',
    name: '搜索框产品片',
    category: 'app',
    prompt: 'clean search product motion, glossy search bar macro shot, glassy white surfaces, subtle brand color trails, minimal interface choreography',
    guidance: 'Build around one hero search/input object. Use macro lens, soft blur, light streaks, cursor pulse, microphone/lens icons, one exact title phrase at most. Keep the frame airy and premium.',
  },
  {
    id: 'app-grid-icons',
    name: '图标矩阵生态',
    category: 'app',
    prompt: 'isometric icon grid ecosystem, many rounded app tiles on a soft matte surface, precise spacing, premium SaaS ecosystem motion',
    guidance: 'Use a grid of elevated icon tiles with alternating white and accent-color faces. Animate with staggered lift, ripple highlight, camera pan, and selective glow. Avoid cluttered labels.',
  },
  {
    id: 'mobile-ui-tour',
    name: '手机界面漫游',
    category: 'app',
    prompt: 'premium mobile UI walkthrough, floating phone screens, gesture trails, clean app navigation, polished screen-to-screen choreography',
    guidance: 'Use one hero phone plus two supporting screens, swipe trails, tap ripples, screen masks, and subtle depth. Keep UI labels minimal and exact; use icons for feature meaning.',
  },
  {
    id: 'saas-dashboard',
    name: 'SaaS 仪表盘',
    category: 'app',
    prompt: 'premium SaaS dashboard motion, modular widgets, KPI cards, animated charts, enterprise-grade information hierarchy',
    guidance: 'Use clean dashboard panels with counters, line charts, status chips, and widget rearrangement. Make the system feel useful and calm, not like colorful analytics clipart.',
  },
  {
    id: 'ai-workflow',
    name: 'AI 工作流界面',
    category: 'app',
    prompt: 'AI workflow motion graphics, prompt input, model nodes, output cards, automation pipeline, polished futuristic product UI',
    guidance: 'Show prompt-to-output transformation through connected nodes, cards, and signal paths. Use clean cyan/green pulses and one hero result reveal; avoid noisy sci-fi decoration.',
  },
  {
    id: 'fintech-payment',
    name: '支付金融 App',
    category: 'app',
    prompt: 'fintech payment app animation, secure cards, transaction flow, balance widgets, trust-building premium UI motion',
    guidance: 'Use cards sliding into a secure flow, lock/check icons, balance counters, and restrained blue/green accents. The design should feel reliable, not casino-like.',
  },
  {
    id: 'ecommerce-product',
    name: '电商功能演示',
    category: 'app',
    prompt: 'ecommerce product showcase motion, product cards, cart flow, offer badges, clean conversion funnel, premium retail UI',
    guidance: 'Animate product cards into a cart, funnel, or checkout path. Use only exact prices/numbers if provided; otherwise rely on icons and object motion.',
  },
  {
    id: 'devtool-pipeline',
    name: '开发者工具流程',
    category: 'app',
    prompt: 'developer tool motion graphics, code blocks as abstract panels, deploy pipeline, API nodes, premium technical product animation',
    guidance: 'Turn code into blocks, blocks into services, services into a successful deploy. Keep snippets abstract unless exact text is supplied; use terminal rhythm without tiny unreadable code.',
  },
  {
    id: 'product-launch-stage',
    name: '产品发布舞台',
    category: 'app',
    prompt: 'premium product launch stage, cinematic reveal, hero object, floating feature cards, clean keynote motion package',
    guidance: 'Use a hero product/object at center with feature cards orbiting in. Slow reveal, elegant shadows, confident pacing. Great for first-shot or brand announcement videos.',
  },
  {
    id: 'neo-grid-objects',
    name: '潮流网格物件',
    category: 'brand-tech',
    prompt: 'bold neo-graphic grid stage, violet grid background, neon green strip, abstract 3D icons, high contrast editorial MG animation',
    guidance: 'Compose with a strict grid, one loud horizontal band, and 3-5 abstract objects. Use snap-to-grid slides, object spin, masked wipes, and color-block rhythm. High design energy, not corporate template.',
  },
  {
    id: 'dark-orbit-tech',
    name: '暗场星轨科技',
    category: 'brand-tech',
    prompt: 'dark cinematic orbital line animation, thin silver ellipses, star particles, black stage, precise technical elegance',
    guidance: 'Use sparse black space, two crossing orbital curves, tiny particle glints, scanning dots, and restrained lens glow. Text, if any, is one exact phrase in the center and must stay crisp.',
  },
  {
    id: 'soft-gradient-title',
    name: '柔光手写标题',
    category: 'brand-tech',
    prompt: 'soft cinematic gradient title card, warm red orange and pale lavender bloom, handwritten Chinese title, gentle film grain',
    guidance: 'Use a blurred luminous gradient background, one exact handwritten-style phrase, gentle scale/ink reveal, small sparkle accent. This style is for emotional openings and section breaks.',
  },
  {
    id: 'swiss-editorial',
    name: '瑞士编辑感',
    category: 'brand-tech',
    prompt: 'Swiss editorial motion graphics, strict typography grid, precise alignment, monochrome with one accent color, museum-grade information design',
    guidance: 'Use modular panels, huge whitespace, thin rules, decisive masks, and one large exact text block. Keep hierarchy sharp; avoid rounded SaaS cards unless the concept needs UI.',
  },
  {
    id: 'glass-ai-interface',
    name: '玻璃 AI 界面',
    category: 'brand-tech',
    prompt: 'premium glassmorphism AI interface, translucent panels, neural paths, soft cyan highlights, depth parallax, refined futuristic motion',
    guidance: 'Use layered glass panes, prompt-to-output flows, node pulses, transparent cards, and slow parallax. Keep it elegant and thin; no noisy cyberpunk clutter.',
  },
  {
    id: 'monochrome-red-accent',
    name: '黑白红点强调',
    category: 'brand-tech',
    prompt: 'monochrome editorial MG animation with one red accent, sharp typography, geometric masks, museum-grade graphic rhythm',
    guidance: 'Use black/white fields, red dots or lines as emphasis, hard cuts, and exact title cards. It should feel like an art direction board, not a business template.',
  },
  {
    id: 'black-gold-launch',
    name: '黑金发布会',
    category: 'brand-tech',
    prompt: 'luxury black gold product launch motion, metallic accents, cinematic light sweeps, elegant particles, premium title package',
    guidance: 'Use black negative space, gold hairlines, metal glints, slow reveals, and restrained typography. Suitable for premium brand moments, not everyday explainer content.',
  },
  {
    id: 'liquid-metal-tech',
    name: '液态金属科技',
    category: 'brand-tech',
    prompt: 'liquid metal technology motion, chrome surfaces, soft reflections, morphing metallic shapes, premium futuristic product film',
    guidance: 'Use metallic blobs or ribbons that morph into icons/cards. Keep reflections smooth and controlled; avoid messy molten effects or over-saturated cyberpunk colors.',
  },
  {
    id: 'microchip-circuit',
    name: '芯片电路流',
    category: 'brand-tech',
    prompt: 'microchip circuit motion graphics, electric traces, precise data packets, modular tiles, premium engineering aesthetic',
    guidance: 'Use PCB-like paths, packet pulses, chip modules, and measured camera moves. Best for AI, computing, security, and infrastructure concepts.',
  },
  {
    id: 'spatial-hologram',
    name: '空间全息界面',
    category: 'brand-tech',
    prompt: 'spatial holographic interface, floating panels in depth, gesture-like motion, translucent UI, premium spatial computing style',
    guidance: 'Use floating panels at different depths, gentle z-axis moves, and hand/gesture metaphors if relevant. Keep the scene bright and refined.',
  },
  {
    id: 'kinetic-infographic',
    name: '高级信息图解',
    category: 'data',
    prompt: 'premium infographic MG animation, kinetic diagrams, elegant arrows, charts, counters, comparison panels, clear visual logic',
    guidance: 'Turn each idea into a visual mechanism: flow, comparison, funnel, stack, loop, timeline, or map. Use icons and numbers more than sentences. Every motion must explain something.',
  },
  {
    id: 'process-flywheel',
    name: '流程飞轮',
    category: 'data',
    prompt: 'business flywheel motion graphic, circular arrows, modular cards, growth loop, premium strategic explainer animation',
    guidance: 'Use a circular loop of 3-5 modules. Animate one module feeding the next, then a full flywheel acceleration. Great for methods, workflows, and growth logic.',
  },
  {
    id: 'comparison-breakdown',
    name: '对比拆解',
    category: 'data',
    prompt: 'premium comparison breakdown, split panels, before-after cards, check and cross icons, precise explanatory motion',
    guidance: 'Use two or three structured panels, with replacement/morphing actions to show difference. Avoid paragraphs; one exact label per side if necessary.',
  },
  {
    id: 'timeline-story',
    name: '时间轴叙事',
    category: 'data',
    prompt: 'timeline story motion graphics, milestones, connecting line, markers, editorial reveal, clear pacing',
    guidance: 'Use a single line or path with milestone cards that reveal in order. Good for history, process, roadmap, and progress stories.',
  },
  {
    id: 'three-step-method',
    name: '三步方法论',
    category: 'data',
    prompt: 'three-step method MG animation, numbered cards, icon-led steps, satisfying snap transitions, clean educational structure',
    guidance: 'Use three stable visual anchors, not many random labels. Let each step transform into the next through shape morphs, arrows, or object handoff.',
  },
  {
    id: 'data-dashboard',
    name: '数据仪表盘',
    category: 'data',
    prompt: 'data dashboard animation, KPI counters, chart builds, heatmap panels, precise enterprise visual design',
    guidance: 'Build data from empty grid to insight. Use counters, line reveals, bars, and one highlighted insight. Only render exact numbers supplied by the user.',
  },
  {
    id: 'system-architecture',
    name: '产品架构图',
    category: 'data',
    prompt: 'system architecture motion, service modules, arrows, data packets, layered infrastructure diagram, premium technical explainer',
    guidance: 'Arrange modules in clear layers. Use packet movement to explain cause and effect. Keep labels symbolic unless exact names are supplied.',
  },
  {
    id: 'map-route',
    name: '地图路径',
    category: 'data',
    prompt: 'map route MG animation, path lines, pins, regions, clean location-based data visualization',
    guidance: 'Use abstract map shapes, animated routes, pins, and region cards. Avoid real geography unless provided; focus on movement and destination logic.',
  },
  {
    id: 'knowledge-cards',
    name: '知识卡片',
    category: 'data',
    prompt: 'knowledge card motion graphics, concept cards, page flips, icon headers, refined educational MG animation',
    guidance: 'Use a small deck of cards that flips, stacks, or expands. Good for explaining terms, lessons, and takeaways without dense text.',
  },
  {
    id: 'numeric-counter',
    name: '数字冲击',
    category: 'data',
    prompt: 'premium numeric counter animation, large exact numbers, kinetic ticks, graph accents, dramatic data reveal',
    guidance: 'Use one exact number as the hero. Build anticipation with ticks, scale, light sweep, and supporting icons. Never invent numbers.',
  },
  {
    id: 'talking-head-premium',
    name: '口播高级包装',
    category: 'talking-head',
    prompt: 'premium talking-head MG overlay package, elegant side graphics, kinetic icons, clean callouts, preserve speaker and background',
    guidance: 'Keep the person untouched. Put graphics in safe side/corner zones, with translucent panels, orbiting icons, thin callout lines, and small beat-synced accents. Never cover face, mouth, eyes, hands, or key props.',
  },
  {
    id: 'side-panel-callouts',
    name: '侧边悬浮卡片',
    category: 'talking-head',
    prompt: 'talking-head side panel callouts, floating cards, thin connector lines, safe-zone layout, polished explainer overlays',
    guidance: 'Use left/right empty areas for cards and icons, with connectors that point near but not over the speaker. Best for口播 with clear bullet-like ideas.',
  },
  {
    id: 'keyword-icon-bursts',
    name: '关键词图形强调',
    category: 'talking-head',
    prompt: 'keyword-driven icon bursts, speech-synced symbols, elastic highlights, premium short-form talking-head graphics',
    guidance: 'Replace long subtitles with icons and one exact keyword. Use quick pops, underlines, rings, and arrows timed to speech. Keep the center face clean.',
  },
  {
    id: 'safe-hud-overlay',
    name: '轻量科技 HUD',
    category: 'talking-head',
    prompt: 'subtle HUD overlay for talking head, thin scanning lines, small data chips, safe zones, refined tech graphics',
    guidance: 'Use corner HUD elements, scanning arcs, and small indicators. It should feel expensive and quiet, not like a game UI.',
  },
  {
    id: 'captionless-visual',
    name: '无字幕视觉包装',
    category: 'talking-head',
    prompt: 'captionless visual packaging, icons and diagrams synced to speech, no subtitle text, clean talking-head enhancement',
    guidance: 'Use diagrams and icons instead of captions. Choose this when text rendering risk is high or when the video already has subtitles.',
  },
  {
    id: 'exact-chinese-title',
    name: '中文锁字标题',
    category: 'text-safe',
    prompt: 'Chinese text-safe title-card motion graphics, exact large Chinese characters, simple high-contrast typography, no extra glyphs',
    guidance: 'Use only the exact quoted Chinese text from the prompt. Large centered glyphs, high contrast, simple reveal. If the model cannot guarantee extra text, omit all non-required labels.',
  },
  {
    id: 'no-text-icon-story',
    name: '无字图形叙事',
    category: 'text-safe',
    prompt: 'textless icon-driven MG storytelling, symbols, arrows, diagrams, UI objects, no generated text except exact numbers',
    guidance: 'Use this when text rendering risk is high. Explain everything through icons, motion, shape relationships, and numbers. Do not generate Chinese labels unless explicitly locked.',
  },
  {
    id: 'paper-editorial-collage',
    name: '报刊拼贴手账',
    category: 'collage',
    prompt: 'editorial paper collage motion, torn paper, sticky notes, polaroids, masking tape, hand drawn icons, refined scrapbook design',
    guidance: 'Use paper layers, tape-stick impacts, page flips, cutout masks, scribble arrows/stars, and tactile shadows. Keep Chinese text to exact short labels only; use icons for detail.',
  },
  {
    id: 'polaroid-tape',
    name: '拍立得胶带',
    category: 'collage',
    prompt: 'polaroid tape collage, photo frames, masking tape, soft paper shadows, playful premium scrapbook motion',
    guidance: 'Use photos/cards taped onto the scene, with tape snaps, frame shakes, and page-turn transitions. Good for storytelling and case examples.',
  },
  {
    id: 'magazine-cutout',
    name: '杂志剪贴版式',
    category: 'collage',
    prompt: 'magazine cutout editorial motion, bold masks, cropped shapes, torn labels, fashion layout rhythm',
    guidance: 'Use large cutout shapes, editorial crops, torn labels, and dramatic mask wipes. Keep it stylish and spacious, not scrapbook clutter.',
  },
  {
    id: 'paper-stage',
    name: '纸片舞台',
    category: 'collage',
    prompt: 'layered paper stage animation, cut paper scenery, dimensional shadows, tactile stop-motion-inspired MG',
    guidance: 'Build a small paper diorama with layered foreground/background. Use paper slides, folds, and pop-up actions for warm narrative explainers.',
  },
  {
    id: 'hand-drawn-doodle',
    name: '手绘涂鸦解释',
    category: 'collage',
    prompt: 'hand-drawn doodle explainer, marker arrows, circles, stars, underline strokes, organic sketch motion',
    guidance: 'Use sketch strokes as annotations, not as messy decoration. Great for casual口播, tutorials, and concept emphasis.',
  },
  {
    id: 'riso-print',
    name: 'Riso 印刷',
    category: 'collage',
    prompt: 'risograph print motion graphics, grainy ink texture, offset colors, bold simple shapes, editorial handmade feel',
    guidance: 'Use limited spot colors, grain, offset registration, and bold silhouettes. Avoid glossy gradients; this is tactile print energy.',
  },
  {
    id: 'creator-pop',
    name: '创作者爆款图形',
    category: 'social',
    prompt: 'creator economy motion graphics, bold stickers, punchy arrows, pop icons, high-energy short-video packaging with premium composition',
    guidance: 'Use fast sticker pops, elastic callouts, icon bursts, and strong rhythm, but keep layout designed: one focal point, one accent system, no random emoji soup.',
  },
  {
    id: 'sticker-bounce',
    name: '贴纸弹跳包装',
    category: 'social',
    prompt: 'sticker bounce MG animation, rounded badges, elastic scale, colorful icons, polished creator video accents',
    guidance: 'Use 3-6 stickers with strong hierarchy, bounce timing, and soft shadows. Good for playful hooks and quick social explanations.',
  },
  {
    id: 'color-block-transition',
    name: '潮流色块转场',
    category: 'social',
    prompt: 'bold color-block transition package, graphic wipes, shape masks, high contrast palette, trend-forward MG',
    guidance: 'Use large geometric wipes and color fields to transition ideas. Keep palette intentional and avoid rainbow randomness.',
  },
  {
    id: 'elastic-icon-system',
    name: '弹性图标系统',
    category: 'social',
    prompt: 'elastic icon system animation, morphing symbols, squash-and-stretch, clean vector rhythm, friendly premium MG',
    guidance: 'Turn concepts into icons that morph into each other. Use springy motion with crisp alignment so it feels designed, not childish.',
  },
  {
    id: 'short-video-impact',
    name: '短视频开场冲击',
    category: 'social',
    prompt: 'short video impact opener, fast kinetic graphics, punchy shape hits, hook-focused motion package',
    guidance: 'Use a strong 0.5s hook, fast scale/blur hits, and one exact hero phrase. Best for openings; avoid running this intensity for the whole clip.',
  },
  {
    id: 'isometric-city',
    name: '等距城市地图',
    category: '3d',
    prompt: 'isometric city map motion graphics, miniature buildings, route lines, service icons, polished explainer diorama',
    guidance: 'Use tiny buildings, roads, pins, and route lines to explain networks, services, logistics, or local business stories.',
  },
  {
    id: 'soft-3d-icons',
    name: '柔光 3D 图标',
    category: '3d',
    prompt: 'soft 3D icon motion, satin plastic materials, floating objects, rounded shapes, premium friendly product animation',
    guidance: 'Use tactile 3D icons with soft lighting and shadows. Good for app features, education, and friendly brand explainers.',
  },
  {
    id: 'miniature-diorama',
    name: '微缩产品舞台',
    category: '3d',
    prompt: 'miniature diorama product stage, tiny scenes, tilt-shift depth, charming premium MG storytelling',
    guidance: 'Build a tiny stage that visualizes the concept with miniature objects. Use slow camera moves and selective focus.',
  },
  {
    id: 'glass-space',
    name: '悬浮玻璃空间',
    category: '3d',
    prompt: 'floating glass spatial scene, transparent panels, refractive surfaces, elegant depth layers, premium interface space',
    guidance: 'Use glass planes, refraction, and layered depth. Good for AI, future interfaces, and abstract product concepts.',
  },
  {
    id: 'product-pedestal',
    name: '产品陈列台',
    category: '3d',
    prompt: '3D product pedestal animation, rotating hero card, display platform, premium showroom lighting',
    guidance: 'Place one hero product/card on a pedestal, then rotate supporting icons around it. Use clean showroom lighting and calm reveals.',
  },
  {
    id: 'apple-spatial-ui',
    name: '空间计算界面',
    category: 'app',
    prompt: 'bright spatial computing interface, luminous glass windows, soft depth, precise gaze and gesture cues, premium operating-system motion',
    guidance: 'Build a bright spatial scene with one hero window, supporting controls at multiple depths, focus expansion, soft parallax, and calm gesture-like transitions. Never copy a real product interface or logo.',
    tags: ['应用展示', '空间', '玻璃'],
    bestFor: 'AI 工具、系统功能、未来交互',
  },
  {
    id: 'terminal-code-cinema',
    name: '代码终端电影感',
    category: 'app',
    prompt: 'cinematic developer terminal motion, abstract code rails, command cards, build pulses, dark precise technical atmosphere',
    guidance: 'Use abstract code lines, terminal panels, status pulses, file blocks, and a clear build-to-result transformation. Keep all code symbolic unless exact snippets are provided.',
    tags: ['开发者', '终端', '流程'],
    bestFor: 'Vibe coding、开发工具、自动化',
  },
  {
    id: 'game-interface',
    name: '游戏界面演示',
    category: 'app',
    prompt: 'premium game interface motion, map panels, inventory tiles, quest markers, polished HUD choreography',
    guidance: 'Use one hero gameplay or map area with inventory, progress, and objective elements moving in a controlled sequence. Avoid noisy gamer overlays and tiny labels.',
    tags: ['游戏', 'HUD', '产品'],
    bestFor: '游戏功能、交互系统、世界观介绍',
  },
  {
    id: 'bauhaus-geometry',
    name: '包豪斯几何',
    category: 'editorial',
    prompt: 'Bauhaus geometric motion, circles bars and primary shapes, strict composition, playful modernist rhythm',
    guidance: 'Use a small set of circles, bars, grids, and cut planes that pass energy from one shape to the next. Keep the composition bold, sparse, and intentionally asymmetrical.',
    tags: ['包豪斯', '几何', '品牌'],
    bestFor: '品牌开场、观点表达、文化内容',
  },
  {
    id: 'brutalist-poster',
    name: '粗野主义海报',
    category: 'editorial',
    prompt: 'brutalist editorial motion poster, oversized blocks, raw grid, hard crops, stark black white and one signal color',
    guidance: 'Use large blocks, hard cuts, raw crops, visible alignment, and one signal color. Treat every frame as a designed poster, not a distressed template.',
    tags: ['海报', '粗野主义', '高对比'],
    bestFor: '潮流、音乐、强观点开场',
  },
  {
    id: 'dream-memory',
    name: '梦境记忆流',
    category: 'editorial',
    prompt: 'poetic dream-memory motion collage, translucent fragments, soft film bloom, drifting objects, elegant emotional montage',
    guidance: 'Use translucent image fragments, slow focus shifts, floating symbolic objects, and gentle dissolves. Richness comes from layered memory cues rather than decorative clutter.',
    tags: ['梦境', '情绪', '电影感'],
    bestFor: '情绪叙事、人物记忆、诗意段落',
  },
  {
    id: 'particle-swarm',
    name: '粒子群聚合',
    category: 'brand-tech',
    prompt: 'premium particle swarm motion, thousands of controlled luminous points, coordinated flocking, precise form emergence',
    guidance: 'Let many particles gather into symbols, data structures, or one hero object, disperse into a path, then reassemble. Motion must feel coordinated and purposeful.',
    tags: ['粒子', '聚合', '科技'],
    bestFor: 'AI、网络、群体智能、数据',
  },
  {
    id: 'domino-chain',
    name: '多米诺因果链',
    category: 'data',
    prompt: 'domino cause-and-effect motion graphic, sequential mechanisms, object handoffs, satisfying chain reaction',
    guidance: 'Turn the explanation into a physical chain reaction: one object triggers the next, energy travels through 5-8 elements, and the final result resolves the whole composition.',
    tags: ['因果', '链路', '机制'],
    bestFor: '流程、方法论、商业逻辑',
  },
  {
    id: 'science-visualization',
    name: '科学可视化',
    category: 'data',
    prompt: 'cinematic scientific visualization, layered diagrams, particles, sectional views, scale transitions, precise educational motion',
    guidance: 'Move between macro and micro scales, combine a hero phenomenon with sectional diagrams, particles, arrows, and measurements. Do not invent scientific labels or claims.',
    tags: ['科普', '微观', '可视化'],
    bestFor: '科学、医学常识、工程解释',
  },
  {
    id: 'architecture-exploded',
    name: '建筑爆炸图',
    category: 'data',
    prompt: 'architectural exploded-view motion, separated layers, structural components, clean axonometric camera, premium spatial explanation',
    guidance: 'Separate a space or object into clear structural layers, orbit the camera gently, highlight one relationship at a time, then reassemble into the final whole.',
    tags: ['建筑', '结构', '爆炸图'],
    bestFor: '空间、硬件、结构和制造',
  },
  {
    id: 'inflatable-objects',
    name: '充气软体世界',
    category: '3d',
    prompt: 'inflatable soft-object motion, air-filled forms, playful squash and stretch, glossy fabric, premium studio lighting',
    guidance: 'Use 4-7 inflated objects that squeeze, bounce, connect, and hand off attention. Keep motion tactile and controlled rather than toy-like chaos.',
    tags: ['软体', '充气', '趣味'],
    bestFor: '年轻品牌、轻松科普、社媒内容',
  },
  {
    id: 'crystal-asmr',
    name: '晶体 ASMR',
    category: '3d',
    prompt: 'crystal material ASMR motion, refractive objects, precise cutting and assembling, macro lighting, satisfying tactile detail',
    guidance: 'Use macro shots of crystals, glass beads, or translucent mechanisms that align, slice, click, and assemble. The sequence should feel satisfying without becoming a single-object loop.',
    tags: ['晶体', 'ASMR', '微距'],
    bestFor: '材质展示、产品细节、感官钩子',
  },
  {
    id: 'mechanical-assembly',
    name: '机械装配演示',
    category: '3d',
    prompt: 'precision mechanical assembly motion, exploded parts, magnetic alignment, clean industrial studio, premium engineering film',
    guidance: 'Introduce components in groups, show their functional relationship, guide them along curved assembly paths, and finish with a working hero mechanism.',
    tags: ['机械', '装配', '工业'],
    bestFor: '硬件、制造、结构原理',
  },
  {
    id: 'absurd-object-ad',
    name: '荒诞物件广告',
    category: 'social',
    prompt: 'high-dopamine absurd object commercial, unexpected scale shifts, playful physical metaphors, premium surreal advertising',
    guidance: 'Start with an impossible object behavior, escalate through several related props and spaces, then land on a clear product or idea payoff. Keep it coherent, not random.',
    tags: ['荒诞', '广告', '高能'],
    bestFor: '爆款开场、产品卖点、反常识观点',
  },
  {
    id: 'pov-vlog-graphics',
    name: 'POV 视角包装',
    category: 'social',
    prompt: 'POV vlog motion package, handheld perspective cues, object interactions, map and notification overlays, fast but legible storytelling',
    guidance: 'Use first-person interactions, object pickups, route cues, reaction icons, and environmental graphics. Keep the interface generic and the scene readable.',
    tags: ['POV', 'Vlog', '纪实'],
    bestFor: '探店、体验、旅行和过程记录',
  },
  {
    id: 'mockumentary-overlay',
    name: '伪纪录片包装',
    category: 'social',
    prompt: 'mockumentary motion graphics, observational camera, evidence cards, timestamps, diagrams, dry comedic timing',
    guidance: 'Combine observational framing with evidence-like cards, arrows, zoom-ins, and restrained comedic beats. Use generic symbols instead of fake legal or news claims.',
    tags: ['伪纪录片', '幽默', '观察'],
    bestFor: '测评、吐槽、幕后和案例复盘',
  },
  {
    id: 'sports-broadcast',
    name: '体育转播包装',
    category: 'social',
    prompt: 'premium sports broadcast motion package, speed trails, tactical diagrams, score modules, energetic camera sweeps',
    guidance: 'Use tactical paths, player/object trails, score-like modules, quick camera sweeps, and replay accents. Never invent scores or team logos.',
    tags: ['体育', '速度', '转播'],
    bestFor: '运动、赛事、效率和竞争主题',
  },
  {
    id: 'ink-wash-motion',
    name: '水墨流动叙事',
    category: 'collage',
    prompt: 'contemporary Chinese ink-wash motion, flowing ink, paper fiber, negative space, restrained color accents',
    guidance: 'Let ink become landscapes, paths, figures, or diagrams; combine several brush events into one visual argument. Preserve generous negative space and avoid decorative pseudo-calligraphy.',
    tags: ['水墨', '东方', '文化'],
    bestFor: '传统文化、历史、诗意叙事',
  },
  {
    id: 'anime-storyboard',
    name: '动画分镜漫画',
    category: 'collage',
    prompt: 'anime storyboard motion, panel layouts, speed lines, character silhouettes, cinematic frame transitions, polished comic rhythm',
    guidance: 'Use 3-6 panels, camera arrows, speed lines, pose silhouettes, and panel-to-full-frame transitions. Keep generated dialogue absent unless exact text is locked.',
    tags: ['动画', '漫画', '分镜'],
    bestFor: '剧情梗概、动作说明、年轻内容',
  },
];

const STYLE_ALIASES: Record<string, string> = {
  'app-001': 'app-premium-3d',
  'app-002': 'app-search-glass',
  'app-003': 'kinetic-infographic',
  'app-004': 'glass-ai-interface',
  'app-005': 'mobile-ui-tour',
  'app-006': 'saas-dashboard',
  'tech-011': 'dark-orbit-tech',
  'collage-021': 'paper-editorial-collage',
  'minimal-031': 'clean-line-explainer',
  'minimal-032': 'swiss-editorial',
  'playful-041': 'creator-pop',
  'data-061': 'kinetic-infographic',
  '3d-081': 'app-premium-3d',
  'text-safe-101': 'exact-chinese-title',
  'text-safe-102': 'no-text-icon-story',
  'text-safe-103': 'no-text-icon-story',
  'text-safe-104': 'talking-head-premium',
  'bold-creator-pop': 'creator-pop',
  'luxury-black-gold': 'black-gold-launch',
};

export const MG_STYLE_PRESETS: MgStylePreset[] = curatedStyles;

const EDITORIAL_STYLE_IDS = new Set([
  'soft-gradient-title',
  'swiss-editorial',
  'monochrome-red-accent',
  'bauhaus-geometry',
  'brutalist-poster',
  'dream-memory',
]);

export function getMgStyleCategoryId(style: MgStylePreset): MgStyleCategoryId {
  if (style.category === 'app') return 'product';
  if (style.category === 'brand-tech') return EDITORIAL_STYLE_IDS.has(style.id) ? 'editorial' : 'tech';
  if (style.category === 'editorial') return 'editorial';
  if (style.category === 'data') return 'information';
  if (style.category === 'talking-head' || style.category === 'text-safe') return 'speaker';
  if (style.category === 'collage') return 'handmade';
  if (style.category === 'social') return 'viral';
  return 'material';
}

export function getMgStylePreview(style: MgStylePreset): {
  src: string;
  categoryId: MgStyleCategoryId;
} {
  const categoryId = getMgStyleCategoryId(style);
  return {
    src: `/omni-style-cards/${style.id}.jpg`,
    categoryId,
  };
}

export function getMgStylePreset(id?: string): MgStylePreset {
  const resolved = id ? (STYLE_ALIASES[id] ?? id) : '';
  return MG_STYLE_PRESETS.find((s) => s.id === resolved) ?? MG_STYLE_PRESETS[0];
}

export function omniMgStylesDoc(limit = MG_STYLE_PRESETS.length): string {
  return MG_STYLE_CATEGORIES.map((category) => {
    const items = MG_STYLE_PRESETS
      .filter((style) => getMgStyleCategoryId(style) === category.id)
      .slice(0, limit)
      .map((style) => `${style.id}=${style.name}${style.bestFor ? `（${style.bestFor}）` : ''}`)
      .join('；');
    return `${category.name}：${items}`;
  }).join('\n');
}

export function omniMgAgentGuide(): string {
  return [
    '',
    '[付费MG动画专用规则]',
    '1. 剪辑窗口第一轮只问一个问题：用户要“网页特效（便宜、可编辑）”还是“付费 MG 动画（AI 视频生成）”。第一轮不要问风格、引擎，不要调用生成工具。',
    '2. 用户选择网页特效后，回到普通 Scene/HTML 工作流，并按网页特效设计指南问风格。',
    '3. 用户选择付费 MG 后，第二轮优先用 ask_user_question 的对话内选项卡询问：生成引擎、风格、花字类型/视频生MG还是纯MG动画/文字生，以及是否需要二次裁切。引擎给三个明确选项：MiniMax H3（默认推荐，2K、5-15秒）、Omni（720p、固定10秒）、Seedance Mini（4-15秒）。用户不选择时才默认 H3，不能静默调用 Seedance 2.0 普通版。',
    '4. 用户确认方案后，调用 timeline_omni_mg_plan/generate 时必须传 engine；多个片段优先调用 timeline_omni_mg_generate_batch 并行生成，不要逐条串行生成。旧工具名只为兼容，不代表强制使用 Omni。',
    '5. 每条 10 秒动画都必须是“有核心概念的丰富系统”：至少一个主视觉、两组辅助元素、清楚的前中后景和元素之间的触发/传递/聚合关系。丰富不等于堆满，禁止单一元素原地循环，也禁止无关素材随机乱飞。',
    '6. 默认节奏是 0-2 秒视觉钩子、2-7 秒多元素展开和因果演示、7-10 秒聚合收束。每个阶段都要写清元素、动作、镜头和转场。',
    '7. 标准 MG 生成必须先做视觉预制：GPT-Image-2 先生成一张包含全部重复元素的母版概念图，再基于母版并行生成 2-4 张同风格关键帧，最后把母版、关键帧和用户原始素材一起交给 H3、Omni 或 Seedance Mini。母版负责锁定元素、色彩、材质和空间语言，派生帧只改变构图、景别和动作阶段。',
    '8. 每个参考素材都必须在提示词中明确使用 @图片一、@图片二、@视频一；编号顺序必须与画布节点上方显示和实际 API 提交顺序一致。禁止后台偷偷加入界面不可见的最终参考素材。',
    '9. 用户连入的人物、文物、产品图片或口播视频始终是主体身份权威，优先级高于 AI 母版。视频生MG必须保护人物身份、五官、发型、表情、口型、动作、声音和背景主体；文物/产品必须保护轮廓、比例、纹理、铭文和关键细节。MG 只负责包装，不得改造主体。',
    '10. 文字不是标准 MG 的主体。优先用图形、图标、物体、界面和空间关系叙事；只允许出现用户明确给出的必要短词，禁止随机中文、乱码、错别字、长句小字和 PPT 式段落。',
    '11. 不做自动评分和自动重生。先把结果交给人判断；用户明确反馈后再定向修复：太简单就增加相关元素组和互动关系，太乱就保留信息但错峰出现，人物/背景变化就收紧保护和安全区，审美不对就换视觉系统而不是堆形容词。',
    '12. 用户反馈“不满意/文字还是错/有错字/乱码/字幕不对/字不对/文案不对/还是不行”时，不要继续反复调 Omni；剪辑视图调用 timeline_mg_text_fallback，画布/普通聊天调用 mg_text_fallback_generate：GPT-Image-2 先生成文字定版图，再用筷子 Seedance 2.0 Mini 图生视频。',
    '13. 普通对话生成 MG 使用 mg_generate_with_reference_boards；画布有 MG/video 节点时也优先使用该工具并传 node_id。不要自行拆成零散生图和生视频调用。',
    'Omni MG 精选风格：',
    omniMgStylesDoc(),
    '',
  ].join('\n');
}

function normalizeDuration(duration?: number): number {
  if (!Number.isFinite(duration)) return 10;
  return Math.min(15, Math.max(4, Math.round(duration!)));
}

function formatBeat(value: number): string {
  return value.toFixed(1);
}

export function buildOmniMgPrompt(args: {
  userPrompt: string;
  styleId?: string;
  accentStyleId?: string;
  duration?: number;
  resolution?: string;
  mode?: 'text' | 'video' | 'image';
  preservePerson?: boolean;
  recipe?: Partial<MgMotionRecipe>;
}): string {
  const style = getMgStylePreset(args.styleId);
  const accentStyle = args.accentStyleId ? getMgStylePreset(args.accentStyleId) : null;
  const recipe = { ...DEFAULT_MG_MOTION_RECIPE, ...args.recipe };
  const duration = normalizeDuration(args.duration);
  const resolution = args.resolution || '720p';
  const hookEnd = Math.max(1, Math.round(duration * 0.2 * 10) / 10);
  const developmentEnd = Math.max(hookEnd + 1, Math.round(duration * 0.7 * 10) / 10);
  const density = recipe.density === 'maximal'
    ? '7-12 active visual elements, introduced in controlled groups'
    : recipe.density === 'rich'
      ? '5-9 active visual elements, introduced in controlled groups'
      : '4-6 active visual elements with generous negative space';
  const spatial = recipe.spatial === '3d'
    ? 'true 3D staging with foreground, midground, background, object depth and camera parallax'
    : recipe.spatial === '2.5d'
      ? 'layered 2.5D staging with foreground accents, a clear hero plane and deep supporting planes'
      : 'graphic 2D staging with strict layers, masks, scale and overlap';
  const rhythm = recipe.rhythm === 'punchy'
    ? 'fast hook, crisp impact beats, short holds, then a clean final lockup'
    : recipe.rhythm === 'steady'
      ? 'measured reveals, smooth handoffs, readable holds and a confident close'
      : 'clear setup, escalation, contrast and payoff with varied beat lengths';
  const relationship = recipe.relationship === 'replace-background'
    ? 'graphics may rebuild the environment, but must preserve any referenced subject'
    : recipe.relationship === 'full-stage'
      ? 'use the full frame as a designed MG stage'
      : 'organize graphics around the subject or hero object and keep its recognition zone clean';
  const material = recipe.material === 'follow-style'
    ? 'follow the selected style material language'
    : recipe.material.replace('soft-3d', 'soft tactile 3D').replace('graphic', 'flat graphic print');
  const preserve = args.preservePerson !== false
    ? [
        'REFERENCE VIDEO PROTECTION:',
        '- If a reference video contains a person, preserve the original identity, face, facial features, hairstyle, expression, lip sync, body motion, and voice exactly.',
        '- Do not cover the eyes, face, mouth, hands, or important props.',
        '- Keep the original background largely unchanged unless the user explicitly asks for replacement.',
        '- Add MG design as foreground/safe-zone graphics, side panels, icons, callouts, or subtle overlays.',
      ].join('\n')
    : '';

  return [
    `You are a world-class motion-graphics director creating a premium, idea-led ${resolution} MG animation.`,
    `Duration: ${duration}s. Resolution: ${resolution}. Aspect ratio follows the request.`,
    `The deliverable is a complete ${duration}-second piece, not a loop, slideshow, or single-object demo.`,
    '',
    'TEXT LOCK - HIGHEST PRIORITY:',
    '- Visible text must be exactly the same as the user-provided wording. Do not paraphrase, translate, simplify, add, misspell, or invent text.',
    '- Never generate random Chinese, mojibake, fake UI labels, dense subtitles, or unreadable small text.',
    '- If exact rendering is uncertain, use no text and communicate with icons, symbols, shapes, numbers, arrows, UI objects, charts, and motion metaphors.',
    '- Important Chinese text may appear only as 1-4 large characters or one explicitly quoted short phrase. Keep it centered/clean/high contrast.',
    '',
    `SELECTED STYLE: ${style.name}`,
    `Style language: ${style.prompt}.`,
    `Design direction: ${style.guidance}`,
    accentStyle && accentStyle.id !== style.id
      ? `ACCENT STYLE (20% maximum): ${accentStyle.name}. Borrow only one material or transition trait from it; the primary style remains dominant.`
      : '',
    '',
    'MOTION RECIPE:',
    `- Visual density: ${density}.`,
    `- Space: ${spatial}.`,
    `- Rhythm: ${rhythm}.`,
    `- Scene relationship: ${relationship}.`,
    `- Material: ${material}.`,
    '',
    `${duration}-SECOND CHOREOGRAPHY:`,
    `- 0.0-${formatBeat(hookEnd)}s HOOK: introduce one unmistakable hero idea plus at least two supporting visual cues. Use an immediate transformation, scale surprise, input reaction, material event, or spatial reveal.`,
    `- ${formatBeat(hookEnd)}-${formatBeat(developmentEnd)}s DEVELOPMENT: expand into two coordinated element groups. Show cause and effect through handoff, orbit, connection, assembly, comparison, propagation, or transformation. Stagger entries so richness stays readable.`,
    `- ${formatBeat(developmentEnd)}-${formatBeat(duration)}s PAYOFF: bring the separate elements into one final system, result, conclusion, or hero composition. Resolve motion cleanly instead of ending mid-action.`,
    '',
    'ELEMENT SYSTEM - REQUIRED:',
    '- Define a hero element, 2-3 secondary element families, 1 connective motion language, and 1 recurring visual motif.',
    '- Every supporting element must explain, reinforce, or react to the central idea. No random confetti, unrelated floating cards, filler particles, or decorative clutter.',
    '- Avoid PPT-like page switching and single-element repetition. Use masks, parallax, curved paths, staggered timing, shape morphs, camera changes, and designed transitions only when they support meaning.',
    '- Keep one focal point at every moment while allowing the overall sequence to feel abundant and alive.',
    preserve,
    args.mode === 'text'
      ? 'MODE: Text-to-video. Turn the copy into a complete MG animation with clear visual progression.'
      : 'MODE: Reference-media editing. Use the reference media as the visual base and add MG design without damaging the original content.',
    '',
    'USER REQUIREMENT / EXACT COPY:',
    args.userPrompt,
  ].filter(Boolean).join('\n');
}

export function buildOmniMgPolishSystemPrompt(duration = 10): string {
  const safeDuration = Math.min(15, Math.max(4, Math.round(duration)));
  const hookEnd = Math.max(1, Math.round(safeDuration * 0.2 * 10) / 10);
  const developmentEnd = Math.max(hookEnd + 1, Math.round(safeDuration * 0.7 * 10) / 10);
  const densityGuide = safeDuration <= 6 ? '4-7' : '5-9';
  return [
    `你是大师级 MG 动效导演，负责把用户要求编译为可执行的 ${safeDuration} 秒视频生成提示词。只输出最终提示词，不解释，也不要用 Markdown 代码块。`,
    '第一优先级是文字准确：所有可见文字必须与用户原文完全一致；不要改写、翻译、增删、造词；不要生成随机中文、乱码、小字长句。若无法保证文字正确，就改用图标、符号、数字、箭头、UI 物件和运动隐喻表达。',
    '提示词必须像真实动效导演写 brief：先提炼一个核心视觉概念，再定义主视觉、两至三组辅助元素、元素之间的因果/传递/聚合关系、前中后景、镜头、材质、色彩和运动节奏。',
    `固定写清三段时间编排：0-${hookEnd} 秒钩子，${hookEnd}-${developmentEnd} 秒多元素展开，${developmentEnd}-${safeDuration} 秒聚合收束。每一段都说明出现什么、怎么动、镜头怎么配合、如何进入下一段。`,
    `默认做丰富多元素效果：${densityGuide} 个活跃元素分组错峰出现，不能只让一个物件原地变形，也不能把无关卡片、粒子和贴纸随机堆满。每个元素都必须服务核心概念。`,
    '避免 PPT、模板感、泛泛的“高级感”和纯形容词堆砌。把抽象形容词落实为构图、材质、运动曲线、景深、光线和转场动作。',
    '视频生 MG 时必须写明保护原人物身份、五官、发型、表情、口型、动作、声音和背景主体；不遮挡人脸。',
    '除非用户明确要求，不做自动评分、不写自检分数、不要求自动重生。结果由人判断，收到用户具体反馈后再定向修改。',
  ].join('\n');
}
