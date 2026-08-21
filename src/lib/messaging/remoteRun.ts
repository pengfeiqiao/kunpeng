export const REMOTE_AGENT_TIMEOUT_MS = 10 * 60_000;

/**
 * 远程频道没有本地“停止”按钮，必须为 Agent 运行设置硬上限，否则一次
 * 卡住的网络请求会让联系人永久停在“处理中”。超时后先中止 coordinator，
 * 再把可理解的错误交给频道 UI 和自动恢复逻辑。
 */
export function withRemoteAgentTimeout<T>(
  task: Promise<T>,
  abort: () => void,
  timeoutMs = REMOTE_AGENT_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      abort();
      reject(new Error(`远程 Agent 处理超过 ${Math.ceil(timeoutMs / 60_000)} 分钟，已自动停止。请重试。`));
    }, timeoutMs);

    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
