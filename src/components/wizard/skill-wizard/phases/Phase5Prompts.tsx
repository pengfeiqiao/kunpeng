import { useState } from 'react';
import { Copy, Check, Download, Loader2 } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useWizardGeneration } from '../hooks/useWizardGeneration';

const SEGMENT_LABELS = ['开篇', '发展', '高潮', '转折', '结尾'];

export default function Phase5Prompts() {
  const { project } = useWizardStore();
  const { generateVideoPrompts, isGenerating, generatingMessage } = useWizardGeneration();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!project) return null;

  const prompts = project.videoPrompts;
  const hasPrompts = prompts.length > 0;

  const handleCopy = async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleExportAll = () => {
    const allPrompts = prompts
      .map((p, i) => `## 段落${i + 1}：${SEGMENT_LABELS[i]}\n\n${p}`)
      .join('\n\n---\n\n');

    const blob = new Blob([allPrompts], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.projectName || 'video-prompts'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerate = async () => {
    await generateVideoPrompts();
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">视频提示词</h3>
        <p className="text-sm text-[rgb(var(--c-text-muted))]">
          按 2-2-2-2-1 规则生成的 5 段视频提示词
        </p>
      </div>

      {/* Prompts List */}
      {hasPrompts ? (
        <div className="space-y-4">
          {prompts.map((prompt, i) => (
            <div
              key={i}
              className="bg-[rgb(var(--c-bg))] rounded-lg border border-[rgb(var(--c-border))] p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[rgb(var(--c-text))]">
                  段落 {i + 1}：{SEGMENT_LABELS[i]}
                </span>
                <button
                  onClick={() => handleCopy(i, prompt)}
                  className="p-1.5 rounded-lg text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors"
                >
                  {copiedIndex === i ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p className="text-sm text-[rgb(var(--c-text-muted))] whitespace-pre-wrap">
                {prompt}
              </p>
            </div>
          ))}

          {/* Export All */}
          <button
            onClick={handleExportAll}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            <Download size={16} />
            导出全部提示词
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Segment Info */}
          <div className="bg-[rgb(var(--c-bg))] rounded-lg p-4 border border-[rgb(var(--c-border))]">
            <h4 className="text-sm font-medium text-[rgb(var(--c-text))] mb-2">分段规则</h4>
            <div className="space-y-1 text-sm text-[rgb(var(--c-text-muted))]">
              <p>• 段落 1（开篇）：分镜 1+2，约 4 秒</p>
              <p>• 段落 2（发展）：分镜 3+4，约 4 秒</p>
              <p>• 段落 3（高潮）：分镜 5+6，约 4 秒</p>
              <p>• 段落 4（转折）：分镜 7+8，约 4 秒</p>
              <p>• 段落 5（结尾）：分镜 9，约 3 秒</p>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || project.storyboardImages.length === 0}
            className="w-full py-3 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {generatingMessage || '生成中...'}
              </>
            ) : (
              '生成视频提示词'
            )}
          </button>

          {project.storyboardImages.length === 0 && (
            <p className="text-xs text-amber-500 text-center">
              请先在上一阶段生成分镜图
            </p>
          )}
        </div>
      )}
    </div>
  );
}
