import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Greeting shown by the chat panels. Public builds greet with a neutral
 * 「你好！」; the author can restore a personalized greeting by setting
 * `greetingName` (directly or via the gitignored private.defaults.json).
 */
export function useHelloGreeting(): string {
  const name = useSettingsStore((s) => s.greetingName);
  const trimmed = name?.trim();
  return trimmed ? `Hi，${trimmed}！` : '你好！';
}
