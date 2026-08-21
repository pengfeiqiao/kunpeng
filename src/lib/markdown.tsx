import { memo, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy, ExternalLink, ImageOff } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { useSettingsStore } from '@/stores/settingsStore';
import { ensureChatHomeDir, expandChatPath, isRemoteUri } from '@/lib/chat/artifacts';
import { useArtifactSource } from '@/components/chat/ArtifactPreview';

type MarkdownTone = 'auto' | 'dark' | 'light';

function CodeBlock({
  className,
  children,
  tone = 'auto',
  ...props
}: React.ComponentPropsWithoutRef<'code'> & { tone?: MarkdownTone }) {
  const theme = useSettingsStore((state) => state.theme);
  const [copied, setCopied] = useState(false);
  const value = String(children).replace(/\n$/, '');
  const language = /language-([\w+-]+)/.exec(className || '')?.[1];
  const isBlock = Boolean(language) || value.includes('\n');
  const isDark = tone === 'dark' || (tone === 'auto' && theme === 'dark');

  if (!isBlock) {
    return <code className={className} {...props}>{children}</code>;
  }

  return (
    <div
      className="group/code my-3 overflow-hidden rounded-lg border"
      style={{
        background: isDark ? '#0D0F12' : '#F8F9FA',
        borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)',
      }}
    >
      <div
        className="flex h-9 items-center border-b px-3 text-[11px]"
        style={{
          borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)',
          color: isDark ? '#A1A1AA' : '#6B7280',
        }}
      >
        <span>{language || '代码'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-white/10"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <SyntaxHighlighter
        style={isDark ? oneDark : oneLight}
        language={language || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '0.9rem 1rem',
          borderRadius: 0,
          background: 'transparent',
          fontSize: '0.8125rem',
          lineHeight: 1.65,
        }}
        codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  const { source } = useArtifactSource(src || '');
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  if (!source) return <span className="my-2 block h-20 animate-pulse rounded-lg bg-[rgb(var(--c-border))]/55" />;
  if (failed) {
    return (
      <span className="my-2 flex min-h-[72px] items-center gap-2 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-card))] px-3 text-xs text-[rgb(var(--c-text-muted))]">
        <ImageOff size={15} />
        <span className="min-w-0 truncate">图片无法预览：{alt || src}</span>
      </span>
    );
  }
  return (
    <img
      src={source}
      alt={alt || ''}
      loading="lazy"
      className="my-2 max-h-[520px] max-w-full rounded-lg border border-[rgb(var(--c-border))] object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const [resolved, setResolved] = useState(href || '');
  useEffect(() => {
    let mounted = true;
    void ensureChatHomeDir().then(() => {
      if (mounted && href) setResolved(expandChatPath(href));
    });
    return () => { mounted = false; };
  }, [href]);

  const external = useMemo(() => isRemoteUri(resolved), [resolved]);
  if (!href) return <span>{children}</span>;
  if (href.startsWith('#')) return <a href={href}>{children}</a>;
  return (
    <button
      type="button"
      className="inline-flex items-baseline gap-1 text-left text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
      onClick={() => void invoke('open_path', { path: resolved, reveal: false })}
      title={resolved}
    >
      <span>{children}</span>
      {external && <ExternalLink size={10} className="self-center" />}
    </button>
  );
}

interface MarkdownRendererProps {
  content: string;
  tone?: MarkdownTone;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, tone = 'auto' }: MarkdownRendererProps) {
  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            return <CodeBlock className={className} tone={tone} {...props}>{children}</CodeBlock>;
          },
          pre({ children }) { return <>{children}</>; },
          a({ href, children }) { return <MarkdownLink href={href}>{children}</MarkdownLink>; },
          img({ src, alt }) { return <MarkdownImage src={src} alt={alt} />; },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownRenderer;
