/**
 * DirectorEngine — 3D 导演台的命令式 three.js 封装。
 *
 * 职责：场景/灯光/地面网格、元素 diff 同步（store→scene）、raycast 点选、
 * TransformControls 调度（拖拽结束提交回 store）、OrbitControls 自由视角、
 * 机位应用与截图、equirect 全景背景。
 *
 * three@0.184 注意：TransformControls 须 scene.add(controls.getHelper())。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import {
  ASPECT_RATIOS,
  vecEq,
  type AspectId,
  type BillboardElement,
  type CrowdElement,
  type DirectorElement,
  type DirectorActionClip,
  type DirectorShot,
  type MannequinElement,
  type Vec3,
} from './types';
import { buildMannequin, applyPose, setMannequinColor } from './mannequin';
import { findPose } from './poses';
import { handleWorldPosition, sampleMotionPath } from './pathCurve';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function actorMaterial(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
}

function buildAnimal(height: number, color: string, species: MannequinElement['animalSpecies']): THREE.Group {
  const group = new THREE.Group();
  const compact = species === 'small';
  const scale = compact ? height * 0.34 : height * 0.48;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(scale * 0.34, scale * 0.75, 5, 10), actorMaterial(color));
  body.rotation.z = Math.PI / 2;
  body.position.y = scale * 0.72;
  const head = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.28, 16, 12), actorMaterial(color));
  head.position.set(scale * 0.62, scale * 0.88, 0);
  group.add(body, head);
  for (const x of [-0.34, 0.34]) for (const z of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.07, scale * 0.085, scale * 0.58, 10), actorMaterial(color));
    leg.position.set(scale * x, scale * 0.34, scale * z);
    group.add(leg);
  }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(scale * 0.035, scale * 0.065, scale * 0.6, 8), actorMaterial(color));
  tail.rotation.z = -Math.PI / 3;
  tail.position.set(-scale * 0.72, scale * 0.78, 0);
  group.add(tail);
  return group;
}

function disposeActorLabel(object: THREE.Object3D): void {
  const label = object.children.find((child) => child.userData.isDirectorActorLabel) as THREE.Sprite | undefined;
  if (!label) return;
  (label.material as THREE.SpriteMaterial).map?.dispose();
  (label.material as THREE.SpriteMaterial).dispose();
  object.remove(label);
}

function attachActorLabel(object: THREE.Object3D, name: string, color: string, height: number): void {
  disposeActorLabel(object);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(18, 20, 24, 0.92)';
  context.beginPath();
  context.roundRect(8, 10, 496, 108, 28);
  context.fill();
  context.fillStyle = color;
  context.fillRect(8, 10, 14, 108);
  context.font = '600 46px -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = '#ffffff';
  context.fillText(name.slice(0, 12), 264, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  label.userData.isDirectorActorLabel = true;
  if (object.userData.elementId) label.userData.elementId = object.userData.elementId;
  label.renderOrder = 999;
  label.position.set(0, height + 0.24, 0);
  label.scale.set(1.55, 0.39, 1);
  object.add(label);
}

export interface CameraPose { position: Vec3; target: Vec3; fov: number; rollDeg?: number }

export interface ElementSnapshotForDesc {
  id: string;
  name: string;
  kind: DirectorElement['kind'];
  worldPos: Vec3;
  forwardDir: Vec3;
  visible: boolean;
}

export interface DirectorEngineDiagnostics {
  webglContextLost: boolean;
  stageSize: { width: number; height: number };
  monitorAttached: boolean;
  sceneObjectCount: number;
  renderedElementCount: number;
  elements: Array<{
    id: string;
    name: string;
    kind: DirectorElement['kind'];
    rootVisible: boolean;
    visibleMeshCount: number;
    worldPos: Vec3;
    distanceToShotCamera: number;
    insideShotFrustum: boolean;
  }>;
}

export class DirectorEngine {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private shotCamera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private monitorRenderer: THREE.WebGLRenderer | null = null;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private gizmoHelper: THREE.Object3D;
  private transformControlsVisible = true;
  private transformDragging = false;
  private transformDirty = false;
  private pointerDownWasTransform = false;
  private transformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  private cameraRigSelected = false;
  private grid: THREE.GridHelper;
  private ground: THREE.Mesh;
  private shotCameraHelper: THREE.CameraHelper;
  private shotCameraBody: THREE.Group;
  private shotTargetMarker: THREE.Mesh;
  private shotPath: THREE.Line;
  private actionPathGroup = new THREE.Group();
  private shotTarget = new THREE.Vector3(0, 1, 0);
  private shotRollDeg = 0;
  private objects = new Map<string, THREE.Object3D>();
  private elementCache = new Map<string, DirectorElement>();
  private raf = 0;
  private container: HTMLDivElement;
  private texLoader = new THREE.TextureLoader();
  private pendingTextures = 0;

  onTransformCommit?: (id: string, t: { position: Vec3; rotationDeg: Vec3; scale: Vec3 }, mode: 'translate' | 'rotate' | 'scale') => void;
  onPick?: (id: string | null, additive: boolean) => void;
  onDoublePick?: (id: string) => void;
  onCameraChanged?: () => void;
  onCameraRigPick?: () => void;
  onCameraRigCommit?: (pose: CameraPose) => void;
  onActionPointPick?: (actionId: string, keyframeId: string) => void;
  onActionHandlePick?: (actionId: string, keyframeId: string, side: 'in' | 'out') => void;
  onActionHandleCommit?: (actionId: string, keyframeId: string, side: 'in' | 'out', offset: Vec3) => void;

  constructor(container: HTMLDivElement) {
    this.container = container;
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    this.scene.background = new THREE.Color(0x16181c);
    this.scene.fog = new THREE.Fog(0x16181c, 40, 90);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 200);
    this.camera.position.set(5, 3.2, 6.5);
    this.shotCamera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 200);
    this.shotCamera.position.set(0, 2.3, 7);
    this.shotCamera.lookAt(this.shotTarget);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // 灯光
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(6, 10, 4);
    this.scene.add(sun);

    // 地面
    this.grid = new THREE.GridHelper(40, 40, 0x3a3f47, 0x262a30);
    this.scene.add(this.grid);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.userData.isGround = true;
    this.scene.add(this.ground);

    // 可直接拖动的拍摄摄影机白模 + 视锥 + 注视目标 + 运动路径。
    this.shotCameraBody = new THREE.Group();
    const cameraBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.26, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xe7e8eb, roughness: 0.65 }),
    );
    cameraBox.position.z = 0.12;
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.16, 0.24, 16),
      new THREE.MeshStandardMaterial({ color: 0x737982, roughness: 0.75 }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.18;
    this.shotCameraBody.add(cameraBox, lens);
    this.shotCameraBody.traverse((object) => { object.userData.isShotCameraRig = true; });
    this.shotCamera.add(this.shotCameraBody);
    this.shotCamera.userData.isShotCameraRig = true;
    this.scene.add(this.shotCamera);
    this.shotCameraHelper = new THREE.CameraHelper(this.shotCamera);
    this.shotCameraHelper.traverse((object) => { object.userData.isShotCameraHelper = true; });
    this.scene.add(this.shotCameraHelper);
    this.shotTargetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.shotTargetMarker.position.copy(this.shotTarget);
    this.scene.add(this.shotTargetMarker);
    this.shotPath = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([this.shotCamera.position.clone(), this.shotCamera.position.clone()]),
      new THREE.LineDashedMaterial({ color: 0xbfc3ca, dashSize: 0.28, gapSize: 0.18, transparent: true, opacity: 0.7 }),
    );
    this.shotPath.computeLineDistances();
    this.scene.add(this.shotPath);
    this.scene.add(this.actionPathGroup);

    // 控制器
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.addEventListener('change', () => this.onCameraChanged?.());

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.72);
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.traverse((o) => { o.userData.isGizmo = true; });
    this.scene.add(this.gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      this.transformDragging = dragging;
      this.orbit.enabled = !dragging;
      if (dragging) this.transformDirty = false;
      else if (this.transformDirty) this.commitTransform();
    });
    this.gizmo.addEventListener('mouseDown', () => { this.pointerDownWasTransform = true; });
    this.gizmo.addEventListener('objectChange', () => { this.transformDirty = true; });

    // 点选（位移阈值区分 orbit 拖拽）
    let downPos: { x: number; y: number } | null = null;
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
      this.pointerDownWasTransform = this.transformDragging;
    });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downPos) return;
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      const wasTransform = this.pointerDownWasTransform || this.transformDragging;
      this.pointerDownWasTransform = false;
      if (wasTransform) return;
      if (moved > 4) return;
      this.pick(e);
    });
    this.renderer.domElement.addEventListener('dblclick', (e) => this.pick(e, true));

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.orbit.update();
      this.faceBillboards();
      this.shotCameraHelper.update();
      this.renderer.render(this.scene, this.camera);
      if (this.monitorRenderer) {
        const gizmoWasVisible = this.gizmoHelper.visible;
        this.setShotHelpersVisible(false);
        this.gizmoHelper.visible = false;
        this.monitorRenderer.render(this.scene, this.shotCamera);
        this.setShotHelpersVisible(true);
        this.gizmoHelper.visible = gizmoWasVisible;
      }
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
    this.monitorRenderer?.dispose();
    this.monitorRenderer?.domElement.remove();
    this.renderer.domElement.remove();
  }

  attachMonitor(container: HTMLDivElement): void {
    this.monitorRenderer?.dispose();
    this.monitorRenderer?.domElement.remove();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth || 240, container.clientHeight || 135, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.replaceChildren(renderer.domElement);
    this.monitorRenderer = renderer;
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  get texturesReady(): boolean {
    return this.pendingTextures === 0;
  }

  // ── 元素同步 ────────────────────────────────────────────────────────────────

  syncElements(elements: DirectorElement[]): void {
    const incoming = new Map(elements.map((e) => [e.id, e]));
    // 删除
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        if (this.gizmo.object === obj) this.gizmo.detach();
        this.scene.remove(obj);
        this.objects.delete(id);
        this.elementCache.delete(id);
      }
    }
    // 新增/更新
    for (const el of elements) {
      const prev = this.elementCache.get(el.id);
      let obj = this.objects.get(el.id);
      const needRebuild = !obj
        || (prev && (
          prev.kind !== el.kind
          || (el.kind === 'mannequin' && ((prev as MannequinElement).heightM !== el.heightM || (prev as MannequinElement).bodyType !== el.bodyType || (prev as MannequinElement).animalSpecies !== el.animalSpecies))
          || (el.kind === 'billboard' && ((prev as BillboardElement).imagePath !== el.imagePath || (prev as BillboardElement).heightM !== el.heightM))
          || (el.kind === 'crowd' && JSON.stringify({ r: (prev as CrowdElement).rows, c: (prev as CrowdElement).cols, s: (prev as CrowdElement).spacing }) !== JSON.stringify({ r: el.rows, c: el.cols, s: el.spacing }))
        ));
      if (needRebuild) {
        if (obj) {
          if (this.gizmo.object === obj) this.gizmo.detach();
          this.scene.remove(obj);
        }
        obj = this.buildObject(el);
        if (el.kind === 'mannequin') attachActorLabel(obj, el.name, el.color, el.bodyType === 'animal' ? Math.max(0.8, el.heightM * 0.55) : el.heightM);
        else if (el.kind === 'crowd') attachActorLabel(obj, el.name, el.color, 1.95);
        obj.traverse((o) => { o.userData.elementId = el.id; });
        this.scene.add(obj);
        this.objects.set(el.id, obj);
      }
      if (!(this.transformDragging && this.gizmo.object === obj)) this.applyElementState(obj!, el, prev);
      this.elementCache.set(el.id, structuredClone(el));
    }
  }

  private buildObject(el: DirectorElement): THREE.Object3D {
    switch (el.kind) {
      case 'box': {
        return new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.8 }),
        );
      }
      case 'sphere': {
        return new THREE.Mesh(
          new THREE.SphereGeometry(0.5, 20, 16),
          new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.8 }),
        );
      }
      case 'cylinder': {
        return new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, 1, 20),
          new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.8 }),
        );
      }
      case 'wall': {
        return new THREE.Mesh(
          new THREE.BoxGeometry(3, 2.4, 0.12),
          new THREE.MeshStandardMaterial({ color: el.color, roughness: 0.9 }),
        );
      }
      case 'mannequin': {
        return el.bodyType === 'animal' ? buildAnimal(el.heightM, el.color, el.animalSpecies) : buildMannequin(el.heightM, el.color);
      }
      case 'billboard': {
        const group = new THREE.Group();
        group.userData.isBillboard = true;
        const h = el.heightM;
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.55, h), mat);
        plane.position.y = h / 2;
        group.add(plane);
        // 底座小三角示意位置
        const base = new THREE.Mesh(
          new THREE.ConeGeometry(0.1, 0.05, 4),
          new THREE.MeshBasicMaterial({ color: 0x1fa2dc }),
        );
        base.position.y = 0.025;
        group.add(base);
        this.pendingTextures++;
        this.texLoader.load(
          convertFileSrc(el.imagePath),
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            mat.map = tex;
            mat.needsUpdate = true;
            // 按图片纵横比修正立牌宽度
            const ratio = tex.image.width / tex.image.height;
            plane.scale.x = (ratio * h) / (h * 0.55);
            this.pendingTextures--;
          },
          undefined,
          () => { this.pendingTextures--; mat.color.set(0x555c66); },
        );
        return group;
      }
      case 'crowd': {
        const group = new THREE.Group();
        const pose = findPose(el.poseId)?.joints ?? {};
        for (let r = 0; r < el.rows; r++) {
          for (let c = 0; c < el.cols; c++) {
            const m = buildMannequin(1.65, el.color);
            applyPose(m, pose);
            m.position.set(
              (c - (el.cols - 1) / 2) * el.spacing,
              0,
              (r - (el.rows - 1) / 2) * el.spacing,
            );
            group.add(m);
          }
        }
        return group;
      }
    }
  }

  private applyElementState(obj: THREE.Object3D, el: DirectorElement, prev?: DirectorElement): void {
    obj.position.set(el.position.x, el.position.y, el.position.z);
    obj.rotation.set(el.rotationDeg.x * D2R, el.rotationDeg.y * D2R, el.rotationDeg.z * D2R);
    obj.scale.set(el.scale.x, el.scale.y, el.scale.z);
    obj.visible = el.visible;

    // 颜色
    if (!prev || prev.color !== el.color) {
      if (el.kind === 'mannequin') {
        if (el.bodyType === 'animal') obj.traverse((child) => { const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; material?.color?.set(el.color); });
        else setMannequinColor(obj as THREE.Group, el.color);
      } else if (el.kind === 'crowd') {
        obj.children.forEach((c) => setMannequinColor(c as THREE.Group, el.color));
      } else if (el.kind !== 'billboard') {
        const mesh = obj as THREE.Mesh;
        (mesh.material as THREE.MeshStandardMaterial).color?.set(el.color);
      }
    }
    if ((el.kind === 'mannequin' || el.kind === 'crowd') && (!prev || prev.name !== el.name || prev.color !== el.color)) {
      attachActorLabel(obj, el.name, el.color, el.kind === 'crowd' ? 1.95 : el.bodyType === 'animal' ? Math.max(0.8, el.heightM * 0.55) : el.heightM);
    }
    // 姿势
    if (el.kind === 'mannequin' && el.bodyType !== 'animal') {
      const prevM = prev as MannequinElement | undefined;
      if (!prevM || JSON.stringify(prevM.joints) !== JSON.stringify(el.joints)) {
        applyPose(obj as THREE.Group, el.joints);
      }
    }
  }

  // ── 选择 / gizmo ────────────────────────────────────────────────────────────

  setSelection(ids: string[]): void {
    // 高亮：emissive 提亮
    for (const [id, obj] of this.objects) {
      const sel = ids.includes(id);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material as THREE.MeshStandardMaterial | undefined;
        if (mat?.emissive) mat.emissive.set(sel ? 0x1f4a5c : 0x000000);
      });
    }
    // gizmo：单选才挂
    if (ids.length === 1) {
      this.cameraRigSelected = false;
      const obj = this.objects.get(ids[0]);
      if (obj) this.gizmo.attach(obj);
      else this.gizmo.detach();
    } else if (!this.cameraRigSelected) {
      this.gizmo.detach();
    }
    this.gizmo.enabled = this.transformControlsVisible;
    this.gizmoHelper.visible = this.transformControlsVisible;
  }

  setTransformMode(m: 'translate' | 'rotate' | 'scale'): void {
    this.transformMode = m;
    this.gizmo.setMode(m);
  }

  setTransformControlsVisible(visible: boolean): void {
    this.transformControlsVisible = visible;
    this.gizmo.enabled = visible;
    this.gizmoHelper.visible = visible;
  }

  private pick(e: PointerEvent | MouseEvent, doubleClick = false): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      if (o.userData.isGizmo || o.userData.isGround) continue;
      let pathHandle: THREE.Object3D | null = o;
      while (pathHandle) {
        if (pathHandle.userData.isDirectorPathHandle) {
          this.cameraRigSelected = false;
          this.gizmo.attach(pathHandle);
          this.setTransformMode('translate');
          this.gizmo.enabled = this.transformControlsVisible;
          this.gizmoHelper.visible = this.transformControlsVisible;
          this.onActionHandlePick?.(
            pathHandle.userData.actionId as string,
            pathHandle.userData.keyframeId as string,
            pathHandle.userData.pathHandleSide as 'in' | 'out',
          );
          return;
        }
        pathHandle = pathHandle.parent;
      }
      let actionPart: THREE.Object3D | null = o;
      while (actionPart) {
        if (actionPart.userData.actionId && actionPart.userData.keyframeId) {
          this.onActionPointPick?.(actionPart.userData.actionId as string, actionPart.userData.keyframeId as string);
          return;
        }
        actionPart = actionPart.parent;
      }
      let cameraPart: THREE.Object3D | null = o;
      while (cameraPart) {
        if (cameraPart.userData.isShotCameraRig) {
          this.cameraRigSelected = true;
          this.gizmo.attach(this.shotCamera);
          this.gizmo.enabled = this.transformControlsVisible;
          this.gizmoHelper.visible = this.transformControlsVisible;
          this.onCameraRigPick?.();
          return;
        }
        cameraPart = cameraPart.parent;
      }
      let elementId: string | undefined;
      while (o) {
        if (o.userData.elementId) { elementId = o.userData.elementId as string; break; }
        o = o.parent;
      }
      if (elementId) {
        this.cameraRigSelected = false;
        if (doubleClick) this.onDoublePick?.(elementId);
        else this.onPick?.(elementId, e.shiftKey);
        return;
      }
    }
    this.cameraRigSelected = false;
    this.onPick?.(null, false);
  }

  private commitTransform(): void {
    const obj = this.gizmo.object;
    if (!obj) return;
    if (obj.userData.isDirectorPathHandle) {
      const base = obj.userData.pathBase as Vec3 | undefined;
      const actionId = obj.userData.actionId as string | undefined;
      const keyframeId = obj.userData.keyframeId as string | undefined;
      const side = obj.userData.pathHandleSide as 'in' | 'out' | undefined;
      if (base && actionId && keyframeId && side) {
        this.onActionHandleCommit?.(actionId, keyframeId, side, {
          x: obj.position.x - base.x,
          y: obj.position.y - base.y,
          z: obj.position.z - base.z,
        });
      }
      this.transformDirty = false;
      return;
    }
    if (obj === this.shotCamera) {
      let rollDeg = this.shotRollDeg;
      if (this.transformMode === 'rotate') {
        const distance = Math.max(0.5, this.shotCamera.position.distanceTo(this.shotTarget));
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.shotCamera.quaternion).normalize();
        this.shotTarget.copy(this.shotCamera.position).addScaledVector(forward, distance);
        rollDeg = -this.shotCamera.rotation.z * R2D;
        this.shotRollDeg = rollDeg;
        this.shotTargetMarker.position.copy(this.shotTarget);
      } else {
        this.shotCamera.lookAt(this.shotTarget);
        if (rollDeg) this.shotCamera.rotateZ(-rollDeg * D2R);
      }
      this.shotCamera.scale.set(1, 1, 1);
      this.shotCameraHelper.update();
      this.onCameraRigCommit?.({
        position: { x: this.shotCamera.position.x, y: this.shotCamera.position.y, z: this.shotCamera.position.z },
        target: { x: this.shotTarget.x, y: this.shotTarget.y, z: this.shotTarget.z },
        fov: this.shotCamera.fov,
        rollDeg,
      });
      this.transformDirty = false;
      return;
    }
    const id = obj.userData.elementId as string | undefined;
    if (!id) return;
    this.onTransformCommit?.(id, {
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      rotationDeg: { x: obj.rotation.x * R2D, y: obj.rotation.y * R2D, z: obj.rotation.z * R2D },
      scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
    }, this.transformMode);
    this.transformDirty = false;
  }

  /** 外部提交后回写缓存，防 subscribe 回环重建 */
  ackTransform(id: string, el: DirectorElement): void {
    this.elementCache.set(id, structuredClone(el));
  }

  private faceBillboards(): void {
    for (const obj of this.objects.values()) {
      if (obj.userData.isBillboard) {
        obj.rotation.y = Math.atan2(
          this.camera.position.x - obj.position.x,
          this.camera.position.z - obj.position.z,
        );
      }
    }
  }

  // ── 相机 / 机位 ─────────────────────────────────────────────────────────────

  getCameraPose(): CameraPose {
    return {
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      target: { x: this.orbit.target.x, y: this.orbit.target.y, z: this.orbit.target.z },
      fov: this.camera.fov,
    };
  }

  applyShot(shot: DirectorShot): void {
    this.camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    this.orbit.target.set(shot.target.x, shot.target.y, shot.target.z);
    this.camera.fov = shot.fov;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  applyCameraPose(pose: CameraPose): void {
    this.shotCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.shotTarget.set(pose.target.x, pose.target.y, pose.target.z);
    this.shotCamera.lookAt(this.shotTarget);
    this.shotRollDeg = pose.rollDeg ?? 0;
    if (this.shotRollDeg) this.shotCamera.rotateZ(-this.shotRollDeg * D2R);
    this.shotCamera.fov = pose.fov;
    this.shotCamera.updateProjectionMatrix();
    this.shotTargetMarker.position.copy(this.shotTarget);
    this.shotCameraHelper.update();
  }

  setCameraPath(poses: CameraPose[]): void {
    this.shotPath.geometry.dispose();
    const points = poses.map((pose) => new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z));
    this.shotPath.geometry = new THREE.BufferGeometry().setFromPoints(points.length >= 2 ? points : [new THREE.Vector3(), new THREE.Vector3()]);
    this.shotPath.computeLineDistances();
  }

  setActionPaths(actions: DirectorActionClip[]): void {
    if (this.gizmo.object) {
      let owner: THREE.Object3D | null = this.gizmo.object;
      while (owner && owner.parent !== this.actionPathGroup) owner = owner.parent;
      if (owner?.parent === this.actionPathGroup) this.gizmo.detach();
    }
    while (this.actionPathGroup.children.length) {
      const child = this.actionPathGroup.children.pop();
      if (!child) continue;
      const object = child as THREE.Line | THREE.Mesh;
      object.geometry?.dispose();
      const material = object.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    }
    for (const action of actions) {
      const actorColor = this.elementCache.get(action.elementId)?.color ?? '#e1e3e7';
      const frames = [...(action.keyframes ?? [])].sort((a, b) => a.timeSec - b.timeSec);
      const sampled = frames.length ? sampleMotionPath(frames, action.from, 18) : [{ position: action.from }, { position: action.to }];
      const points = sampled.map(({ position }) => new THREE.Vector3(position.x, Math.max(0.035, position.y + 0.035), position.z));
      const distance = points.slice(1).reduce((sum, point, index) => sum + point.distanceTo(points[index]), 0);
      if (distance < 0.05) continue;
      const from = points[0];
      const to = points[points.length - 1];
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({ color: actorColor, dashSize: 0.2, gapSize: 0.14, transparent: true, opacity: 0.72 }),
      );
      line.computeLineDistances();
      this.actionPathGroup.add(line);
      frames.forEach((frame, index) => {
        const raw = frame.position ?? action.from;
        const point = new THREE.Vector3(raw.x, Math.max(0.035, raw.y + 0.035), raw.z);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(index === 0 || index === frames.length - 1 ? 0.1 : 0.075, 12, 8),
          new THREE.MeshBasicMaterial({ color: actorColor, transparent: true, opacity: index === 0 || index === frames.length - 1 ? 0.95 : 0.72 }),
        );
        marker.position.copy(point);
        marker.userData.actionId = action.id;
        marker.userData.keyframeId = frame.id;
        this.actionPathGroup.add(marker);
        if (frame.pathMode === 'smooth' || frame.pathIn || frame.pathOut) {
          (['in', 'out'] as const).forEach((side) => {
            const handlePosition = handleWorldPosition(frame, side);
            if (!handlePosition || !frame.position) return;
            const handle = new THREE.Mesh(
              new THREE.BoxGeometry(0.11, 0.11, 0.11),
              new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 }),
            );
            handle.position.set(handlePosition.x, Math.max(0.05, handlePosition.y + 0.05), handlePosition.z);
            handle.userData.isDirectorPathHandle = true;
            handle.userData.actionId = action.id;
            handle.userData.keyframeId = frame.id;
            handle.userData.pathHandleSide = side;
            handle.userData.pathBase = { x: frame.position.x, y: frame.position.y + 0.05, z: frame.position.z };
            const guide = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([point, handle.position.clone()]),
              new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.34 }),
            );
            this.actionPathGroup.add(guide, handle);
          });
        }
      });
      const directionFrom = [...points].reverse().find((point) => point.distanceTo(to) > 0.001) ?? from;
      const direction = to.clone().sub(directionFrom).normalize();
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.28, 10),
        new THREE.MeshBasicMaterial({ color: actorColor, transparent: true, opacity: 0.85 }),
      );
      arrow.position.copy(to);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      this.actionPathGroup.add(arrow);
    }
  }

  private setShotHelpersVisible(visible: boolean): void {
    this.shotCameraBody.visible = visible;
    this.shotCameraHelper.visible = visible;
    this.shotTargetMarker.visible = visible;
    this.shotPath.visible = visible;
    this.actionPathGroup.visible = visible;
    for (const object of this.objects.values()) object.traverse((child) => { if (child.userData.isDirectorActorLabel) child.visible = visible; });
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** 球坐标快捷机位：以 focus 为目标，按 pitch/yaw/distance 放置相机 */
  applyPresetPose(pitchDeg: number, yawDeg: number, distance: number, fov: number, focus: Vec3): void {
    const pitch = pitchDeg * D2R;
    const yaw = yawDeg * D2R;
    const y = focus.y + distance * Math.sin(-pitch) + 1.0;
    const r = distance * Math.cos(pitch);
    this.camera.position.set(
      focus.x + r * Math.sin(yaw),
      Math.max(0.2, y),
      focus.z + r * Math.cos(yaw),
    );
    this.orbit.target.set(focus.x, focus.y + 0.9, focus.z);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.orbit.update();
  }

  /** 场景焦点：选中元素中心，否则所有元素包围盒中心 */
  getFocusPoint(selectedIds: string[]): Vec3 {
    const ids = selectedIds.length > 0 ? selectedIds : [...this.objects.keys()];
    const box = new THREE.Box3();
    let any = false;
    for (const id of ids) {
      const obj = this.objects.get(id);
      if (obj?.visible) { box.expandByObject(obj); any = true; }
    }
    if (!any) return { x: 0, y: 0, z: 0 };
    const c = box.getCenter(new THREE.Vector3());
    return { x: c.x, y: c.y, z: c.z };
  }

  // ── 截图 ────────────────────────────────────────────────────────────────────

  captureShot(aspect: AspectId, width = 1600): string {
    return this.captureFrame(aspect, width, { includeHelpers: false, transparent: false });
  }

  captureTransparent(aspect: AspectId, width = 1600): string {
    return this.captureFrame(aspect, width, { includeHelpers: false, transparent: true });
  }

  captureTopView(aspect: AspectId, width = 1600, includePaths = false): string {
    const current = {
      position: this.shotCamera.position.clone(),
      target: this.shotTarget.clone(),
      fov: this.shotCamera.fov,
      quaternion: this.shotCamera.quaternion.clone(),
    };
    this.shotCamera.position.set(0, 16, 0.01);
    this.shotTarget.set(0, 0, 0);
    this.shotCamera.lookAt(this.shotTarget);
    this.shotCamera.fov = 42;
    this.shotCamera.updateProjectionMatrix();
    try {
      return this.captureFrame(aspect, width, { includeHelpers: includePaths, transparent: false });
    } finally {
      this.shotCamera.position.copy(current.position);
      this.shotTarget.copy(current.target);
      this.shotCamera.quaternion.copy(current.quaternion);
      this.shotCamera.fov = current.fov;
      this.shotCamera.updateProjectionMatrix();
    }
  }

  private captureFrame(aspect: AspectId, width: number, options: { includeHelpers: boolean; transparent: boolean }): string {
    const ratio = ASPECT_RATIOS[aspect];
    const h = Math.round(width / ratio);
    const prevPixelRatio = this.renderer.getPixelRatio();
    const prevW = this.renderer.domElement.width / prevPixelRatio;
    const prevH = this.renderer.domElement.height / prevPixelRatio;
    const prevAspect = this.shotCamera.aspect;
    const gridWas = this.grid.visible;
    const helperWas = this.gizmoHelper.visible;
    const backgroundWas = this.scene.background;
    try {
      this.grid.visible = false;
      this.gizmoHelper.visible = false;
      this.setShotHelpersVisible(options.includeHelpers);
      if (options.transparent) this.scene.background = null;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, h, false);
      this.shotCamera.aspect = ratio;
      this.shotCamera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.shotCamera);
      return this.renderer.domElement.toDataURL('image/png');
    } finally {
      this.grid.visible = gridWas;
      this.gizmoHelper.visible = helperWas;
      this.setShotHelpersVisible(true);
      this.scene.background = backgroundWas;
      this.renderer.setPixelRatio(prevPixelRatio);
      this.renderer.setSize(prevW, prevH, false);
      this.shotCamera.aspect = prevAspect;
      this.shotCamera.updateProjectionMatrix();
    }
  }

  // ── 全景背景 ────────────────────────────────────────────────────────────────

  setPanorama(imagePath: string | null): void {
    if (!imagePath) {
      this.scene.background = new THREE.Color(0x16181c);
      return;
    }
    this.texLoader.load(convertFileSrc(imagePath), (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = tex;
    });
  }

  // ── 机位描述用快照 ──────────────────────────────────────────────────────────

  snapshotForDescription(): { camera: CameraPose; aspect: number; elements: ElementSnapshotForDesc[] } {
    const els: ElementSnapshotForDesc[] = [];
    for (const [id, obj] of this.objects) {
      const el = this.elementCache.get(id);
      if (!el) continue;
      const wp = new THREE.Vector3();
      obj.getWorldPosition(wp);
      // 人物中心抬到身高一半
      if (el.kind === 'mannequin' || el.kind === 'billboard') wp.y += (el as MannequinElement).heightM ? (el as MannequinElement).heightM / 2 : 0.85;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(obj.getWorldQuaternion(new THREE.Quaternion()));
      els.push({
        id,
        name: el.name,
        kind: el.kind,
        worldPos: { x: wp.x, y: wp.y, z: wp.z },
        forwardDir: { x: fwd.x, y: fwd.y, z: fwd.z },
        visible: el.visible,
      });
    }
    return { camera: this.getCameraPose(), aspect: this.camera.aspect, elements: els };
  }

  diagnostics(): DirectorEngineDiagnostics {
    this.scene.updateMatrixWorld(true);
    this.shotCamera.updateMatrixWorld(true);
    const projection = new THREE.Matrix4().multiplyMatrices(this.shotCamera.projectionMatrix, this.shotCamera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projection);
    const elements = [...this.objects.entries()].map(([id, object]) => {
      const element = this.elementCache.get(id)!;
      const world = object.getWorldPosition(new THREE.Vector3());
      let visibleMeshCount = 0;
      object.traverse((child) => { if ((child as THREE.Mesh).isMesh && child.visible) visibleMeshCount += 1; });
      const box = new THREE.Box3().setFromObject(object);
      return {
        id,
        name: element?.name ?? id,
        kind: element?.kind ?? 'box',
        rootVisible: object.visible,
        visibleMeshCount,
        worldPos: { x: world.x, y: world.y, z: world.z },
        distanceToShotCamera: world.distanceTo(this.shotCamera.position),
        insideShotFrustum: object.visible && !box.isEmpty() && frustum.intersectsBox(box),
      };
    });
    return {
      webglContextLost: this.renderer.getContext().isContextLost(),
      stageSize: { width: this.container.clientWidth, height: this.container.clientHeight },
      monitorAttached: Boolean(this.monitorRenderer),
      sceneObjectCount: this.scene.children.length,
      renderedElementCount: this.objects.size,
      elements,
    };
  }
}

export function vecChanged(a: Vec3, b: Vec3): boolean {
  return !vecEq(a, b);
}
