/**
 * todo_write — agent-facing tool to manage the session's todo list.
 *
 * Semantics: the full list is replaced each call. No merge logic, no
 * partial updates. This matches how Claude Code's TodoWrite behaves and
 * avoids the class of bugs where the agent forgets an item because it
 * thought it was appending.
 */

import type { Tool } from '../types';
import { useTodoStore, type TodoItem, type TodoStatus } from '@/stores/todoStore';
import { useRunStepStore } from '@/stores/runStepStore';

const VALID_STATUSES: TodoStatus[] = ['pending', 'in_progress', 'completed'];

interface TodoInput {
  content?: string;
  status?: string;
  activeForm?: string;
}

export function createTodoWriteTool(getSessionId: () => string): Tool {
  return {
    definition: {
      name: 'todo_write',
      description:
        '管理当前会话的待办列表。每次调用会完整替换列表，不要只传部分条目。' +
        '用于多步骤任务的进度追踪。只有一个任务可以是 in_progress。' +
        '`activeForm` 是进行中显示的现在进行时文案（例："正在运行测试"）。',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: '完整的待办列表，顺序即展示顺序',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '任务简述（祈使句）' },
                status: { type: 'string', enum: VALID_STATUSES, description: '状态' },
                activeForm: { type: 'string', description: '进行时文案（可选）' },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
    risk: 'safe',
    async execute(params) {
      const raw = (params as { todos?: TodoInput[] }).todos;
      if (!Array.isArray(raw)) {
        return { success: false, output: '', error: 'todos must be an array' };
      }

      const items: TodoItem[] = [];
      let inProgressCount = 0;
      for (let i = 0; i < raw.length; i++) {
        const t = raw[i];
        if (!t.content || !t.status) {
          return { success: false, output: '', error: `item ${i}: missing content or status` };
        }
        if (!VALID_STATUSES.includes(t.status as TodoStatus)) {
          return { success: false, output: '', error: `item ${i}: invalid status "${t.status}"` };
        }
        if (t.status === 'in_progress') inProgressCount++;
        items.push({
          id: `t-${Date.now()}-${i}`,
          content: t.content,
          status: t.status as TodoStatus,
          activeForm: t.activeForm,
        });
      }

      if (inProgressCount > 1) {
        return {
          success: false,
          output: '',
          error: `只允许一个 in_progress (got ${inProgressCount})`,
        };
      }

      const sessionId = getSessionId();
      if (!sessionId) {
        return { success: false, output: '', error: 'no active session' };
      }
      useTodoStore.getState().setTodos(sessionId, items);
      useRunStepStore.getState().syncTodos(sessionId, items);

      const summary = items
        .map((t, i) => {
          const box = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[~]' : '[ ]';
          return `${i + 1}. ${box} ${t.content}`;
        })
        .join('\n');
      return { success: true, output: `已更新 ${items.length} 个待办项:\n${summary}` };
    },
  };
}
