/**
 * headless — 无人值守标记（微信远程会话等场景）。
 *
 * 置 true 时，任何会阻塞等待用户操作的 UI（ask_user_question 选择框等）
 * 都必须跳过：用户不在电脑旁，弹窗会永远挂起。工具应返回指引让 agent
 * 自行决策继续。
 *
 * 引用计数：多个 coordinator 可同时声明 headless，全部释放后才恢复。
 */
let headlessCount = 0;

export function setAgentHeadless(v: boolean): void {
  headlessCount += v ? 1 : -1;
  if (headlessCount < 0) headlessCount = 0;
}

export function isAgentHeadless(): boolean {
  return headlessCount > 0;
}
