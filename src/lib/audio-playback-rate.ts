import * as React from "react";

export const AUDIO_PLAYBACK_RATES = [1, 1.5, 2, 2.5] as const;
export type AudioPlaybackRate = (typeof AUDIO_PLAYBACK_RATES)[number];

const STORAGE_KEY = "valem_audio_playback_rate";
const SYNC_EVENT = "valem:audio-playback-rate-change";

export function isValidAudioPlaybackRate(value: unknown): value is AudioPlaybackRate {
  return (
    typeof value === "number" &&
    (AUDIO_PLAYBACK_RATES as readonly number[]).includes(value)
  );
}

export function getSavedAudioPlaybackRate(): AudioPlaybackRate {
  if (typeof window === "undefined") return 1;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return 1;
    const parsed = Number(raw);
    return isValidAudioPlaybackRate(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

export function saveAudioPlaybackRate(rate: AudioPlaybackRate): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(rate));
  } catch {
    // ignore storage errors
  }
  try {
    window.dispatchEvent(new CustomEvent<AudioPlaybackRate>(SYNC_EVENT, { detail: rate }));
  } catch {
    // ignore event errors
  }
}

export function getNextAudioPlaybackRate(current: number): AudioPlaybackRate {
  const idx = (AUDIO_PLAYBACK_RATES as readonly number[]).indexOf(current);
  if (idx === -1) return 1.5;
  return AUDIO_PLAYBACK_RATES[(idx + 1) % AUDIO_PLAYBACK_RATES.length];
}

export function formatAudioPlaybackRate(rate: number): string {
  if (rate === 1) return "1x";
  return `${rate.toFixed(1)}x`;
}

export function applyAudioPlaybackRate(
  audio: HTMLAudioElement | null | undefined,
  rate: number,
): void {
  if (!audio) return;
  const safeRate = isValidAudioPlaybackRate(rate) ? rate : 1;
  try {
    audio.defaultPlaybackRate = safeRate;
    audio.playbackRate = safeRate;
    if ("preservesPitch" in audio) {
      audio.preservesPitch = true;
    } else if ("webkitPreservesPitch" in (audio as any)) {
      (audio as any).webkitPreservesPitch = true;
    }
  } catch {
    // ignore media element errors
  }
}

export function useAudioPlaybackRate(
  audioRef?: React.RefObject<HTMLAudioElement | null>,
  srcDependency?: string,
) {
  const [playbackRate, setPlaybackRateState] = React.useState<AudioPlaybackRate>(() =>
    getSavedAudioPlaybackRate(),
  );

  const syncAudioElement = React.useCallback(
    (overrideRate?: AudioPlaybackRate) => {
      applyAudioPlaybackRate(audioRef?.current, overrideRate ?? playbackRate);
    },
    [audioRef, playbackRate],
  );

  React.useEffect(() => {
    applyAudioPlaybackRate(audioRef?.current, playbackRate);
  }, [audioRef, playbackRate, srcDependency]);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSync = (event: Event) => {
      const next = (event as CustomEvent<AudioPlaybackRate>).detail;
      if (isValidAudioPlaybackRate(next)) {
        setPlaybackRateState(next);
        applyAudioPlaybackRate(audioRef?.current, next);
      }
    };
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  }, [audioRef]);

  const setPlaybackRate = React.useCallback(
    (nextRate: AudioPlaybackRate) => {
      setPlaybackRateState(nextRate);
      applyAudioPlaybackRate(audioRef?.current, nextRate);
      saveAudioPlaybackRate(nextRate);
    },
    [audioRef],
  );

  const cyclePlaybackRate = React.useCallback(
    (e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }
      const nextRate = getNextAudioPlaybackRate(playbackRate);
      setPlaybackRate(nextRate);
    },
    [playbackRate, setPlaybackRate],
  );

  return {
    playbackRate,
    setPlaybackRate,
    cyclePlaybackRate,
    syncAudioElement,
  };
}
