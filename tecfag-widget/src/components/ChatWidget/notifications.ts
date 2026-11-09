import { AVATAR_URL } from "../../config";

// Notification sound utility using Web Audio API (Two-tone chime original do chat-widget-pro)
const audioCtx =
  typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)
    ? new (window.AudioContext || (window as any).webkitAudioContext)()
    : null;

export function playNotificationSound() {
  try {
    if (!audioCtx) return;

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    const frequencies = [880, 1100];

    frequencies.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.12);

      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.3);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.35);
    });
  } catch {
    // Audio play blocked or unsupported
  }
}

export function vibrate() {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([80, 40, 80]);
    }
  } catch {}
}

export const requestNotificationPermission = async () => {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
      await Notification.requestPermission();
    }
  } catch {}
};

export const showBrowserNotification = (title: string, body: string) => {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted" && document.hidden) {
      new Notification(title, {
        body,
        icon: AVATAR_URL,
      });
    }
  } catch {}
};
