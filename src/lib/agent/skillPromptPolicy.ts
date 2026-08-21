export interface PromptSkill {
  name: string;
  displayName?: string;
  description: string;
  triggers: string[];
  visibility?: 'toolbar' | 'library' | 'internal' | 'disabled';
  promptTemplate: string;
  skillPath: string;
  invokable?: boolean;
}

const SCOPED_INTERNAL_SKILLS: Record<string, { views: string[]; keywords: string[] }> = {
  'canvas-project-manager': {
    views: ['canvas'],
    keywords: ['画布', '节点', '连线', 'canvas'],
  },
  'scene-image-anchor': {
    views: ['workshop'],
    keywords: ['分镜', '故事板', '生图', '资产图', '角色一致', '场景一致', 'storyboard'],
  },
};

export function shouldIncludeInternalSkill(skill: PromptSkill, activeView = 'chat', query = ''): boolean {
  const scope = SCOPED_INTERNAL_SKILLS[skill.name];
  if (!scope) return true;
  if (scope.views.includes(activeView)) return true;
  const haystack = query.toLowerCase();
  return scope.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

export function isSkillRelevant(skill: PromptSkill, query = ''): boolean {
  const haystack = query.trim().toLowerCase();
  if (!haystack) return false;
  return [skill.name, skill.displayName, skill.description, ...skill.triggers]
    .filter(Boolean)
    .some((value) => haystack.includes(String(value).toLowerCase()) || String(value).toLowerCase().includes(haystack));
}

export function compactSkillDescription(description: string, limit = 180): string {
  const compact = description.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit).trim()}…`;
}

export function buildSkillDescriptionText(
  skills: PromptSkill[],
  options: { activeView?: string; query?: string } = {},
): string {
  const activeView = options.activeView || 'chat';
  // Deliberately NOT query-dependent: this text lives in the system prompt,
  // and any per-query variation (relevance markers, keyword-scoped internal
  // skills) rebuilds messages[0] every turn, destroying server-side prompt
  // cache prefix stability. Query-dependent relevance moves to a transient
  // per-run notice — see buildSkillRelevanceNotice.
  const internal = skills.filter(
    (skill) => skill.visibility === 'internal' && shouldIncludeInternalSkill(skill, activeView),
  );
  const publicSkills = skills.filter((skill) => skill.visibility !== 'internal');
  const groups = [
    {
      title: '### 可调用技能（可通过 skill_invoke 工具调用）',
      skills: publicSkills.filter((skill) => skill.invokable),
      action: '调用前按需读取',
    },
    {
      title: '### 参考型技能（按需读取 SKILL.md）',
      skills: publicSkills.filter((skill) => !skill.invokable),
      action: '读取',
    },
  ];
  const parts: string[] = [];
  for (const group of groups) {
    if (group.skills.length === 0) continue;
    parts.push(group.title);
    for (const skill of group.skills) {
      parts.push(
        `- **${skill.displayName || skill.name}**: ${compactSkillDescription(skill.description)} → ${group.action} \`${skill.skillPath}/SKILL.md\``,
      );
    }
  }
  if (internal.length > 0) {
    parts.push('### 当前工作区内部规则（自动生效）');
    for (const skill of internal) {
      parts.push(`#### ${skill.displayName || skill.name}\n${skill.promptTemplate}`);
    }
  }
  return parts.join('\n');
}

/**
 * Per-run, query-dependent skill relevance — delivered as a TRANSIENT user
 * message (CC-style attachment), never baked into the system prompt, so the
 * cached prefix stays byte-stable across turns.
 *
 * Two payloads:
 * 1. Names of public skills matching the query (previously the
 *    `· 本轮相关` marker inside the system prompt).
 * 2. Full promptTemplates of internal skills whose keywords match the query
 *    but whose scope does not include the active view (previously they were
 *    full-text injected into the system prompt per query).
 */
export function buildSkillRelevanceNotice(
  skills: PromptSkill[],
  options: { activeView?: string; query?: string } = {},
): string | null {
  const query = (options.query || '').trim();
  if (!query) return null;
  const activeView = options.activeView || 'chat';

  const relevantPublic = skills.filter(
    (skill) => skill.visibility !== 'internal' && isSkillRelevant(skill, query),
  );
  const keywordInternal = skills.filter(
    (skill) =>
      skill.visibility === 'internal'
      && !shouldIncludeInternalSkill(skill, activeView)
      && shouldIncludeInternalSkill(skill, activeView, query),
  );
  if (relevantPublic.length === 0 && keywordInternal.length === 0) return null;

  const parts: string[] = ['[本轮相关技能提示 — 仅供你参考，无需回应此消息]'];
  if (relevantPublic.length > 0) {
    parts.push(
      `以下技能与本轮请求可能相关，需要时可调用或读取其 SKILL.md：${
        relevantPublic.map((skill) => skill.displayName || skill.name).join('、')
      }`,
    );
  }
  for (const skill of keywordInternal) {
    parts.push(`#### ${skill.displayName || skill.name}\n${skill.promptTemplate}`);
  }
  return parts.join('\n');
}
