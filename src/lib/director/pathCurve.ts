import type { DirectorMotionKeyframe, Vec3 } from './types';

function add(a: Vec3, b?: Vec3): Vec3 {
  return { x: a.x + (b?.x ?? 0), y: a.y + (b?.y ?? 0), z: a.z + (b?.z ?? 0) };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function mul(a: Vec3, amount: number): Vec3 {
  return { x: a.x * amount, y: a.y * amount, z: a.z * amount };
}

export function cubicBezier(a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number): Vec3 {
  const p = Math.max(0, Math.min(1, t));
  const q = 1 - p;
  return {
    x: q * q * q * a.x + 3 * q * q * p * b.x + 3 * q * p * p * c.x + p * p * p * d.x,
    y: q * q * q * a.y + 3 * q * q * p * b.y + 3 * q * p * p * c.y + p * p * p * d.y,
    z: q * q * q * a.z + 3 * q * q * p * b.z + 3 * q * p * p * c.z + p * p * p * d.z,
  };
}

export function evaluatePathSegment(left: DirectorMotionKeyframe, right: DirectorMotionKeyframe, progress: number, fallback: Vec3): Vec3 {
  const a = left.position ?? fallback;
  const d = right.position ?? a;
  if (!left.pathOut && !right.pathIn) {
    return {
      x: a.x + (d.x - a.x) * progress,
      y: a.y + (d.y - a.y) * progress,
      z: a.z + (d.z - a.z) * progress,
    };
  }
  return cubicBezier(a, add(a, left.pathOut), add(d, right.pathIn), d, progress);
}

/** Generate Photoshop/Pen-like balanced handles from neighbouring points. */
export function smoothPathFrame(
  frames: DirectorMotionKeyframe[],
  frameId: string,
  tension = 0.28,
): DirectorMotionKeyframe[] {
  const sorted = [...frames].sort((a, b) => a.timeSec - b.timeSec);
  const index = sorted.findIndex((frame) => frame.id === frameId);
  if (index < 0) return frames;
  const current = sorted[index];
  const point = current.position;
  if (!point) return frames;
  const previous = sorted[index - 1]?.position ?? point;
  const next = sorted[index + 1]?.position ?? point;
  const tangent = mul(sub(next, previous), tension);
  const nextFrame = {
    ...current,
    pathMode: 'smooth' as const,
    pathIn: mul(tangent, -1),
    pathOut: tangent,
  };
  return frames.map((frame) => frame.id === frameId ? nextFrame : frame);
}

export function cornerPathFrame(frames: DirectorMotionKeyframe[], frameId: string): DirectorMotionKeyframe[] {
  return frames.map((frame) => frame.id === frameId
    ? { ...frame, pathMode: 'corner' as const, pathIn: undefined, pathOut: undefined }
    : frame);
}

export interface SampledPathPoint {
  position: Vec3;
  keyframeId?: string;
}

export function sampleMotionPath(frames: DirectorMotionKeyframe[], fallback: Vec3, subdivisions = 16): SampledPathPoint[] {
  const sorted = [...frames].filter((frame) => frame.position).sort((a, b) => a.timeSec - b.timeSec);
  if (sorted.length === 0) return [{ position: fallback }];
  if (sorted.length === 1) return [{ position: sorted[0].position ?? fallback, keyframeId: sorted[0].id }];
  const sampled: SampledPathPoint[] = [];
  sorted.slice(0, -1).forEach((left, index) => {
    const right = sorted[index + 1];
    for (let step = 0; step < subdivisions; step += 1) {
      const progress = step / subdivisions;
      sampled.push({
        position: evaluatePathSegment(left, right, progress, fallback),
        keyframeId: step === 0 ? left.id : undefined,
      });
    }
  });
  const last = sorted[sorted.length - 1];
  sampled.push({ position: last.position ?? fallback, keyframeId: last.id });
  return sampled;
}

export function handleWorldPosition(frame: DirectorMotionKeyframe, side: 'in' | 'out'): Vec3 | null {
  if (!frame.position) return null;
  return add(frame.position, side === 'in' ? frame.pathIn : frame.pathOut);
}
