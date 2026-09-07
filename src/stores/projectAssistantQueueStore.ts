import { ProjectAssistantQueue } from '../lib/workspace/projectAssistantQueue.ts';

const CACHE_KEY = 'kunpeng-workspace-assistant-v1';
export const projectAssistantQueue = new ProjectAssistantQueue((value) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CACHE_KEY, value);
});
try {
  if (typeof localStorage !== 'undefined') projectAssistantQueue.restore(localStorage.getItem(CACHE_KEY));
} catch { /* Storage can be unavailable; remount persistence still works in memory. */ }
