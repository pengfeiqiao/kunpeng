import { useCallback } from 'react';
import { useWizardStore, type CharacterData, type SceneData } from '@/stores/wizardStore';
import { useAgent } from '@/hooks';

/**
 * Hook for handling wizard generation operations.
 * Integrates with the chat system to send generation prompts.
 */
export function useWizardGeneration() {
  const { project, setGenerating, setGeneratedImages, setStoryboardImages, setVideoPrompts } = useWizardStore();
  // Secondary engine: wizard runs must not hijack the main instance's
  // session-restore callback or persist wizard history into chat sessions.
  const { sendMessage } = useAgent({ primary: false });

  /**
   * Generate makeup photos for a character
   */
  const generateMakeup = useCallback(async (character: CharacterData, characterIndex: number) => {
    if (!project) return;

    setGenerating(true, `正在为 ${character.name} 生成定妆照...`);

    const prompt = buildMakeupPrompt(character, project.style);

    try {
      await sendMessage(prompt);
      // Note: In a real implementation, we'd parse the response to extract image URLs
      // For now, we'll use placeholder URLs
      setGeneratedImages(`makeup-${characterIndex}`, [
        '/placeholder-makeup-1.jpg',
        '/placeholder-makeup-2.jpg',
        '/placeholder-makeup-3.jpg',
        '/placeholder-makeup-4.jpg',
      ]);
    } catch (error) {
      console.error('Failed to generate makeup:', error);
    } finally {
      setGenerating(false);
    }
  }, [project, sendMessage, setGenerating, setGeneratedImages]);

  /**
   * Generate three-view (front/side/back) for a character
   */
  const generateThreeView = useCallback(async (character: CharacterData, selectedMakeupUrl: string) => {
    if (!project) return;

    setGenerating(true, `正在为 ${character.name} 生成三视图...`);

    const prompt = buildThreeViewPrompt(character, selectedMakeupUrl, project.style);

    try {
      await sendMessage(prompt);
      setGeneratedImages(`threeview-${character.name}`, [
        '/placeholder-threeview.jpg',
      ]);
    } catch (error) {
      console.error('Failed to generate three-view:', error);
    } finally {
      setGenerating(false);
    }
  }, [project, sendMessage, setGenerating, setGeneratedImages]);

  /**
   * Generate scene concept image
   */
  const generateSceneConcept = useCallback(async (scene: SceneData, sceneIndex: number) => {
    if (!project) return;

    setGenerating(true, `正在生成场景「${scene.name}」概念图...`);

    const prompt = buildScenePrompt(scene, project.style, project.characters);

    try {
      await sendMessage(prompt);
      setGeneratedImages(`scene-${sceneIndex}`, [
        '/placeholder-scene.jpg',
      ]);
    } catch (error) {
      console.error('Failed to generate scene concept:', error);
    } finally {
      setGenerating(false);
    }
  }, [project, sendMessage, setGenerating, setGeneratedImages]);

  /**
   * Generate storyboard (9 shots)
   */
  const generateStoryboard = useCallback(async () => {
    if (!project || project.scenes.length === 0) return;

    setGenerating(true, '正在生成分镜图...');

    const prompt = buildStoryboardPrompt(project);

    try {
      await sendMessage(prompt);
      // Generate 9 placeholder shots
      const shots = Array.from({ length: 9 }, (_, i) => `/placeholder-shot-${i + 1}.jpg`);
      setStoryboardImages(shots);
    } catch (error) {
      console.error('Failed to generate storyboard:', error);
    } finally {
      setGenerating(false);
    }
  }, [project, sendMessage, setGenerating, setStoryboardImages]);

  /**
   * Regenerate a single shot
   */
  const regenerateShot = useCallback(async (shotIndex: number) => {
    if (!project) return;

    setGenerating(true, `正在重新生成分镜 ${shotIndex + 1}...`);

    const prompt = buildSingleShotPrompt(project, shotIndex);

    try {
      await sendMessage(prompt);
      // Update the specific shot
      const currentImages = project.storyboardImages;
      const newImages = [...currentImages];
      newImages[shotIndex] = `/placeholder-shot-${shotIndex + 1}-regen.jpg`;
      setStoryboardImages(newImages);
    } catch (error) {
      console.error('Failed to regenerate shot:', error);
    } finally {
      setGenerating(false);
    }
  }, [project, sendMessage, setGenerating, setStoryboardImages]);

  /**
   * Generate video prompts
   */
  const generateVideoPrompts = useCallback(async () => {
    if (!project || project.storyboardImages.length === 0) return;

    setGenerating(true, '正在生成视频提示词...');

    const prompt = buildVideoPromptsPrompt(project);

    try {
      await sendMessage(prompt);
      // Set placeholder prompts
      setVideoPrompts([
        `【开篇】镜头从远处缓缓推进，展现${project.scenes[0]?.name || '场景'}的全貌...`,
        `【发展】${project.characters[0]?.name || '角色'}缓缓走入画面...`,
        `【高潮】画面聚焦于核心冲突点...`,
        `【转折】镜头突然切换到新的视角...`,
        `【结尾】画面渐渐拉远，留白余韵...`,
      ]);
    } catch (error) {
      console.error('Failed to generate video prompts:', error);
    } finally {
      setGenerating(false);
    }
  }, [project, sendMessage, setGenerating, setVideoPrompts]);

  return {
    generateMakeup,
    generateThreeView,
    generateSceneConcept,
    generateStoryboard,
    regenerateShot,
    generateVideoPrompts,
    isGenerating: useWizardStore((s) => s.isGenerating),
    generatingMessage: useWizardStore((s) => s.generatingMessage),
  };
}

// ── Prompt Builders ────────────────────────────────────────────────────────

function buildMakeupPrompt(character: CharacterData, style: 'costume' | 'wasteland' | 'travel' | null): string {
  const styleNames: Record<string, string> = { costume: '古装剧', wasteland: '废土风格', travel: '现代旅游' };
  const styleName = (style && styleNames[style]) || '古装剧';

  return `[视频风格复刻] 请为以下角色生成 4 张定妆照候选图（U1-U4）：

**角色信息**
- 名称：${character.name}
- 原型：${character.archetype}
- 年龄：${character.age}
- 性格：${character.personality}
- 外貌：${character.appearance}
- 视觉记忆点：${character.visualMemory || '无'}
- 服装：${character.costume}

**风格要求**
- 整体风格：${styleName}
- 写实主义，避免 AI 感
- 精确的光影、色彩、质感控制

请生成 4 张不同角度/表情的定妆照供选择。`;
}

function buildThreeViewPrompt(character: CharacterData, makeupUrl: string, style: 'costume' | 'wasteland' | 'travel' | null): string {
  const styleNames: Record<string, string> = { costume: '古装剧', wasteland: '废土风格', travel: '现代旅游' };
  const styleName = (style && styleNames[style]) || '古装剧';

  return `[视频风格复刻] 请基于选定的定妆照生成角色的三视图：

**角色信息**
- 名称：${character.name}
- 定妆照：${makeupUrl}

**三视图要求**
- 正面、侧面、背面三个视角
- 保持角色一致性
- ${styleName}风格
- 白色背景，适合后续合成

请生成完整的三视图。`;
}

function buildScenePrompt(scene: SceneData, style: 'costume' | 'wasteland' | 'travel' | null, _characters: CharacterData[]): string {
  const styleNames: Record<string, string> = { costume: '古装剧', wasteland: '废土风格', travel: '现代旅游' };
  const styleName = (style && styleNames[style]) || '古装剧';
  const typeMap: Record<string, string> = {
    'indoor-day': '室内·白天',
    'indoor-night': '室内·夜晚',
    'outdoor-day': '室外·白天',
    'outdoor-night': '室外·夜晚',
  };
  const charNames = scene.characters.join('、');

  return `[视频风格复刻] 请生成以下场景的概念图：

**场景信息**
- 名称：${scene.name}
- 类型：${typeMap[scene.type]}
- 描述：${scene.description}
- 出场角色：${charNames || '无'}

**风格要求**
- 整体风格：${styleName}
- 电影级画面质量
- 写实主义光影

请生成场景概念图。`;
}

function buildStoryboardPrompt(project: NonNullable<ReturnType<typeof useWizardStore.getState>['project']>): string {
  const styleNames: Record<string, string> = { costume: '古装剧', wasteland: '废土风格', travel: '现代旅游' };
  const styleName = (project.style && styleNames[project.style]) || '古装剧';
  const sceneInfo = project.scenes.map((s, i) => `场景${i + 1}：${s.name} - ${s.description}`).join('\n');
  const charInfo = project.characters.map((c) => `${c.name}（${c.archetype}）`).join('、');

  return `[视频风格复刻] 请生成九宫格分镜图：

**项目信息**
- 名称：${project.projectName}
- 风格：${styleName}

**角色**
${charInfo}

**场景**
${sceneInfo}

**分镜要求**
- 9 张分镜图，组成完整的叙事序列
- 遵循 2-2-2-2-1 分段规则（开篇2张、发展2张、高潮2张、转折2张、结尾1张）
- 保持角色一致性
- 电影级画面质量

请生成九宫格分镜图。`;
}

function buildSingleShotPrompt(project: NonNullable<ReturnType<typeof useWizardStore.getState>['project']>, shotIndex: number): string {
  const styleNames: Record<string, string> = { costume: '古装剧', wasteland: '废土风格', travel: '现代旅游' };
  const styleName = (project.style && styleNames[project.style]) || '古装剧';
  const segmentLabels = ['开篇', '开篇', '发展', '发展', '高潮', '高潮', '转折', '转折', '结尾'];

  return `[视频风格复刻] 请重新生成分镜 ${shotIndex + 1}：

**项目信息**
- 名称：${project.projectName}
- 风格：${styleName}

**分镜信息**
- 序号：分镜 ${shotIndex + 1}
- 所属段落：${segmentLabels[shotIndex]}

请重新生成这张分镜图，保持与整体风格一致。`;
}

function buildVideoPromptsPrompt(project: NonNullable<ReturnType<typeof useWizardStore.getState>['project']>): string {
  const styleNames: Record<string, string> = { costume: '古装剧', wasteland: '废土风格', travel: '现代旅游' };
  const styleName = (project.style && styleNames[project.style]) || '古装剧';
  const charInfo = project.characters.map((c) => `${c.name}：${c.appearance}`).join('\n');

  return `[视频风格复刻] 请生成视频提示词：

**项目信息**
- 名称：${project.projectName}
- 风格：${styleName}

**角色**
${charInfo}

**要求**
- 按 2-2-2-2-1 规则分为 5 段
- 每段包含画面描述、运镜、音效建议
- 格式适合直接复制到 AI 视频平台（Runway/Pika 等）

请生成 5 段视频提示词。`;
}
