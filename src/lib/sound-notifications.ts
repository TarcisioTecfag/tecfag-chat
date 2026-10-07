/**
 * Serviço de Alerta Sonoro Sintetizado via Web Audio API.
 * Gera um chime harmônico cristalino e moderno sem depender de arquivos de áudio externos ou rede.
 */

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
   */
  playNotificationSound() {
    try {
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
