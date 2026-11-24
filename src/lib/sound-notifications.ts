/**
 * Serviço de Alerta Sonoro Sintetizado via Web Audio API.
 * Gera um chime harmônico cristalino e moderno sem depender de arquivos de áudio externos ou rede.
 */

const SOUND_DEDUPE_STORAGE_KEY = "valem_sound_notification_last_ts";
const SOUND_DEDUPE_WINDOW_MS = 1200;

/**
 * Garante que múltiplas guias abertas simultaneamente não toquem o mesmo alerta sonoro em coro.
 * Retorna `true` se esta guia conquistou a janela de reprodução; `false` se outra guia acabou de tocar.
 */
export function tryAcquireCrossTabSoundSlot(
  nowMs: number = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(SOUND_DEDUPE_STORAGE_KEY);
    const lastTs = raw ? Number(raw) : 0;
    if (Number.isFinite(lastTs) && lastTs > 0 && nowMs - lastTs < SOUND_DEDUPE_WINDOW_MS) {
      return false;
    }
    storage.setItem(SOUND_DEDUPE_STORAGE_KEY, String(nowMs));
    return true;
  } catch {
    return true;
  }
}

class SoundNotificationService {
  private ctx: AudioContext | null = null;
  private hasInteracted = false;

  constructor() {
    if (typeof window !== "undefined") {
      const unlockAudio = () => {
        this.hasInteracted = true;
        this.initContext();
        window.removeEventListener("pointerdown", unlockAudio);
        window.removeEventListener("keydown", unlockAudio);
      };
      window.addEventListener("pointerdown", unlockAudio, { passive: true });
      window.addEventListener("keydown", unlockAudio, { passive: true });
    }
  }

  private initContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!this.ctx || this.ctx.state === "closed") {
      try {
        this.ctx = new AudioCtx();
      } catch (err) {
        console.warn("[SoundService] Falha ao criar AudioContext:", err);
      }
    }

    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  /**
   * Toca o chime suave de notificação (Dó maior elegante C5 - E5 - G5).
   * Deduplica automaticamente entre múltiplas guias abertas do mesmo navegador.
   */
  playNotificationSound() {
    try {
      if (!tryAcquireCrossTabSoundSlot()) return;
      const ctx = this.initContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      // Tríade harmônica com decaimento exponencial suave (acorde cristalino)
      const notes = [
        { freq: 523.25, time: 0.0, duration: 0.22, gain: 0.16 },  // C5 (Dó)
        { freq: 659.25, time: 0.08, duration: 0.24, gain: 0.18 }, // E5 (Mi)
        { freq: 783.99, time: 0.16, duration: 0.35, gain: 0.22 }, // G5 (Sol)
      ];

      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(note.freq, now + note.time);

        gainNode.gain.setValueAtTime(0.001, now + note.time);
        gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.time + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.duration);

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start(now + note.time);
        osc.stop(now + note.time + note.duration + 0.05);
      }
    } catch (err) {
      console.warn("[SoundService] Erro ao reproduzir som de notificação:", err);
    }
  }
}

export const soundNotificationService = new SoundNotificationService();
export const playNotificationSound = () => soundNotificationService.playNotificationSound();
