import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Music2,
  PanelRightClose,
  Video,
} from 'lucide-react';
import type { Message } from '@/types';
import { collectChatArtifacts, expandChatPath, isPresentableOutputArtifact, type ChatArtifact } from '@/lib/chat/artifacts';
import { ArtifactLightbox, ArtifactPreview, openChatArtifact, revealChatArtifact } from './ArtifactPreview';
import { useChatStore } from '@/stores/chatStore';

type OutputGroup = 'video' | 'image' | 'audio' | 'file';

const GROUP_META: Record<OutputGroup, { label: string; icon: typeof Video }> = {
  video: { label: '视频', icon: Video },
  image: { label: '图片', icon: ImageIcon },
  audio: { label: '音频', icon: Music2 },
  file: { label: '文件', icon: FileText },
};

function outputGroup(artifact: ChatArtifact): OutputGroup | null {
  if (!isPresentableOutputArtifact(artifact)) return null;
  if (artifact.kind === 'video') return 'video';
  if (artifact.kind === 'image') return 'image';
  if (artifact.kind === 'audio') return 'audio';
  if (['code', 'document', 'archive'].includes(artifact.kind)) return 'file';
  return null;
}

function friendlyToolSource(toolName: string, kind: OutputGroup): string {
  if (toolName.startsWith('workshop_')) return '工坊生成';
  if (toolName.startsWith('canvas_')) return '画布生成';
  if (toolName.startsWith('timeline_')) return '剪辑导出';
  if (toolName.startsWith('director_')) return '导演台导出';
  if (/image|seedream|gpt_image/.test(toolName)) return '图片生成';
  if (/video|omni|seedance/.test(toolName)) return '视频生成';
  if (/speech|audio/.test(toolName)) return '音频生成';
  if (/write|edit/.test(toolName)) return 'Agent 文件';
  return GROUP_META[kind].label;
}

function friendlyArtifactName(artifact: ChatArtifact, kind: OutputGroup): string {
  const clean = artifact.name.replace(/^`|`$/g, '').trim();
  if (!clean || clean.toLowerCase() === 'alt text' || /^[A-Za-z0-9_-]{24,}(?:\.[a-z0-9]+)?$/i.test(clean)) {
    return `生成的${GROUP_META[kind].label}`;
  }
  return clean;
}

function OutputSection({
  kind,
  artifacts,
  onPreview,
}: {
  kind: OutputGroup;
  artifacts: ChatArtifact[];
  onPreview: (artifact: ChatArtifact) => void;
}) {
  const [open, setOpen] = useState(true);
  if (artifacts.length === 0) return null;
  const Icon = GROUP_META[kind].icon;

  return (
    <section className="border-b border-[rgb(var(--c-border))] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[12px] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Icon size={13} />
        <span className="font-medium">{GROUP_META[kind].label}</span>
        <span className="ml-auto tabular-nums">{artifacts.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 px-3 pb-3">
              {artifacts.map((artifact) => (
                <OutputRow key={artifact.id} artifact={artifact} kind={kind} onPreview={onPreview} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function OutputRow({
  artifact,
  kind,
  onPreview,
}: {
  artifact: ChatArtifact;
  kind: OutputGroup;
  onPreview: (artifact: ChatArtifact) => void;
}) {
  const name = friendlyArtifactName(artifact, kind);
  const source = artifact.toolName ? friendlyToolSource(artifact.toolName, kind) : `对话中的${GROUP_META[kind].label}`;

  return (
    <div className="group overflow-hidden rounded-lg border border-[rgb(var(--c-border))] bg-white dark:bg-[rgb(var(--c-card))]">
      {(kind === 'image' || kind === 'video') && (
        <div className="max-h-40 overflow-hidden bg-[rgb(var(--c-card))]">
          <ArtifactPreview artifact={artifact} compact onPreviewImage={onPreview} />
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => void openChatArtifact(artifact)}
          className="min-w-0 flex-1 text-left"
          title={artifact.uri}
        >
          <span className="block truncate text-[12px] font-medium text-[rgb(var(--c-text))]">{name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-[rgb(var(--c-text-muted))]">{source}</span>
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(expandChatPath(artifact.uri))}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]"
          title="复制路径或链接"
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          onClick={() => void revealChatArtifact(artifact)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]"
          title="打开或在 Finder 中显示"
        >
          <ExternalLink size={12} />
        </button>
      </div>
    </div>
  );
}

export interface OutputDrawerProps {
  messages: Message[];
  sessionId: string | null;
  onClose: () => void;
  overlay?: boolean;
}

export default function OutputDrawer({ messages, onClose, overlay = false }: OutputDrawerProps) {
  const [lightbox, setLightbox] = useState<ChatArtifact | null>(null);
  const setActiveView = useChatStore((state) => state.setActiveView);
  const grouped = useMemo(() => {
    const result: Record<OutputGroup, ChatArtifact[]> = { video: [], image: [], audio: [], file: [] };
    for (const artifact of collectChatArtifacts(messages)) {
      const kind = outputGroup(artifact);
      if (kind) result[kind].push(artifact);
    }
    return result;
  }, [messages]);
  const total = Object.values(grouped).reduce((sum, items) => sum + items.length, 0);

  return (
    <>
      <motion.aside
        className={`${overlay ? 'absolute inset-y-3 right-3 z-30 shadow-2xl' : 'relative my-3 mr-3'} flex w-[336px] shrink-0 flex-col overflow-hidden rounded-xl border border-[rgb(var(--c-border))] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.10)] dark:bg-[rgb(var(--c-bg))]`}
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 18 }}
        transition={{ duration: 0.16 }}
        aria-label="生成结果"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[rgb(var(--c-border))] px-4">
          <span className="text-sm font-medium text-[rgb(var(--c-text))]">生成结果</span>
          {total > 0 && <span className="text-[11px] tabular-nums text-[rgb(var(--c-text-muted))]">{total}</span>}
          <button type="button" onClick={() => setActiveView('library')} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]" title="打开产物库">
            <FolderOpen size={14} />
          </button>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]" title="收起生成结果">
            <PanelRightClose size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {total === 0 ? (
            <div className="px-5 py-8 text-center">
              <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg border border-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))]">
                <ImageIcon size={16} />
              </div>
              <div className="text-[12px] font-medium text-[rgb(var(--c-text))]">还没有生成内容</div>
              <div className="mt-1 text-[11px] leading-5 text-[rgb(var(--c-text-muted))]">生图、视频、音频和导出文件会集中显示在这里。</div>
            </div>
          ) : (
            (['video', 'image', 'audio', 'file'] as OutputGroup[]).map((kind) => (
              <OutputSection key={kind} kind={kind} artifacts={grouped[kind]} onPreview={setLightbox} />
            ))
          )}
        </div>

        {total > 0 && (
          <footer className="flex h-11 shrink-0 items-center border-t border-[rgb(var(--c-border))] px-3">
            <button
              type="button"
              onClick={() => setActiveView('library')}
              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]"
            >
              <FolderOpen size={12} />
              打开产物库
            </button>
          </footer>
        )}
      </motion.aside>
      <AnimatePresence>
        {lightbox && <ArtifactLightbox artifact={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </>
  );
}
