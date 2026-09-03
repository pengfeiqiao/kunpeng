const DOUBAO_SPEECH = /(?:豆包.{0,8}(?:配音|语音|朗读|旁白)|(?:配音|语音|朗读|旁白).{0,8}豆包|seed[ -]?audio)/i;
const ACTION = /(?:帮我|给我|请|把|将|用|使用|生成|制作|配成|读一遍|念一遍|去配音)/i;
const QUESTION_ONLY = /(?:怎么|如何|什么是|接口|\bapi\b|文档|调用方式|调用方法|为什么|排查|修复|代码)/i;

/** Only match an execution request; questions about the API must not spend money. */
export function isExplicitDoubaoSpeechGenerationRequest(input: string): boolean {
  const text = input.trim();
  if (!DOUBAO_SPEECH.test(text) || !ACTION.test(text)) return false;
  return !QUESTION_ONLY.test(text);
}

/** A direct tool call is safe only when the utterance is present or clearly in prior context. */
export function shouldRequireDoubaoSpeechToolCall(input: string): boolean {
  if (!isExplicitDoubaoSpeechGenerationRequest(input)) return false;
  return /[：:]\s*\S{2,}|[“”"'][^\n“”"']{2,}[“”"']|(?:这段|这句|以下|上面|刚才|前面).{0,8}(?:文字|文案|台词|内容|旁白|配音|朗读)/i.test(input);
}

const CONFLICTING_GENERATION_TOOLS = new Set([
  'video_generate',
  'image_generate',
  'canvas_generate',
  'canvas_generate_batch',
  'mg_generate_with_reference_boards',
  'mg_text_fallback_generate',
  'timeline_omni_mg_generate',
  'timeline_omni_mg_generate_batch',
  'workshop_generate',
]);

/** Prevent an explicit Seed-Audio request from spending money on another model. */
export function isConflictingDoubaoSpeechGenerationTool(toolName: string): boolean {
  return CONFLICTING_GENERATION_TOOLS.has(toolName);
}

export function buildDoubaoSpeechRoutingNotice(input: string): string | null {
  if (!isExplicitDoubaoSpeechGenerationRequest(input)) return null;
  return `[系统路由提醒 — 无需回复本段]
当前用户正在要求执行豆包配音。台词信息齐全时必须直接调用 doubao_speech_generate；该工具的生成模型固定是 Seed-Audio，不得改用视频、音乐、通用音频模型、文本节点、手工操作说明或只续写提示词。只使用用户本轮明确提供或当前选中的参考音频，不得从旧对话、其他角色或其他画布节点猜一条。本地参考音频传 reference_audio_path(s)，公网音频传 reference_audio_url(s)，多条时保持用户给出的顺序。普通对话默认 create_canvas_node=false；只有用户明确要放到画布时才设为 true。若只配置了筷子 Seed-Audio 通道却没有参考音频，不得伪造 URL；应请用户提供一条参考音频。`;
}
