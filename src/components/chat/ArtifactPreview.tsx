import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import {
  Archive,
  Code2,
  Copy,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  Folder,
  Image as ImageIcon,
  Music2,
  Play,
  Video,
  X,
} from 'lucide-react';
import {
  ensureChatHomeDir,
  expandChatPath,
  isRemoteUri,
  type ChatArtifact,
  type ChatArtifactKind,
} from '@/lib/chat/artifacts';

function artifactIcon(kind: ChatArtifactKind, size = 15) {
  const props = { size, strokeWidth: 1.8 };
  if (kind === 'image') return <ImageIcon {...props} />;
  if (kind === 'video') return <Video {...props} />;
  if (kind === 'audio') return <Music2 {...props} />;
  if (kind === 'code') return <Code2 {...props} />;
  if (kind === 'document') return <FileText {...props} />;
  if (kind === 'archive') return <Archive {...props} />;
  if (kind === 'folder') return <Folder {...props} />;
  return <File {...props} />;
}

function artifactKindLabel(kind: ChatArtifactKind): string {
  const labels: Record<ChatArtifactKind, string> = {
    image: '图片',
    video: '视频',
    audio: '音频',
    code: '代码',
    document: '文档',
    archive: '压缩包',
    folder: '文件夹',
    link: '链接',
    other: '文件',
  };
  return labels[kind];
}

export function useArtifactSource(uri: string): { resolved: string; source: string } {
  const needsHome = /^(?:~|～)\//.test(uri);
  const [homeReady, setHomeReady] = useState(!needsHome);
  useEffect(() => {
    let mounted = true;
    void ensureChatHomeDir().finally(() => mounted && setHomeReady(true));
    return () => { mounted = false; };
  }, []);
  return useMemo(() => {
    if (needsHome && !homeReady) return { resolved: uri, source: '' };
    const resolved = expandChatPath(uri);
    return {
      resolved,
      source: isRemoteUri(resolved) ? resolved : convertFileSrc(resolved),
    };
  }, [homeReady, needsHome, uri]);
}

async function openArtifact(uri: string, reveal = false) {
  await ensureChatHomeDir();
  const target = expandChatPath(uri);
  await invoke('open_path', { path: target, reveal: reveal && !isRemoteUri(target) });
}

function MediaFallback({ artifact }: { artifact: ChatArtifact }) {
  return (
    <button
      type="button"
      onClick={() => void openArtifact(artifact.uri)}
      className="flex min-h-[76px] w-full items-center gap-3 px-3 text-left text-[rgb(var(--c-text-muted))] transition-colors hover:text-[rgb(var(--c-text))]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--c-border))]">
        {artifactIcon(artifact.kind, 17)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-[rgb(var(--c-text))]">{artifact.name}</span>
        <span className="mt-0.5 block text-[11px]">预览不可用，点击用系统应用打开</span>
      </span>
    </button>
  );
}

export function ArtifactPreview({
  artifact,
  compact = false,
  onPreviewImage,
}: {
  artifact: ChatArtifact;
  compact?: boolean;
  onPreviewImage?: (artifact: ChatArtifact) => void;
}) {
  const { source } = useArtifactSource(artifact.uri);
  const [failed, setFailed] = useState(false);

  if (!source) {
    return <div className="h-20 animate-pulse bg-[rgb(var(--c-border))]/50" />;
  }

  if (artifact.kind === 'image') {
    if (failed) return <MediaFallback artifact={artifact} />;
    return (
      <button
        type="button"
        className="group relative block w-full overflow-hidden bg-[rgb(var(--c-card))] text-left"
        onClick={() => onPreviewImage?.(artifact)}
        title={artifact.name}
      >
        <img
          src={source}
          alt={artifact.name}
          loading="lazy"
          className={`${compact ? 'h-24' : 'max-h-[260px]'} w-full object-cover`}
          onError={() => setFailed(true)}
        />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/75 to-transparent px-2.5 pb-2 pt-7 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
          <span className="truncate">{artifact.name}</span>
          <ExternalLink size={11} className="shrink-0" />
        </span>
      </button>
    );
  }

  if (artifact.kind === 'video') {
    if (failed) return <MediaFallback artifact={artifact} />;
    return (
      <div className="relative overflow-hidden bg-black">
        <video
          src={source}
          controls={!compact}
          muted={compact}
          playsInline
          preload="metadata"
          className={`${compact ? 'h-24' : 'max-h-[300px]'} w-full object-contain`}
          onError={() => setFailed(true)}
        />
        {compact && (
          <button
            type="button"
            onClick={() => void openArtifact(artifact.uri)}
            className="absolute inset-0 flex items-center justify-center bg-black/10 text-white transition-colors hover:bg-black/25"
            title={`打开 ${artifact.name}`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60"><Play size={14} fill="currentColor" /></span>
          </button>
        )}
      </div>
    );
  }

  if (artifact.kind === 'audio') {
    if (failed) return <MediaFallback artifact={artifact} />;
    return (
      <div className="flex min-h-[82px] items-center gap-3 px-3 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))]">
          <Music2 size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 truncate text-xs text-[rgb(var(--c-text))]">{artifact.name}</div>
          <audio src={source} controls preload="metadata" className="h-8 w-full" onError={() => setFailed(true)} />
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void openArtifact(artifact.uri)}
      className="group/file flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-[rgb(var(--c-card))]"
      title={artifact.uri}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--c-card))] text-[rgb(var(--c-text-muted))] group-hover/file:bg-white dark:group-hover/file:bg-white/10">
        {artifactIcon(artifact.kind, 14)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[rgb(var(--c-text))]">{artifact.name}</span>
      </span>
      <span className="shrink-0 text-[10px] text-[rgb(var(--c-text-muted))] opacity-0 transition-opacity group-hover/file:opacity-100">
        {artifactKindLabel(artifact.kind)}
      </span>
      <ExternalLink size={12} className="shrink-0 text-[rgb(var(--c-text-muted))] opacity-0 transition-opacity group-hover/file:opacity-100" />
    </button>
  );
}

function AttachmentTile({ artifact, onPreview }: { artifact: ChatArtifact; onPreview: (artifact: ChatArtifact) => void }) {
  const { source } = useArtifactSource(artifact.uri);
  const isImage = artifact.kind === 'image';
  return (
    <button
      type="button"
      onClick={() => isImage ? onPreview(artifact) : void openArtifact(artifact.uri)}
      className="flex h-[54px] min-w-0 max-w-[260px] items-center gap-2.5 rounded-lg border border-[rgb(var(--c-border))] bg-white p-1.5 pr-2.5 text-left transition-colors hover:bg-[rgb(var(--c-card))] dark:bg-[rgb(var(--c-card))]"
      title={artifact.uri}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))]">
        {isImage && source
          ? <img src={source} alt="" className="h-full w-full object-cover" />
          : artifactIcon(artifact.kind, 16)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-[rgb(var(--c-text))]">{artifact.name}</span>
        <span className="mt-0.5 block text-[10px] text-[rgb(var(--c-text-muted))]">{artifactKindLabel(artifact.kind)}</span>
      </span>
    </button>
  );
}

function displayArtifactPath(uri: string): string {
  const path = expandChatPath(uri).replaceAll('\\', '/');
  const homeMatch = path.match(/^\/Users\/[^/]+\/(.+)$/);
  return homeMatch?.[1] || path.replace(/^file:\/\//, '');
}

function FileArtifactSummary({ artifacts }: { artifacts: ChatArtifact[] }) {
  const edited = artifacts.some((artifact) => /edit|write|patch/i.test(artifact.toolName ?? ''));
  const title = edited ? `已编辑 ${artifacts.length} 个文件` : `已生成 ${artifacts.length} 个文件`;
  const added = artifacts.reduce((sum, artifact) => sum + (artifact.addedLines ?? 0), 0);
  const deleted = artifacts.reduce((sum, artifact) => sum + (artifact.deletedLines ?? 0), 0);
  const hasStats = artifacts.some((artifact) => artifact.addedLines !== undefined || artifact.deletedLines !== undefined);
  return (
    <div className="mt-3 max-w-2xl overflow-hidden rounded-lg border border-[rgb(var(--c-border))] bg-white dark:bg-transparent">
      <div className="flex min-h-14 items-center gap-3 border-b border-[rgb(var(--c-border))] px-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgb(var(--c-card))] text-[rgb(var(--c-text-muted))]">
          <FilePlus2 size={18} strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-[rgb(var(--c-text))]">{title}</span>
          {hasStats && (
            <span className="mt-0.5 flex items-center gap-2 text-[12px]">
              <span className="text-emerald-600">+{added}</span>
              <span className="text-red-500">-{deleted}</span>
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void openArtifact(artifacts[0].uri, true)}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] transition-colors hover:bg-[rgb(var(--c-card))] hover:text-[rgb(var(--c-text))]"
          title="在 Finder 中查看"
        >
          <Folder size={15} />
        </button>
      </div>
      <div className="py-1">
        {artifacts.map((artifact) => (
          <button
            key={artifact.id}
            type="button"
            onClick={() => void openArtifact(artifact.uri)}
            className="group/file flex min-h-10 w-full items-center gap-3 px-3 text-left transition-colors hover:bg-[rgb(var(--c-card))]"
            title={artifact.uri}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] text-[rgb(var(--c-text-muted))]">
              {displayArtifactPath(artifact.uri)}
            </span>
            {(artifact.addedLines !== undefined || artifact.deletedLines !== undefined) ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums">
                <span className="text-emerald-600">+{artifact.addedLines ?? 0}</span>
                <span className="text-red-500">-{artifact.deletedLines ?? 0}</span>
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-[rgb(var(--c-text-muted))] opacity-0 transition-opacity group-hover/file:opacity-100">打开</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ArtifactGrid({ artifacts, compact = false }: { artifacts: ChatArtifact[]; compact?: boolean }) {
  const visible = artifacts.filter((artifact) => !artifact.embedded);
  const [lightbox, setLightbox] = useState<ChatArtifact | null>(null);
  if (visible.length === 0) return null;

  if (compact) {
    return (
      <>
        <div className="mt-2 flex max-w-full flex-wrap justify-end gap-2">
          {visible.map((artifact) => (
            <AttachmentTile key={artifact.id} artifact={artifact} onPreview={setLightbox} />
          ))}
        </div>
        <AnimatePresence>
          {lightbox && <ArtifactLightbox artifact={lightbox} onClose={() => setLightbox(null)} />}
        </AnimatePresence>
      </>
    );
  }

  const media = visible.filter((artifact) => artifact.kind === 'image' || artifact.kind === 'video' || artifact.kind === 'audio');
  const files = visible.filter((artifact) => !media.includes(artifact));

  return (
    <>
      {media.length > 0 && (
        <div className={`mt-3 grid gap-2 ${media.length === 1 ? 'max-w-xl grid-cols-1' : 'grid-cols-2'}`}>
          {media.map((artifact) => (
            <div key={artifact.id} className="min-w-0 overflow-hidden rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-card))]">
              <ArtifactPreview artifact={artifact} onPreviewImage={setLightbox} />
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <FileArtifactSummary artifacts={files} />
      )}
      <AnimatePresence>
        {lightbox && <ArtifactLightbox artifact={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </>
  );
}

export function ArtifactLightbox({ artifact, onClose }: { artifact: ChatArtifact; onClose: () => void }) {
  const { source, resolved } = useArtifactSource(artifact.uri);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/82 p-8 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative flex max-h-full max-w-full flex-col overflow-hidden rounded-lg bg-zinc-950 shadow-2xl"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(event) => event.stopPropagation()}
      >
        <img src={source} alt={artifact.name} className="max-h-[82vh] max-w-[88vw] object-contain" />
        <div className="flex h-11 items-center gap-2 border-t border-white/10 px-3 text-xs text-zinc-300">
          <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(resolved)}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
            title="复制路径"
          >
            <Copy size={13} />
          </button>
          {!isRemoteUri(resolved) && (
            <button
              type="button"
              onClick={() => void openArtifact(resolved, true)}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
              title="在 Finder 中显示"
            >
              <Folder size={13} />
            </button>
          )}
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10" title="关闭">
            <X size={14} />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export async function revealChatArtifact(artifact: ChatArtifact) {
  await openArtifact(artifact.uri, true);
}

export async function openChatArtifact(artifact: ChatArtifact) {
  await openArtifact(artifact.uri);
}
