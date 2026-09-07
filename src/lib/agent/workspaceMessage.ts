export type WorkspaceMessageScope = 'canvas' | 'editor' | 'workshop';
const PREFIX = '[鲲鹏工作面上下文:';

/** JSON keeps quoted text and delimiter-looking data inside the context, never in user authorization. */
export function wrapWorkspaceContext(scope: WorkspaceMessageScope, context: string): string {
  return `${PREFIX}${JSON.stringify({ version: 1, scope, context })}]\n\n`;
}

export function readWorkspaceMessage(content: string):
  | { status: 'none' | 'invalid' }
  | { status: 'valid'; scope: WorkspaceMessageScope; context: string; request: string } {
  if (!content.startsWith(PREFIX)) return { status: 'none' };
  const end = content.indexOf('\n');
  if (end < 0 || content[end - 1] !== ']' || content[end + 1] !== '\n') return { status: 'invalid' };
  try {
    const value = JSON.parse(content.slice(PREFIX.length, end - 1));
    if (!value || value.version !== 1 || !['canvas', 'editor', 'workshop'].includes(value.scope)
      || typeof value.context !== 'string') return { status: 'invalid' };
    return { status: 'valid', scope: value.scope, context: value.context, request: content.slice(end + 2) };
  } catch { return { status: 'invalid' }; }
}

export function workspaceScopeForView(view?: { workspaceSurface?: string; workspaceMediaView?: string }): WorkspaceMessageScope {
  return view?.workspaceSurface === 'editor' ? 'editor'
    : (!view?.workspaceSurface || view.workspaceSurface === 'media') && view?.workspaceMediaView === 'canvas' ? 'canvas' : 'workshop';
}
