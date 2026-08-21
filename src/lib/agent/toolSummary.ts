function basename(p: unknown): string {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function summarizeCommand(command: unknown): string {
  const value = String(command ?? '').trim();
  if (!value) return '运行命令';
  if (/\b(tsc|typecheck)\b|npm\s+run\s+typecheck/i.test(value)) return '检查 TypeScript';
  if (/npm\s+(run\s+)?(build|test)|pnpm\s+(build|test)|yarn\s+(build|test)/i.test(value)) return /test/i.test(value) ? '运行测试' : '运行生产构建';
  if (/cargo\s+(check|test|clippy)/i.test(value)) return /test/i.test(value) ? '测试桌面端' : '检查桌面端代码';
  if (/\b(rg|grep|find)\b/i.test(value)) return '定位相关内容';
  if (/\b(ls|stat|du|file)\b/i.test(value)) return '检查本地文件';
  if (/\b(ffmpeg|ffprobe)\b/i.test(value)) return '处理媒体文件';
  if (/\bpython(?:3)?\b/i.test(value)) return '运行校验脚本';
  if (/\b(git\s+status|git\s+diff)\b/i.test(value)) return '检查代码变更';
  return '运行系统命令';
}

export function formatToolSummary(name: string, params: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return `读取 ${basename(params.path)}`;
    case 'bash': return summarizeCommand(params.command);
    case 'grep_search': return `搜索 "${params.pattern}"`;
    case 'edit_file': return `编辑 ${basename(params.path)}`;
    case 'write_file': return `写入 ${basename(params.path)}`;
    case 'web_search': return `搜索: ${params.query}`;
    case 'web_fetch': return `获取: ${String(params.url ?? '').replace(/^https?:\/\/([^/]+).*/, '$1')}`;
    case 'browser_control': {
      const action = String(params.action ?? 'snapshot');
      if (/open|navigate|goto/i.test(action)) return '打开预览页面';
      if (/snapshot|read|inspect/i.test(action)) return '读取页面内容';
      if (/screenshot/i.test(action)) return '查看页面画面';
      if (/click/i.test(action)) return '操作页面控件';
      if (/type|input|fill/i.test(action)) return '填写页面内容';
      return '检查页面状态';
    }
    case 'sleep': return '等待页面加载';
    case 'doubao_speech_generate': return '生成豆包配音';
    case 'send_file_to_user': return `发送文件: ${basename(params.file_path)}`;
    case 'list_directory': return `列出目录 ${basename(params.path)}`;
    case 'timeline_export_analyze': return '分析导出方式';
    case 'timeline_render_graph': return '诊断渲染图';
    case 'timeline_export_prepare': return `准备导出${params.output_path ? `到 ${basename(params.output_path)}` : ''}`;
    case 'timeline_export_video': return `导出成片${params.output_path ? `到 ${basename(params.output_path)}` : ''}`;
    case 'timeline_export_status': return '查看导出进度';
    case 'timeline_export_stop': return '停止导出';
    case 'timeline_export_retry': return '重试导出';
    case 'timeline_render_cache_status': return '查看渲染缓存';
    case 'timeline_render_debug_tail': return '查看渲染诊断';
    case 'timeline_render_cache_clear': return '清理渲染缓存';
    case 'timeline_proxy_prepare': return '准备代理文件';
    default: {
      const firstVal = Object.values(params)[0];
      if (name.startsWith('timeline_')) return '处理剪辑内容';
      if (name.startsWith('canvas_')) return '更新画布内容';
      if (name.startsWith('workshop_')) return '更新工坊内容';
      if (name.startsWith('director_')) return '调整导演台';
      return firstVal ? '运行智能工具' : '处理当前任务';
    }
  }
}

export function formatToolBatchLabel(calls: Array<{ name: string; params: Record<string, unknown> }>): string {
  if (calls.length === 0) return '处理任务';
  const names = new Set(calls.map((call) => call.name));
  if ([...names].every((name) => name === 'web_search' || name === 'web_fetch')) return '查找并核对资料';
  if ([...names].every((name) => /read_file|grep_search|glob_search|list_directory/.test(name))) return '检查相关文件';
  if ([...names].every((name) => /write_file|edit_file/.test(name))) return '修改相关内容';
  if ([...names].every((name) => name === 'bash')) {
    const labels = [...new Set(calls.map((call) => summarizeCommand(call.params.command)))];
    return labels.length === 1 ? labels[0] : '运行检查与验证';
  }
  if ([...names].some((name) => /image_generate|video_generate|canvas_generate|workshop_generate/.test(name))) return '生成所需内容';
  if ([...names].some((name) => name.startsWith('timeline_export_'))) return '渲染并检查成片';
  if ([...names].some((name) => name.startsWith('timeline_'))) return '处理剪辑任务';
  if ([...names].some((name) => name.startsWith('canvas_'))) return '更新画布';
  if ([...names].some((name) => name.startsWith('workshop_'))) return '更新工坊内容';
  return calls.length === 1 ? formatToolSummary(calls[0].name, calls[0].params) : `处理 ${calls.length} 项任务`;
}

function compactList(values: string[], limit = 3): string {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length <= limit) return unique.join('、');
  return `${unique.slice(0, limit).join('、')}等 ${unique.length} 项`;
}

function fileLabel(params: Record<string, unknown>): string {
  return basename(params.path ?? params.file_path ?? params.output_path);
}

export function isTechnicalProgressText(text: string): boolean {
  const value = text.trim();
  return /(?:我先执行[:：]|(?:^|\n)\s*(?:ls|cat|rg|grep|python\d*|source|npm|pnpm|yarn|git|cargo|ffmpeg|sleep)\s|browser\s+open|浏览器\s+open|localhost:\d+|这一阶段已经完成|确认结果后继续|代码层的处理已经完成一部分|沿着用户可见现象定位|只(?:是|停留在)静态代码|正在核对本地运行状态和实际返回结果)/i.test(value);
}

/**
 * Keep the model's useful, user-facing investigation update while removing
 * command narration and repeated filler. Hidden reasoning is never surfaced;
 * this only cleans text the model already emitted as its public progress note.
 */
export function sanitizeProgressText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(?:```|我先执行[:：]|我先(?:运行|读取|搜索|修改|写入)[:：]?)/.test(line))
    .filter((line) => !/^(?:ls|cat|rg|grep|python\d*|source|npm|pnpm|yarn|git|cargo|ffmpeg|sleep)\s/i.test(line))
    .filter((line) => !/(?:确认结果后继续|这一阶段已经完成，我正在结合结果继续处理|代码层的处理已经完成一部分|沿着用户可见现象定位|正在核对本地运行状态和实际返回结果)/.test(line));
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(line);
  }
  return unique.slice(-5).join('\n\n');
}

export function formatToolBatchStart(calls: Array<{ name: string; params: Record<string, unknown> }>): string {
  if (calls.length === 0) return '';
  const names = new Set(calls.map((call) => call.name));

  if ([...names].every((name) => name === 'web_search')) {
    const queries = compactList(calls.map((call) => String(call.params.query ?? '')));
    return calls.length > 1
      ? `这个问题需要核对当前资料，单一来源不够稳妥。我正在分别查询${queries || '相关信息'}，接下来会对照发布时间和原始出处，再把一致结论整理给你。`
      : `我正在核对${queries || '相关信息'}的最新资料，重点确认来源和更新时间。拿到结果后会先判断它是否直接支持你的问题，再给出结论。`;
  }

  if ([...names].every((name) => /read_file|web_fetch/.test(name))) {
    const targets = compactList(calls.map((call) => call.name === 'web_fetch'
      ? String(call.params.url ?? '').replace(/^https?:\/\/([^/]+).*/, '$1')
      : fileLabel(call.params)));
    return `我正在读取${targets ? ` ${targets}` : '相关资料'}，先确认现有实现和数据流实际怎么走。这样可以判断问题是在写入、状态同步还是界面展示这一层，避免只修表面现象。`;
  }

  if ([...names].every((name) => /grep_search|glob_search|list_directory/.test(name))) {
    const patterns = compactList(calls.map((call) => String(call.params.pattern ?? call.params.glob_pattern ?? '')));
    return `我正在定位${patterns ? `“${patterns}”相关的` : ''}代码入口，并核对它与状态存储、渲染组件之间的数据流。找到实际负责用户可见行为的位置后，我会先说明根因，再修改并验证对应入口。`;
  }

  if ([...names].every((name) => /write_file|edit_file/.test(name))) {
    const files = compactList(calls.map((call) => fileLabel(call.params)));
    return `问题已经收敛到${files ? ` ${files}` : '相关实现'}。我正在修改真正负责这段行为的逻辑，同时保留现有数据结构和其他入口；写入后会继续检查关联位置并跑完整验证。`;
  }

  if ([...names].every((name) => name === 'bash')) {
    const labels = [...new Set(calls.map((call) => summarizeCommand(call.params.command)))];
    if (labels.some((label) => /构建|TypeScript|桌面端|测试|校验/.test(label))) {
      return '核心改动已经写入，接下来进入验证阶段。我正在同时检查类型、桌面端代码和生产构建，确认这次修改不仅界面上可见，也没有破坏原有功能。';
    }
    return '代码层的处理已经完成一部分，我正在核对本地运行状态和实际返回结果。这里主要确认改动是否真的作用在用户当前使用的链路上，而不只是静态代码看起来正确。';
  }

  if ([...names].every((name) => name === 'sleep')) {
    return '开发版还在完成页面加载和状态恢复，我先等界面稳定下来。加载完成后会继续检查真实布局和交互，不用一张尚未渲染完整的画面下结论。';
  }

  if ([...names].every((name) => name === 'browser_control' || name === 'sleep')) {
    return '代码层的检查已经告一段落，我正在开发版里核对真实表现。重点看内容层级、折叠状态和交互是否符合普通用户的使用习惯，发现视觉或操作问题会直接回到对应组件修正。';
  }

  if ([...names].some((name) => /image_generate|video_generate|canvas_generate|workshop_generate/.test(name))) {
    return '生成要求和输入素材已经整理完成，我正在提交实际生成任务。接下来会持续跟进任务状态，并在结果返回后检查画面、文字和素材引用是否符合要求。';
  }

  if ([...names].some((name) => name.startsWith('timeline_export_'))) {
    return '导出范围、画幅和编码参数已经确认，我正在执行正式渲染。完成后会检查文件是否可播放、分辨率是否正确，以及输出位置和时间范围是否与设置一致。';
  }

  if ([...names].some((name) => name.startsWith('timeline_'))) return '我正在读取剪辑工程的真实时间线状态，先确认素材、轨道和当前播放位置是否一致。确认后会直接在正确的片段上操作，并检查结果是否准确落到时间轴。';
  if ([...names].some((name) => name.startsWith('canvas_'))) return '我正在检查画布里的节点、连线和素材引用，重点确认前台看到的内容与后台实际传入的数据一致。这样可以及时发现隐藏引用或节点删除后仍被提交的问题。';
  if ([...names].some((name) => name.startsWith('workshop_'))) return '我正在核对工坊当前步骤、分镜和参考资产，先确认这次操作应该影响哪些全局数据。处理完成后会检查工坊、画布和生成任务之间是否保持同步。';
  return calls.length > 1
    ? '我正在同时核对这几项关联状态，先把它们之间的依赖关系确认清楚。确认结果后会直接处理真正影响用户体验的部分，并继续验证后续流程。'
    : `我正在${formatToolSummary(calls[0].name, calls[0].params)}，先确认当前状态和返回结果。确认无误后会继续处理关联步骤，并检查最终表现。`;
}

export function formatToolBatchEnd(results: Array<{ name: string; success: boolean }>): string {
  if (results.length === 0) return '';
  if (results.some((result) => !result.success)) {
    return '这一步有操作没有成功，我正在根据返回信息调整处理方式。';
  }
  const names = new Set(results.map((result) => result.name));
  if ([...names].every((name) => name === 'web_search' || name === 'web_fetch')) {
    return '相关资料已经拿到，我正在核对时间、来源和关键数据。';
  }
  if ([...names].every((name) => /read_file|grep_search|glob_search|list_directory/.test(name))) {
    return '相关内容已经检查完，我正在整理发现并确定下一步修改。';
  }
  if ([...names].every((name) => /write_file|edit_file/.test(name))) {
    return '修改已经写入，我接着检查关联位置并验证结果。';
  }
  if ([...names].some((name) => /generate/.test(name))) {
    return '生成任务已经提交，我正在等待并检查返回结果。';
  }
  return '这一阶段已经完成，我正在结合结果继续处理。';
}
