/**
 * ask_user_question — agent asks the user a multiple-choice question mid-task.
 *
 * The tool blocks until the user submits an answer (or cancels the question).
 * The request is rendered inline by the active chat surface.
 *
 * When to use (in the tool description for the model):
 *   - Clarifying requirements before a non-trivial implementation
 *   - Choosing between valid approaches where user preference matters
 *   - NEVER use this for "should I proceed?" — just proceed or don't
 */

import type { Tool } from '../types';
import { useAskUserStore, type AskUserQuestion } from '@/stores/askUserStore';
import { useChatStore } from '@/stores/chatStore';
import { isAgentHeadless } from '../headless';

export const askUserQuestionTool: Tool = {
  definition: {
    name: 'ask_user_question',
    description:
      '向用户展示一个可恢复的决策卡并等待回答。只在用户偏好真正阻塞任务时使用；能从项目状态读取的信息不要问。' +
      '默认一次只问 1 个最关键问题，最多 3 个。每题给 2-4 个结果明确的选项，把推荐项放第一位并说明选择后的影响。' +
      '不要用它问“是否继续”，低风险工作直接执行；费用、覆盖、删除等重要决定应明确询问。',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: '1-3 个问题，默认只问一个最关键问题',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '稳定问题 ID，用于记录和恢复' },
              question: { type: 'string', description: '完整问句（以问号结尾）' },
              header: { type: 'string', description: '短标签（≤12 字符）' },
              context: { type: 'string', description: '为什么需要用户决定，一句话即可' },
              multiSelect: { type: 'boolean', description: '是否允许多选' },
              allowCustom: { type: 'boolean', description: '是否允许自定义回答，默认 true' },
              required: { type: 'boolean', description: '是否必须回答，默认 true；false 时允许跳过' },
              defaultOptionId: { type: 'string', description: '无人值守时采用的选项 ID' },
              submitLabel: { type: 'string', description: '结果导向的确认按钮文案，例如“采用此方案并继续”' },
              options: {
                type: 'array',
                description: '2-4 个选项',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: '稳定选项 ID' },
                    label: { type: 'string', description: '选项文案' },
                    description: { type: 'string', description: '选择后的结果或代价，一句话说明' },
                    recommended: { type: 'boolean', description: '是否为推荐选项，每题最多一个' },
                    badge: { type: 'string', description: '短标签，例如“免费”“约 ¥0.8”' },
                    disabled: { type: 'boolean', description: '当前是否不可选' },
                  },
                  required: ['label'],
                },
              },
            },
            required: ['question', 'options'],
          },
        },
      },
      required: ['questions'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const raw = (params as { questions?: AskUserQuestion[] }).questions;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { success: false, output: '', error: 'questions must be a non-empty array' };
    }
    if (raw.length > 3) {
      return { success: false, output: '', error: 'at most 3 questions per call' };
    }
    for (let i = 0; i < raw.length; i++) {
      const q = raw[i];
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
        return {
          success: false,
          output: '',
          error: `question ${i}: must have 2-4 options and a question string`,
        };
      }
      const labels = q.options.map((option) => option.label.trim());
      if (labels.some((label) => !label) || new Set(labels).size !== labels.length) {
        return { success: false, output: '', error: `question ${i}: option labels must be non-empty and unique` };
      }
      if (q.options.filter((option) => option.recommended).length > 1) {
        return { success: false, output: '', error: `question ${i}: at most one option can be recommended` };
      }
      if (!q.options.some((option) => !option.disabled)) {
        return { success: false, output: '', error: `question ${i}: at least one option must be enabled` };
      }
    }

    const normalized = raw.map((question, questionIndex) => ({
      ...question,
      id: question.id?.trim() || `question-${questionIndex + 1}`,
      multiSelect: Boolean(question.multiSelect),
      allowCustom: question.allowCustom !== false,
      required: question.required !== false,
      options: [...question.options]
        .sort((left, right) => Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)))
        .map((option, optionIndex) => ({
          ...option,
          id: option.id?.trim() || `option-${questionIndex + 1}-${optionIndex + 1}`,
          label: option.label.trim(),
        })),
    }));

    // 无人值守时按 default → recommended → 首个可用选项的稳定顺序处理，
    // 不再把选择权模糊地交还给模型。
    if (isAgentHeadless()) {
      const summary = normalized
        .map((question) => {
          const selected = question.options.find((option) => option.id === question.defaultOptionId && !option.disabled)
            ?? question.options.find((option) => option.recommended && !option.disabled)
            ?? question.options.find((option) => !option.disabled);
          return `${question.question} → ${selected?.label || '(无可用选项)'}`;
        })
        .join('\n');
      return {
        success: true,
        output: `[无人值守模式：已按默认项或推荐项自动选择，不要再次追问。]\n${summary}`,
      };
    }

    const chat = useChatStore.getState();
    const sourceLabel = chat.sessions.find((session) => session.id === chat.currentSessionId)?.title
      || ({
        chat: '普通对话',
        canvas: '画布助手',
        workshop: '工坊助手',
        editor: '剪辑助手',
        copywriting: '文案助手',
      } as Record<string, string>)[chat.activeView]
      || '鲲鹏助手';

    const answers = await useAskUserStore.getState().ask(
      normalized,
      {
        sourceLabel,
        sourceView: chat.activeView,
        sourceSessionId: chat.currentSessionId,
      },
    );

    if (!answers) {
      return { success: true, output: '[用户未作答，已取消]' };
    }

    const lines: string[] = [];
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i];
      const q = normalized[i];
      const parts: string[] = [];
      if (a.selected.length > 0) parts.push(a.selected.join(' / '));
      if (a.freeText) parts.push(`(其他: ${a.freeText})`);
      lines.push(`${q.question} → ${parts.join(' ') || '(未选)'}`);
    }
    return { success: true, output: lines.join('\n') };
  },
};
