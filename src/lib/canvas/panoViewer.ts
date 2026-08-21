/**
 * panoViewer — 迷你 equirect 全景预览器（three.js，命令式）。
 * 球面内壁贴图 + 拖拽改 yaw/pitch。挂载返回 dispose。
 */
import * as THREE from 'three';

export function mountPanoViewer(container: HTMLDivElement, imageUrl: string): () => void {
  const w = container.clientWidth || 280;
  const h = container.clientHeight || 200;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, w / h, 0.1, 100);
  camera.position.set(0, 0, 0.01);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // 球面内壁
  const geo = new THREE.SphereGeometry(10, 48, 32);
  geo.scale(-1, 1, 1); // 翻法线朝内
  const mat = new THREE.MeshBasicMaterial();
  const sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);

  new THREE.TextureLoader().load(imageUrl, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.needsUpdate = true;
  });

  // 拖拽环视
  let yaw = 0;
  let pitch = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.005;
    pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX;
    lastY = e.clientY;
    e.stopPropagation();
  };
  const onUp = () => { dragging = false; };

  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointerleave', onUp);

  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    renderer.render(scene, camera);
  };
  loop();

  // 容器尺寸跟随
  const ro = new ResizeObserver(() => {
    const nw = container.clientWidth;
    const nh = container.clientHeight;
    if (!nw || !nh) return;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  ro.observe(container);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.domElement.removeEventListener('pointerdown', onDown);
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('pointerup', onUp);
    renderer.domElement.removeEventListener('pointerleave', onUp);
    geo.dispose();
    mat.map?.dispose();
    mat.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
