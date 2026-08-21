/**
 * FloatingMenu — 拖线松手弹出「引用该节点生成」大面板。
 * 深色玻璃，按源类型过滤选项（文本/图片/视频/3D 世界/音频），
 * 选择后只建节点+连线（不自动生成）。
 */
import { memo } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, FileText, Globe2, ImageIcon, Music } from 'lucide-react';

export type FloatingMenuTarget = 'text' | 'image' | 'video' | 'panorama' | 'audio';

interface FloatingMenuProps {
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  sourceNodeType: 'text' | 'image' | 'video' | 'group';
  onSelect: (type: FloatingMenuTarget) => void;
  onClose: () => void;
}

interface Option {
  id: FloatingMenuTarget;
  icon: typeof FileText;
  label: string;
  desc?: string;
}

const ALL_OPTIONS: Record<FloatingMenuTarget, Option> = {
  text: { id: 'text', icon: FileText, label: '文本', desc: '剧本梗概、台词旁白、营销文案' },
  image: { id: 'image', icon: ImageIcon, label: '图片' },
  video: { id: 'video', icon: Clapperboard, label: '视频' },
  panorama: { id: 'panorama', icon: Globe2, label: '3D 世界' },
  audio: { id: 'audio', icon: Music, label: '音频' },
};

/** 按源类型过滤可生成目标 */
function optionsFor(sourceType: FloatingMenuProps['sourceNodeType']): Option[] {
  switch (sourceType) {
    case 'text':
      return [ALL_OPTIONS.image, ALL_OPTIONS.video, ALL_OPTIONS.panorama, ALL_OPTIONS.audio];
    case 'image':
      return [ALL_OPTIONS.text, ALL_OPTIONS.image, ALL_OPTIONS.video, ALL_OPTIONS.panorama];
    case 'video':
      return [
        ALL_OPTIONS.text,
        { ...ALL_OPTIONS.image, desc: '从视频截取一帧' },
        { ...ALL_OPTIONS.video, desc: '基于当前视频续写' },
        { ...ALL_OPTIONS.audio, desc: '分离人声 / 配乐' },
      ];
    case 'group':
      return [ALL_OPTIONS.image, ALL_OPTIONS.video];
  }
}

function FloatingMenu({ x, y, sourceX, sourceY, sourceNodeType, onSelect, onClose }: FloatingMenuProps) {
  const options = optionsFor(sourceNodeType);
  // 面板钳制视口
  const PANEL_W = 300;
  const panelH = options.length * 76 + 64;
  const px = Math.min(x, window.innerWidth - PANEL_W - 24);
  const py = Math.min(Math.max(y - 40, 24), window.innerHeight - panelH - 24);

  const content = (
    <div className="canvas-dark">
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* 弧线连接 */}
      <svg className="fixed z-[45] pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%' }}>
        <path
          d={`M ${sourceX} ${sourceY} C ${sourceX + Math.max(60, (px - sourceX) * 0.5)} ${sourceY}, ${px - Math.max(60, (px - sourceX) * 0.5)} ${py + 44}, ${px} ${py + 44}`}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>
      {/* 大面板 */}
      <div
        className="fixed z-50 flex flex-col"
        style={{
          left: px,
          top: py,
          width: PANEL_W,
          padding: '20px 16px',
          gap: 8,
          borderRadius: 20,
          background: 'rgba(20,21,24,0.93)',
          backdropFilter: 'blur(36px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.5)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          backgroundImage: 'radial-gradient(ellipse at 90% 110%, rgba(31,70,96,0.22), transparent 55%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[13px] text-[rgba(255,255,255,0.5)] px-2 mb-1 tracking-wide">引用该节点生成</p>
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => { onSelect(opt.id); onClose(); }}
            className="flex items-center gap-3.5 px-3.5 py-3 rounded-2xl transition-all duration-150 hover:bg-[rgba(255,255,255,0.07)] active:scale-[0.985] text-left"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <opt.icon size={20} className="text-white" strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <p className="text-[16px] font-semibold text-white leading-tight">{opt.label}</p>
              {opt.desc && <p className="text-[12px] text-[rgba(255,255,255,0.42)] mt-0.5 leading-snug">{opt.desc}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : null;
}

export default memo(FloatingMenu);
