import { nanoid } from 'nanoid';
import { animatedJoints } from './playback';
import type { DirectorActionId, DirectorMotionKeyframe, Vec3 } from './types';

export type MotionCategory = '基础' | '走位' | '视线' | '交流' | '手部' | '姿态' | '情绪' | '专项';

export interface MotionTemplate {
  id: DirectorActionId;
  label: string;
  category: MotionCategory;
  description: string;
  defaultDurationSec: number;
  moving?: boolean;
  suggestedDistance?: number;
  loopable?: boolean;
}

const row = (category: MotionCategory, items: Array<[DirectorActionId, string, string, number, boolean?, number?]>): MotionTemplate[] =>
  items.map(([id, label, description, defaultDurationSec, moving, suggestedDistance]) => ({ id, label, category, description, defaultDurationSec, moving, suggestedDistance }));

export const MOTION_TEMPLATES: MotionTemplate[] = [
  ...row('基础', [
    ['stand', '站立', '稳定站姿', 2], ['wait', '等待', '带轻微呼吸的等待', 2], ['idle-breathe', '自然呼吸', '克制的待机呼吸', 3],
    ['stop', '停步', '从运动中收住重心', 0.8], ['turn', '转身', '身体与视线共同转向', 1.2],
  ]),
  ...row('走位', [
    ['walk', '行走', '自然步速走位', 2.5, true, 2], ['fast-walk', '快走', '目的明确的快步', 2, true, 2.6], ['run', '跑动', '快速跑动', 1.8, true, 3.2],
    ['step-forward', '向前一步', '小范围靠近', 1, true, 0.7], ['step-back', '后退一步', '警惕或让位', 1, true, -0.7],
    ['follow', '跟随', '跟随另一人物的空间节奏', 2.5, true, 2], ['pass-by', '擦肩而过', '从另一人物身侧通过', 2.2, true, 2.4], ['dodge', '闪避', '快速侧向躲避', 0.9, true, 1.2],
  ]),
  ...row('视线', [
    ['look-up', '抬眼', '由低处抬起视线', 0.9], ['look-down', '低头', '视线和头部向下', 0.9], ['look-at', '注视', '稳定看向目标', 1.2],
    ['look-back', '回望', '头肩先后回转', 1.1], ['glance', '快速一瞥', '短促看向侧方后收回', 0.7], ['inspect', '仔细观察', '小幅扫视目标细节', 1.8],
  ]),
  ...row('交流', [
    ['speak', '说话', '克制的口头表达手势', 2], ['listen', '倾听', '身体微向说话者开放', 2], ['nod', '点头', '确认式点头', 0.8],
    ['shake-head', '摇头', '否定式摇头', 0.9], ['face-to-face', '面对面', '建立双人交流朝向', 1.2], ['hand-over', '递交', '将手中物递向目标', 1.2], ['receive', '接取', '伸手接过物品', 1.2],
  ]),
  ...row('手部', [
    ['reach', '伸手', '手臂伸向目标', 1], ['hold', '托持', '双手稳定托住物体', 1.4], ['pick-up', '拿起', '俯身或伸手拿起物体', 1.3],
    ['put-down', '放下', '将物体稳定放下', 1.3], ['point', '指向', '明确指向目标', 1], ['wave', '挥手', '招呼式挥手', 1.2], ['raise-hand', '抬手', '抬起一只手', 0.8],
    ['clap', '鼓掌', '连续两到三次鼓掌', 1.4], ['knock', '敲击', '手部连续敲击', 1.1], ['phone', '接听电话', '抬手贴近耳侧', 1.5], ['drink', '饮用', '抬手饮用后放回', 1.8],
  ]),
  ...row('姿态', [
    ['sit', '坐下', '重心后移坐下', 1.5], ['stand-up', '起身', '从坐姿恢复站立', 1.5], ['crouch', '蹲下', '降低重心观察', 1.2],
    ['kneel', '跪下', '单膝落地', 1.4], ['lie-down', '躺下', '身体落向地面', 1.8], ['bow', '鞠躬', '上身前倾后恢复', 1.3],
    ['cross-arms', '抱臂', '双臂收于胸前', 1.2], ['hands-on-hips', '叉腰', '双手落于腰侧', 1.2],
  ]),
  ...row('情绪', [
    ['hesitate', '迟疑', '欲言又止的小动作', 1.5], ['hug', '拥抱', '向目标张臂靠近', 1.8], ['fall', '跌倒', '失去重心倒地', 1.2], ['get-up', '爬起', '从地面恢复站立', 1.8],
  ]),
  ...row('专项', [
    ['read', '阅读', '双手持卷或书阅读', 2], ['write', '书写', '一手扶持一手落笔', 2], ['sew', '缝纫', '低头双手连续走针', 2],
    ['open-door', '开门', '伸手并拉开门', 1.5], ['close-door', '关门', '转身将门合上', 1.4], ['push', '推物', '双手向前施力', 1.5], ['pull', '拉物', '重心后移拉动物体', 1.5],
    ['enter-car', '进入车辆', '靠近并进入车辆', 2.2, true, 1.5], ['exit-car', '离开车辆', '从车辆中出来并站稳', 2.2, true, 1.5],
  ]),
];

export function motionTemplate(id: DirectorActionId): MotionTemplate {
  return MOTION_TEMPLATES.find((item) => item.id === id) ?? { id, label: id, category: '基础', description: '基础动作', defaultDurationSec: 1.5 };
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function createMotionKeyframes(action: DirectorActionId, durationSec: number, from: Vec3, to: Vec3, source: DirectorMotionKeyframe['source'] = 'template'): DirectorMotionKeyframe[] {
  const times = [0, 0.18, 0.5, 0.82, 1];
  return times.map((progress, index) => ({
    id: `kf-${nanoid(7)}`,
    timeSec: Number((durationSec * progress).toFixed(3)),
    position: lerpVec(from, to, progress),
    joints: animatedJoints(action, progress, durationSec),
    interpolation: index === 0 || index === times.length - 1 ? 'ease-out' : 'smooth',
    source,
    note: index === 0 ? '起势' : index === times.length - 1 ? '收势' : index === 2 ? '动作峰值' : undefined,
  }));
}
