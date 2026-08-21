import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, FolderOpen, FileText, FileImage, FileVideo, FileAudio, FileCode2, Archive, ArrowUp, Square, Globe, Megaphone } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { appWindow } from '@tauri-apps/api/window';
import { useChatStore, useSkillStore, useSettingsStore } from '@/stores';
import { useWizardStore } from '@/stores/wizardStore';
import { SkillBar, SkillPanelWrapper } from './skills';
import { TouliuDataPanel } from './touliu';
import ComposerModelPicker from './ComposerModelPicker';
import DeepseekHarnessControl from './chat/DeepseekHarnessControl';
import type { SkillManifest } from '@/types/skill';

interface MessageInputProps {
  onSend: (content: string, filePaths?: string[]) => void;
  onAbort?: () => void;
}

export default function MessageInput({ onSend, onAbort }: MessageInputProps) {
  const draftMessage = useChatStore((s) => s.draftMessage);
  const setDraftMessage = useChatStore((s) => s.setDraftMessage);
  const setMessage = (v: string) => setDraftMessage(v);
  const message = draftMessage;
  const [filePaths, setFilePaths] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDisabled = useChatStore((s) => (
    s.currentSessionId ? Boolean(s.streamingSessions[s.currentSessionId]) : false
  ));
  const isStreaming = isDisabled;
  const providerDefault = useSettingsStore((s) => s.providerDefault);

  // 联网搜索开关（默认关闭；开启后 web_search 工具才暴露给模型）
  const webSearchEnabled = useSettingsStore((s) => s.webSearchEnabled);
  const setWebSearchEnabled = useSettingsStore((s) => s.setWebSearchEnabled);

  // Consume pendingInput injected from other panels (e.g. MemoryPanel project workbench)
  const pendingInput = useChatStore((s) => s.pendingInput);
  const setPendingInput = useChatStore((s) => s.setPendingInput);
  useEffect(() => {
    if (pendingInput != null) {
      setMessage(pendingInput);
      setPendingInput(null);
      // Focus and scroll the textarea
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [pendingInput, setPendingInput]);

  // Skill store
  const skills = useSkillStore((s) => s.skills);
  const activeSkillId = useSkillStore((s) => s.activeSkillId);
  const fieldValues = useSkillStore((s) => s.fieldValues);
  const setActiveSkill = useSkillStore((s) => s.setActiveSkill);
  const setFieldValue = useSkillStore((s) => s.setFieldValue);
  const buildActivePrompt = useSkillStore((s) => s.buildActivePrompt);
  const getActiveSkill = useSkillStore((s) => s.getActiveSkill);

  const activeSkill = getActiveSkill();
  const activeSkillIdRef = useRef(activeSkillId);
  useEffect(() => { activeSkillIdRef.current = activeSkillId; }, [activeSkillId]);

  // Tauri native file drop
  useEffect(() => {
    const isImg = (p: string) => /\.(png|jpg|jpeg|webp|gif)$/i.test(p);
    // If the component unmounts before listen() resolves, the cleanup closure
    // runs with `un* === undefined` and the listener leaks. Track disposal
    // and unlisten immediately for late-resolving registrations.
    let disposed = false;
    let unHover: (() => void) | undefined;
    let unDrop: (() => void) | undefined;
    let unCancel: (() => void) | undefined;
    const keep = (assign: (fn: () => void) => void) => (fn: () => void) => {
      if (disposed) { fn(); return; }
      assign(fn);
    };

    appWindow.listen('tauri://file-drop-hover', () => {
      setIsDragging(true);
    }).then(keep((fn) => { unHover = fn; }));

    appWindow.listen<string[]>('tauri://file-drop', (event) => {
      setIsDragging(false);
      const dropped = event.payload;
      if (!dropped.length) return;

      const activeSkillObj = useSkillStore.getState().getActiveSkill();
      const currentFieldValues = useSkillStore.getState().fieldValues;

      // Check if current skill has file-multi fields, route images there
      if (activeSkillObj?.panel?.fields && dropped.some(isImg)) {
        const fileMultiField = activeSkillObj.panel.fields.find(
          (f) => f.type === 'file-multi'
        );
        if (fileMultiField) {
          const imgs = dropped.filter(isImg);
          const existing = (currentFieldValues[fileMultiField.key] as string[]) || [];
          useSkillStore.getState().setFieldValue(
            fileMultiField.key,
            [...existing, ...imgs.filter((p) => !existing.includes(p))]
          );
          return;
        }
      }

      // Default: add to file paths
      setFilePaths((prev) => [...prev, ...dropped.filter((p) => !prev.includes(p))]);
    }).then(keep((fn) => { unDrop = fn; }));

    appWindow.listen('tauri://file-drop-cancelled', () => {
      setIsDragging(false);
    }).then(keep((fn) => { unCancel = fn; }));

    return () => { disposed = true; unHover?.(); unDrop?.(); unCancel?.(); };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [message]);

  // Deactivate prompt-based skills when textarea is cleared
  useEffect(() => {
    if (!message.trim() && activeSkill && !activeSkill.hasPanel) {
      setActiveSkill(null);
    }
  }, [message, activeSkill, setActiveSkill]);

  // Close file menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowFileMenu(false);
    };
    if (showFileMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFileMenu]);

  const handleSubmit = () => {
    if (!message.trim() && filePaths.length === 0 && !activeSkill?.hasPanel) return;

    let finalMessage = message;
    if (activeSkillId) {
      finalMessage = buildActivePrompt(message.trim());
    }

    onSend(finalMessage, filePaths.length > 0 ? filePaths : undefined);
    setMessage('');
    setFilePaths([]);
    setActiveSkill(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
  };

  const handleSkillClick = (skill: SkillManifest) => {
    // Check if this is a wizard-type skill
    if (skill.wizard) {
      // Open wizard panel instead of normal skill panel
      const { createProject, setPanelOpen } = useWizardStore.getState();
      createProject(skill.id);
      setPanelOpen(true);
      return;
    }

    // Normal skill handling
    if (activeSkillId === skill.id) {
      setActiveSkill(null);
      if (!skill.hasPanel) setMessage('');
    } else {
      setActiveSkill(skill.id);
      if (!skill.hasPanel && skill.promptTemplate) {
        // For simple skills, pre-fill the prompt template (without variables)
        setMessage(skill.promptTemplate.replace(/\{\{userContent\}\}/, ''));
      }
    }
    textareaRef.current?.focus();
  };

  const handleSelectFiles = async () => {
    setShowFileMenu(false);
    const selected = await open({ multiple: true, directory: false }).catch(() => null);
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      setFilePaths((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))]);
    }
  };

  const handleSelectFolder = async () => {
    setShowFileMenu(false);
    const selected = await open({ multiple: false, directory: true }).catch(() => null);
    if (selected && typeof selected === 'string')
      setFilePaths((prev) => (prev.includes(selected) ? prev : [...prev, selected]));
  };

  const canSend = !!message.trim() || filePaths.length > 0 || (activeSkill?.hasPanel ?? false);
  const displayName = (p: string) => p.split('/').pop() || p;
  const attachmentIcon = (path: string) => {
    if (path.endsWith('/')) return <FolderOpen size={13} />;
    const extension = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase();
    if (extension && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'svg'].includes(extension)) return <FileImage size={13} />;
    if (extension && ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'].includes(extension)) return <FileVideo size={13} />;
    if (extension && ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(extension)) return <FileAudio size={13} />;
    if (extension && ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'swift', 'html', 'css', 'json', 'md'].includes(extension)) return <FileCode2 size={13} />;
    if (extension && ['zip', 'rar', '7z', 'tar', 'gz', 'dmg'].includes(extension)) return <Archive size={13} />;
    return <FileText size={13} />;
  };

  // Determine placeholder
  const placeholder = isStreaming
    ? '补充要求，发送后会调整当前任务...'
    : activeSkill?.placeholder
      ?? (activeSkill?.hasPanel ? '补充说明（可选）...' : '有什么我可以帮你的？');

  // Check if current skill has file-multi fields (for drag overlay text)
  const hasFileMultiField = activeSkill?.panel?.fields?.some((f) => f.type === 'file-multi');

  return (
    <div
      className={`relative transition-all duration-200 ${isDragging ? 'scale-[1.005]' : ''}`}
      onDragOver={(e) => { e.preventDefault(); }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDrop={(e) => { e.preventDefault(); }}
    >
      {/* Main card */}
      <div className={`
        bg-white dark:bg-zinc-950 border rounded-[22px] transition-all duration-200 shadow-[0_1px_3px_rgba(15,23,42,0.08)]
        ${isDragging
          ? 'border-zinc-400 shadow-[0_0_0_3px_rgba(24,24,27,0.08)]'
          : 'border-[rgb(var(--c-border))] focus-within:border-zinc-400 focus-within:shadow-[0_0_0_2px_rgba(24,24,27,0.05)]'}
      `}>

        <AnimatePresence>
          {filePaths.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 3 }}
              className="flex flex-wrap gap-2 px-4 pt-3"
            >
              {filePaths.map((p, i) => (
                <div key={p} className="flex h-11 max-w-[230px] items-center gap-2 rounded-lg border border-[rgb(var(--c-border))] bg-white py-1 pl-1.5 pr-1.5 text-xs text-[rgb(var(--c-text))] dark:bg-[rgb(var(--c-card))]">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-[rgb(var(--c-card))] text-[rgb(var(--c-text-muted))] dark:bg-[rgb(var(--c-border))]">{attachmentIcon(p)}</span>
                  <span className="min-w-0 flex-1 truncate" title={p}>{displayName(p)}</span>
                  <button
                    type="button"
                    onClick={() => setFilePaths((prev) => prev.filter((_, j) => j !== i))}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]"
                    title="移除附件"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Textarea */}
        <div className="px-5 pt-4 pb-3">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="w-full bg-transparent resize-none outline-none max-h-[180px] text-[0.9375rem] leading-relaxed placeholder:text-[rgb(var(--c-text-muted))] text-[rgb(var(--c-text))]"
          />
        </div>

        {/* Dynamic skill panel */}
        <SkillPanelWrapper
          skill={activeSkill}
          fieldValues={fieldValues}
          onFieldChange={setFieldValue}
        />

        {/* Touliu Data Panel (inside skill panel area) */}
        {activeSkillId === 'ocean-engine-ad' && <TouliuDataPanel />}

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 pb-3 pt-1">

          {/* Attachment button */}
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setShowFileMenu((v) => !v)}
              disabled={isDisabled}
              title="添加文件或文件夹"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--c-card))] text-[rgb(var(--c-text))] transition-colors hover:bg-[rgb(var(--c-border))] disabled:opacity-40 dark:bg-[rgb(var(--c-border))]"
            >
              <Plus size={19} strokeWidth={1.8} />
            </button>
            <AnimatePresence>
              {showFileMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 4, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.96 }} transition={{ duration: 0.1 }}
                  className="absolute bottom-full left-0 z-40 mb-2 w-48 overflow-hidden rounded-xl border border-[rgb(var(--c-border))] bg-white p-1.5 shadow-xl dark:bg-[rgb(var(--c-bg))]"
                >
                  <button onClick={handleSelectFiles} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[rgb(var(--c-text))] transition-colors hover:bg-[rgb(var(--c-card))]">
                    <FileText size={14} className="text-[rgb(var(--c-text-muted))]" /> 添加文件
                  </button>
                  <button onClick={handleSelectFolder} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-[rgb(var(--c-text))] transition-colors hover:bg-[rgb(var(--c-card))]">
                    <FolderOpen size={14} className="text-[rgb(var(--c-text-muted))]" /> 添加文件夹
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 联网搜索开关 */}
          <button
            onClick={() => setWebSearchEnabled(!webSearchEnabled)}
            disabled={isDisabled}
            title={
              webSearchEnabled
                ? '联网搜索已开启 — 模型可联网获取实时信息（perplexity，失败回退腾讯）。点击关闭'
                : '联网搜索已关闭 — 点击开启后模型才能联网搜索'
            }
            className={`
              flex-shrink-0 flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-medium
              transition-colors disabled:opacity-40
              ${webSearchEnabled
                ? 'border border-[rgb(var(--c-border))] bg-white text-[rgb(var(--c-text))] dark:bg-[rgb(var(--c-card))]'
                : 'text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]'}
            `}
          >
            <Globe size={14} strokeWidth={2} />
            <span>联网</span>
          </button>

          {/* 投流按钮 */}
          <button
            onClick={() => {
              const touliuSkill = skills.find((s) => s.id === 'ocean-engine-ad');
              if (touliuSkill) handleSkillClick(touliuSkill);
            }}
            disabled={isDisabled}
            title={activeSkillId === 'ocean-engine-ad' ? '收起投流面板' : '打开投流面板'}
            className={`
              flex-shrink-0 flex items-center gap-1.5 px-2.5 h-8 rounded-full text-xs font-medium
              transition-colors disabled:opacity-40
              ${activeSkillId === 'ocean-engine-ad'
                ? 'border border-[rgb(var(--c-border))] bg-white text-[rgb(var(--c-text))] dark:bg-[rgb(var(--c-card))]'
                : 'text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]'}
            `}
          >
            <Megaphone size={14} strokeWidth={2} />
            <span>投流</span>
          </button>

          {/* Skill buttons */}
          <SkillBar
            skills={skills}
            activeSkillId={activeSkillId}
            onSkillClick={handleSkillClick}
            disabled={isDisabled}
          />

          <div className="flex-1 min-w-2" />

          <DeepseekHarnessControl providerId={providerDefault} disabled={isDisabled} />
          <ComposerModelPicker disabled={isDisabled} />

          {/* Send / Stop button */}
          {isStreaming ? (
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {canSend && (
                <motion.button
                  onClick={handleSubmit}
                  whileTap={{ scale: 0.92 }}
                  title="补充当前任务"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-950 hover:bg-zinc-800 text-white shadow-sm transition-all duration-200 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
                >
                  <ArrowUp size={15} strokeWidth={2.5} />
                </motion.button>
              )}
              <motion.button
                onClick={onAbort}
                whileTap={{ scale: 0.92 }}
                title="终止任务"
                className="w-9 h-9 rounded-full flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 text-zinc-700 transition-all duration-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              >
                <Square size={13} fill="currentColor" strokeWidth={0} />
              </motion.button>
            </div>
          ) : (
            <motion.button
              onClick={handleSubmit}
              disabled={!canSend}
              whileTap={{ scale: canSend ? 0.92 : 1 }}
              className={`
                flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center
                transition-all duration-200
                ${canSend
                  ? 'bg-zinc-950 hover:bg-zinc-800 text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white'
                  : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))]'}
              `}
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </motion.button>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="absolute inset-0 border-2 border-dashed border-zinc-400 bg-white/75 dark:bg-zinc-950/75 backdrop-blur-xl rounded-[20px] flex items-center justify-center pointer-events-none"
        >
          <span className="text-[rgb(var(--c-text))] text-sm font-medium">
            {hasFileMultiField ? '松开以添加参考图' : '松开以添加文件路径'}
          </span>
        </motion.div>
      )}
    </div>
  );
}
