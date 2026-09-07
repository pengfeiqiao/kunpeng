import { convertFileSrc } from '@tauri-apps/api/tauri';
import { FileAudio, Film, Image as ImageIcon, Layers3, MessageSquareText, X } from 'lucide-react';
import { useWorkshopStore } from '@/stores/workshopStore';
import { removeProjectConversationReference } from '@/lib/projectObjects/conversationRefs';
import type { ProjectConversationReference } from '@/lib/projectObjects/types';

function previewSource(path?: string): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|asset:|data:)/i.test(path)) return path;
  return path.startsWith('/') ? convertFileSrc(path) : path;
}

function mediaKind(path?: string): 'image' | 'video' | 'audio' | 'other' {
  if (!path) return 'other';
  if (/^data:image\//i.test(path) || /\.(png|jpe?g|webp|gif|heic|avif)(?:[?#].*)?$/i.test(path)) return 'image';
  if (/^data:video\//i.test(path) || /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(path)) return 'video';
  if (/^data:audio\//i.test(path) || /\.(mp3|wav|m4a|aac|flac|ogg)(?:[?#].*)?$/i.test(path)) return 'audio';
  return 'other';
}

function ReferenceIcon({ reference }: { reference: ProjectConversationReference }) {
  const kind = mediaKind(reference.thumbnailPath);
  if (kind === 'video') return <Film size={13} />;
  if (kind === 'audio') return <FileAudio size={13} />;
  if (kind === 'image') return <ImageIcon size={13} />;
  if (reference.kind === 'text-selection') return <MessageSquareText size={13} />;
  return <Layers3 size={13} />;
}

export default function ProjectConversationContext({
  variant = 'dark',
  currentLabel,
  currentMeta,
}: {
  variant?: 'dark' | 'light';
  currentLabel?: string;
  currentMeta?: string;
}) {
  const references = useWorkshopStore((state) => state.data?.projectViewState?.conversationReferences ?? []);
  const updateProjectViewState = useWorkshopStore((state) => state.updateProjectViewState);
  if (!currentLabel && references.length === 0) return null;

  const dark = variant === 'dark';
  const text1 = dark ? 'var(--canvas-text-1)' : '#1A1A1A';
  const text2 = dark ? 'var(--canvas-text-2)' : '#4B5563';
  const text3 = dark ? 'var(--canvas-text-3)' : '#9CA3AF';
  const border = dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.08)';
  const background = dark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.025)';

  const remove = (id: string) => updateProjectViewState({
    conversationReferences: removeProjectConversationReference(references, id),
  });

  return (
    <div className="min-w-0 rounded-xl border px-2.5 py-2" style={{ borderColor: border, background }}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background, color: text2 }}>
          <MessageSquareText size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[9px]" style={{ color: text3 }}>
            {currentLabel ? '当前对象' : '已添加到对话'}
          </span>
          <span className="block truncate text-[11px] font-medium" style={{ color: text1 }}>
            {currentLabel ?? `${references.length} 个项目对象`}
          </span>
          {currentMeta && <span className="block truncate text-[9px]" style={{ color: text3 }}>{currentMeta}</span>}
        </span>
        {references.length > 1 && (
          <button
            type="button"
            onClick={() => updateProjectViewState({ conversationReferences: [] })}
            className="h-7 shrink-0 rounded-md px-2 text-[9px]"
            style={{ color: text3 }}
            title="只清空对话引用，不删除项目素材"
          >
            清空引用
          </button>
        )}
      </div>
      {references.length > 0 && (
        <div className="mt-2 flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto">
          {references.map((reference) => {
            const preview = mediaKind(reference.thumbnailPath) === 'image'
              ? previewSource(reference.thumbnailPath)
              : undefined;
            return (
              <span
                key={reference.id}
                className="group flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg border pr-1"
                style={{ borderColor: border, color: text2, background: dark ? 'rgba(0,0,0,0.14)' : '#fff' }}
                title={`${reference.label}\n${reference.kind} · ${reference.operationScope}${reference.version ? ` · v${reference.version}` : ''}`}
              >
                <span className="flex h-full w-8 shrink-0 items-center justify-center overflow-hidden rounded-l-[7px]" style={{ background }}>
                  {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <ReferenceIcon reference={reference} />}
                </span>
                <span className="max-w-[150px] truncate text-[10px]">{reference.label}</span>
                {reference.version ? <span className="text-[8px]" style={{ color: text3 }}>v{reference.version}</span> : null}
                <button
                  type="button"
                  onClick={() => remove(reference.id)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-60 hover:opacity-100"
                  title="从对话移除，不删除项目素材"
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
