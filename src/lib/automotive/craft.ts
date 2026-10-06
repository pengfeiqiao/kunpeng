/** Editorial guidance only: no tool execution, provider routing or user-memory writes. */
export const AUTOMOTIVE_CRAFT_POLICY = `汽车创作按任务选方法：先确定受众处境、传播目的、可核实卖点及用户已定的车型/参考，再选择人物故事、生活观察、产品演示、造型光影、喜剧、旅途或感官诗性；不强制空镜开场、黄金时刻、反转、家庭煽情和固定镜数。文案用具体行为与选择承载价值；画面给证据，旁白补未说出的关系或视角，不逐句复述画面，不堆“突破/不止/从容/定义”等可互换口号。用户只改文案或提示词时不得调用生成。内置案例仅用匿名编号，不恢复来源品牌、车型专名、明星名或片名；案例只学机制，不复制情节和口号、不推定获奖或官方身份，不把成片效果当车辆性能证明。`;

export const AUTOMOTIVE_VISUAL_POLICY = `汽车视觉只在汽车任务启用：车型身份以用户定版参考为准，锁车身比例、灯组、格栅、轮毂、传感器实际配置和车漆；不可见部位标待确认，不凭新能源标签新增雷达。区分资产棚拍、单镜图像、时间镜头、整片脚本：单图只描述一个瞬间，不塞多段运镜；视频分别交代车的路径/速度变化、相机相对方位/高度/跟随关系、可见背景视差和动作结束状态，每段一种主运动。轮胎接地、滚动/转向、惯性与路面/光源/反射一致；公路交通方向由场景地域确认，不把画面左右当世界方向。驾驶人物全程正确系好安全带，肩带斜跨胸前、腰带贴合髋部并扣紧；不得仅留在负面提示中，英文输出同义明确表达。纯车辆空镜不新增人物。白模只验证空间、路径、遮挡与时机，车型外观仍由资产图约束；镜头参数是复现建议，不是假称原片实测。`;

export const AUTOMOTIVE_SHOT_POLICY = `汽车分镜每镜写清叙事作用、入镜状态、持续变化、结束接点，分开车辆路径与相机运动，复用已有分镜字段。路跑先选同速侧跟、侧前领拍、固定掠过、弯道跟随、高位路线、轮胎细节或逐渐超越之一；同速等距时车占幅稳定而近远景有不同视差，固定机位允许车辆进出画，超越必须改变相对位置，弯道车头沿路径切线且前轮转向。普通转弯不自动漂移，多镜剪辑不写成一次环绕。单图只写瞬间；时间镜头写动作结束状态，不要求生成首尾帧。先从 references/road-running-case-lessons.md 按叙事意图选1—3条有片例与近似时间证据的经验，借用镜头关系而非照抄剧情；再读 references/road-running-shots.md 写具体机位，不把跨镜剪辑当一次连续运镜。细写时读 references/road-running-close-reads/index.md，对照主体占幅、可见侧面、近远视差和遮挡恢复，说明与前后镜的信息关系；用户只改机位时保持车型、道路、人物、剧情与安全带约束。`;

const VEHICLE = /汽车|车辆|车型|车身|车灯|轮毂|驾[驶趣]|座舱|车内|车头|车尾|路跑|跟车|领拍|智驾|试驾|越野车|轿车|轿跑|房车|皮卡|\b(?:suv|mpv|sedan|automotive|car|vehicle)\b|奥迪|阿维塔|腾势|蔚来|理想[li]\d|宝马|奔驰|领克|小鹏|问界|保时捷|雷克萨斯|福特|起亚/i;
const CREATIVE = /文案|剧本|脚本|分镜|镜头|拉片|路跑|跟车|跟拍|领拍|广告|品牌片|tvc|commercial|提示词|prompt|运镜|白模|预演|blender|生图|生视频|构图|画面|拍摄|创作|润色|改写|场景|海报|宣传|设计|故事|造型/i;
export function isAutomotiveCreativeTask(task: string): boolean {
  if (/修复|\bbug\b|编译|接口报错|单元测试|代码重构/.test(task) && !/写.*(?:剧本|文案)|创作/.test(task)) return false;
  return VEHICLE.test(task) && CREATIVE.test(task);
}
export function buildAutomotiveContext(task: string): string {
  if (!isAutomotiveCreativeTask(task)) return '';
  const writing = /文案|剧本|脚本|故事|广告|品牌片|tvc/i.test(task);
  const shots = /分镜|镜头|拉片|路跑|跟车|跟拍|领拍|掠过|弯道|运镜|提示词|prompt|storyboard|tracking|driving shot/i.test(task);
  return `## 汽车TVC创作方法\n${writing ? AUTOMOTIVE_CRAFT_POLICY + '\n' : ''}${AUTOMOTIVE_VISUAL_POLICY}${shots ? '\n' + AUTOMOTIVE_SHOT_POLICY : ''}\n需要展开时读取 car-commercial-storyboard：文案用 references/writing-method.md，画面与提示词用 references/visual-method.md，按 references/tvc-2026/index.md 找相符片例；复杂空间运镜用 blender-clay-previz。按需读取，不把整库塞进每轮上下文。`;
}
