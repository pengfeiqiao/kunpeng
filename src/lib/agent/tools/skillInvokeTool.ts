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
import { getSharedSkillLoader } from '../skillLoader';
import { getBuiltinSkills } from '@/lib/skillLoader';
import { buildPrompt } from '@/lib/promptBuilder';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';

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

    const loader = await getSharedSkillLoader();
    // 默认节流（750ms）即可：主链路每次发送前已刷新，evolution 新写入的
    // 技能最迟下一轮可见；每次调用强制全量重扫在大目录下有可感知开销。
    const diskSkills = (await loader.refreshIfDue()).filter(
      (skill) => skill.invokable && skill.visibility !== 'internal',
    );
    // 内置 fallback 技能（视频脚本、即梦、film-master 等）不落盘，但 UI 面板
    // 一直展示它们——skill_invoke 必须也能调用，否则 agent 看到的是"无此技能"。
    // 磁盘技能按 id 覆盖同名内置技能。
    const builtinSkills = getBuiltinSkills().filter((skill) => skill.visibility !== 'internal');
    const byId = new Map(builtinSkills.map((skill) => [skill.id, skill] as const));
    for (const skill of diskSkills) byId.delete(skill.id!);

    if (!skillId) {
      const lines = [
        ...diskSkills.map((s) => `- ${s.id} — ${s.displayName || s.name}: ${s.description}`),
        ...[...byId.values()].map((s) => `- ${s.id} — ${s.name}: ${s.description}`),
      ];
      if (lines.length === 0) {
        return { success: true, output: '(无可用技能 — 在 Skills 面板添加)' };
      }
      return { success: true, output: `可用技能:\n${lines.join('\n')}` };
    }

    const diskSkill = diskSkills.find((s) => s.id === skillId);
    if (diskSkill) {
      const composed = loader.renderPrompt(diskSkill, {
        ...(fieldValues ?? {}),
        userContent: userContent ?? '',
      });
      return { success: true, output: composed };
    }

    const builtin = byId.get(skillId);
    if (!builtin) {
      return { success: false, output: '', error: `skill "${skillId}" not found` };
    }
    // 内置技能保留旧渲染路径：labelMap/showIf/数组字段与 key 占位符解析
    // （未提供的 key 变量解析为空串，不会把 {{dmxApiKey}} 字面量发给模型）。
    const settings = useSettingsStore.getState();
    const firstSlot = settings.imageApiSlots?.find((s) => s.enabled && resolveSlotApiKey(settings, s));
    const composed = buildPrompt(builtin, fieldValues ?? {}, userContent ?? '', {
      geminiApiKey: resolveApiKey(settings, 'gemini', settings.geminiApiKey),
      dmxApiKey: resolveApiKey(settings, 'dmx', settings.dmxApiKey) || resolveSlotApiKey(settings, firstSlot),
      bananaProApiKey: resolveApiKey(settings, 'bananaPro', settings.bananaProApiKey) || resolveSlotApiKey(settings, firstSlot),
    });
    return { success: true, output: composed };
  },
};
