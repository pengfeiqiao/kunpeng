/**
 * cameraPresets — Lens Combo style prompt dictionary (TapNow/LibTV 逆向).
 * Each entry's `body` is the text appended to the prompt on selection.
 */
export interface CameraCombo {
  id: string;
  label: string;
  scene: string;
  body: string;
}

export const CAMERA_COMBOS: CameraCombo[] = [
  { id: 'portrait-85', label: '人像特写', scene: '人物情绪', body: 'Sony Venice 电影机，85mm f/1.8 定焦，浅景深虚化背景，人物面部细节锐利' },
  { id: 'product-24', label: '产品全景', scene: '电商产品', body: '广角 24mm f/8 大景深，产品全貌清晰，商业摄影布光' },
  { id: 'scene-50', label: '标准场景', scene: '环境叙事', body: '标准 50mm f/4 镜头，自然视角，环境与主体平衡' },
  { id: 'env-portrait-35', label: '环境人像', scene: '人物+环境', body: '35mm f/2 镜头，人物与环境共存，街头摄影质感' },
  { id: 'macro-100', label: '微距细节', scene: '材质特写', body: '100mm 微距镜头，极浅景深，材质纹理纤毫毕现' },
  { id: 'anamorphic', label: '宽银幕电影', scene: '电影感', body: '变形宽银幕镜头（Anamorphic），椭圆焦外光斑，水平拉丝眩光，2.39:1 电影质感' },
  { id: 'leica-doc', label: '徕卡纪实', scene: '纪实人文', body: '徕卡 Summilux 35mm f/1.4，胶片颗粒感，纪实人文色调' },
  { id: 'drone-wide', label: '航拍广角', scene: '宏大场面', body: '无人机航拍视角，超广角 16mm，高空俯瞰，宏大空间感' },
  { id: 'vintage-helios', label: '旋焦复古', scene: '梦幻氛围', body: 'Helios 58mm f/2 老镜头，旋转焦外，复古暖调，梦幻氛围' },
  { id: 'tele-200', label: '长焦压缩', scene: '紧张/窥视', body: '200mm 长焦，空间压缩感强烈，背景拉近，窥视般的紧张感' },
  { id: 'fisheye', label: '鱼眼冲击', scene: '夸张张力', body: '8mm 鱼眼镜头，强烈桶形畸变，视觉冲击力拉满' },
  { id: 'goldenhour', label: '黄金时刻', scene: '逆光氛围', body: '黄金时刻自然光，低角度暖阳逆光，轮廓光勾边，长投影' },
];

export interface CameraMove {
  id: string;
  label: string;
  body: string;
  kinds: ('image' | 'video')[];
}

export const CAMERA_MOVES: CameraMove[] = [
  { id: 'dolly-in', label: '推镜', body: '镜头缓慢推近（Dolly-in），逐渐聚焦主体', kinds: ['video'] },
  { id: 'dolly-out', label: '拉镜', body: '镜头缓慢拉远（Dolly-out），逐渐展现环境全貌', kinds: ['video'] },
  { id: 'pan', label: '摇镜', body: '镜头水平摇移（Pan），扫过场景', kinds: ['video'] },
  { id: 'tilt', label: '俯仰', body: '镜头垂直俯仰（Tilt），由下至上展现主体', kinds: ['video'] },
  { id: 'truck', label: '横移', body: '镜头水平横移（Truck），与主体平行移动', kinds: ['video'] },
  { id: 'pedestal', label: '升降', body: '镜头垂直升降（Pedestal），缓慢上升俯瞰', kinds: ['video'] },
  { id: 'orbit', label: '环绕', body: '镜头环绕主体旋转（Orbit），360 度展示', kinds: ['video'] },
  { id: 'follow', label: '跟拍', body: '镜头跟随主体移动（Follow），保持构图稳定', kinds: ['video'] },
  { id: 'handheld', label: '手持', body: '手持镜头轻微晃动，纪实临场感', kinds: ['video'] },
  { id: 'steadicam', label: '斯坦尼康', body: '斯坦尼康稳定器长镜头，丝滑流畅移动', kinds: ['video'] },
  { id: 'dollyzoom', label: '希区柯克变焦', body: '希区柯克变焦（Dolly zoom），背景空间扭曲，主体不变，眩晕紧张感', kinds: ['video'] },
  { id: 'whippan', label: '甩镜', body: '快速甩镜转场（Whip pan），动感强烈', kinds: ['video'] },
  { id: 'crashzoom', label: '急推', body: '急速推近（Crash zoom），瞬间聚焦，冲击力强', kinds: ['video'] },
  { id: 'aerial', label: '航拍俯冲', body: '无人机航拍俯冲，从高空快速下降接近主体', kinds: ['video'] },
  { id: 'lowangle', label: '低角度仰拍', body: '低角度仰拍，主体高大威严', kinds: ['image', 'video'] },
  { id: 'overshoulder', label: '越肩', body: '越肩镜头（Over-the-shoulder），对话与对峙构图', kinds: ['image', 'video'] },
  { id: 'pov', label: '第一人称', body: '第一人称视角（POV），沉浸式代入', kinds: ['image', 'video'] },
  { id: 'arc', label: '弧线运动', body: '镜头弧线运动（Arc），围绕主体画弧，空间立体感', kinds: ['video'] },
  { id: 'slowpush', label: '缓推特写', body: '镜头极缓慢推近至面部特写，情绪渐强', kinds: ['video'] },
  { id: 'static', label: '固定机位', body: '固定机位（Static shot），构图稳定，让动作在画框内发生', kinds: ['image', 'video'] },
];
