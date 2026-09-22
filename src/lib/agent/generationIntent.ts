/** Only the current user request is inspected; project context is not generation consent. */
export function isPromptOnlyRequest(request: string, defaultPromptOnly = false): boolean {
  const text = request.replace(/```[\s\S]*?```|[“「『][\s\S]*?[”」』]/g, ' ').trim();
  const forbidden = /(?:不要|不需要|无需|禁止|不得|别|先不|暂不)(?:再|自动|直接|开始|执行|提交|进行|任何|付费|\s)*(?:生成|生图|配音|渲染)(?=$|[，。！？；、\s]|图片|图像|视频|音频|素材|任务)/i.test(text)
    || /(?:只|仅|只需)(?:要|是|用)?[^，。！？；\n]{0,12}(?:改|写|优化|调整|完善|检查)[^，。！？；\n]{0,8}(?:提示词|prompt|音色描述)/i.test(text);
  if (forbidden) return true;
  // “生成提示词” is text editing. Require a separate media instruction to submit.
  const mediaRequest = text.replace(/(?:生成|制作|输出|写出)(?:一[份段条个组]|新的|这[份段条个组])?(?:提示词|prompt|配音词|生图词|视频词)/gi, '');
  const explicitGeneration = /(?:生成|制作|渲染|重做|重生)(?:一[张段条个组]|[这该]个|[这该]张|新的|一下|[\d一二三四五六七八九十]+[张段条个组])?(?:图片|图像|视频|音频|配音|素材|海报)|(?:生图|重新配音|开始生成|提交生成|执行生成|生成吧|生成即可|生成就行)|(?:改完|修改后|然后|再|并|直接|立即|现在|重新)(?:帮我)?生成/i.test(mediaRequest);
  return !explicitGeneration && (defaultPromptOnly || /(?:提示词|prompt|配音词|生图词|视频词|音色描述)/i.test(text));
}
