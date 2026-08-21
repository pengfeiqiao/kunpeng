// ── Agent Metadata ──────────────────────────────────────────────────────────

export interface AgentMeta {
  name: string;
  icon: string;
  description: string;
  slogan: string;
  suggestions: string[];
  /**
   * Optional runtime overrides. The product currently exposes only the single
   * Kunpeng assistant, but these fields are kept for backward-compatible
   * settings hydration.
   */
  preferredProviderId?: string;
  outputStyle?: 'default' | 'concise' | 'verbose' | 'coding';
  systemPromptAddition?: string;
}

export const DEFAULT_AGENT_METAS: Record<string, AgentMeta> = {
  main: {
    name: '鲲鹏',
    icon: '🐟',
    description: '北冥有鱼，其名为鲲',
    slogan: '鲲之大，不知其几千里也',
    suggestions: [
      '帮我写一段代码',
      '解释一个概念',
      '翻译成中文',
      '总结这篇文章',
      '分析数据趋势',
      '写一封邮件',
      '制定学习计划',
      '头脑风暴创意',
      '检查语法错误',
    ],
  },
};
