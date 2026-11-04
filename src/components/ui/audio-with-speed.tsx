import * as React from "react";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  useAudioPlaybackRate,
  formatAudioPlaybackRate,
  applyAudioPlaybackRate,
} from "@/lib/audio-playback-rate";

interface AudioWithSpeedProps {
  src: string;
  className?: string;
  audioClassName?: string;
  preload?: "none" | "metadata" | "auto";
}

export function AudioWithSpeed({
  src,
  className = "",
  audioClassName = "h-8 flex-1 min-w-0",
  preload = "metadata",
}: AudioWithSpeedProps) {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const { playbackRate, cyclePlaybackRate, syncAudioElement } = useAudioPlaybackRate(audioRef, src);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <audio
        ref={audioRef}
        controls
        preload={preload}
        src={src}
        onPlay={() => syncAudioElement()}
        onLoadedMetadata={() => applyAudioPlaybackRate(audioRef.current, playbackRate)}
        className={audioClassName}
      />
      <SystemTooltip
        content={`Velocidade ${formatAudioPlaybackRate(playbackRate)} (clique para alternar: 1x → 1.5x → 2.0x → 2.5x)`}
      >
        <button
          type="button"
          onClick={cyclePlaybackRate}
          aria-label={`Velocidade de reprodução: ${formatAudioPlaybackRate(playbackRate)}`}
          className={`inline-flex h-6 px-2 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold tracking-tight border transition active:scale-95 cursor-pointer tabular-nums ${
            playbackRate > 1
              ? "bg-primary text-primary-foreground border-primary shadow-2xs"
              : "bg-muted text-foreground border-border/80 hover:bg-muted/80"
          }`}
        >
          {formatAudioPlaybackRate(playbackRate)}
        </button>
      </SystemTooltip>
    </div>
  );
}
