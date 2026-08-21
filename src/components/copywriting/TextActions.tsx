import { createPortal } from 'react-dom';
import { useState } from 'react';
import { Wand2, Minimize2, Maximize2, Languages, MessageSquarePlus, Smile } from 'lucide-react';
import { dispatchCopywritingPrompt } from './CopywritingChatPanel';
import { TONE_OPTIONS, buildTonePrompt } from '@/lib/copywriting/toneOptions';
import { withCopywritingStyleGuard } from '@/lib/copywriting/antiAiStyle';

const ACTIONS = [
  { icon: Wand2, label: '改写', prompt: (t: string) => withCopywritingStyleGuard(`请改写以下文字，保持原意和体裁，不要改成通用 AI 文案。文学类保留意象、节奏和留白；商业类去掉套话，增加具体场景和判断：\n\n${t}`) },
  { icon: Minimize2, label: '缩写', prompt: (t: string) => withCopywritingStyleGuard(`请精简以下文字，保留核心信息、语气和文学/口播节奏。删掉空泛修饰和模板句，不要把文字压成干巴巴的摘要：\n\n${t}`) },
  { icon: Maximize2, label: '扩写', prompt: (t: string) => withCopywritingStyleGuard(`请扩充以下文字。不要堆形容词，不要写通用宣传腔；用具体场景、动作、物件、人物选择或镜头细节来扩写。文学类可以增加意象和留白，但要克制：\n\n${t}`) },
  { icon: Languages, label: '翻译', prompt: (t: string) => `请将以下文字翻译为英文。保留原文体裁、节奏和意象，不要翻译成通用 AI 营销腔；文学类保留留白，广告类保留钩子和传播感：\n\n${t}` },
];

interface Props {
  selectedText: string;
  rect: DOMRect;
  onDismiss: () => void;
  onComment: () => void;
}

export default function TextActions({ selectedText, rect, onDismiss, onComment }: Props) {
  const [toneOpen, setToneOpen] = useState(false);

  const handleAction = (promptFn: (t: string) => string) => {
    dispatchCopywritingPrompt(promptFn(selectedText), selectedText);
    onDismiss();
  };

  const x = Math.max(8, rect.left);
  const y = Math.max(8, rect.top - 42);

  return createPortal(
    <div
      className="fixed z-[90] flex items-center gap-0.5 px-1.5 py-1 rounded-xl"
      style={{
        left: x,
        top: y,
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(12px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.4)',
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)',
      }}
    >
      {ACTIONS.map(a => (
        <button
          key={a.label}
          onClick={() => handleAction(a.prompt)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-all"
          style={{ color: 'var(--cw-text-2)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-accent-light)'; e.currentTarget.style.color = 'var(--cw-accent-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
          title={a.label}
        >
          <a.icon size={12} />
          {a.label}
        </button>
      ))}
      <button
        onClick={() => { onComment(); onDismiss(); }}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-all"
        style={{ color: 'var(--cw-text-2)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-accent-light)'; e.currentTarget.style.color = 'var(--cw-accent-text)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
        title="添加批注"
      >
        <MessageSquarePlus size={12} />
        批注
      </button>
      <div className="relative">
        <button
          onClick={() => setToneOpen(v => !v)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-all whitespace-nowrap"
          style={{ color: 'var(--cw-text-2)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-accent-light)'; e.currentTarget.style.color = 'var(--cw-accent-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
          title="选择语气"
        >
          <Smile size={12} />
          语气
        </button>
        {toneOpen && (
          <div
            className="absolute left-0 top-[34px] z-[91] w-[188px] rounded-xl border bg-white p-1.5 shadow-xl"
            style={{ borderColor: 'rgba(0,0,0,0.08)' }}
          >
            {TONE_OPTIONS.map(tone => (
              <button
                key={tone.label}
                onClick={() => handleAction(text => buildTonePrompt(tone.label, text))}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] leading-snug transition-colors hover:bg-stone-100"
                style={{ color: 'var(--cw-text-2)' }}
                title={tone.desc}
              >
                {tone.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
