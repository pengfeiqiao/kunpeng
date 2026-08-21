/**
 * skill_invoke — agent-facing entry point to kunpeng's skill library.
 *
 * Users already configure skills via the Skills tab (~/.kunpeng/skills/).
 * This tool lets the agent pick a skill by id and render its template with
 * a set of field values, then return the composed prompt as a string. The
 * agent typically does NOT execute the prompt itself — it's meant as a
 * "template expansion" step; the caller then uses that as the next user
 * turn or inline context.
 *
 * Rationale: skills are reusable prompt recipes the user has already
 * authored. Exposing them as a tool lets the agent choose one programmatically
 * (e.g. "for video-style replication tasks, invoke the video-style skill").
 */

import type { Tool } from '../types';
import { useSkillStore } from '@/stores/skillStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';
import { buildPrompt } from '@/lib/promptBuilder';

export const skillInvokeTool: Tool = {
  definition: {
    name: 'skill_invoke',
    description:
      '用指定的技能 id 和字段值，渲染该技能的提示词模板。返回渲染后的完整提示词。' +
      '技能是用户配置好的可复用 prompt 模板 —— 用它们而不是自己重新拼凑。' +
      '不知道 id 时先列出可用技能（不传 skillId）。',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '技能 id。不传则列出全部可用技能' },
        userContent: { type: 'string', description: '注入 {{userContent}} 的内容' },
        fieldValues: {
          type: 'object',
          description: '面板字段值（key → value），与技能的 panel.fields 对应',
          additionalProperties: true,
        },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const { skillId, userContent, fieldValues } = params as {
      skillId?: string;
      userContent?: string;
      fieldValues?: Record<string, unknown>;
    };

    const skillState = useSkillStore.getState();
    if (!skillState.loaded) {
      await skillState.loadAllSkills();
    }
    const skills = useSkillStore.getState().skills.filter((skill) => skill.visibility !== 'internal');

    if (!skillId) {
      if (skills.length === 0) {
        return { success: true, output: '(无可用技能 — 在 Skills 面板添加)' };
      }
      const lines = skills.map(
        (s) => `- ${s.id} — ${s.name}: ${s.description}`,
      );
      return { success: true, output: `可用技能:\n${lines.join('\n')}` };
    }

    const skill = skills.find((s) => s.id === skillId);
    if (!skill) {
      return { success: false, output: '', error: `skill "${skillId}" not found` };
    }

    const settings = useSettingsStore.getState();
    // 自动从 imageApiSlots 取 dmxApiKey（兼容老 skill 模板）
    const firstSlot = settings.imageApiSlots?.find(s => s.enabled && resolveSlotApiKey(settings, s));
    const composed = buildPrompt(skill, fieldValues ?? {}, userContent ?? '', {
      geminiApiKey: resolveApiKey(settings, 'gemini', settings.geminiApiKey),
      dmxApiKey: resolveApiKey(settings, 'dmx', settings.dmxApiKey) || resolveSlotApiKey(settings, firstSlot),
      bananaProApiKey: resolveApiKey(settings, 'bananaPro', settings.bananaProApiKey) || resolveSlotApiKey(settings, firstSlot),
    });
    return { success: true, output: composed };
  },
};
