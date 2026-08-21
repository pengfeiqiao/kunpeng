/**
 * 引导页共享 UI 零件 —— 视觉规范见《03-视觉策略(仅重做引导页)》：
 * bg-white 内容底、卡片 rounded-lg border-zinc-200、标题 15px font-medium text-zinc-900、
 * 正文 13px、辅助 11px text-zinc-500、主按钮 primary 实心、次按钮白底 zinc 边框。
 * 显式浅色，不跟随全局 .dark；125%-200% 缩放下 min-w-0 + break-words 防溢出。
 */
import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle, Zap } from 'lucide-react';

export const inputCls =
  'w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] text-zinc-900 outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100';

export const primaryBtnCls =
  'rounded-md bg-primary-500 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-40';

export const secondaryBtnCls =
  'rounded-md border border-zinc-200 bg-white px-4 py-2 text-[13px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40';

export type TestState = 'idle' | 'testing' | 'ok' | 'fail';

/** Key 输入框：默认掩码 + 眼睛切换（样式对齐 ProviderSettings.tsx:337 一带）。 */
export function KeyInput({
  value,
  onChange,
  placeholder = '粘贴 API Key',
  onInput,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onInput?: () => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onInput?.();
        }}
        placeholder={placeholder}
        className={`${inputCls} pr-10 font-mono text-xs`}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
        title={show ? '隐藏密钥' : '显示密钥'}
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/** 「测试连接」按钮：idle/testing/ok/fail 四态。 */
export function TestButton({
  state,
  disabled,
  onClick,
}: {
  state: TestState;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'testing'}
      className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
    >
      {state === 'testing' ? (
        <Loader2 size={13} className="animate-spin" />
      ) : state === 'ok' ? (
        <CheckCircle2 size={13} className="text-emerald-600" />
      ) : state === 'fail' ? (
        <XCircle size={13} className="text-zinc-500" />
      ) : (
        <Zap size={13} />
      )}
      {state === 'ok' ? '连接正常' : state === 'fail' ? '连接失败' : '测试连接'}
    </button>
  );
}

/** 渠道卡片统一版式：名称 | 官网/控制台链接 | 用途 | 内容（Key 输入等）。 */
export function ChannelCard({
  title,
  url,
  purpose,
  note,
  badge,
  children,
}: {
  title: string;
  url?: string;
  purpose: string;
  note?: string;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-zinc-300">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[15px] font-medium text-zinc-900">{title}</span>
          {badge && (
            <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">{badge}</span>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline"
          >
            获取 Key
          </a>
        )}
      </div>
      <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-600">{purpose}</p>
      {note && <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">{note}</p>}
      {children && <div className="mt-3 min-w-0">{children}</div>}
    </div>
  );
}
