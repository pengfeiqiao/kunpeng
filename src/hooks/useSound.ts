import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores';

export function useSound() {
  const { soundEnabled, soundVolume } = useSettingsStore();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio element
  useEffect(() => {
    const audio = new Audio('/sounds/notification.mp3');
    audio.preload = 'auto';
    audio.volume = soundVolume;
    audio.addEventListener('error', (e) => {
      console.warn('[useSound] Failed to load notification sound:', e);
    });
    audioRef.current = audio;

    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  // Sync volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = soundVolume;
    }
  }, [soundVolume]);

  const playNotification = useCallback(() => {
    if (!soundEnabled || !audioRef.current) return;
    // Reset to start so rapid messages each play from beginning
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch((err) => {
      console.warn('[useSound] Play failed:', err);
    });
  }, [soundEnabled]);

  const playCustom = useCallback(
    (src: string) => {
      if (!soundEnabled) return;
      const audio = new Audio(src);
      audio.volume = soundVolume;
      audio.play().catch((err) => {
        console.warn('[useSound] Custom play failed:', err);
      });
    },
    [soundEnabled, soundVolume]
  );

  return { playNotification, playCustom };
}
