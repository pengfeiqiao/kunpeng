import { Loader2, Download } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import { useWizardGeneration } from '../hooks/useWizardGeneration';
import ImageGrid from '../components/ImageGrid';

export default function Phase3Storyboard() {
  const { project, setStoryboardImages } = useWizardStore();
  const { generateStoryboard, isGenerating, generatingMessage } = useWizardGeneration();

  if (!project) return null;

  const storyboardImages = project.storyboardImages;
  const hasImages = storyboardImages.length > 0;

  const handleGenerate = async () => {
    await generateStoryboard();
  };

  const handleRegenerate = async () => {
    setStoryboardImages([]);
    await generateStoryboard();
  };

  const handleExportStoryboard = async () => {
    if (!hasImages) return;

    // Create a markdown file with storyboard info
    const content = `# ${project.projectName || '分镜脚本'}

## 项目信息
- 风格: ${project.style === 'costume' ? '古装风格' : project.style === 'travel' ? '现代旅游' : '废土风格'}
- 场景数量: ${project.scenes.length}
- 分镜数量: ${storyboardImages.length}

## 角色
${project.characters.map(c => `- **${c.name}** (${c.archetype}, ${c.age}岁)`).join('\n')}

## 场景
${project.scenes.map((s, i) => `### 场景 ${i + 1}: ${s.name}\n${s.description}`).join('\n\n')}

## 分镜图
${storyboardImages.map((img, i) => `### 分镜 ${i + 1}\n![分镜${i + 1}](${img})`).join('\n\n')}
`;

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.projectName || 'storyboard'}-分镜.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">分镜生成</h3>
        <p className="text-sm text-[rgb(var(--c-text-muted))]">
          生成九宫格分镜图
        </p>
      </div>

      {/* Progress Info */}
      <div className="bg-[rgb(var(--c-border))] rounded-lg p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[rgb(var(--c-text-muted))]">场景数量</span>
          <span className="text-[rgb(var(--c-text))]">{project.scenes.length}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-1">
          <span className="text-[rgb(var(--c-text-muted))]">分镜数量</span>
          <span className="text-[rgb(var(--c-text))]">9 张/场景</span>
        </div>
      </div>

      {/* Storyboard Images */}
      {hasImages ? (
        <div className="space-y-4">
          <ImageGrid images={storyboardImages} columns={3} />

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleRegenerate}
              disabled={isGenerating}
              className="flex-1 py-2 rounded-lg border border-[rgb(var(--c-border))] text-sm text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  生成中...
                </>
              ) : (
                '重新生成'
              )}
            </button>
            <button
              onClick={handleExportStoryboard}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
            >
              <Download size={14} />
              导出九宫格
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Generation Options */}
          <div className="bg-[rgb(var(--c-bg))] rounded-lg p-4 border border-[rgb(var(--c-border))]">
            <h4 className="text-sm font-medium text-[rgb(var(--c-text))] mb-2">生成选项</h4>
            <div className="space-y-2 text-sm text-[rgb(var(--c-text-muted))]">
              <p>• 将为每个场景生成 9 张分镜图</p>
              <p>• 自动组合为九宫格</p>
              <p>• 支持单独导出每张分镜</p>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || project.scenes.length === 0}
            className="w-full py-3 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {generatingMessage || '生成中...'}
              </>
            ) : (
              '开始生成分镜'
            )}
          </button>

          {project.scenes.length === 0 && (
            <p className="text-xs text-amber-500 text-center">
              请先在上一阶段创建场景
            </p>
          )}
        </div>
      )}
    </div>
  );
}
