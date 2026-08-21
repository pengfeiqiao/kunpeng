/**
 * presets/index — 预设注册表 + agent 文档生成。
 */
import { MG_PRESETS, type PresetDef } from './mg';
import { TALKING_PRESETS } from './talking';
import { INFO_PRESETS } from './infopage';
import { WEB_PRESETS } from './webgrade';
import { COMPOSITION_PRESETS } from './composition';
import { STYLED_PRESETS } from './styled';
import { SIGNATURE_PRESETS } from './signature';
import { DEMO_CONCEPT_PRESETS } from './demoConcept';
import { DEMO_MEDIA_PRESETS } from './demoMedia';
import type { SceneSpec } from '../spec';

export type { PresetDef };

export const SCENE_PRESETS: PresetDef[] = [
  ...DEMO_CONCEPT_PRESETS,
  ...DEMO_MEDIA_PRESETS,
  ...SIGNATURE_PRESETS,
  ...MG_PRESETS,
  ...TALKING_PRESETS,
  ...INFO_PRESETS,
  ...WEB_PRESETS,
  ...COMPOSITION_PRESETS,
  ...STYLED_PRESETS,
];

export function findScenePreset(id: string): PresetDef | undefined {
  return SCENE_PRESETS.find((p) => p.id === id);
}

export function buildScenePreset(id: string, params: Record<string, unknown>, durationSec?: number): SceneSpec | null {
  const preset = findScenePreset(id);
  if (!preset) return null;
  const duration = Math.max(0.5, Math.min(15, durationSec ?? preset.defaultDuration));
  return preset.build(params ?? {}, duration);
}

/** 生成 timeline_add_scene 工具描述用的预设清单 */
export function scenePresetsDoc(): string {
  const groups = new Map<string, PresetDef[]>();
  for (const p of SCENE_PRESETS) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group)!.push(p);
  }
  return [...groups.entries()]
    .map(([g, ps]) => `【${g}】\n${ps.map((p) => `- ${p.id}（${p.label}）参数 ${p.paramsDoc}`).join('\n')}`)
    .join('\n');
}
