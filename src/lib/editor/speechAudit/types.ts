/**
 * speechAudit/types — 口播审片系统数据模型。
 *
 * 判定哲学：不问"文字像不像"，问"这一段有没有信息增量 + 音频上是不是一次重来"。
 * 所有 finding 携带证据链（原始重转写/停顿模式/能量互相关/LLM 语义），
 * 全部只标记不自动剪，用户在剪口播面板复核后一键应用。
 */

export type FindingCategory =
  | 'filler'    // 语气词（嗯/啊/呃/那个）
  | 'repeat'    // 重复（含 ASR 吞掉的重录）
  | 'pause'     // 停顿（时长可调过滤）
  | 'stutter'   // 口误/结巴/说错重来
  | 'rambling'  // 废话/无信息增量表达
  | 'manual';   // 用户在文稿里手动圈选的字级删除

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  filler: '语气词',
  repeat: '重复',
  pause: '停顿',
  stutter: '口误',
  rambling: '废话',
  manual: '手动',
};

export type EvidenceKind =
  | 'raw_rewhisper'  // 短窗原始模式重转写（恢复被 ASR 清洗的语流）
  | 'pause_pattern'  // 词间停顿模式（blank_duration / silencedetect）
  | 'energy_xcorr'   // 能量包络互相关（两遍重录声学高度相似）
  | 'text_heuristic' // 文本启发式（相似度/句内重复/口癖密度）——仅候选信号
  | 'llm_semantic'   // LLM 信息增量判定
  | 'user_manual';   // 用户手动圈选

export interface FindingEvidence {
  kind: EvidenceKind;
  /** 人可读的证据描述，如「原始重转写两遍均为"我们团队已经"，能量相似度 0.91」 */
  detail: string;
  score?: number;
}

export interface SpeechFinding {
  id: string;
  category: FindingCategory;
  mediaPath: string;
  /** 源媒体相对秒，已吸附到词边界 + 呼吸余量 */
  sourceStart: number;
  sourceEnd: number;
  /** 被删内容（原文） */
  text: string;
  /** repeat 类：保留的那一遍的文本（供 UI 提示"保留这遍"） */
  keptAlternativeText?: string;
  /** repeat 类：保留遍的源区间（供 UI 下划线定位） */
  keptRange?: [number, number];
  evidence: FindingEvidence[];
  /** 0-1 综合置信度 */
  confidence: number;
  /** 面板勾选状态（按类别批量 + 单条切换）；只有 enabled 的才会被应用/预览跳过 */
  enabled: boolean;
  /** pause 类：停顿时长秒（供最短停顿阈值前端过滤） */
  pauseDur?: number;
}

export interface SpeechAuditStats {
  asrCalls: number;
  llmCalls: number;
  windows: number;
}

export type SpeechAuditStatus = 'idle' | 'running' | 'done' | 'error';

export interface SpeechAuditReport {
  createdAt: number;
  findings: SpeechFinding[];
  stats: SpeechAuditStats;
  status: SpeechAuditStatus;
  /** 运行中进度描述，如「重转写 5/12…」 */
  progress?: string;
  error?: string;
}

/** 词间停顿事件（源媒体相对秒） */
export interface PauseEvent {
  mediaPath: string;
  /** 停顿开始（前词结束） */
  sourceStart: number;
  /** 停顿结束（后词开始） */
  sourceEnd: number;
  durSec: number;
}

/** 候选可疑窗口（源媒体相对秒，已扩边合并） */
export interface SuspectWindow {
  mediaPath: string;
  sourceStart: number;
  sourceEnd: number;
  /** 触发该窗口的信号，供 LLM prompt 与调试 */
  reasons: string[];
  /** 声学相似度（retake 模式命中时） */
  energyScore?: number;
}

/** 引擎运行选项 */
export interface SpeechAuditOptions {
  /** 只审这个时间轴范围（秒）；不传审全轨 */
  startSec?: number;
  endSec?: number;
  /** 可疑窗口上限（默认 30） */
  maxWindows?: number;
  /** 增量回调：每批新 findings 产出时触发（面板实时刷新） */
  onUpdate?: (report: SpeechAuditReport) => void;
}
