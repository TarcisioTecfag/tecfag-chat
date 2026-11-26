/**
 * Serviço de Alerta Sonoro Sintetizado via Web Audio API.
 * Gera um chime harmônico cristalino e moderno sem depender de arquivos de áudio externos ou rede.
 */

const SOUND_DEDUPE_STORAGE_KEY = "valem_sound_notification_last_ts";
const SOUND_DEDUPE_WINDOW_MS = 1200;
const NEW_LEAD_SOUND_DEDUPE_STORAGE_KEY = "valem_new_lead_sound_last_ts";
const NEW_LEAD_SOUND_DEDUPE_WINDOW_MS = 1800;
const SUPERVISOR_ATTENTION_SOUND_DEDUPE_STORAGE_KEY = "valem_supervisor_attention_sound_last_ts";
const SUPERVISOR_ATTENTION_SOUND_DEDUPE_WINDOW_MS = 1800;

/**
 * Garante que múltiplas guias abertas simultaneamente não toquem o mesmo alerta sonoro em coro.
 * Retorna `true` se esta guia conquistou a janela de reprodução; `false` se outra guia acabou de tocar.
 */
export function tryAcquireCrossTabSoundSlot(
  nowMs: number = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
): boolean {
  return tryAcquireSoundSlotWithKey(
    SOUND_DEDUPE_STORAGE_KEY,
    SOUND_DEDUPE_WINDOW_MS,
    nowMs,
    storage,
  );
}

/**
 * Slot independente para alerta de Lead Novo, evitando que o ping de uma mensagem
 * comum chegue milissegundos antes e silencie o som de interrupção do lead.
 */
export function tryAcquireNewLeadSoundSlot(
  nowMs: number = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
): boolean {
  return tryAcquireSoundSlotWithKey(
    NEW_LEAD_SOUND_DEDUPE_STORAGE_KEY,
    NEW_LEAD_SOUND_DEDUPE_WINDOW_MS,
    nowMs,
    storage,
  );
}

/**
 * Slot independente para alerta de Cobrança / Orientação da Supervisão, garantindo
 * que um ping de mensagem comum ou de lead novo não silencie o aviso do gestor.
 */
export function tryAcquireSupervisorAttentionSoundSlot(
  nowMs: number = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null =
    typeof window !== "undefined" ? window.localStorage : null,
): boolean {
  return tryAcquireSoundSlotWithKey(
    SUPERVISOR_ATTENTION_SOUND_DEDUPE_STORAGE_KEY,
    SUPERVISOR_ATTENTION_SOUND_DEDUPE_WINDOW_MS,
    nowMs,
    storage,
  );
}

function tryAcquireSoundSlotWithKey(
  storageKey: string,
  windowMs: number,
  nowMs: number,
  storage: Pick<Storage, "getItem" | "setItem"> | null,
): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(storageKey);
    const lastTs = raw ? Number(raw) : 0;
    if (Number.isFinite(lastTs) && lastTs > 0 && nowMs - lastTs < windowMs) {
      return false;
    }
    storage.setItem(storageKey, String(nowMs));
    return true;
  } catch {
    return true;
  }
}

class SoundNotificationService {
  private ctx: AudioContext | null = null;
  private hasInteracted = false;
  private pendingLeadAlertOnUnlock = false;
  private pendingSupervisorAlertOnUnlock = false;

  constructor() {
    if (typeof window !== "undefined") {
      const unlockAudio = () => {
        this.hasInteracted = true;
        this.initContext();
        if (this.pendingLeadAlertOnUnlock) {
          this.pendingLeadAlertOnUnlock = false;
          this.playNewLeadAlertSound({ bypassCrossTab: true });
        }
        if (this.pendingSupervisorAlertOnUnlock) {
          this.pendingSupervisorAlertOnUnlock = false;
          this.playSupervisorAttentionAlertSound({ bypassCrossTab: true });
        }
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

  /**
   * Toca alerta sonoro de alta prioridade para Lead Novo atribuído ao vendedor.
   * Dupla sequência harmônica ascendente (Mi maior: E5-G#5-B5 -> E5-G#5-B5-E6) com
   * timbre cristalino + overtone triangular para ser imediatamente distinguível de mensagens comuns.
   */
  playNewLeadAlertSound(options?: { bypassCrossTab?: boolean }) {
    try {
      if (!options?.bypassCrossTab && !tryAcquireNewLeadSoundSlot()) return;
      const ctx = this.initContext();
      if (!ctx) return;

      if (ctx.state === "suspended" && !this.hasInteracted) {
        this.pendingLeadAlertOnUnlock = true;
      }

      const scheduleChime = () => {
        const now = ctx.currentTime + 0.01;
        const notes: Array<{
          freq: number;
          time: number;
          duration: number;
          gain: number;
          overtoneGain: number;
        }> = [
          // 1º pulso (chamada rápida ascendente)
          { freq: 659.25, time: 0.0, duration: 0.2, gain: 0.28, overtoneGain: 0.08 },   // E5
          { freq: 830.61, time: 0.09, duration: 0.22, gain: 0.3, overtoneGain: 0.09 },  // G#5
          { freq: 987.77, time: 0.18, duration: 0.28, gain: 0.34, overtoneGain: 0.1 },  // B5
          // 2º pulso (confirmação brilhante mais aguda)
          { freq: 659.25, time: 0.52, duration: 0.2, gain: 0.3, overtoneGain: 0.09 },   // E5
          { freq: 830.61, time: 0.61, duration: 0.22, gain: 0.32, overtoneGain: 0.1 },  // G#5
          { freq: 987.77, time: 0.7, duration: 0.26, gain: 0.36, overtoneGain: 0.11 },  // B5
          { freq: 1318.51, time: 0.8, duration: 0.45, gain: 0.38, overtoneGain: 0.12 }, // E6
        ];

        for (const note of notes) {
          const osc = ctx.createOscillator();
          const overtone = ctx.createOscillator();
          const gainNode = ctx.createGain();
          const overtoneGainNode = ctx.createGain();

          osc.type = "sine";
          osc.frequency.setValueAtTime(note.freq, now + note.time);

          overtone.type = "triangle";
          overtone.frequency.setValueAtTime(note.freq * 2, now + note.time);

          gainNode.gain.setValueAtTime(0.001, now + note.time);
          gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.time + 0.015);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.duration);

          overtoneGainNode.gain.setValueAtTime(0.001, now + note.time);
          overtoneGainNode.gain.exponentialRampToValueAtTime(
            note.overtoneGain,
            now + note.time + 0.012,
          );
          overtoneGainNode.gain.exponentialRampToValueAtTime(
            0.0001,
            now + note.time + note.duration * 0.7,
          );

          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          overtone.connect(overtoneGainNode);
          overtoneGainNode.connect(ctx.destination);

          osc.start(now + note.time);
          osc.stop(now + note.time + note.duration + 0.05);
          overtone.start(now + note.time);
          overtone.stop(now + note.time + note.duration + 0.05);
        }
      };

      if (ctx.state === "suspended") {
        ctx
          .resume()
          .then(() => {
            this.pendingLeadAlertOnUnlock = false;
            scheduleChime();
          })
          .catch(() => {});
      } else {
        this.pendingLeadAlertOnUnlock = false;
        scheduleChime();
      }
    } catch (err) {
      console.warn("[SoundService] Erro ao reproduzir som de alerta de lead novo:", err);
    }
  }

  /**
   * Toca alerta sonoro executivo de atenção/urgência quando a Supervisão cobra ou orienta
   * um consultor específico. Duplo pulso nítido (A5 -> C#6 -> E6 | A5 -> C#6) com
   * timbre distinto do ping comum e do alerta de Lead Novo.
   */
  playSupervisorAttentionAlertSound(options?: { bypassCrossTab?: boolean }) {
    try {
      if (!options?.bypassCrossTab && !tryAcquireSupervisorAttentionSoundSlot()) return;
      const ctx = this.initContext();
      if (!ctx) return;

      if (ctx.state === "suspended" && !this.hasInteracted) {
        this.pendingSupervisorAlertOnUnlock = true;
      }

      const scheduleAlert = () => {
        const now = ctx.currentTime + 0.01;
        const notes: Array<{
          freq: number;
          time: number;
          duration: number;
          gain: number;
          overtoneGain: number;
        }> = [
          // 1º toque de atenção (direto e incisivo)
          { freq: 880.0, time: 0.0, duration: 0.16, gain: 0.3, overtoneGain: 0.1 },      // A5
          { freq: 1108.73, time: 0.14, duration: 0.22, gain: 0.34, overtoneGain: 0.11 }, // C#6
          // 2º toque de reforço (urgência clara)
          { freq: 880.0, time: 0.44, duration: 0.16, gain: 0.32, overtoneGain: 0.11 },   // A5
          { freq: 1108.73, time: 0.58, duration: 0.2, gain: 0.34, overtoneGain: 0.12 },  // C#6
          { freq: 1318.51, time: 0.72, duration: 0.34, gain: 0.36, overtoneGain: 0.12 }, // E6
        ];

        for (const note of notes) {
          const osc = ctx.createOscillator();
          const overtone = ctx.createOscillator();
          const gainNode = ctx.createGain();
          const overtoneGainNode = ctx.createGain();

          osc.type = "sine";
          osc.frequency.setValueAtTime(note.freq, now + note.time);

          overtone.type = "triangle";
          overtone.frequency.setValueAtTime(note.freq * 1.5, now + note.time);

          gainNode.gain.setValueAtTime(0.001, now + note.time);
          gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.time + 0.012);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.time + note.duration);

          overtoneGainNode.gain.setValueAtTime(0.001, now + note.time);
          overtoneGainNode.gain.exponentialRampToValueAtTime(
            note.overtoneGain,
            now + note.time + 0.01,
          );
          overtoneGainNode.gain.exponentialRampToValueAtTime(
            0.0001,
            now + note.time + note.duration * 0.65,
          );

          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          overtone.connect(overtoneGainNode);
          overtoneGainNode.connect(ctx.destination);

          osc.start(now + note.time);
          osc.stop(now + note.time + note.duration + 0.05);
          overtone.start(now + note.time);
          overtone.stop(now + note.time + note.duration + 0.05);
        }
      };

      if (ctx.state === "suspended") {
        ctx
          .resume()
          .then(() => {
            this.pendingSupervisorAlertOnUnlock = false;
            scheduleAlert();
          })
          .catch(() => {});
      } else {
        this.pendingSupervisorAlertOnUnlock = false;
        scheduleAlert();
      }
    } catch (err) {
      console.warn("[SoundService] Erro ao reproduzir som de atenção da supervisão:", err);
    }
  }
}

export const soundNotificationService = new SoundNotificationService();
export const playNotificationSound = () => soundNotificationService.playNotificationSound();
export const playNewLeadAlertSound = (options?: { bypassCrossTab?: boolean }) =>
  soundNotificationService.playNewLeadAlertSound(options);
export const playSupervisorAttentionAlertSound = (options?: { bypassCrossTab?: boolean }) =>
  soundNotificationService.playSupervisorAttentionAlertSound(options);
