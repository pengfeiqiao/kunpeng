export const DIRECTOR_RUNTIME_COMMAND_EVENT = 'kunpeng-director-runtime-command';

export interface DirectorRuntimeSnapshot {
  fps: number;
  currentTimeSec: number;
  exportInSec: number;
  exportOutSec: number;
  outputPath: string;
  lastExportPath: string;
  exporting: boolean;
}

export type DirectorRuntimeCommand =
  | { type: 'set-export-range'; inSec: number; outSec: number }
  | { type: 'set-output-path'; path: string }
  | { type: 'open-panel'; panel: 'inspect' | 'export' }
  | { type: 'switch-workshop-shot'; shotNo: string; mode: 'storyboard' | 'video-prompt' }
  | { type: 'recognize-storyboard' }
  | { type: 'repair-scene' };

let snapshot: DirectorRuntimeSnapshot | null = null;

export function setDirectorRuntimeSnapshot(next: DirectorRuntimeSnapshot | null): void {
  snapshot = next;
}

export function getDirectorRuntimeSnapshot(): DirectorRuntimeSnapshot | null {
  return snapshot ? { ...snapshot } : null;
}

export function dispatchDirectorRuntimeCommand(command: DirectorRuntimeCommand): boolean {
  if (typeof window === 'undefined') return false;
  window.dispatchEvent(new CustomEvent<DirectorRuntimeCommand>(DIRECTOR_RUNTIME_COMMAND_EVENT, { detail: command }));
  return true;
}
