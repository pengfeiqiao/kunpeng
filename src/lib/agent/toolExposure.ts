import type { ToolDefinition } from './types';
const CORE = new Set(['bash','bash_read_output','read_file','write_file','edit_file','glob_search','grep_search','list_directory','ask_user_question','skill_invoke','image_recognition','browser_control','web_fetch','web_search','todo_write','tool_search']);
/** One instance per coordinator. Discovery never expands another conversation. */
export class ToolExposure {
  private loaded = new Set<string>();
  private catalog: ToolDefinition[] = [];
  clear(): void { this.loaded.clear(); }
  definitions(all: ToolDefinition[]): ToolDefinition[] {
    this.catalog = all;
    if (all.length <= 40) return all;
    return [...all.filter(tool => CORE.has(tool.name) || this.loaded.has(tool.name)), {
      name: 'tool_search',
      description: '按名称加载当前任务需要的工具；下一步将提供完整参数。没有合适工具时先查看此目录，不要猜参数。可用工具：\n' + all.filter(t => !CORE.has(t.name)).map(t => `${t.name}: ${t.description.slice(0,70)}`).join('\n'),
      parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' }, description: '目录中的工具名，可一次加载多个相关工具' } }, required: ['names'] },
    }];
  }
  load(names: unknown, current = this.catalog): { success: boolean; output: string; error?: string } {
    if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string')) return { success:false,output:'',error:'names 必须是工具名数组' };
    const available=new Set(current.map(t=>t.name));
    const missing=names.filter(name=>!available.has(name));
    if(missing.length) return {success:false,output:'',error:`工具不存在或未启用：${missing.join(', ')}`};
    for(const name of names)this.loaded.add(name);
    return {success:true,output:`已加载 ${names.join(', ')}，请使用下一步提供的完整参数定义。本次只加载工具，没有执行操作。`};
  }
}
