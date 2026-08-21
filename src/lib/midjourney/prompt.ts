export const MIDJOURNEY_VERSIONS = [
  { value: 'v8.2', label: 'V8.2' },
  { value: 'v8.1', label: 'V8.1' },
  { value: 'v7', label: 'V7' },
  { value: 'v6.1', label: 'V6.1' },
  { value: 'v5.2', label: 'V5.2' },
  { value: 'v5.1', label: 'V5.1' },
  { value: 'niji7', label: 'Niji 7' },
  { value: 'niji6', label: 'Niji 6' },
] as const;

export type MidjourneyVersion = typeof MIDJOURNEY_VERSIONS[number]['value'];

export type MidjourneyCreativityMode = 'faithful' | 'balanced' | 'exploratory';
export type MidjourneyProvider = 'apimart' | 'runninghub';

export const MIDJOURNEY_PARAMETER_PRESETS = {
  faithful: { stylize: 140, chaos: 0, raw: true },
  balanced: { stylize: 300, chaos: 0, raw: false },
  exploratory: { stylize: 300, chaos: 25, raw: false },
} as const satisfies Record<MidjourneyCreativityMode, {
  stylize: number;
  chaos: number;
  raw: boolean;
}>;

export const MIDJOURNEY_DEFAULT_VERSION: MidjourneyVersion = 'v8.2';
export const MIDJOURNEY_DEFAULT_MODE: MidjourneyCreativityMode = 'balanced';

/**
 * Midjourney uses a dedicated provider route rather than the generic canvas
 * engine registry. Keep this check shared by every entry point so a new model
 * alias cannot be rejected before the dedicated route gets control.
 */
export function isMidjourneyEngineId(value: unknown): boolean {
  const engineId = String(value ?? '').trim().toLowerCase();
  return engineId === 'midjourney' || engineId.startsWith('midjourney-');
}

/** APIMart is the only Midjourney route (RunningHub 悠船 overseas node retired 2026-08). */
export function midjourneyProviderOrder(_version: MidjourneyVersion): MidjourneyProvider[] {
  return ['apimart'];
}

export function getMidjourneyParameterDefaults(
  mode: MidjourneyCreativityMode = MIDJOURNEY_DEFAULT_MODE,
  overrides: Partial<{ stylize: number; chaos: number; raw: boolean }> = {},
) {
  return { ...MIDJOURNEY_PARAMETER_PRESETS[mode], ...overrides };
}

export interface MidjourneyPromptInput {
  prompt: string;
  version?: string;
  aspectRatio?: string;
  stylize?: number;
  chaos?: number;
  raw?: boolean;
  quality?: string | number;
  weird?: number;
  styleReferenceUrls?: string[];
  styleWeight?: number;
  imageWeight?: number;
}

export function normalizeMidjourneyVersion(value: unknown): MidjourneyVersion {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, MidjourneyVersion> = {
    '8.2': 'v8.2', v82: 'v8.2', 'v8.2': 'v8.2',
    '8.1': 'v8.1', v81: 'v8.1', 'v8.1': 'v8.1',
    '7': 'v7', v7: 'v7',
    '6.1': 'v6.1', v61: 'v6.1', 'v6.1': 'v6.1',
    '5.2': 'v5.2', v52: 'v5.2', 'v5.2': 'v5.2',
    '5.1': 'v5.1', v51: 'v5.1', 'v5.1': 'v5.1',
    niji7: 'niji7', 'niji-7': 'niji7',
    niji6: 'niji6', 'niji-6': 'niji6',
  };
  return aliases[normalized] ?? MIDJOURNEY_DEFAULT_VERSION;
}

export function stripMidjourneyControlledFlags(prompt: string): string {
  return prompt
    .replace(/\s+--(?:v|version|niji|ar|aspect|stylize|s|chaos|c|quality|q|weird|w|sref|sw|iw)\s+[^\s]+/gi, '')
    .replace(/\s+--style\s+raw\b/gi, '')
    .replace(/\s+--raw\b/gi, '')
    .trim();
}

export function buildApimartMidjourneyPrompt(
  input: MidjourneyPromptInput,
  resolvedReferences: string[] = [],
): string {
  const version = normalizeMidjourneyVersion(input.version);
  const flags: string[] = [];
  if (version.startsWith('niji')) flags.push(`--niji ${version.slice(4)}`);
  else flags.push(`--v ${version.slice(1)}`);
  if (input.aspectRatio) flags.push(`--ar ${input.aspectRatio}`);
  if (Number.isFinite(input.stylize)) flags.push(`--stylize ${Math.min(1000, Math.max(0, Math.round(Number(input.stylize))))}`);
  if (Number.isFinite(input.chaos)) flags.push(`--chaos ${Math.min(100, Math.max(0, Math.round(Number(input.chaos))))}`);
  // APIMart's V8.2 endpoint rejects the legacy quality flag. Keep it only on
  // the V8.1 route where the provider documents and accepts it.
  if (version === 'v8.1' && input.quality !== undefined && input.quality !== '') flags.push(`--q ${input.quality}`);
  if (Number.isFinite(input.weird)) flags.push(`--weird ${Math.min(3000, Math.max(0, Math.round(Number(input.weird))))}`);
  const styleRefs = (input.styleReferenceUrls ?? []).filter(Boolean);
  if (styleRefs.length > 0) {
    flags.push(`--sref ${styleRefs.join(' ')}`);
    flags.push(`--sw ${Math.min(1000, Math.max(0, Math.round(Number(input.styleWeight ?? 100))))}`);
  }
  if (resolvedReferences.length > 0 && Number.isFinite(input.imageWeight)) {
    flags.push(`--iw ${Math.min(3, Math.max(0, Number(input.imageWeight)))}`);
  }
  if (input.raw) flags.push('--style raw');
  return [...resolvedReferences, stripMidjourneyControlledFlags(input.prompt), ...flags].filter(Boolean).join(' ');
}
