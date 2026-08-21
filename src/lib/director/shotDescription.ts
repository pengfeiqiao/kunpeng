/**
 * shotDescription — 纯几何机位描述生成。
 * 焦段换算、俯仰角、机位高度 + 每个可见元素的九宫格位置/景深层/朝向。
 */
import type { CameraCombo } from '@/lib/canvas/cameraPresets';
import type { ElementSnapshotForDesc } from './engine';
import type { DirectorShot, Vec3 } from './types';

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function len(v: Vec3): number { return Math.hypot(v.x, v.y, v.z); }
function norm(v: Vec3): Vec3 { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** 全画幅 35mm 等效焦段（垂直 fov，半高 12mm） */
function fovToFocal(fovDeg: number): number {
  return 12 / Math.tan((fovDeg / 2) * Math.PI / 180);
}

function focalLabel(f: number): string {
  if (f <= 20) return `约 ${Math.round(f)}mm 超广角`;
  if (f <= 35) return `约 ${Math.round(f)}mm 广角`;
  if (f <= 60) return `约 ${Math.round(f)}mm 标准镜头`;
  if (f <= 105) return `约 ${Math.round(f)}mm 中长焦`;
  return `约 ${Math.round(f)}mm 长焦`;
}

export function describeShot(
  shot: DirectorShot,
  elements: ElementSnapshotForDesc[],
  combo?: CameraCombo,
): string {
  const camDir = norm(sub(shot.target, shot.position));
  const f = fovToFocal(shot.fov);

  // 俯仰
  const pitchDeg = Math.asin(-camDir.y) * 180 / Math.PI;
  const angleLabel = pitchDeg > 15 ? '俯拍' : pitchDeg < -15 ? '仰拍' : '平拍';
  const heightLabel = shot.position.y < 0.6 ? '低机位' : shot.position.y > 2.5 ? '高机位' : `机位高 ${shot.position.y.toFixed(1)}m`;

  // 视图投影（手算，无需 renderer）
  const up = { x: 0, y: 1, z: 0 };
  const right = norm(cross(camDir, up));
  const camUp = cross(right, camDir);
  const tanHalf = Math.tan((shot.fov / 2) * Math.PI / 180);
  const aspectRatio = shot.aspect === '9:16' ? 9 / 16 : shot.aspect === '4:3' ? 4 / 3 : shot.aspect === '1:1' ? 1 : 16 / 9;

  const visible = elements.filter((e) => e.visible);
  const projected = visible.map((e) => {
    const rel = sub(e.worldPos, shot.position);
    const zDepth = dot(rel, camDir);
    if (zDepth <= 0.05) return { e, off: true, ndcX: 0, ndcY: 0, depth: Infinity };
    const ndcX = dot(rel, right) / (zDepth * tanHalf * aspectRatio);
    const ndcY = dot(rel, camUp) / (zDepth * tanHalf);
    return { e, off: Math.abs(ndcX) > 1.15 || Math.abs(ndcY) > 1.15, ndcX, ndcY, depth: zDepth };
  });

  const inFrame = projected.filter((p) => !p.off);
  const depths = inFrame.map((p) => p.depth).sort((a, b) => a - b);
  const t1 = depths[Math.floor(depths.length / 3)] ?? Infinity;
  const t2 = depths[Math.floor((depths.length * 2) / 3)] ?? Infinity;

  const lines = inFrame.map((p) => {
    const col = p.ndcX < -1 / 3 ? '左' : p.ndcX > 1 / 3 ? '右' : '中';
    const row = p.ndcY > 1 / 3 ? '上' : p.ndcY < -1 / 3 ? '下' : '';
    const posLabel = row && col !== '中' ? `画面${col}${row === '上' ? '上' : '下'}` : row ? `画面${row === '上' ? '上部' : '下部'}` : `画面${col === '中' ? '中部' : `${col}侧`}`;
    const depthLabel = inFrame.length < 2 ? '' : p.depth <= t1 ? '前景' : p.depth <= t2 ? '中景' : '背景';

    let facing = '';
    if (p.e.kind === 'mannequin' || p.e.kind === 'billboard') {
      const toCam = norm(sub(shot.position, p.e.worldPos));
      const d = dot(norm(p.e.forwardDir), toCam);
      if (d > 0.5) facing = '正面朝向镜头';
      else if (d < -0.5) facing = '背对镜头';
      else {
        const side = cross(norm(p.e.forwardDir), toCam).y > 0 ? '右' : '左';
        facing = `侧面朝向镜头（面向画${side}）`;
      }
    }
    return `[${p.e.name}] ${[depthLabel, posLabel, facing].filter(Boolean).join('，')}`;
  });

  const offNames = projected.filter((p) => p.off).map((p) => p.e.name);

  const parts = [
    `${shot.name} · ${shot.aspect}｜${focalLabel(f)}，${angleLabel}，${heightLabel}`,
  ];
  if (lines.length > 0) parts.push(`构图：${lines.join('；')}`);
  if (offNames.length > 0) parts.push(`画外：${offNames.join('、')}`);
  if (combo) parts.push(`（镜头参考：${combo.body}）`);
  return parts.join('\n');
}
