import { useState } from 'react';
import { Plus, Trash2, Loader2, Upload, X } from 'lucide-react';
import { useWizardStore, type CharacterData } from '@/stores/wizardStore';
import { useWizardGeneration } from '../hooks/useWizardGeneration';
import ImageSelector from '../components/ImageSelector';
import { convertFileSrc } from '@tauri-apps/api/tauri';

const DEFAULT_CHARACTER: CharacterData = {
  name: '',
  archetype: '',
  age: 25,
  personality: '',
  appearance: '',
  visualMemory: '',
  boneStructure: '',
  costume: '',
};

const ARCHETYPES = [
  { value: 'hero', label: '英雄/主角' },
  { value: 'heroine', label: '女主角' },
  { value: 'villain', label: '反派' },
  { value: 'mentor', label: '导师/长辈' },
  { value: 'companion', label: '伙伴/侍从' },
  { value: 'lover', label: '恋人' },
  { value: 'rival', label: '对手' },
  { value: 'other', label: '其他' },
];

export default function Phase1Characters() {
  const {
    project,
    addCharacter,
    updateCharacter,
    removeCharacter,
    selectMakeupImage,
  } = useWizardStore();
  const { generateMakeup, isGenerating, generatingMessage } = useWizardGeneration();
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!project) return null;

  const characters = project.characters;
  const currentCharacter = characters[currentIndex];
  const makeupImages = project.generatedImages[`makeup-${currentIndex}`] || [];
  const selectedMakeup = project.selectedMakeupImages[currentCharacter?.name || ''];

  const handleAddCharacter = () => {
    addCharacter({ ...DEFAULT_CHARACTER, name: `角色 ${characters.length + 1}` });
    setCurrentIndex(characters.length);
  };

  const handleRemoveCharacter = (index: number) => {
    if (characters.length <= 1) return;
    removeCharacter(index);
    if (currentIndex >= characters.length - 1) {
      setCurrentIndex(Math.max(0, characters.length - 2));
    }
  };

  const handleUpdateCharacter = (data: Partial<CharacterData>) => {
    if (currentCharacter) {
      updateCharacter(currentIndex, data);
    }
  };

  const handleGenerateMakeup = async () => {
    if (!currentCharacter || !currentCharacter.name.trim()) {
      return;
    }
    await generateMakeup(currentCharacter, currentIndex);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">角色建立</h3>
        <p className="text-sm text-[rgb(var(--c-text-muted))]">
          定义项目中的角色信息
        </p>
      </div>

      {/* Character Count & Add Button */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-[rgb(var(--c-text-muted))]">
          已创建 {characters.length} 个角色
        </span>
        <button
          onClick={handleAddCharacter}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus size={14} />
          添加角色
        </button>
      </div>

      {/* Character Tabs */}
      {characters.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {characters.map((char, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
                i === currentIndex
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))]'
              }`}
            >
              {char.name || `角色 ${i + 1}`}
              {characters.length > 1 && (
                <Trash2
                  size={12}
                  className="ml-1 opacity-50 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveCharacter(i);
                  }}
                />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Current Character Editor */}
      {currentCharacter && (
        <div className="space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
                角色名称
              </label>
              <input
                type="text"
                value={currentCharacter.name}
                onChange={(e) => handleUpdateCharacter({ name: e.target.value })}
                placeholder="输入名称..."
                className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
                角色原型
              </label>
              <select
                value={currentCharacter.archetype}
                onChange={(e) => handleUpdateCharacter({ archetype: e.target.value })}
                className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              >
                <option value="">选择原型...</option>
                {ARCHETYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
                年龄
              </label>
              <input
                type="number"
                value={currentCharacter.age}
                onChange={(e) => handleUpdateCharacter({ age: parseInt(e.target.value) || 0 })}
                className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
                服装
              </label>
              <input
                type="text"
                value={currentCharacter.costume}
                onChange={(e) => handleUpdateCharacter({ costume: e.target.value })}
                placeholder="服装描述..."
                className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>
          </div>

          {/* Personality */}
          <div>
            <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
              性格特点
            </label>
            <textarea
              value={currentCharacter.personality}
              onChange={(e) => handleUpdateCharacter({ personality: e.target.value })}
              placeholder="描述角色的性格特点..."
              rows={2}
              className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
            />
          </div>

          {/* Appearance */}
          <div>
            <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
              外貌描述
            </label>
            <textarea
              value={currentCharacter.appearance}
              onChange={(e) => handleUpdateCharacter({ appearance: e.target.value })}
              placeholder="描述角色的外貌特征..."
              rows={2}
              className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50 resize-none"
            />
          </div>

          {/* Face Reference (Travel style only) */}
          {project.style === 'travel' && (
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
                真人照片参考
              </label>
              <p className="text-xs text-[rgb(var(--c-text-muted))] mb-2 opacity-70">
                上传真人照片作为角色面部参考（现代旅游风格）
              </p>
              {currentCharacter.faceReference ? (
                <div className="relative inline-block">
                  <img
                    src={convertFileSrc(currentCharacter.faceReference)}
                    alt="面部参考"
                    className="w-24 h-24 object-cover rounded-lg border border-[rgb(var(--c-border))]"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <button
                    onClick={() => handleUpdateCharacter({ faceReference: undefined })}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border border-dashed border-[rgb(var(--c-border))] text-sm text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:border-indigo-400/50 transition-colors cursor-pointer">
                  <Upload size={14} />
                  选择照片
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      // Use Tauri dialog or just store the file path
                      // For web file input, we create a local URL
                      const { writeBinaryFile } = await import('@tauri-apps/api/fs');
                      const { appDataDir } = await import('@tauri-apps/api/path');
                      const buffer = await file.arrayBuffer();
                      const appData = await appDataDir();
                      const fileName = `face-ref-${currentCharacter.name || 'char'}-${Date.now()}.${file.name.split('.').pop()}`;
                      const filePath = `${appData}faces/${fileName}`;
                      try {
                        const { createDir } = await import('@tauri-apps/api/fs');
                        await createDir(`${appData}faces`, { recursive: true });
                        await writeBinaryFile(filePath, new Uint8Array(buffer));
                        handleUpdateCharacter({ faceReference: filePath });
                      } catch (err) {
                        console.error('Failed to save face reference:', err);
                      }
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {/* Visual Memory */}
          <div>
            <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-1">
              视觉记忆点
            </label>
            <input
              type="text"
              value={currentCharacter.visualMemory}
              onChange={(e) => handleUpdateCharacter({ visualMemory: e.target.value })}
              placeholder="泪痣、梨涡、疤痕等关键特征..."
              className="w-full px-2 py-1.5 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-sm text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>

          {/* Makeup Image Selector */}
          {makeupImages.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[rgb(var(--c-text-muted))] mb-2">
                选择定妆照
              </label>
              <ImageSelector
                images={makeupImages}
                selected={selectedMakeup}
                onSelect={(imageId) => selectMakeupImage(currentCharacter.name, imageId)}
                columns={2}
              />
            </div>
          )}

          {/* Generate Makeup Button */}
          {makeupImages.length === 0 && (
            <button
              onClick={handleGenerateMakeup}
              disabled={isGenerating || !currentCharacter.name.trim()}
              className="w-full py-2 rounded-lg border border-dashed border-[rgb(var(--c-border))] text-sm text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:border-indigo-400/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {generatingMessage || '生成中...'}
                </>
              ) : (
                '生成定妆照'
              )}
            </button>
          )}
        </div>
      )}

      {/* Empty State */}
      {characters.length === 0 && (
        <div className="text-center py-8">
          <p className="text-[rgb(var(--c-text-muted))] mb-4">还没有创建角色</p>
          <button
            onClick={handleAddCharacter}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            创建第一个角色
          </button>
        </div>
      )}
    </div>
  );
}
