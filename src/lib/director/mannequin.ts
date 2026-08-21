/**
 * mannequin — three 原语拼装的可摆姿势人体素模。
 *
 * 骨骼 = Group 嵌套层级（关节即 Group，pivot 在关节点）；
 * 肢体 capsule 沿 -Y 悬挂，mesh 偏移 -len/2。所有比例按身高 H 缩放。
 */
import * as THREE from 'three';
import type { JointName, Vec3 } from './types';

const D2R = Math.PI / 180;

interface MannequinRefs {
  joints: Record<JointName, THREE.Group>;
  material: THREE.MeshStandardMaterial;
}

function capsule(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(r, len, 4, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -len / 2;
  return mesh;
}

/** 装配素模；root.userData.mannequin = { joints, material } */
export function buildMannequin(heightM: number, color: string): THREE.Group {
  const H = heightM;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
  const joints = {} as Record<JointName, THREE.Group>;
  const J = (name: JointName, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    joints[name] = g;
    return g;
  };

  const root = new THREE.Group();

  // 髋（骨盆）
  const hips = J('hips', 0, 0.53 * H, 0, root);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.075 * H, 12, 10), mat);
  pelvis.scale.set(1.25, 0.75, 0.9);
  hips.add(pelvis);

  // 脊柱 → 胸腔
  const spine = J('spine', 0, 0.02 * H, 0, hips);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.085 * H, 0.16 * H, 4, 12), mat);
  torso.position.y = 0.13 * H;
  spine.add(torso);

  // 颈 → 头
  const neck = J('neck', 0, 0.245 * H, 0, spine);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.068 * H, 14, 12), mat);
  head.position.y = 0.075 * H;
  neck.add(head);
  // 鼻头小凸起标朝向（+Z 为正面）
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.015 * H, 6, 6), mat);
  nose.position.set(0, 0.075 * H, 0.065 * H);
  neck.add(nose);

  // 手臂（左 x 负 / 右 x 正；上臂挂肩、前臂挂肘）
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const shoulder = J(`shoulder${side}` as JointName, sx * 0.115 * H, 0.215 * H, 0, spine);
    shoulder.add(capsule(0.03 * H, 0.165 * H, mat));
    const elbow = J(`elbow${side}` as JointName, 0, -0.165 * H, 0, shoulder);
    elbow.add(capsule(0.026 * H, 0.15 * H, mat));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.03 * H, 8, 8), mat);
    hand.position.y = -0.17 * H;
    elbow.add(hand);
  }

  // 腿
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const hip = J(`hip${side}` as JointName, sx * 0.06 * H, -0.02 * H, 0, hips);
    hip.add(capsule(0.042 * H, 0.245 * H, mat));
    const knee = J(`knee${side}` as JointName, 0, -0.245 * H, 0, hip);
    knee.add(capsule(0.036 * H, 0.235 * H, mat));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.055 * H, 0.03 * H, 0.12 * H), mat);
    foot.position.set(0, -0.25 * H, 0.035 * H);
    knee.add(foot);
  }

  root.userData.mannequin = { joints, material: mat } satisfies MannequinRefs;
  return root;
}

/** 重置所有关节后应用指定角度（度） */
export function applyPose(root: THREE.Group, joints: Partial<Record<JointName, Vec3>>): void {
  const refs = root.userData.mannequin as MannequinRefs | undefined;
  if (!refs) return;
  for (const g of Object.values(refs.joints)) g.rotation.set(0, 0, 0);
  for (const [name, deg] of Object.entries(joints)) {
    const g = refs.joints[name as JointName];
    if (g && deg) g.rotation.set(deg.x * D2R, deg.y * D2R, deg.z * D2R);
  }
}

export function setMannequinColor(root: THREE.Group, color: string): void {
  const refs = root.userData.mannequin as MannequinRefs | undefined;
  refs?.material.color.set(color);
}
