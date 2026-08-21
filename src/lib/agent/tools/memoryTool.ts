/**
 * memory_write — 写入鲲鹏自有长期记忆（~/.kunpeng/memory/<name>.md）。
 *
 * 格式与 Claude Code 记忆兼容（name/description/type frontmatter + markdown
 * 正文），召回走 findRelevantMemories 的关键词打分，写入后立即可被后续
 * run 检索到。这是鲲鹏自己的记忆生产入口——此前 findRelevantMemories 只读
 * Claude Code 的目录，鲲鹏自己不产生长期记忆。
 */

import { createDir, writeTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import type { Tool } from '../types';
import { invalidateMemoryIndex, KUNPENG_MEMORY_DIR_REL } from '../findRelevantMemories';

const MEMORY_TYPES = ['user', 'project', 'feedback', 'reference'] as const;

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export const memoryWriteTool: Tool = {
  definition: {
    name: 'memory_write',
    description: `写入一条长期记忆，跨会话保留；后续对话涉及相关内容时会自动召回。
何时使用：
- 用户明确告诉你偏好、习惯或身份信息（如"我喜欢简洁的回答"）→ user
- 用户纠正了你的做法，值得以后都遵守 → feedback（最重要，召回权重最高）
- 项目中沉淀的可复用事实（品牌调性、常用模型通道、交付规格）→ project
何时不要用：
- 只与当前任务相关的临时状态（那是 todo_write 的职责）
- 能从代码、文件直接读到的客观事实
- 未经用户确认、你单方面猜测的偏好
同名记忆会被覆盖更新。正文要写成独立自足的完整内容，不要写"如上所述"这类依赖上下文的指代。`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '记忆标识（kebab-case，同名覆盖更新）' },
        description: { type: 'string', description: '一句话说明这条记忆记录什么（用于召回匹配，要具体）' },
        memory_type: {
          type: 'string',
          enum: [...MEMORY_TYPES],
          description: 'user=用户偏好/身份, feedback=用户的纠正与反馈, project=项目事实, reference=外部资料指引',
        },
        body: { type: 'string', description: '记忆正文（markdown，完整自足）' },
      },
      required: ['name', 'description', 'memory_type', 'body'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const name = slugify(String(params.name || ''));
    if (!name) return { success: false, output: '', error: 'name 不能为空或全是符号' };
    const description = inline(String(params.description || ''));
    const memoryType = String(params.memory_type || '').trim();
    const body = String(params.body || '').trim();
    if (!description) return { success: false, output: '', error: 'description 不能为空' };
    if (!(MEMORY_TYPES as readonly string[]).includes(memoryType)) {
      return { success: false, output: '', error: `memory_type 必须是 ${MEMORY_TYPES.join(' / ')}` };
    }
    if (!body) return { success: false, output: '', error: 'body 不能为空' };

    const content = `---\nname: ${name}\ndescription: ${description}\ntype: ${memoryType}\n---\n\n${body}\n`;
    await createDir(KUNPENG_MEMORY_DIR_REL, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
    await writeTextFile(`${KUNPENG_MEMORY_DIR_REL}/${name}.md`, content, { dir: BaseDirectory.Home });
    invalidateMemoryIndex();
    return {
      success: true,
      output: `已记住：${name}（${memoryType}）。后续对话涉及相关内容时会自动召回。`,
    };
  },
};
