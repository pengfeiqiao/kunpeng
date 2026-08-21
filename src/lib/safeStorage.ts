/**
 * safeStorage — localStorage with quota self-healing.
 *
 * 「The quota has been exceeded」曾导致：zustand persist 写入抛错 →
 * linkAigcProject 等关键状态丢失 → 重启后画布-工坊关联消失 → 每次打开
 * 项目再建一个幽灵画布；生成任务 addTask 抛错 → 二次生成直接失败。
 *
 * 策略：setItem 失败时清掉可再生的缓存键（消息缓存有文件源、画布缓存有
 * canvas.json、任务队列可丢历史）再重试一次；仍失败则静默放弃（内存态
 * 不受影响），绝不让 quota 错误冒泡进业务逻辑。
 */

/** 可安全清除的缓存键（数据在磁盘文件里有源，丢 LS 缓存无损） */
function isRegenerableKey(key: string): boolean {
  return (
    key.startsWith('kunpeng-messages-') ||      // 会话消息缓存（文件为源）
    key.startsWith('kunpeng-agent-messages-') || // agent 消息缓存（文件为源）
    key === 'kunpeng-canvas' ||                  // 画布二级缓存（canvas.json 为源）
    key === 'kunpeng-canvas-tasks' ||            // 任务队列历史（可丢）
    key === 'kunpeng-run-steps'                  // 运行步骤时间线（纯展示历史，可丢）
  );
}

function purgeRegenerableKeys(): number {
  let removed = 0;
  const victims: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (isRegenerableKey(key)) {
      victims.push(key);
    }
  }
  for (const k of victims) {
    try { localStorage.removeItem(k); removed++; } catch { /* ignore */ }
  }
  return removed;
}

/**
 * 主动防线：单键超过此值的「可再生缓存」不写 LS（读侧自动回退磁盘文件）。
 * 曾有单会话消息缓存膨胀到 3.7MB 把 5MB 配额挤满，引发打开项目失败 +
 * 空画布覆写连锁。文件才是 source of truth，超大缓存不值得占配额。
 */
const REGENERABLE_CACHE_MAX_BYTES = 512 * 1024;

export const safeLocalStorage: Storage = {
  get length() { return localStorage.length; },
  key: (i: number) => localStorage.key(i),
  getItem: (k: string) => localStorage.getItem(k),
  removeItem: (k: string) => localStorage.removeItem(k),
  clear: () => localStorage.clear(),
  setItem: (k: string, v: string) => {
    // 主动防线：超大的可再生缓存直接不进 LS（文件为源，读侧会回退磁盘），
    // 顺手把已有的旧值删掉腾配额。
    if (isRegenerableKey(k) && v.length > REGENERABLE_CACHE_MAX_BYTES) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
      return;
    }
    try {
      localStorage.setItem(k, v);
    } catch {
      const removed = purgeRegenerableKeys();
      console.warn(`[safeStorage] localStorage 配额满，清理 ${removed} 个缓存键后重试: ${k}`);
      try {
        localStorage.setItem(k, v);
      } catch (err2) {
        console.error(`[safeStorage] 重试仍失败，放弃写入 ${k}（内存态不受影响）:`, err2);
      }
    }
  },
};
