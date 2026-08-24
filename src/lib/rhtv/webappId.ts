/**
 * RunningHub 自定义 AI 应用（webappId）支持。
 * 用户可粘贴应用 ID 或完整应用链接，自动提取 19 位数字 ID；
 * 设置后覆盖内置 appConfig 的 webappId（要求节点结构与内置工作流一致，
 * 典型场景：用户自己部署的同款工作流副本，走自己的账号计费与并发）。
 */

const WEBAPP_ID_RE = /\d{15,25}/;

/** 从用户输入（纯 ID 或应用链接）提取 webappId；无法识别返回空串。 */
export function extractRhtvWebappId(input: string): string {
  const text = input.trim();
  if (!text) return '';
  const match = text.match(WEBAPP_ID_RE);
  return match ? match[0] : '';
}
