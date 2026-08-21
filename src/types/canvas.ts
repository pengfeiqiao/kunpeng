export type CanvasNodeType = 'text' | 'image' | 'video' | 'audio';

export interface TextNodeData {
  description: string;
  prompt?: string;
  isGenerating?: boolean;
  generatedContent?: string;
  isEditing?: boolean;
}

export interface ImageNodeData {
  description?: string;
  referenceImage?: string;
  referenceImages?: { url: string; name?: string }[];
  generatedImageUrl?: string;
  localPath?: string;
  imagePrompt?: string;
  isGenerating?: boolean;
  imageModel?: string;
  modelVersion?: string;
  midjourneyStyleId?: string;
  midjourneyStylize?: number;
  midjourneyChaos?: number;
  midjourneyRaw?: boolean;
  midjourneyStyleWeight?: number;
  midjourneyImageWeight?: number;
  midjourneyWeird?: number;
  aspectRatio?: string;
  resolution?: string;
  generationMode?: 'text-to-image' | 'image-to-image';
  generationHistory?: { url: string; timestamp: number }[];
  isStoryboard?: boolean;
  isUploadedImage?: boolean;
  isImageToPrompt?: boolean;
}

export interface VideoNodeData {
  imageUrl?: string;
  description?: string;
  /** Current node override. Missing means follow the app-wide default. */
  videoPromptTemplate?: 'legacy' | 'universal';
  /** Both variants are retained so switching templates never destroys edits. */
  legacyVideoPrompt?: string;
  universalVideoPrompt?: string;
  generatedVideoUrl?: string;
  localPath?: string;
  /**
   * Explicit source selected by the user (upload / artifact picker).
   * Generated outputs never overwrite this field, so regenerating a node
   * cannot silently feed the previous result back as a reference video.
   */
  sourceVideoPath?: string;
  /** Distinguishes user-selected inputs from generated/derived outputs. */
  mediaRole?: 'reference' | 'output';
  referenceImages?: { url: string; name?: string }[];
  referenceVideos?: { url: string; name?: string }[];
  isGenerating?: boolean;
  modelVersion?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  hasAudio?: boolean;
  generationHistory?: { url: string; timestamp: number }[];
  isMgAnimationNode?: boolean;
  mgStyleId?: string;
}

/** 音频参考节点（上传的音色/音乐素材，Seedance 多模态 @音频一 引用） */
export interface AudioNodeData {
  description?: string;
  /** asset:// display URL */
  audioUrl?: string;
  /** absolute local path（提交时经 rhtvResolveMedia 上传） */
  localPath?: string;
  fileName?: string;
}

export type CanvasNodeData = TextNodeData | ImageNodeData | VideoNodeData | AudioNodeData;
