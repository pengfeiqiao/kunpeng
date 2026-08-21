import { useCallback, useEffect, useState } from 'react';
import { Download, FileUp, PanelLeftOpen } from 'lucide-react';
import { useCopywritingStore } from '@/stores/copywritingStore';
import { useSettingsStore } from '@/stores/settingsStore';
import DocSidebar from './DocSidebar';
import DocEditor from './DocEditor';
import CopywritingChatPanel, { dispatchCopywritingPrompt } from './CopywritingChatPanel';
import ExperiencePanel from './ExperiencePanel';

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}

export default function CopywritingView({ onSendMessage, onAbort }: Props) {
  const loaded = useCopywritingStore(s => s.loaded);
  const loadAll = useCopywritingStore(s => s.loadAll);
  const docs = useCopywritingStore(s => s.docs);
  const activeDocId = useCopywritingStore(s => s.activeDocId);
  const updateDoc = useCopywritingStore(s => s.updateDoc);
  const [showExperience, setShowExperience] = useState(false);
  const sidebarCollapsed = useSettingsStore(s => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore(s => s.toggleSidebar);

  useEffect(() => {
    if (!loaded) void loadAll();
  }, [loaded, loadAll]);

  const activeDoc = docs.find(d => d.id === activeDocId) ?? null;

  const handleGuideClick = useCallback((prompt: string) => {
    dispatchCopywritingPrompt(prompt);
  }, []);

  const handleFeishuSync = () => {
    if (!activeDoc) return;
    dispatchCopywritingPrompt(
      `请将当前文案同步到飞书：\n1. 先用 bash 执行 \`npx lark-cli auth status\` 检查登录态；未登录则告诉我授权步骤后停止\n2. 判断内容类型：\n   - 如果是分镜表/策划方案 → 创建飞书多维表格，遵循 bitable-sop\n   - 如果是长文案/剧本/报告 → 创建飞书云文档\n3. 完成后返回飞书链接\n\n文档标题：${activeDoc.title}\n文档内容：\n${activeDoc.content}`,
    );
  };

  if (!loaded) {
    return (
      <div className="copywriting-light flex-1 flex items-center justify-center" style={{ background: 'var(--cw-bg)' }}>
        <p style={{ color: 'var(--cw-text-muted)', fontSize: 14 }}>加载中…</p>
      </div>
    );
  }

  return (
    <div className="copywriting-light flex-1 flex flex-col min-h-0" style={{ background: 'var(--cw-bg)' }}>
      {/* Top bar */}
      <div
        className="flex items-center gap-3 px-5 py-2.5 shrink-0"
        style={{ background: 'var(--cw-bg)', borderBottom: '1px solid var(--cw-border)' }}
      >
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="p-1.5 -ml-2 rounded-md transition-colors"
            style={{ color: 'var(--cw-text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-card)'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
            title="展开侧边栏"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        {activeDoc ? (
          <input
            value={activeDoc.title}
            onChange={e => updateDoc(activeDoc.id, { title: e.target.value })}
            className="flex-1 text-[15px] font-semibold bg-transparent border-none outline-none"
            style={{ color: 'var(--cw-text)' }}
            placeholder="文档标题"
          />
        ) : (
          <span className="flex-1 text-[15px] font-medium" style={{ color: 'var(--cw-text-muted)' }}>
            文案工作室
          </span>
        )}

        {activeDoc && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleFeishuSync}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] transition-colors"
              style={{ color: 'var(--cw-text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-card)'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
              title="同步到飞书"
            >
              <FileUp size={13} /> 飞书
            </button>
            <button
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] transition-colors"
              style={{ color: 'var(--cw-text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-card)'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
              title="导出"
            >
              <Download size={13} /> 导出
            </button>
          </div>
        )}
      </div>

      {/* Three-column body */}
      <div className="flex-1 flex min-h-0 relative">
        <DocSidebar
          onGuideClick={handleGuideClick}
          onToggleExperience={() => setShowExperience(!showExperience)}
        />

        {showExperience ? (
          <ExperiencePanel onClose={() => setShowExperience(false)} />
        ) : (
          <DocEditor doc={activeDoc} />
        )}

        <CopywritingChatPanel onSendMessage={onSendMessage} onAbort={onAbort} />
      </div>
    </div>
  );
}
