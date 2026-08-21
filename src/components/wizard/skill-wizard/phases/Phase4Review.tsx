import { useState } from 'react';
import { ChevronLeft, ChevronRight, Check, RotateCcw, Loader2 } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useWizardGeneration } from '../hooks/useWizardGeneration';

export default function Phase4Review() {
  const { project, approveShot, rejectShot } = useWizardStore();
  const { regenerateShot, isGenerating, generatingMessage } = useWizardGeneration();
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!project) return null;

  const images = project.storyboardImages;
  const totalShots = images.length;
  const approvedCount = project.approvedShots.length;

  if (totalShots === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">审查优化</h3>
          <p className="text-sm text-[rgb(var(--c-text-muted))]">
            逐张审查分镜图
          </p>
        </div>
        <div className="text-center py-8 text-[rgb(var(--c-text-muted))]">
          请先生成分镜图
        </div>
      </div>
    );
  }

  const currentImage = images[currentIndex];
  const isApproved = project.approvedShots.includes(currentIndex);

  const handlePrev = () => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const handleNext = () => {
    setCurrentIndex((i) => Math.min(totalShots - 1, i + 1));
  };

  const handleApprove = () => {
    approveShot(currentIndex);
    if (currentIndex < totalShots - 1) {
      handleNext();
    }
  };

  const handleReject = async () => {
    rejectShot(currentIndex);
    await regenerateShot(currentIndex);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">审查优化</h3>
        <p className="text-sm text-[rgb(var(--c-text-muted))]">
          逐张审查分镜图，不满意可重新生成
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-[rgb(var(--c-text-muted))]">
          已审批 {approvedCount}/{totalShots}
        </span>
        <div className="flex gap-1">
          {images.map((_, i) => (
            <div
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`w-2 h-2 rounded-full cursor-pointer transition-colors ${
                i === currentIndex
                  ? 'bg-indigo-600'
                  : project.approvedShots.includes(i)
                  ? 'bg-green-500'
                  : 'bg-[rgb(var(--c-border))]'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Current Image */}
      <div className="relative">
        <div className="rounded-xl overflow-hidden border border-[rgb(var(--c-border))]">
          <img
            src={currentImage}
            alt={`分镜 ${currentIndex + 1}`}
            className="w-full h-auto"
          />
        </div>

        {/* Shot Number Badge */}
        <div className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/70 text-white text-xs">
          分镜 {currentIndex + 1}/{totalShots}
        </div>

        {/* Approved Badge */}
        {isApproved && (
          <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-green-600 text-white text-xs flex items-center gap-1">
            <Check size={12} />
            已审批
          </div>
        )}

        {/* Generating Overlay */}
        {isGenerating && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="bg-[rgb(var(--c-surface))] rounded-xl p-4 shadow-xl flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-indigo-500" />
              <span className="text-sm text-[rgb(var(--c-text))]">
                {generatingMessage || '生成中...'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation & Actions */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className={`p-2 rounded-lg transition-colors ${
            currentIndex === 0
              ? 'text-[rgb(var(--c-text-muted))] cursor-not-allowed'
              : 'text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))]'
          }`}
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex gap-2">
          <button
            onClick={handleReject}
            disabled={isGenerating}
            className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[rgb(var(--c-border))] text-sm text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            重新生成
          </button>
          <button
            onClick={handleApprove}
            disabled={isGenerating}
            className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 ${
              isApproved
                ? 'bg-green-600 text-white'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            <Check size={14} />
            {isApproved ? '已审批' : '满意'}
          </button>
        </div>

        <button
          onClick={handleNext}
          disabled={currentIndex === totalShots - 1}
          className={`p-2 rounded-lg transition-colors ${
            currentIndex === totalShots - 1
              ? 'text-[rgb(var(--c-text-muted))] cursor-not-allowed'
              : 'text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))]'
          }`}
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
