import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, RotateCw, Camera } from 'lucide-react';
import * as THREE from 'three';
import { useCanvasStore } from '@/stores/canvasStore';

interface Image3DCameraEditorProps {
  nodeId: string;
  imageUrl: string;
  onClose: () => void;
}

interface CameraParams {
  pitch: number;
  yaw: number;
  distance: number;
  azimuth: number;
}

const FIXED_OBSERVER_Z = 4;
const IMAGE_DISTANCE_SCALE = 2;
const GROUND_Y = -1;
const DEFAULT_PARAMS: CameraParams = { pitch: 0, yaw: 0, distance: 1.0, azimuth: 0 };

export default function Image3DCameraEditor({ nodeId, imageUrl, onClose }: Image3DCameraEditorProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [params, setParams] = useState<CameraParams>(DEFAULT_PARAMS);
  const previewRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const wireRef = useRef<THREE.LineSegments | null>(null);
  const diagRef = useRef<THREE.LineSegments | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const animRef = useRef<number | null>(null);
  const paramsRef = useRef<CameraParams>(DEFAULT_PARAMS);

  // Keep paramsRef in sync
  useEffect(() => { paramsRef.current = params; }, [params]);

  // Init scene + start persistent render loop
  useEffect(() => {
    if (!previewRef.current) return;
    const c = previewRef.current;
    const w = c.clientWidth || 1, h = c.clientHeight || 1;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1816);
    sceneRef.current = scene;
    const cam = new THREE.PerspectiveCamera(38, w / h, 0.1, 1000);
    cam.position.set(0, 0, FIXED_OBSERVER_Z);
    cameraRef.current = cam;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', position: 'absolute', top: '0', left: '0' });
    c.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    const grid = new THREE.GridHelper(10, 20, 0x5c5349, 0x2d2926);
    grid.position.y = GROUND_Y;
    scene.add(grid);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 5, 5);
    scene.add(dl);

    // Persistent render loop — always running, reads params from ref
    const animate = () => {
      const { pitch, yaw, distance, azimuth } = paramsRef.current;
      const pr = (pitch * Math.PI) / 180, yr = (yaw * Math.PI) / 180, ar = (azimuth * Math.PI) / 180;
      const iz = -distance * IMAGE_DISTANCE_SCALE;
      const ph = (meshRef.current?.geometry as any)?.parameters?.height ?? 2;
      const iy = GROUND_Y + ph / 2;
      if (meshRef.current) { meshRef.current.position.set(0, iy, iz); meshRef.current.rotation.set(pr, yr, ar); }
      if (wireRef.current) { wireRef.current.position.set(0, iy, iz); wireRef.current.rotation.set(pr, yr, ar); }
      if (diagRef.current) { diagRef.current.position.set(0, iy, iz); diagRef.current.rotation.set(pr, yr, ar); }
      cam.position.set(0, 0, FIXED_OBSERVER_Z);
      cam.lookAt(0, iy, iz);
      renderer.render(scene, cam);
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      renderer.dispose();
      if (c.contains(renderer.domElement)) c.removeChild(renderer.domElement);
      textureRef.current?.dispose();
      meshRef.current?.geometry.dispose();
      wireRef.current?.geometry.dispose();
      diagRef.current?.geometry.dispose();
    };
  }, []);

  // Load texture
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(imageUrl, (tex) => {
      textureRef.current = tex;
      if (!sceneRef.current) return;
      const ar = (tex.image?.width || 1) / (tex.image?.height || 1);
      const pw = 2, ph = pw / ar;
      const geo = new THREE.PlaneGeometry(pw, ph);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      sceneRef.current.add(mesh);
      meshRef.current = mesh;
      const boxGeo = new THREE.BoxGeometry(pw + 0.1, ph + 0.1, 0.2);
      const wfGeo = new THREE.WireframeGeometry(boxGeo);
      const wire = new THREE.LineSegments(wfGeo, new THREE.LineBasicMaterial({ color: 0xc4a574 }));
      sceneRef.current.add(wire);
      wireRef.current = wire;
      const dVerts = new Float32Array([-pw / 2, -ph / 2, 0, pw / 2, ph / 2, 0, pw / 2, -ph / 2, 0, -pw / 2, ph / 2, 0]);
      const dGeo = new THREE.BufferGeometry();
      dGeo.setAttribute('position', new THREE.BufferAttribute(dVerts, 3));
      const diag = new THREE.LineSegments(dGeo, new THREE.LineBasicMaterial({ color: 0xc4a574 }));
      sceneRef.current.add(diag);
      diagRef.current = diag;
      setImageLoaded(true);
    }, undefined, () => setImageLoaded(true));
  }, [imageUrl]);

  // Resize
  useEffect(() => {
    const onResize = () => {
      if (!previewRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = previewRef.current.clientWidth, h = previewRef.current.clientHeight;
      if (w > 0 && h > 0) { cameraRef.current.aspect = w / h; cameraRef.current.updateProjectionMatrix(); rendererRef.current.setSize(w, h); }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleApply = useCallback(() => {
    const { pitch, yaw, distance, azimuth } = params;
    const prompt = `视角参数: pitch=${pitch}°, yaw=${yaw}°, distance=${distance}, azimuth=${azimuth}°`;
    useCanvasStore.getState().triggerAgentAction('ai-3d-camera', nodeId, prompt);
    onClose();
  }, [nodeId, onClose, params]);

  const sliders: { key: keyof CameraParams; label: string; unit: string; min: number; max: number; step: number }[] = [
    { key: 'pitch', label: '俯仰', unit: '°', min: -90, max: 90, step: 1 },
    { key: 'yaw', label: '偏航', unit: '°', min: -180, max: 180, step: 1 },
    { key: 'distance', label: '距离', unit: '', min: 0.5, max: 3, step: 0.1 },
    { key: 'azimuth', label: '方位', unit: '°', min: 0, max: 360, step: 1 },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[99999] overflow-hidden" style={{ background: '#1a1816' }}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(165deg, #1c1917 0%, #292524 40%, #1f1d1b 100%)' }} />
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-6 py-3">
        <span className="text-[#c4a574] text-sm tracking-[0.2em] uppercase font-light">视角 View</span>
        <button onClick={onClose} className="p-2 text-[#78716c] hover:text-[#c4a574] transition-colors rounded hover:bg-white/5" title="ESC"><X size={20} /></button>
      </div>
      <div className="absolute inset-0 flex pt-14 pb-6 pl-6 pr-6 gap-6 overflow-hidden z-10">
        <div ref={previewRef} className="flex-1 relative min-w-0 rounded-lg overflow-hidden" style={{ boxShadow: 'inset 0 0 0 1px rgba(196,165,116,0.2)', background: '#0c0b0a' }}>
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center z-10"><Loader2 className="w-6 h-6 animate-spin text-[#57534e]" /><span className="text-xs text-[#57534e] ml-2">Loading</span></div>
          )}
        </div>
        <div className="w-72 flex-shrink-0 flex flex-col gap-5 py-5 px-5 overflow-y-auto" style={{ background: 'rgba(28,25,23,0.6)', border: '1px solid rgba(196,165,116,0.15)', borderRadius: 12 }}>
          <div className="text-[#e7e5e4] text-[13px] font-medium border-b border-[#c4a574]/20 pb-3">视角参数</div>
          {sliders.map(({ key, label, unit, min, max, step }) => (
            <div key={key} className="space-y-1.5">
              <div className="flex justify-between"><label className="text-[#a8a29e] text-xs">{label}</label><span className="text-[#c4a574] text-xs tabular-nums">{Number.isInteger(params[key]) ? params[key] : params[key].toFixed(1)}{unit}</span></div>
              <input type="range" min={min} max={max} step={step} value={params[key]} onChange={(e) => setParams((p) => ({ ...p, [key]: Number(e.target.value) }))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-[#292524] [accent-color:#c4a574]" />
            </div>
          ))}
          <div className="flex flex-col gap-2 pt-2 border-t border-[#c4a574]/15">
            <button onClick={() => setParams(DEFAULT_PARAMS)} className="w-full py-2.5 text-[#a8a29e] hover:text-[#e7e5e4] hover:bg-white/5 rounded-lg text-xs flex items-center justify-center gap-2"><RotateCw size={14} />重置</button>
            <button onClick={handleApply} disabled={!imageLoaded} className="w-full py-3 rounded-lg text-[#1c1917] text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50" style={{ background: imageLoaded ? '#c4a574' : 'rgba(196,165,116,0.4)' }}>
              <Camera size={16} />应用视角并生成
            </button>
          </div>
          <p className="text-[10px] text-[#57534e]">拖动滑块调整视角，生成图将由 Agent 处理。ESC 关闭</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
