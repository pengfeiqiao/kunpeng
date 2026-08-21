import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

export type ChannelConnectionState = 'online' | 'reconnecting' | 'error' | 'offline';

interface ChannelStatusBarProps {
  state: ChannelConnectionState;
  label: string;
  detail?: string;
  active?: number;
  pending?: number;
  onRecover?: () => void;
  recoverLabel?: string;
}

const dotClass: Record<ChannelConnectionState, string> = {
  online: 'bg-emerald-500',
  reconnecting: 'bg-sky-500 animate-pulse',
  error: 'bg-red-500',
  offline: 'bg-zinc-400',
};

export default function ChannelStatusBar({
  state,
  label,
  detail,
  active = 0,
  pending = 0,
  onRecover,
  recoverLabel = '恢复连接',
}: ChannelStatusBarProps) {
  return (
    <div
      className="flex min-h-9 items-center gap-2 border-b px-4 py-2 text-[11px]"
      style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass[state]}`} />
      <span className="shrink-0 font-medium" style={{ color: 'rgb(var(--c-text))' }}>{label}</span>
      {detail && <span className="min-w-0 truncate" title={detail}>{detail}</span>}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {active > 0 && (
          <span className="flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" />
            处理中 {active}
          </span>
        )}
        {pending > 0 && <span>排队 {pending}</span>}
        {onRecover && (
          <button
            onClick={onRecover}
            className="rounded-md p-1 transition-colors hover:bg-black/5"
            title={recoverLabel}
            aria-label={recoverLabel}
          >
            {state === 'error' ? <AlertCircle size={12} /> : <RefreshCw size={12} />}
          </button>
        )}
      </div>
    </div>
  );
}
