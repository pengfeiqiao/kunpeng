import { Lightbulb } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';

interface ImageToPromptButtonProps {
  nodeId: string;
  compact?: boolean;
}

export default function ImageToPromptButton({ nodeId, compact }: ImageToPromptButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        useCanvasStore.getState().triggerAgentAction('ai-image-to-prompt', nodeId);
      }}
      className={compact
        ? 'w-7 h-7 flex items-center justify-center rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-all duration-100'
        : 'p-2 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors'
      }
      title="图片反推提示词"
    >
      <Lightbulb size={compact ? 13 : 16} strokeWidth={compact ? 2 : 1.6} />
    </button>
  );
}
