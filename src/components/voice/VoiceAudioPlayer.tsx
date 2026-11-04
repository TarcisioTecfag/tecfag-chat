import React, { useState, useRef } from "react";
import { Play, Pause, Volume2, Volume1, VolumeX, RotateCcw } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  useAudioPlaybackRate,
  formatAudioPlaybackRate,
  applyAudioPlaybackRate,
} from "@/lib/audio-playback-rate";

interface VoiceAudioPlayerProps {
  src: string;
  onTimeUpdate?: (currentTime: number) => void;
  className?: string;
}

export function VoiceAudioPlayer({ src, onTimeUpdate, className = "" }: VoiceAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const { playbackRate, cyclePlaybackRate, syncAudioElement } = useAudioPlaybackRate(audioRef, src);

  // Formatar tempo em mm:ss
  const formatTime = (timeInSecs: number) => {
    if (isNaN(timeInSecs) || timeInSecs < 0) return "0:00";
    const minutes = Math.floor(timeInSecs / 60);
    const seconds = Math.floor(timeInSecs % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Alternar Play / Pause
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      syncAudioElement();
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.warn("[VoiceAudioPlayer] Erro ao reproduzir:", err));
    }
  };

  // Atualização contínua do tempo
  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const curr = audioRef.current.currentTime;
    setCurrentTime(curr);
    if (onTimeUpdate) {
      onTimeUpdate(curr);
    }
  };

  // Metadados carregados
  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    applyAudioPlaybackRate(audioRef.current, playbackRate);
    setDuration(audioRef.current.duration || 0);
  };

  // Fim do áudio
  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (onTimeUpdate) onTimeUpdate(0);
  };

  // Seek ao clicar na barra
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !progressBarRef.current || !duration) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = pct * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    if (onTimeUpdate) onTimeUpdate(newTime);
  };

  // Alternar Mute
  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.muted = false;
      setIsMuted(false);
    } else {
      audioRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`bg-card border border-border/80 rounded-2xl p-3.5 shadow-soft select-none transition-all ${className}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => syncAudioElement()}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
        {/* Botão Principal Play/Pause */}
        <div className="flex items-center gap-2 shrink-0">
          <SystemTooltip content={isPlaying ? "Pausar" : "Reproduzir gravação"}>
            <button
              type="button"
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-primary text-primary-foreground hover:opacity-90 flex items-center justify-center shadow-soft transition transform active:scale-95 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-4.5 h-4.5 fill-current" /> : <Play className="w-4.5 h-4.5 fill-current ml-0.5" />}
            </button>
          </SystemTooltip>

          <SystemTooltip content="Reiniciar do início">
            <button
              type="button"
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = 0;
                  setCurrentTime(0);
                }
              }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </SystemTooltip>
        </div>

        {/* Barra de Progresso e Timestamps */}
        <div className="flex-1 flex flex-col gap-1 w-full min-w-0">
          <div
            ref={progressBarRef}
            onClick={handleSeek}
            className="group relative w-full h-2.5 bg-muted/80 hover:bg-muted rounded-full overflow-hidden cursor-pointer transition-all flex items-center"
          >
            <div
              className="h-full bg-primary rounded-full transition-all duration-75 relative"
              style={{ width: `${progressPct}%` }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white border-2 border-primary rounded-full opacity-0 group-hover:opacity-100 shadow-sm transition-opacity" />
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span className="font-bold text-foreground">{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controles Extras: Velocidade & Volume */}
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {/* Velocidade de Reprodução */}
          <SystemTooltip
            content={`Velocidade ${formatAudioPlaybackRate(playbackRate)} (clique para alternar: 1x → 1.5x → 2.0x → 2.5x)`}
          >
            <button
              type="button"
              onClick={cyclePlaybackRate}
              className={`px-2 py-1 rounded-lg text-[10px] font-extrabold tracking-wider border transition cursor-pointer tabular-nums ${
                playbackRate > 1
                  ? "bg-primary text-primary-foreground border-primary shadow-2xs"
                  : "bg-muted/60 hover:bg-muted text-foreground border-border/70"
              }`}
            >
              {formatAudioPlaybackRate(playbackRate)}
            </button>
          </SystemTooltip>

          {/* Mute / Volume */}
          <SystemTooltip content={isMuted ? "Desmutar áudio" : "Mutar áudio"}>
            <button
              type="button"
              onClick={toggleMute}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition cursor-pointer"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-500" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-4 h-4 text-primary" />
              ) : (
                <Volume2 className="w-4 h-4 text-primary" />
              )}
            </button>
          </SystemTooltip>
        </div>
      </div>
    </div>
  );
}
