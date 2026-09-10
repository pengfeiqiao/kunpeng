import { CANVAS_IMAGE_ENGINES, CANVAS_VIDEO_ENGINES } from '../rhtv/canvasEngines.ts';
import type { RhtvCanvasEngine } from '../rhtv/types';
import { MIDJOURNEY_VERSIONS, getMidjourneyParameterDefaults } from '../midjourney/prompt.ts';
import type { WorkspaceDraft } from './types.ts';

const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const mj = getMidjourneyParameterDefaults();

/** Presentation schemas only. Dedicated routes stay in canvasGen, not in the RH registry. */
export const WORKSPACE_ENGINES: RhtvCanvasEngine[] = [
  { id: 'gpt-image-2.5', label: 'GPT Image 2.5', endpoint: '', kind: 'image', mode: 'image-to-image',
    imageParam: { key: 'imageUrls', multiple: true }, params: [
      { key: 'aspectRatio', label: '比例', type: 'list', default: '16:9', options: ratios },
      { key: 'resolution', label: '分辨率', type: 'list', default: '2k', options: ['1k', '2k', '4k'] },
    ] },
  ...CANVAS_IMAGE_ENGINES.map((engine) => ({ ...engine, imageParam: { key: 'imageUrls', multiple: true } })),
  ...MIDJOURNEY_VERSIONS.map(({ value, label }): RhtvCanvasEngine => ({
    id: `midjourney-${value}`, label: `Midjourney ${label}`, endpoint: '', kind: 'image', mode: 'image-to-image',
    imageParam: { key: 'imageUrls', multiple: true }, params: [
      { key: 'aspectRatio', label: '比例', type: 'list', default: '16:9', options: ratios },
      { key: 'stylize', label: '风格化', type: 'int', default: mj.stylize },
      { key: 'chaos', label: '混沌度', type: 'int', default: mj.chaos },
    ],
  })),
  { id: 'dreamina-seedance-2.5', label: 'Seedance 2.5', endpoint: '', kind: 'video', mode: 'multimodal-video',
    imageParam: { key: 'imageUrls', multiple: true }, videoParam: { key: 'videoUrls', multiple: true }, audioParam: { key: 'audioUrls', multiple: true },
    params: [
      { key: 'ratio', label: '比例', type: 'list', default: '16:9', options: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] },
      { key: 'duration', label: '时长', type: 'list', default: '5', options: Array.from({ length: 27 }, (_, i) => String(i + 4)) },
      { key: 'resolution', label: '分辨率', type: 'list', default: '480p', options: ['480p', '720p'] },
    ] },
  ...CANVAS_VIDEO_ENGINES,
];

/** 旧引擎 id → 现役 id 的读取层别名（存量草稿/任务记录不改数据文件）。 */
export function canonicalWorkspaceEngineId(id: string): string {
  if (id === 'gpt-image-2' || id === 'gpt-image-2-i2i') return id === 'gpt-image-2' ? 'gpt-image-2.5' : 'gpt-image-2.5-i2i';
  return id;
}

export function workspaceEngine(id: string): RhtvCanvasEngine | undefined {
  const canonical = canonicalWorkspaceEngineId(id) !== id ? canonicalWorkspaceEngineId(id)
    : id === 'minimax-h3' ? 'minimax-hailuo-h3' : id === 'seedance-2.5' ? 'dreamina-seedance-2.5'
    : id === 'midjourney' ? 'midjourney-v8.2' : id.replace(/^midjourney-v(\d)(\d)$/, 'midjourney-v$1.$2');
  const engine = WORKSPACE_ENGINES.find((item) => item.id === canonical);
  // Keep a historical route alias intact; canvasGen already understands it.
  return engine && engine.id !== id ? { ...engine, id } : engine;
}

/** Freeze displayed defaults into confirmation and history without silently changing explicit values. */
export function materializeWorkspaceDefaults(draft: WorkspaceDraft): WorkspaceDraft {
  const params = { ...draft.params };
  for (const param of workspaceEngine(draft.engineId)?.params ?? []) {
    if (params[param.key] == null && param.default !== undefined) params[param.key] = param.default;
  }
  return { ...draft, params, references: draft.references.map((ref) => ({ ...ref })) };
}
