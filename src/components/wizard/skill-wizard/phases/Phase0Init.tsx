import { useState, useCallback } from 'react';
import { FolderOpen, Upload, Loader2, CheckCircle } from 'lucide-react';
import { open } from '@tauri-apps/api/dialog';
import { readTextFile, readDir } from '@tauri-apps/api/fs';
import { useWizardStore, type CharacterData, type SceneData } from '@/stores/wizardStore';

interface ProjectYaml {
  name?: string;
  style?: string;
  scenes?: Record<string, {
    description?: string;
    type?: string;
    style?: string;
    concept_path?: string;
    status?: string;
    biography_path?: string;
  }>;
}

interface CharacterConfig {
  name: string;
  archetype?: string;
  age?: string | number;
  temperament?: string[];
  bone_structure?: {
    face_shape_description?: string;
  };
  visual_memory_points?: Array<{ feature: string; description: string }>;
  costume?: {
    default?: string;
  };
}

interface SceneFolder {
  name: string;
  path: string;
  hasConcept: boolean;
  hasStoryboard: boolean;
  storyboardImages: string[];
  conceptImages: string[];
}

const STYLES = [
  {
    id: 'costume' as const,
    name: '古装风格',
    description: '知否/清平乐风格，北宋质感',
    preview: '🎭',
  },
  {
    id: 'wasteland' as const,
    name: '废土风格',
    description: '赛博朋克，后末世',
    preview: '🏜️',
  },
  {
    id: 'travel' as const,
    name: '现代旅游',
    description: '旅游风光影视片，自然光线，真人参考',
    preview: '🏔️',
  },
];

export default function Phase0Init() {
  const { project, setStyle, setProjectName, setSaveLocation, setCharacters, setScenes, setGeneratedImages, setStoryboardImages } = useWizardStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadSummary, setLoadSummary] = useState<{characters: number; scenes: number; storyboards: number} | null>(null);

  if (!project) return null;

  // Parse age string like "22-25岁" to number
  const parseAge = (ageStr: string | number | undefined): number => {
    if (typeof ageStr === 'number') return ageStr;
    if (!ageStr) return 25;
    const match = ageStr.match(/(\d+)/);
    return match ? parseInt(match[1]) : 25;
  };

  // Advanced YAML parser for project.yaml (handles multi-line values)
  const parseProjectYaml = (content: string): ProjectYaml => {
    const result: ProjectYaml = {};
    const lines = content.split('\n');
    let inScenes = false;
    let currentScene = '';
    let currentKey = '';
    let multiLineValue = '';

    const saveMultiLine = () => {
      if (currentScene && currentKey && result.scenes?.[currentScene]) {
        (result.scenes[currentScene] as Record<string, string>)[currentKey] = multiLineValue.trim();
      }
      currentKey = '';
      multiLineValue = '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimEnd();

      // Check indentation level
      const indent = line.search(/\S/);

      if (!inScenes) {
        // Top-level keys
        if (trimmed.startsWith('name:')) {
          result.name = trimmed.replace('name:', '').trim().replace(/['"]/g, '');
        } else if (trimmed.startsWith('style:')) {
          result.style = trimmed.replace('style:', '').trim();
        } else if (trimmed === 'scenes:') {
          inScenes = true;
          result.scenes = {};
        }
      } else {
        // Inside scenes block
        if (indent === 2 && trimmed.endsWith(':')) {
          // New scene: "  场景名:"
          saveMultiLine();
          currentScene = trimmed.slice(0, -1).trim();
          if (result.scenes) {
            result.scenes[currentScene] = {};
          }
        } else if (indent === 4 && currentScene && result.scenes?.[currentScene]) {
          // Scene property: "    key:"
          saveMultiLine();
          const colonIndex = trimmed.indexOf(':');
          if (colonIndex > 0) {
            currentKey = trimmed.substring(0, colonIndex).trim();
            const value = trimmed.substring(colonIndex + 1).trim();
            if (value) {
              // Single-line value
              (result.scenes[currentScene] as Record<string, string>)[currentKey] = value.replace(/^['"]|['"]$/g, '');
              currentKey = '';
            }
            // If no value, it might be a multi-line value starting next line
          }
        } else if (indent >= 6 && currentKey) {
          // Multi-line value continuation
          multiLineValue += (multiLineValue ? '\n' : '') + trimmed;
        } else if (indent < 2) {
          // Left scenes block
          saveMultiLine();
          inScenes = false;
        }
      }
    }
    saveMultiLine();
    return result;
  };

  // Scan scene folders for images
  const scanSceneFolders = async (scenesDir: string): Promise<SceneFolder[]> => {
    const folders: SceneFolder[] = [];
    try {
      const entries = await readDir(scenesDir);
      for (const entry of entries) {
        if (entry.name?.startsWith('scene_') && entry.children) {
          const folderPath = `${scenesDir}/${entry.name}`;
          const storyboardImages: string[] = [];
          const conceptImages: string[] = [];

          // Scan for storyboard and concept images
          for (const child of entry.children) {
            if (child.name?.endsWith('.jpg') || child.name?.endsWith('.png')) {
              const imagePath = `file://${folderPath}/${child.name}`;
              if (child.name.includes('storyboard') || child.name.includes('grid')) {
                storyboardImages.push(imagePath);
              } else if (child.name.includes('concept')) {
                conceptImages.push(imagePath);
              }
            }
            // Check storyboard subfolder
            if (child.name === 'storyboard' && child.children) {
              for (const sbChild of child.children) {
                if (sbChild.name?.endsWith('.jpg') || sbChild.name?.endsWith('.png')) {
                  storyboardImages.push(`file://${folderPath}/storyboard/${sbChild.name}`);
                }
              }
            }
            // Check concept subfolder
            if (child.name === 'concept' && child.children) {
              for (const cChild of child.children) {
                if (cChild.name?.endsWith('.jpg') || cChild.name?.endsWith('.png')) {
                  conceptImages.push(`file://${folderPath}/concept/${cChild.name}`);
                }
              }
            }
          }

          folders.push({
            name: entry.name.replace(/^scene_/, '').replace(/^scene_/, ''),
            path: folderPath,
            hasConcept: conceptImages.length > 0,
            hasStoryboard: storyboardImages.length > 0,
            storyboardImages,
            conceptImages,
          });
        }
      }
    } catch (err) {
      console.log('[Phase0Init] No scenes directory or failed to read:', err);
    }
    return folders;
  };

  // Load project from directory
  const loadProjectFromDirectory = async (dirPath: string) => {
    setIsLoading(true);
    setLoadError(null);
    setLoadSummary(null);

    try {
      // 1. Load project.yaml
      const projectYamlPath = `${dirPath}/project.yaml`;
      const projectYamlContent = await readTextFile(projectYamlPath);
      const projectYaml = parseProjectYaml(projectYamlContent);
      console.log('[Phase0Init] Loaded project.yaml:', projectYaml);

      // Set project name and style (use directory name as fallback)
      const projectName = projectYaml.name || dirPath.split('/').pop() || '未命名项目';
      setProjectName(projectName);
      if (projectYaml.style === 'costume_drama') {
        setStyle('costume');
      } else if (projectYaml.style === 'wasteland') {
        setStyle('wasteland');
      } else if (projectYaml.style === 'modern_travel') {
        setStyle('travel');
      }
      setSaveLocation(dirPath);

      // 2. Load characters
      const charactersDir = `${dirPath}/characters`;
      const characters: CharacterData[] = [];
      const generatedImages: Record<string, string[]> = {};

      try {
        const charEntries = await readDir(charactersDir);
        console.log('[Phase0Init] Character directory entries:', charEntries.length, charEntries.map(e => e.name));

        for (const entry of charEntries) {
          console.log('[Phase0Init] Checking entry:', entry.name, 'isFile:', !entry.children);
          if (entry.name && entry.name.endsWith('_config.json')) {
            try {
              const configContent = await readTextFile(`${charactersDir}/${entry.name}`);
              const charConfig: CharacterConfig = JSON.parse(configContent);

              // Extract visual memory points
              const visualMemory = charConfig.visual_memory_points
                ?.map(v => v.feature)
                .join('、') || '';

              // Find makeup images
              const charName = charConfig.name;
              const makeupImages: string[] = [];
              for (const e of charEntries) {
                if (e.name?.startsWith(`${charName}_定妆照_U`) && (e.name.endsWith('.jpg') || e.name.endsWith('.png'))) {
                  makeupImages.push(`file://${charactersDir}/${e.name}`);
                }
              }
              // Sort by U number
              makeupImages.sort((a, b) => {
                const matchA = a.match(/U(\d)/);
                const matchB = b.match(/U(\d)/);
                return (matchA ? parseInt(matchA[1]) : 0) - (matchB ? parseInt(matchB[1]) : 0);
              });

              characters.push({
                name: charConfig.name || '',
                archetype: charConfig.archetype || '',
                age: parseAge(charConfig.age),
                personality: charConfig.temperament?.join('、') || '',
                appearance: charConfig.bone_structure?.face_shape_description || '',
                visualMemory: visualMemory,
                boneStructure: charConfig.bone_structure?.face_shape_description || '',
                costume: charConfig.costume?.default || '',
              });

              // Store makeup images
              if (makeupImages.length > 0) {
                generatedImages[`makeup-${characters.length - 1}`] = makeupImages;
              }
            } catch (err) {
              console.error('[Phase0Init] Failed to load character config:', entry.name, err);
            }
          }
        }
      } catch (err) {
        console.log('[Phase0Init] No characters directory or failed to read:', err);
      }

      setCharacters(characters);
      console.log('[Phase0Init] Loaded characters:', characters.length);

      // 3. Load scenes from YAML and scan folders
      const scenes: SceneData[] = [];
      let totalStoryboardImages = 0;

      // First, scan scene folders
      const sceneFolders = await scanSceneFolders(`${dirPath}/scenes`);
      const folderMap = new Map(sceneFolders.map(f => [f.name, f]));

      // Load scenes from YAML
      if (projectYaml.scenes) {
        for (const [sceneName, sceneData] of Object.entries(projectYaml.scenes)) {
          const typeMap: Record<string, SceneData['type']> = {
            'indoor_daytime': 'indoor-day',
            'indoor_nighttime': 'indoor-night',
            'outdoor_daytime': 'outdoor-day',
            'outdoor_nighttime': 'outdoor-night',
          };

          // Find matching folder
          let matchingFolder = folderMap.get(sceneName);
          if (!matchingFolder) {
            // Try to find by partial match
            for (const [folderName, folder] of folderMap) {
              if (folderName.includes(sceneName) || sceneName.includes(folderName)) {
                matchingFolder = folder;
                break;
              }
            }
          }

          const scene: SceneData = {
            name: sceneName,
            description: sceneData.description || '',
            type: typeMap[sceneData.type || ''] || 'indoor-day',
            characters: [],
            conceptPath: sceneData.concept_path,
            status: sceneData.status,
            folderPath: matchingFolder?.path,
          };
          scenes.push(scene);

          // Store concept image if exists
          if (sceneData.concept_path) {
            generatedImages[`scene-${scenes.length - 1}-concept`] = [
              `file://${dirPath}/${sceneData.concept_path}`,
            ];
          }

          // Store storyboard images from folder
          if (matchingFolder && matchingFolder.storyboardImages.length > 0) {
            generatedImages[`scene-${scenes.length - 1}-storyboard`] = matchingFolder.storyboardImages;
            totalStoryboardImages += matchingFolder.storyboardImages.length;
          }
        }
      }

      // Add any scene folders not in YAML
      for (const folder of sceneFolders) {
        const existsInYaml = scenes.some(s =>
          s.name === folder.name || s.name.includes(folder.name) || folder.name.includes(s.name)
        );
        if (!existsInYaml) {
          scenes.push({
            name: folder.name,
            description: '',
            type: 'indoor-day',
            characters: [],
            folderPath: folder.path,
          });
          if (folder.storyboardImages.length > 0) {
            generatedImages[`scene-${scenes.length - 1}-storyboard`] = folder.storyboardImages;
            totalStoryboardImages += folder.storyboardImages.length;
          }
        }
      }

      setScenes(scenes);

      // Store all generated images
      for (const [key, images] of Object.entries(generatedImages)) {
        setGeneratedImages(key, images);
      }

      // Set storyboard images for phase 3
      const allStoryboardImages: string[] = [];
      for (const images of Object.values(generatedImages)) {
        if (images.some(img => img.includes('storyboard') || img.includes('grid'))) {
          allStoryboardImages.push(...images);
        }
      }
      if (allStoryboardImages.length > 0) {
        setStoryboardImages(allStoryboardImages);
      }

      setLoadSummary({
        characters: characters.length,
        scenes: scenes.length,
        storyboards: totalStoryboardImages,
      });

      console.log('[Phase0Init] Project loaded successfully:', {
        name: projectName,
        characters: characters.length,
        scenes: scenes.length,
        storyboards: totalStoryboardImages,
      });

    } catch (err) {
      console.error('[Phase0Init] Failed to load project:', err);
      setLoadError('无法加载项目，请确保目录包含有效的 project.yaml 文件');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle directory selection (also try to load existing project)
  const handleSelectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: '选择项目保存位置',
      });
      if (selected && typeof selected === 'string') {
        // Check if project.yaml exists, try to load it
        try {
          await readTextFile(`${selected}/project.yaml`);
          // Project exists, load it
          await loadProjectFromDirectory(selected);
        } catch {
          // No project.yaml, just set the save location
          setSaveLocation(selected);
          setLoadError(null);
          setLoadSummary(null);
        }
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  };

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // In Tauri webview, we can't get file paths from drop
    // So we open the directory picker instead
    handleSelectDirectory();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-[rgb(var(--c-text))] mb-1">项目初始化</h3>
        <p className="text-sm text-[rgb(var(--c-text-muted))]">
          选择风格并设置项目基本信息
        </p>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleSelectDirectory}
        className={`
          relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
          transition-all duration-200
          ${isDragging
            ? 'border-indigo-500 bg-indigo-500/10'
            : loadSummary
              ? 'border-green-500/50 bg-green-500/10'
              : 'border-[rgb(var(--c-border))] hover:border-indigo-400/50 hover:bg-[rgb(var(--c-border))]/30'
          }
        `}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 size={24} className="animate-spin text-indigo-500" />
            <span className="text-sm text-[rgb(var(--c-text-muted))]">正在加载项目...</span>
          </div>
        ) : loadSummary ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle size={24} className="text-green-500" />
            <span className="text-sm text-[rgb(var(--c-text))]">项目加载成功</span>
            <div className="flex gap-4 text-xs text-[rgb(var(--c-text-muted))]">
              <span>👥 {loadSummary.characters} 角色</span>
              <span>🎬 {loadSummary.scenes} 场景</span>
              <span>🖼️ {loadSummary.storyboards} 分镜</span>
            </div>
            <p className="text-xs text-[rgb(var(--c-text-muted))] mt-1">点击重新选择目录</p>
          </div>
        ) : (
          <>
            <Upload size={24} className="mx-auto mb-2 text-[rgb(var(--c-text-muted))]" />
            <p className="text-sm text-[rgb(var(--c-text-muted))]">
              点击加载已有项目目录
            </p>
            <p className="text-xs text-[rgb(var(--c-text-muted))] mt-1">
              将自动加载 project.yaml 和角色/场景配置
            </p>
          </>
        )}
        {loadError && (
          <p className="text-xs text-red-500 mt-2">{loadError}</p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-[rgb(var(--c-border))]" />
        <span className="text-xs text-[rgb(var(--c-text-muted))]">或创建新项目</span>
        <div className="flex-1 h-px bg-[rgb(var(--c-border))]" />
      </div>

      {/* Style Selection */}
      <div>
        <label className="block text-sm font-medium text-[rgb(var(--c-text))] mb-2">
          选择风格
        </label>
        <div className="grid grid-cols-2 gap-3">
          {STYLES.map((style) => (
            <button
              key={style.id}
              onClick={() => setStyle(style.id)}
              className={`p-3 rounded-xl border-2 text-left transition-all ${
                project.style === style.id
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-[rgb(var(--c-border))] hover:border-indigo-400/50'
              }`}
            >
              <div className="text-2xl mb-2">{style.preview}</div>
              <div className="font-medium text-[rgb(var(--c-text))]">{style.name}</div>
              <div className="text-xs text-[rgb(var(--c-text-muted))] mt-1">
                {style.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Project Name */}
      <div>
        <label className="block text-sm font-medium text-[rgb(var(--c-text))] mb-2">
          项目名称
        </label>
        <input
          type="text"
          value={project.projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="输入项目名称..."
          className="w-full px-3 py-2 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-[rgb(var(--c-text))] placeholder-[rgb(var(--c-text-muted))] focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
      </div>

      {/* Save Location */}
      <div>
        <label className="block text-sm font-medium text-[rgb(var(--c-text))] mb-2">
          保存位置
        </label>
        <div className="flex gap-2">
          <div
            className="flex-1 px-3 py-2 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-bg))] text-[rgb(var(--c-text-muted))] text-sm truncate cursor-pointer hover:border-indigo-400/50"
            onClick={handleSelectDirectory}
          >
            {project.saveLocation || '点击选择目录...'}
          </div>
          <button
            onClick={handleSelectDirectory}
            className="px-3 py-2 rounded-lg border border-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors"
          >
            <FolderOpen size={18} />
          </button>
        </div>
      </div>

      {/* Validation Hint */}
      {(!project.style || !project.projectName || !project.saveLocation) && (
        <div className="text-xs text-amber-500 bg-amber-500/10 rounded-lg p-2">
          请完成所有必填项后继续
        </div>
      )}
    </div>
  );
}
