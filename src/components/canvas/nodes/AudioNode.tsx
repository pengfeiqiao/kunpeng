/**
 * AudioNode — uploaded audio reference (voice/music) for Seedance multimodal
 * generation. Referenced in prompts as @音频一 (text-only convention — audio
 * does NOT take an @图片N slot, per AGENT.md).
 */
import { memo, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { AudioLines, Bot, Trash2, Music, Link2, Download, FolderOpen } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { copyFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { message as tauriMessage } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import type { AudioNodeData } from '@/types/canvas';
import type { WorkshopRef } from '@/lib/workshop/canvasSync';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';
import { useHasMultiNodeSelection } from '../NodeToolbarPortal';

function audioSourcePath(data: AudioNodeData): string {
  return data.localPath || (data.audioUrl ? assetUrlToLocalPath(data.audioUrl) : '');
}

function defaultAudioName(path: string): string {
  const base = path.split('/').pop()?.split('?')[0]?.split('#')[0] || '';
  if (/\.(mp3|wav|m4a|ogg|opus|pcm|webm)$/i.test(base)) return base;
  return `audio-${Date.now()}.mp3`;
}

function VoiceLinkButton({ nodeId, localPath }: { nodeId: string; localPath?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const project = useWorkshopStore((s) => s.project);
  const characters = useWorkshopStore((s) => s.data?.characters ?? []);
  const edges = useCanvasStore((s) => s.edges);
  const nodes = useCanvasStore((s) => s.nodes);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (!project || characters.length === 0) return null;

  const connectedIds = edges
    .filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => (e.source === nodeId ? e.target : e.source));
  let linkedChar: { id: string; name: string } | null = null;
  for (const cid of connectedIds) {
    const n = nodes.find((nd) => nd.id === cid);
    if (!n) continue;
    const ref = (n.data as Record<string, unknown>)?.workshopRef as WorkshopRef | undefined;
    if (ref && ref.projectId === project.id && ref.kind === 'character' && ref.role === 'asset') {
      const ch = characters.find((c) => c.id === ref.id);
      if (ch) { linkedChar = { id: ch.id, name: ch.name }; break; }
    }
  }

  const syncToCharacter = async (charId: string) => {
    if (!localPath) { await tauriMessage('此音频节点没有本地文件', { title: '提示' }); return; }
    setBusy(true);
    try {
      const ext = localPath.includes('.') ? localPath.slice(localPath.lastIndexOf('.')) : '.mp3';
      const relDir = `.kunpeng/aigc-memory/projects/${project.id}/assets/voices`;
      await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
      const rel = `${relDir}/${charId.replace(/[^\w-]+/g, '_')}-cv${ext}`;
      await copyFile(localPath, rel, { dir: BaseDirectory.Home });
      const home = await homeDir();
      useWorkshopStore.getState().setCharacterVoice(charId, `${home}${rel}`, 'canvas');
      const charName = characters.find((c) => c.id === charId)?.name ?? charId;
      await tauriMessage(`已关联音频到角色「${charName}」`, { title: '成功' });
    } catch (err) {
      await tauriMessage(`关联失败：${err}`, { title: '错误' });
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  if (linkedChar) {
    return (
      <button
        onClick={() => void syncToCharacter(linkedChar!.id)}
        disabled={busy}
        className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-accent)] disabled:opacity-40 flex items-center gap-0.5 text-[10px] whitespace-nowrap"
        title={`同步到角色「${linkedChar.name}」`}
      >
        <Link2 size={12} />
        <span className="max-w-[60px] truncate">{linkedChar.name}</span>
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        disabled={busy}
        className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-accent)] disabled:opacity-40 flex items-center gap-0.5 text-[10px] whitespace-nowrap"
        title="关联工坊角色"
      >
        <Link2 size={12} />
        <span>关联角色</span>
      </button>
      {menuOpen && (
        <div
          className="absolute top-full mt-1 left-1/2 -translate-x-1/2 rounded-xl py-1 z-50 min-w-[120px]"
          style={{ background: 'rgba(24,25,28,0.97)', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 12px 36px rgba(0,0,0,0.5)' }}
        >
          {characters.map((c) => (
            <button
              key={c.id}
              onClick={() => void syncToCharacter(c.id)}
              className="w-full px-3 py-1.5 text-left text-[11px] text-[var(--canvas-text-2)] hover:bg-[rgba(255,255,255,0.07)] hover:text-[var(--canvas-text-1)] transition-colors truncate"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AudioNodeComponent({ id, data, selected }: NodeProps<AudioNodeData>) {
  const hasMultiSelection = useHasMultiNodeSelection();
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const wsProject = useWorkshopStore((s) => s.project);

  const handleDownload = async () => {
    const source = audioSourcePath(data);
    if (!source) { await tauriMessage('未找到可下载的音频文件', { title: '提示' }); return; }
    try {
      await invoke('save_file_dialog', { sourcePath: source, defaultName: defaultAudioName(source) });
    } catch (err) {
      console.error('下载音频失败:', err);
      await tauriMessage(`下载失败：${err instanceof Error ? err.message : String(err)}`, { title: '错误' });
    }
  };

  const handleOpenFolder = async () => {
    const source = audioSourcePath(data);
    if (!source) { await tauriMessage('未找到本地音频文件', { title: '提示' }); return; }
    try {
      await invoke('open_path', { path: source, reveal: true });
    } catch (err) {
      console.error('打开音频位置失败:', err);
      await tauriMessage(`打开失败：${err instanceof Error ? err.message : String(err)}`, { title: '错误' });
    }
  };

  return (
    // width/height 100% 让节点跟随 NodeResizer 写入的 node.style；minWidth 保证
    // 未调整过的音频节点也有合理大小（与 image/video 一致的可调体验）。
    <div
      className={`relative group h-full ${selected ? 'shadow-[0_0_0_1.5px_rgba(255,255,255,0.7),0_4px_24px_rgba(0,0,0,0.35)]' : 'shadow-sm hover:shadow-[0_1px_4px_1px_rgba(255,255,255,0.08)]'} ${(data as Record<string, unknown>).isGenerating ? 'flowing-border' : ''}`}
      style={{ width: '100%', height: '100%', minWidth: 280, minHeight: 96 }}
    >

      {/* 节点外左上角标题 */}
      <div className="absolute -top-6 left-0.5 flex items-center gap-1.5 pointer-events-none">
        <Music size={11} className="text-[var(--canvas-text-3)]" />
        <span className="text-[11px] text-[var(--canvas-text-3)] font-medium">Audio</span>
      </div>

      {selected && !hasMultiSelection && (
        <div className="absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-1 rounded-lg bg-[var(--canvas-panel)] shadow-md border border-[var(--canvas-node-border)] z-10">
          <button onClick={() => openCanvasNodeInAgent(id)} className="flex items-center gap-1 p-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]" title="把当前音频节点交给 Agent 操作"><Bot size={13} /><span className="text-[10px]">Agent</span></button>
          {wsProject && <VoiceLinkButton nodeId={id} localPath={data.localPath} />}
          {data.audioUrl && (
            <>
              <button onClick={() => void handleDownload()} className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-accent)]" title="下载音频"><Download size={13} /></button>
              <button onClick={() => void handleOpenFolder()} className="p-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-accent)]" title="在 Finder 中定位"><FolderOpen size={13} /></button>
            </>
          )}
          <button onClick={() => deleteNode(id)} className="p-1 rounded hover:bg-[rgba(255,97,99,0.15)] text-[var(--canvas-text-2)] hover:text-red-500" title="删除"><Trash2 size={13} /></button>
        </div>
      )}

      {selected && (
        <NodeResizer
          color="#a8a8a8"
          isVisible={selected}
          minWidth={280}
          minHeight={96}
          handleStyle={{ backgroundColor: '#a8a8a8', border: '1px solid #141414', borderRadius: '50%', width: 6, height: 6 }}
          lineStyle={{ borderColor: '#a8a8a8', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        className="rounded-2xl transition-all duration-200 h-full"
        style={{ background: 'var(--canvas-node-bg)', border: `1px solid ${selected ? 'transparent' : 'var(--canvas-node-border)'}` }}
      >
        <div className="p-2.5 flex flex-col gap-1.5 h-full">
          {data.audioUrl ? (
            <>
              {/* nodrag nopan：阻止 ReactFlow 接管原生音频控件的指针事件，
                  避免点播放后鼠标被拖拽逻辑"咬住"无法移出节点。 */}
              <audio src={data.audioUrl} controls className="nodrag nopan w-full h-9 shrink-0" preload="none" />
            </>
          ) : (data as Record<string, unknown>).isGenerating ? (
            <div className="h-12 flex items-center justify-center text-[10px] text-[var(--canvas-text-2)]">
              生成中…
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <AudioLines size={20} className="text-[var(--canvas-text-3)]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(AudioNodeComponent);
