export interface NormalizedRules {
  rules: string;
  notices: string[];
}

const REASONING_REQUEST = /(展示|显示|输出|给出|公开).{0,16}(完整)?(思考过程|推理过程|思维链|chain[ -]?of[ -]?thought)/i;
const REASONING_DENIAL = /(不|不要|禁止|避免|无需).{0,10}(展示|显示|输出|给出|公开).{0,16}(思考过程|推理过程|思维链|chain[ -]?of[ -]?thought)/i;

/** Resolve known custom-rule conflicts without silently discarding the user's intent. */
export function normalizeCustomRules(input: string | undefined): NormalizedRules {
  if (!input?.trim()) return { rules: '', notices: [] };
  let replaced = 0;
  const lines = input.split('\n').map((line) => {
    if (!REASONING_REQUEST.test(line) || REASONING_DENIAL.test(line)) return line;
    replaced += 1;
    const prefix = line.match(/^\s*[-*]\s*/)?.[0] ?? '';
    return `${prefix}向用户提供可复核的判断依据、阶段进度和结论摘要；不得输出逐字隐藏思考、内部思维链或私密推理原文。`;
  });
  const notices = replaced > 0
    ? [`检测到 ${replaced} 条要求展示隐藏思考过程的自定义规则，已转换为“展示可复核依据与进度摘要”。`]
    : [];
  return { rules: lines.join('\n'), notices };
}
