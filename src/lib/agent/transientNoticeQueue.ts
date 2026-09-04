import type { AgentMessage } from './types.ts';

/**
 * Transient context has two lifetimes: one model request, or the whole agent
 * run. Keeping the distinction in one small queue prevents multi-tool runs
 * from silently losing their stage contract after the first tool round.
 */
export class TransientNoticeQueue {
  private runNotices: AgentMessage[] = [];
  private oneShotNotices: AgentMessage[] = [];

  addRun(text: string): void {
    const cleaned = text.trim();
    if (cleaned) this.runNotices.push({ role: 'user', content: cleaned });
  }

  addOnce(text: string): void {
    const cleaned = text.trim();
    if (cleaned) this.oneShotNotices.push({ role: 'user', content: cleaned });
  }

  takeForRequest(): AgentMessage[] {
    const notices = [...this.runNotices, ...this.oneShotNotices];
    this.oneShotNotices = [];
    return notices;
  }

  endRun(): void {
    this.runNotices = [];
    this.oneShotNotices = [];
  }
}
