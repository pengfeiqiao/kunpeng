export type RemoteCommand = 'status' | 'stop' | 'new' | 'help';

/** Remote-only commands are exact matches; normal prompts containing these
 * words continue through the Agent unchanged. */
export function parseRemoteCommand(text: string): RemoteCommand | null {
  const normalized = text.trim().toLowerCase();
  switch (normalized) {
    case '/status':
    case '/状态':
      return 'status';
    case '/stop':
    case '/停止':
      return 'stop';
    case '/new':
    case '/new_session':
    case '/新会话':
      return 'new';
    case '/help':
    case '/帮助':
      return 'help';
    default:
      return null;
  }
}

export const REMOTE_COMMAND_HELP = [
  '远程任务命令：',
  '/status — 查看当前任务与队列状态',
  '/stop — 停止当前任务并清空本会话待处理消息',
  '/new — 停止当前任务并开始全新会话',
  '/help — 查看命令帮助',
].join('\n');
