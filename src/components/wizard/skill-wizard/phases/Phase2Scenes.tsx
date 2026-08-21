import { useState } from 'react';
import { Plus, Trash2, Loader2, ZoomIn } from 'lucide-react';
import { useWizardStore, type SceneData } from '@/stores/wizardStore';
import { useWizardGeneration } from '../hooks/useWizardGeneration';

const DEFAULT_SCENE: SceneData = {
  name: '',
  description: '',
  type: 'indoor-day',
  characters: [],
};

const SCENE_TYPES = [
  { value: 'indoor-day', label: '室内·白天' },
  { value: 'indoor-night', label: '室内·夜晚' },
  { value: 'outdoor-day', label: '室外·白天' },
  { value: 'outdoor-night', label: '室外·夜晚' },
];

export default function Phase2Scenes() {
  const { project, addScene, updateScene, removeScene } = useWizardStore();
  const { generateSceneConcept, isGenerating, generatingMessage } = useWizardGeneration();
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!project) return null;

  const scenes = project.scenes;
  const currentScene = scenes[currentIndex];
  const conceptImages = project.generatedImages[`scene-${currentIndex}`] || [];

  const handleAddScene = () => {
    addScene({ ...DEFAULT_SCENE, name: `场景 ${scenes.length + 1}` });
    setCurrentIndex(scenes.length);
  };

  const handleRemoveScene = (index: number) => {
    if (scenes.length <= 1) return;
    removeScene(index);
    if (currentIndex >= scenes.length - 1) {
      setCurrentIndex(Math.max(0, scenes.length - 2));
    }
  };

  const handleUpdateScene = (data: Partial<SceneData>) => {
    if (currentScene) {
      updateScene(currentIndex, data);
    }
  };

  const toggleCharacter = (charName: string) => {
    if (!currentScene) return;
    const newChars = currentScene.characters.includes(charName)
      ? currentScene.characters.filter((c) => c !== charName)
      : [...currentScene.characters, charName];
    handleUpdateScene({ characters: newChars });
  };

  const handleGenerateConcept = async () => {
    if (!currentScene || !currentScene.name.trim()) return;
    await generateSceneConcept(currentScene, currentIndex);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">场景建立</h3>
        <p className="text-sm text-[rgb(var(--c-text-muted))]">
          定义项目中的场景信息
        </p>
      </div>

      {/* Scene Count & Add Button */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[rgb(var(--c-text-muted))]">
          已创建 {scenes.length} 个场景
        </span>
        <button
          onClick={handleAddScene}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus size={14} />
          添加场景
        </button>
      </div>

      {/* Scene Tabs */}
      {scenes.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {scenes.map((scene, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                i === currentIndex
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]'
              }`}
            >
              {scene.name || `场景 ${i + 1}`}
              {scenes.length > 1 && (
                <Trash2
                  size={12}
                  className="ml-1 opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveScene(i);
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Current Scene Editor */}
      {currentScene && (
        <div className="space-y-4">
          {/* Scene Name */}
          <div>
            <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
              场景名称
            </label>
            <input
              type="text"
              value={currentScene.name}
              onChange={(e) => handleUpdateScene({ name: e.target.value })}
              placeholder="输入场景名称..."
              className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>

          {/* Scene Type */}
          <div>
            <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-2">
              场景类型
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SCENE_TYPES.map((type) => (
                <button
                  key={type.value}
                  onClick={() => handleUpdateScene({ type: type.value as SceneData['type'] })}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    currentScene.type === type.value
                      ? 'bg-indigo-600 text-white'
                      : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]'
                  }`}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scene Description */}
          <div>
            <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
              场景描述
            </label>
            <textarea
              value={currentScene.description}
              onChange={(e) => handleUpdateScene({ description: e.target.value })}
              placeholder="描述场景的环境、氛围、细节..."
              rows={3}
              className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
            />
          </div>

          {/* Character Selection */}
          {project.characters.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-2">
                出场角色
              </label>
              <div className="flex flex-wrap gap-2">
                {project.characters.map((char) => (
                  <button
                    key={char.name}
                    onClick={() => toggleCharacter(char.name)}
                    className={`px-2 py-1 rounded-full text-xs transition-colors ${
                      currentScene.characters.includes(char.name)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]'
                    }`}
                  >
                    {char.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Concept Image */}
          {conceptImages.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-2">
                场景概念图
              </label>
              <div className="relative rounded-xl overflow-hidden border border-[rgb(var(--c-border))] group">
                <img
                  src={conceptImages[0]}
                  alt="场景概念图"
                  className="w-full h-auto"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <button className="p-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition-colors">
                    <ZoomIn size={20} />
                  </button>
                </div>
              </div>
              <button
                onClick={handleGenerateConcept}
                disabled={isGenerating}
                className="mt-2 w-full py-1.5 rounded-lg border border-[rgb(var(--c-border))] text-xs text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors disabled:opacity-50"
              >
                重新生成
              </button>
            </div>
          )}

          {/* Generate Concept Button */}
          {conceptImages.length === 0 && (
            <button
              onClick={handleGenerateConcept}
              disabled={isGenerating || !currentScene.name.trim()}
              className="w-full py-2 rounded-lg border border-dashed border-[rgb(var(--c-border))] text-sm text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:border-indigo-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {generatingMessage || '生成中...'}
                </>
              ) : (
                '生成场景概念图'
              )}
            </button>
          )}
        </div>
      )}

      {/* Empty State */}
      {scenes.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[rgb(var(--c-text-muted))] mb-4">还没有创建场景</p>
          <button
            onClick={handleAddScene}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            创建第一个场景
          </button>
        </div>
      )}
    </div>
  );
}
