import React, { useEffect, useRef, useState } from "react";
import { Award, CheckCircle2, Sparkles, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { SystemTooltip } from "../ui/tooltip";

export interface SaleCelebrationData {
  dealTitle: string;
  value: number | string | null;
  sellerName?: string | null;
  accountName?: string | null;
  stageName?: string | null;
}

interface SaleCelebrationModalProps {
  data: SaleCelebrationData | null;
  onClose: () => void;
}

function formatCelebrationCurrency(val: number | string | null | undefined): string {
  const num =
    typeof val === "number"
      ? val
      : typeof val === "string"
        ? parseFloat(val.replace(",", "."))
        : 0;
  const safeNum = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(safeNum);
}

/**
 * Sintetiza um efeito sonoro harmônico de celebração + aplausos suaves via Web Audio API,
 * sem depender de arquivos externos que possam falhar no carregamento.
 */
function playCelebrationAudio() {
  if (typeof window === "undefined") return;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // 1. Fanfarra harmônica (Acorde Maior ascendente suave: C5 - E5 - G5 - C6)
    const notes = [
      { freq: 523.25, delay: 0.0, duration: 0.45 },
      { freq: 659.25, delay: 0.11, duration: 0.45 },
      { freq: 783.99, delay: 0.22, duration: 0.55 },
      { freq: 1046.5, delay: 0.34, duration: 0.95 },
    ];

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const subOsc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "triangle";
      subOsc.type = "sine";
      osc.frequency.setValueAtTime(note.freq, now + note.delay);
      subOsc.frequency.setValueAtTime(note.freq * 0.5, now + note.delay);

      gain.gain.setValueAtTime(0.0001, now + note.delay);
      gain.gain.exponentialRampToValueAtTime(0.14, now + note.delay + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.delay + note.duration);

      osc.connect(gain);
      subOsc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.delay);
      subOsc.start(now + note.delay);
      osc.stop(now + note.delay + note.duration + 0.05);
      subOsc.stop(now + note.delay + note.duration + 0.05);
    }

    // 2. Palmas rítmicas sintetizadas (filtragem passa-banda de ruído branco em pulsos de aplauso)
    const clapCount = 14;
    for (let i = 0; i < clapCount; i++) {
      const startOffset = 0.18 + i * 0.095 + (Math.random() * 0.025 - 0.012);
      const bufferSize = Math.floor(ctx.sampleRate * 0.065);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        output[j] = (Math.random() * 2 - 1) * Math.exp(-j / (bufferSize * 0.32));
      }

      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.setValueAtTime(1150 + (i % 4) * 140, now + startOffset);
      bandpass.Q.setValueAtTime(1.8, now + startOffset);

      const clapGain = ctx.createGain();
      const peakGain = Math.max(0.025, 0.09 * (1 - i / (clapCount + 4)));
      clapGain.gain.setValueAtTime(0.001, now + startOffset);
      clapGain.gain.linearRampToValueAtTime(peakGain, now + startOffset + 0.006);
      clapGain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + 0.065);

      whiteNoise.connect(bandpass);
      bandpass.connect(clapGain);
      clapGain.connect(ctx.destination);

      whiteNoise.start(now + startOffset);
      whiteNoise.stop(now + startOffset + 0.07);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 2400);
  } catch {
    // Ignora bloqueio de autoplay do navegador
  }
}

export function SaleCelebrationModal({ data, onClose }: SaleCelebrationModalProps) {
  const [muted, setMuted] = useState(false);
  const [clapPulse, setClapPulse] = useState(false);
  const playedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data) {
      playedRef.current = null;
      return;
    }
    const key = `${data.dealTitle}-${data.value}`;
    if (playedRef.current !== key && !muted) {
      playedRef.current = key;
      playCelebrationAudio();
    }
    setClapPulse(true);
    const pulseInterval = setInterval(() => {
      setClapPulse((prev) => !prev);
    }, 420);
    return () => clearInterval(pulseInterval);
  }, [data, muted]);

  if (!data) return null;

  const formattedValue = formatCelebrationCurrency(data.value);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-background/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-celebration-title"
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/40 bg-card text-card-foreground shadow-2xl animate-in zoom-in-95 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Brilho superior sutil na paleta do sistema */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-72 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />

        {/* Barra superior de destaque */}
        <div className="h-1.5 w-full bg-primary" />

        {/* Controles de topo */}
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Venda Concluída
          </div>

          <div className="flex items-center gap-1.5">
            <SystemTooltip content={muted ? "Ativar efeito sonoro e repetir aplausos" : "Repetir aplausos de comemoração"}>
              <button
                type="button"
                onClick={() => {
                  if (muted) {
                    setMuted(false);
                  }
                  playCelebrationAudio();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </SystemTooltip>

            <SystemTooltip content="Fechar comemoração">
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary/60 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Conteúdo central */}
        <div className="flex flex-col items-center px-6 pb-6 pt-3 text-center">
          {/* Ícone de Troféu e Palmas animadas */}
          <div className="relative mb-4 flex items-center justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/30 bg-primary/15 text-primary shadow-inner">
              <Trophy className="h-10 w-10" />
            </div>
            <div
              className={`-right-3 -bottom-2 absolute flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-card shadow-md transition-transform duration-300 ${
                clapPulse ? "scale-115 -rotate-6" : "scale-95 rotate-6"
              }`}
            >
              <span className="text-xl leading-none select-none" role="img" aria-label="Palmas">
                👏
              </span>
            </div>
          </div>

          <h2 id="sale-celebration-title" className="text-xl font-bold tracking-tight text-foreground">
            Parabéns pela Venda!
          </h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-xs">
            Mais um negócio fechado com sucesso. Excelente trabalho comercial!
          </p>

          {/* Card de Valor e Detalhes da Negociação */}
          <div className="mt-5 w-full rounded-xl border border-primary/25 bg-secondary/40 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Valor da Venda Realizada
            </div>
            <div className="mt-1 text-3xl font-extrabold tracking-tight text-primary">
              {formattedValue}
            </div>

            <div className="mt-3 border-t border-border/60 pt-3 text-left space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground shrink-0">Negociação:</span>
                <span className="font-semibold text-foreground truncate">{data.dealTitle}</span>
              </div>
              {data.accountName && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">Cliente:</span>
                  <span className="font-medium text-foreground truncate">{data.accountName}</span>
                </div>
              )}
              {data.sellerName && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0">Responsável:</span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary truncate">
                    <Award className="h-3.5 w-3.5 shrink-0" />
                    {data.sellerName}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Botão de confirmação */}
          <div className="mt-5 flex w-full items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-sm transition-all hover:opacity-95"
            >
              <CheckCircle2 className="h-4 w-4" />
              Continuar vendendo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
