import type { ToolDefinition } from './types';
const CORE = new Set(['bash','bash_read_output','read_file','write_file','edit_file','glob_search','grep_search','list_directory','ask_user_question','skill_invoke','image_recognition','browser_control','web_fetch','web_search','todo_write','tool_search','view_capabilities','switch_view']);
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
      description: '按工具名称或能力/模型关键词检索并加载工具；支持 query 如视频生成、wan3.0。当前函数列表不是完整能力清单，判断不支持前必须检索。下一步提供完整参数。本工具不执行生成。可用工具：\n' + all.filter(t => !CORE.has(t.name)).map(t => `${t.name}: ${t.description.slice(0,70)}`).join('\n'),
      parameters: { type: 'object', properties: { query: { type: 'string', description: '能力、模型或工具关键词；检索完整工具描述和参数定义，例如 视频生成、wan3.0' }, names: { type: 'array', items: { type: 'string' }, description: '目录中的工具名，可一次加载多个相关工具' } } },
    }];
  }
  load(names: unknown, current = this.catalog, query?: unknown): { success: boolean; output: string; error?: string } {
    if ((names == null || (Array.isArray(names) && names.length === 0)) && typeof query === 'string' && query.trim()) {
      const normalize = (value: string) => value.toLowerCase().replace(/[\s_.-]+/g, '');
      const terms = query.trim().split(/[,，;；\s]+/).map(normalize).filter(Boolean);
      const aliases: Record<string, string> = {
        video_generate: '视频生成 生视频 文生视频 图生视频',
        image_generate: '图片生成 生图 文生图 图生图',
      };
      const matches = current.map(tool => {
        const text = normalize(tool.name + ' ' + tool.description + ' ' + JSON.stringify(tool.parameters) + ' ' + (aliases[tool.name] ?? ''));
        return { tool, score: terms.reduce((score, term) => score + (normalize(tool.name) === term ? 100 : normalize(aliases[tool.name] ?? '').includes(term) ? 10 : text.includes(term) ? 1 : 0), 0) };
      }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
      if (!matches.length) return { success: true, output: '当前已启用工具未检索到匹配项；这不代表全产品不支持。请换关键词或调用 view_capabilities 查看工作区入口，再核实配置；脚本端点列表仅代表该脚本渠道。' };
      for (const { tool } of matches) this.loaded.add(tool.name);
      return { success: true, output: JSON.stringify({ loaded: matches.map(item => item.tool.name), tools: matches.map(item => item.tool), note: '仅发现并加载能力，没有执行生成。工具支持某模型不等于凭证已配置或远端当前可用；提交仍遵循原确认流程。' }) };
    }
    if (!Array.isArray(names) || !names.length || names.some(name => typeof name !== 'string')) return { success:false,output:'',error:'请传 names 工具名数组或 query 检索关键词' };
    const available=new Set(current.map(t=>t.name));
    const missing=names.filter(name=>!available.has(name));
    if(missing.length) return {success:false,output:'',error:`工具不存在或未启用：${missing.join(', ')}`};
    for(const name of names)this.loaded.add(name);
    return {success:true,output:`已加载 ${names.join(', ')}，请使用下一步提供的完整参数定义。本次只加载工具，没有执行操作。`};
  }
}
