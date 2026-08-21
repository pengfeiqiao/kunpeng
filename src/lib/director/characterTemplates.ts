export interface CharacterPerformanceTemplate {
  id: string;
  label: string;
  description: string;
  motionScale: number;
  personalSpaceM: number;
  defaultPoseId: string;
}

export const CHARACTER_PERFORMANCE_TEMPLATES: CharacterPerformanceTemplate[] = [
  { id: 'neutral', label: '自然写实', description: '动作幅度自然，适合多数剧情', motionScale: 1, personalSpaceM: 0.8, defaultPoseId: 'stand' },
  { id: 'restrained', label: '克制内敛', description: '减少肢体幅度，以头眼和重心表达', motionScale: 0.72, personalSpaceM: 0.9, defaultPoseId: 'stand' },
  { id: 'confident', label: '沉稳自信', description: '身体开放，动作明确而不过度', motionScale: 0.92, personalSpaceM: 1, defaultPoseId: 'stand' },
  { id: 'energetic', label: '敏捷外放', description: '动作速度快、幅度更明显', motionScale: 1.28, personalSpaceM: 0.75, defaultPoseId: 'stand' },
  { id: 'nervous', label: '紧张警觉', description: '动作偏碎，视线与肩颈反应更强', motionScale: 1.12, personalSpaceM: 1.15, defaultPoseId: 'headdown' },
  { id: 'tired', label: '疲惫迟缓', description: '重心偏低，动作启动和收势更慢', motionScale: 0.68, personalSpaceM: 0.75, defaultPoseId: 'lean' },
  { id: 'authoritative', label: '威严庄重', description: '减少多余动作，保持稳定空间占位', motionScale: 0.82, personalSpaceM: 1.25, defaultPoseId: 'stand' },
  { id: 'casual', label: '松弛生活化', description: '轻微重心偏移和不对称站姿', motionScale: 0.88, personalSpaceM: 0.7, defaultPoseId: 'lean' },
];

export function characterPerformanceTemplate(id?: string): CharacterPerformanceTemplate {
  return CHARACTER_PERFORMANCE_TEMPLATES.find((item) => item.id === id) ?? CHARACTER_PERFORMANCE_TEMPLATES[0];
}
