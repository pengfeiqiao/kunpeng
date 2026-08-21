import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Terminal, FileText, Search, Edit3, FolderSearch, Bot, Check, X, Loader2 } from 'lucide-react';
import type { ToolExecution } from '@/lib/agent';

const TOOL_ICONS: Record<string, React.ElementType> = {
  bash: Terminal,
  read_file: FileText,
  write_file: FileText,
  edit_file: Edit3,
  glob_search: FolderSearch,
  grep_search: Search,
  agent: Bot,
};

const TOOL_LABELS: Record<string, string> = {
  bash: '执行命令',
  read_file: '读取文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  glob_search: '搜索文件',
  grep_search: '搜索内容',
  agent: '子任务',
};

interface ToolCardProps {
  execution: ToolExecution;
}

export function ToolCard({ execution }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[execution.toolName] || Terminal;
  const label = TOOL_LABELS[execution.toolName] || execution.toolName;

  // Summarize params for display
  const paramSummary = getParamSummary(execution);

  return (
    <div className="my-1 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-card))] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[rgb(var(--c-border))] transition-colors"
      >
        {/* Status indicator */}
        {execution.status === 'running' && (
          <Loader2 className="w-4 h-4 text-[rgb(var(--c-text-muted))] animate-spin flex-shrink-0" />
        )}
        {execution.status === 'completed' && (
          <Check className="w-4 h-4 text-[rgb(var(--c-text-muted))] flex-shrink-0" />
        )}
        {execution.status === 'error' && (
          <X className="w-4 h-4 text-[rgb(var(--c-text-muted))] flex-shrink-0" />
        )}

        <Icon className="w-4 h-4 text-[rgb(var(--c-text-muted))] flex-shrink-0" />
        <span className="font-medium text-[rgb(var(--c-text))]">{label}</span>
        <span className="text-[rgb(var(--c-text-muted))] truncate flex-1 text-left">
          {paramSummary}
        </span>

        {execution.endTime && (
          <span className="text-xs text-[rgb(var(--c-text-muted))] flex-shrink-0">
            {((execution.endTime - execution.startTime) / 1000).toFixed(1)}s
          </span>
        )}

        {expanded ? (
          <ChevronDown className="w-4 h-4 text-[rgb(var(--c-text-muted))] flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-[rgb(var(--c-text-muted))] flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-[rgb(var(--c-border))]">
              {/* Params */}
              <div className="mt-2">
                <div className="text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">参数</div>
                <pre className="text-xs text-[rgb(var(--c-text))] bg-[rgb(var(--c-bg))] rounded-md p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(execution.params, null, 2)}
                </pre>
              </div>

              {/* Output */}
              {execution.result && (
                <div className="mt-2">
                  <div className="text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
                    {execution.result.success ? '输出' : '错误'}
                  </div>
                  <pre
                    className={`text-xs rounded p-2 overflow-x-auto max-h-60 ${
                      execution.result.success
                        ? 'text-[rgb(var(--c-text))] bg-[rgb(var(--c-bg))]'
                        : 'text-[rgb(var(--c-text))] bg-[rgb(var(--c-bg))] border border-[rgb(var(--c-border))]'
                    }`}
                  >
                    {execution.result.output || execution.result.error || '(无输出)'}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getParamSummary(execution: ToolExecution): string {
  const { toolName, params } = execution;

  switch (toolName) {
    case 'bash':
      return String(params.command || '').slice(0, 80);
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return String(params.path || '');
    case 'glob_search':
      return String(params.pattern || '');
    case 'grep_search':
      return String(params.pattern || '');
    case 'agent':
      return String(params.task || '').slice(0, 60);
    default:
      return '';
  }
}

/** 渲染一组工具执行卡片 */
export function ToolCardList({
  executions,
}: {
  executions: ToolExecution[];
}) {
  if (executions.length === 0) return null;

  return (
    <div className="space-y-1 my-2">
      {executions.map((exec) => (
        <ToolCard key={exec.id} execution={exec} />
      ))}
    </div>
  );
}
