import { invoke } from '@tauri-apps/api/tauri';
import { buildSkillDescriptionText } from './skillPromptPolicy';

export interface AgentSkillManifest {
  name: string;
  displayName?: string;
  description: string;
  version?: string;
  triggers: string[];
  category: string;
  emoji?: string;
  hasPanel: boolean;
  parameters?: SkillParameter[];
  promptTemplate: string;
  skillPath: string;
  /** true = has skill.json (can be invoked via skill_invoke tool); false = SKILL.md only (agent reference, read via bash) */
  invokable?: boolean;
  visibility?: 'toolbar' | 'library' | 'internal' | 'disabled';
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
}

/**
 * 技能加载器 — 从磁盘加载和管理 Skills
 */
export class SkillLoader {
  private skills: AgentSkillManifest[] = [];
  private scanDirs: string[];

  constructor(scanDirs: string[]) {
    this.scanDirs = scanDirs;
  }

  /** 从所有扫描目录加载技能 */
  async loadAll(): Promise<AgentSkillManifest[]> {
    this.skills = [];
    let skillNames: string[] = [];
    try {
      // scan_skills_dir already targets ~/.kunpeng/skills. Calling it once per
      // candidate base directory duplicated the complete scan and could make
      // Agent startup wait forever on one stale/non-existent fallback path.
      skillNames = await this.invokeWithTimeout<string[]>(
        'scan_skills_dir',
        undefined,
        5_000,
      );
    } catch (err) {
      console.warn('Failed to scan skills directory:', err);
      return this.skills;
    }

    const uniqueNames = Array.from(new Set(skillNames));
    const manifests = await this.mapWithConcurrency(uniqueNames, 6, async (skillName) => {
      for (const dir of this.scanDirs) {
        try {
          const manifest = await this.loadSkill(dir, skillName);
          if (manifest) return manifest;
        } catch (err) {
          console.warn(`Failed to load skill ${skillName} from ${dir}:`, err);
        }
      }
      return null;
    });

    this.skills = manifests.filter((manifest): manifest is AgentSkillManifest => Boolean(manifest));

    return this.skills;
  }

  private async invokeWithTimeout<T>(
    command: string,
    args?: Record<string, unknown>,
    timeoutMs = 3_000,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        invoke<T>(command, args),
        new Promise<T>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`${command} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const runners = Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      async () => {
        while (cursor < items.length) {
          const index = cursor;
          cursor += 1;
          results[index] = await worker(items[index]);
        }
      },
    );
    await Promise.all(runners);
    return results;
  }

  /** 加载单个技能 */
  private async loadSkill(
    baseDir: string,
    skillName: string,
  ): Promise<AgentSkillManifest | null> {
    const skillPath = `${baseDir}/${skillName}`;
    let hasSkillJson = false;

    // Check if skill.json exists (marks skill as invokable via skill_invoke)
    try {
      const skillJson = await this.invokeWithTimeout<{ content: string; total_lines: number }>(
        'read_file',
        { path: `${skillPath}/skill.json` },
      );
      const rawJson = skillJson.content.replace(/^\s*\d+\t/gm, '');
      // Only manifests with a stable public id can be resolved by
      // skill_invoke. Legacy skill.json files that only have `name` remain
      // useful as reference skills but must not be advertised as invokable.
      hasSkillJson = Boolean(JSON.parse(rawJson)?.id);
    } catch {
      // no skill.json
    }

    // Try reading SKILL.md
    try {
      const result = await this.invokeWithTimeout<{ content: string; total_lines: number }>(
        'read_file',
        { path: `${skillPath}/SKILL.md` },
      );

      const manifest = this.parseSkillMd(result.content, skillPath, skillName);
      if (manifest?.visibility === 'disabled') return null;
      if (manifest) manifest.invokable = hasSkillJson;
      return manifest;
    } catch {
      // Try skill.json as fallback for manifest data
      if (hasSkillJson) {
        try {
          const result = await this.invokeWithTimeout<{ content: string; total_lines: number }>(
            'read_file',
            { path: `${skillPath}/skill.json` },
          );
          const manifest = this.parseSkillJson(result.content, skillPath, skillName);
          if (manifest) manifest.invokable = true;
          return manifest;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /** 解析 SKILL.md (YAML front matter + Markdown body) */
  private parseSkillMd(
    rawContent: string,
    skillPath: string,
    skillName: string,
  ): AgentSkillManifest | null {
    // Remove line numbers from read_file output
    const content = rawContent
      .split('\n')
      .map((line) => {
        const match = line.match(/^\d+\t(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');

    // Parse YAML front matter
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const metadata: Record<string, string> = {};
    let body = content;

    if (frontMatterMatch) {
      const yaml = frontMatterMatch[1];
      body = frontMatterMatch[2];

      // Small front-matter parser with block-scalar support. Several skills
      // use `description: |`; treating that as the literal "|" previously
      // made the Agent see meaningless skill descriptions.
      const lines = yaml.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        const kv = lines[i].match(/^(\w[\w-]*):\s*(.*)$/);
        if (!kv) continue;
        const [, key, rawValue] = kv;
        if (rawValue === '|' || rawValue === '>') {
          const block: string[] = [];
          while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
            i += 1;
            block.push(lines[i].replace(/^\s{2}/, ''));
          }
          metadata[key] = rawValue === '>' ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trim();
        } else {
          metadata[key] = rawValue.replace(/^["']|["']$/g, '');
        }
      }
    }

    // Extract triggers from metadata
    const triggers: string[] = [];
    if (metadata.triggers) {
      triggers.push(
        ...metadata.triggers.split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')),
      );
    }
    triggers.push(skillName);

    return {
      name: metadata.name || skillName,
      displayName: metadata.displayName,
      description: metadata.description || `Skill: ${skillName}`,
      version: metadata.version,
      triggers,
      category: metadata.category || 'general',
      emoji: metadata.emoji,
      hasPanel: body.includes('parameters') || body.includes('--'),
      promptTemplate: body,
      skillPath,
      visibility: metadata.visibility === 'internal' || metadata.visibility === 'library' || metadata.visibility === 'disabled'
        ? metadata.visibility
        : 'toolbar',
    };
  }

  /** 解析 skill.json */
  private parseSkillJson(
    rawContent: string,
    skillPath: string,
    skillName: string,
  ): AgentSkillManifest | null {
    // Remove line numbers
    const content = rawContent
      .split('\n')
      .map((line) => {
        const match = line.match(/^\d+\t(.*)$/);
        return match ? match[1] : line;
      })
      .join('\n');

    try {
      const json = JSON.parse(content);

      return {
        name: json.name || skillName,
        displayName: json.displayName,
        description: json.description || `Skill: ${skillName}`,
        version: json.version,
        triggers: json.triggers || [skillName],
        category: json.category || 'general',
        hasPanel: !!json.parameters,
        parameters: json.parameters
          ? Object.entries(json.parameters).map(([key, val]: [string, any]) => ({
              name: key,
              type: val.type || 'string',
              label: val.label || key,
              description: val.description,
              required: val.required,
              default: val.default,
            }))
          : undefined,
        promptTemplate: json.promptTemplate || json.description || '',
        skillPath,
        visibility: json.visibility === 'internal' || json.visibility === 'library' || json.visibility === 'disabled'
          ? json.visibility
          : 'toolbar',
      };
    } catch {
      return null;
    }
  }

  /** 获取所有已加载的技能 */
  getAll(): AgentSkillManifest[] {
    return this.skills;
  }

  /** 获取技能描述文本 (用于系统提示词) */
  getDescriptionText(options: { activeView?: string; query?: string } = {}): string {
    return buildSkillDescriptionText(this.skills, options);
  }

  /** 渲染技能提示词 (变量替换) */
  renderPrompt(
    skill: AgentSkillManifest,
    params?: Record<string, unknown>,
  ): string {
    let prompt = skill.promptTemplate;

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        prompt = prompt.replace(
          new RegExp(`\\{\\{${key}\\}\\}|\\$\\{${key}\\}`, 'g'),
          String(value),
        );
      }
    }

    return prompt;
  }
}
