import { nanoid } from 'nanoid';
import type { FxClip, TextClip } from '@/stores/editorStore';

const STORAGE_KEY = 'kunpeng.editor.customPresets.v1';

export const CUSTOM_PRESETS_UPDATED_EVENT = 'kunpeng-editor-custom-presets-updated';

export interface CustomTextPreset {
  id: string;
  kind: 'text';
  label: string;
  text: string;
  templateId: string;
  position: TextClip['position'];
  customPos?: TextClip['customPos'];
  styleOverrides?: TextClip['styleOverrides'];
  duration: number;
  createdAt: number;
}

export interface CustomFxPreset {
  id: string;
  kind: 'fx';
  label: string;
  html: string;
  css: string;
  componentId?: string;
  params?: Record<string, unknown>;
  theme?: string;
  transform?: FxClip['transform'];
  duration: number;
  createdAt: number;
}

export type CustomEditorPreset = CustomTextPreset | CustomFxPreset;

function readRawPresets(): CustomEditorPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPresetLike) : [];
  } catch {
    return [];
  }
}

function isPresetLike(value: unknown): value is CustomEditorPreset {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CustomEditorPreset>;
  return (item.kind === 'text' || item.kind === 'fx') && typeof item.id === 'string';
}

function writePresets(presets: CustomEditorPreset[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  window.dispatchEvent(new CustomEvent(CUSTOM_PRESETS_UPDATED_EVENT));
}

export function readCustomPresets() {
  return readRawPresets().sort((a, b) => b.createdAt - a.createdAt);
}

export function saveCustomTextPreset(clip: TextClip): CustomTextPreset {
  const preset: CustomTextPreset = {
    id: `ctp-${nanoid(8)}`,
    kind: 'text',
    label: clip.text.trim().slice(0, 18) || '我的花字',
    text: clip.text,
    templateId: clip.templateId,
    position: clip.position,
    customPos: clip.customPos,
    styleOverrides: clip.styleOverrides,
    duration: Math.max(0.3, clip.endSec - clip.startSec),
    createdAt: Date.now(),
  };
  writePresets([preset, ...readRawPresets()]);
  return preset;
}

export function saveCustomFxPreset(clip: FxClip): CustomFxPreset {
  const preset: CustomFxPreset = {
    id: `cfp-${nanoid(8)}`,
    kind: 'fx',
    label: clip.label || '我的特效',
    html: clip.html,
    css: clip.css,
    componentId: clip.componentId,
    params: clip.params,
    theme: clip.theme,
    transform: clip.transform,
    duration: Math.max(0.3, clip.duration),
    createdAt: Date.now(),
  };
  writePresets([preset, ...readRawPresets()]);
  return preset;
}

export function deleteCustomPreset(id: string) {
  writePresets(readRawPresets().filter((preset) => preset.id !== id));
}
