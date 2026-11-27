import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Mic,
  Pause,
  Play,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import { formatAudioPlaybackRate, useAudioPlaybackRate } from "@/lib/audio-playback-rate";
import { downloadChatMedia, type DownloadableMediaType } from "@/lib/chat/message-context-menu";
import {
  normalizeCitedMessageMedia,
  parseCitedMessageMedia,
  type CitedMessageMedia,
} from "@/lib/valentina/cited-media";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

export interface CitedMessageMediaPreviewProps {
  lastMessage?: string | null;
  lastMessageMedia?: CitedMessageMedia | null;
  clientName?: string | null;
  /** Modo compacto para listas densas (`Atendimentos Ativos`, `Conversas Citadas`). */
  compact?: boolean;
  onMediaClick?: (type: "image" | "video", url: string) => void;
}

function getDocumentMeta(fileName?: string | null, mimeType?: string | null) {
  const safeName = (fileName || "").trim();
  const ext = safeName.includes(".") ? safeName.split(".").pop()?.toLowerCase() || "" : "";
  const mime = (mimeType || "").split(";")[0].trim().toLowerCase();

  const isPdf = ext === "pdf" || mime === "application/pdf";
  const isExcel =
    ["xls", "xlsx", "csv", "ods"].includes(ext) ||
    mime.includes("spreadsheet") ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv";
  const isWord =
    ["doc", "docx", "odt", "rtf"].includes(ext) ||
    mime.includes("wordprocessingml") ||
    mime === "application/msword";
  const isPpt =
    ["ppt", "pptx"].includes(ext) ||
    mime.includes("presentationml") ||
    mime === "application/vnd.ms-powerpoint";

  const iconBg = isPdf
    ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25"
    : isExcel
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
      : isWord
        ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25"
        : isPpt
          ? "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25"
          : "bg-muted text-muted-foreground border-border/80";

  const typeLabel = isPdf
    ? "PDF"
    : isExcel
      ? "Planilha"
      : isWord
        ? "Word"
        : isPpt
          ? "Apresentação"
          : ext
            ? ext.toUpperCase()
            : "Documento";

  const canOpenInline = isPdf || mime.startsWith("text/") || ext === "txt";

  return {
    displayName: safeName || (isPdf ? "documento.pdf" : "Documento enviado"),
    iconBg,
    typeLabel,
    canOpenInline,
  };
}

function formatAudioSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function CitedAudioPlayer({
  src,
  mediaId,
  messageId,
  clientName,
  initialTranscription,
  compact,
  onDownload,
  downloading,
}: {
  src: string;
  mediaId?: string | null;
  messageId?: string | null;
  clientName?: string | null;
  initialTranscription?: string | null;
  compact: boolean;
  onDownload: (e: React.MouseEvent) => void;
  downloading: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const [openTranscript, setOpenTranscript] = useState(
    Boolean(!compact && initialTranscription && initialTranscription.trim().length > 0),
  );
  const [transcript, setTranscript] = useState<string | null>(initialTranscription || null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  const { playbackRate, cyclePlaybackRate, syncAudioElement } = useAudioPlaybackRate(audioRef, src);

  useEffect(() => {
    setAudioError(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    if (initialTranscription && initialTranscription.trim()) {
      setTranscript(initialTranscription.trim());
      if (!compact) setOpenTranscript(true);
    }
  }, [initialTranscription, compact]);

  const updateDuration = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    syncAudioElement();
    if (Number.isFinite(a.duration) && a.duration > 0) {
      setDuration(a.duration);
    } else if (a.duration === Infinity) {
      const onSeeked = () => {
        a.removeEventListener("seeked", onSeeked);
        if (Number.isFinite(a.currentTime) && a.currentTime > 0) {
          setDuration(a.currentTime);
        }
        a.currentTime = 0;
      };
      a.addEventListener("seeked", onSeeked, { once: true });
      a.currentTime = 1e101;
    }
  }, [syncAudioElement]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = audioRef.current;
    if (!a || audioError) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      syncAudioElement();
      a.play()
        .then(() => setPlaying(true))
        .catch(() => {
          setPlaying(false);
          setAudioError(true);
        });
    }
  };

  const handleToggleTranscript = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = !openTranscript;
    setOpenTranscript(nextOpen);

    if (!nextOpen || transcript || loadingTranscript) return;
    if (!messageId && !mediaId) return;

    setLoadingTranscript(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/chats/transcribe-audio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messageId: messageId || undefined,
          mediaId: mediaId || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text =
          (typeof data?.transcription === "string" && data.transcription.trim()) ||
          (typeof data?.mediaInterpretation === "string" && data.mediaInterpretation.trim()) ||
          "";
        if (text) {
          setTranscript(text);
        }
      }
    } catch {
      // Silencioso: mostra fallback "Transcrição indisponível"
    } finally {
      setLoadingTranscript(false);
    }
  };

  const pct =
    duration > 0 && Number.isFinite(duration)
      ? Math.min(100, Math.max(0, (current / duration) * 100))
      : 0;
  const audioTitle = clientName ? `Áudio de ${clientName}` : "Áudio enviado pelo cliente";

  return (
    <div
      className={`rounded-lg bg-muted/65 border-l-2 border-primary ${
        compact ? "px-2 py-1.5" : "p-2.5"
      } flex flex-col gap-1.5 min-w-0 max-w-full`}
      onClick={(e) => e.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => syncAudioElement()}
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onCanPlayThrough={updateDuration}
        onError={() => {
          setPlaying(false);
          setAudioError(true);
        }}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (!a) return;
          const ct = a.currentTime || 0;
          setCurrent(ct);
          if (
            (!duration || !Number.isFinite(duration)) &&
            Number.isFinite(a.duration) &&
            a.duration > 0
          ) {
            setDuration(a.duration);
          }
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
      />

      {audioError ? (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground italic">
          <Mic className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="truncate">
            Áudio indisponível no preview — abra a conversa para ouvir.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 min-w-0">
          <SystemTooltip content={playing ? "Pausar áudio" : "Ouvir áudio"}>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pausar áudio" : "Ouvir áudio"}
              className={`grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition cursor-pointer shadow-2xs ${
                compact ? "h-6 w-6" : "h-8 w-8"
              }`}
            >
              {playing ? (
                <Pause className={compact ? "h-3 w-3 fill-current" : "h-3.5 w-3.5 fill-current"} />
              ) : (
                <Play
                  className={
                    compact ? "h-3 w-3 fill-current ml-0.5" : "h-3.5 w-3.5 fill-current ml-0.5"
                  }
                />
              )}
            </button>
          </SystemTooltip>

          <div className="flex-1 min-w-0 flex flex-col gap-1">
            {!compact && (
              <div className="flex items-center justify-between gap-1.5 min-w-0">
                <span className="flex items-center gap-1 text-[10px] font-bold text-foreground truncate">
                  <Mic className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">{audioTitle}</span>
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <SystemTooltip
                    content={`Velocidade ${formatAudioPlaybackRate(playbackRate)} (clique para alternar)`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cyclePlaybackRate(e);
                      }}
                      aria-label={`Velocidade de reprodução: ${formatAudioPlaybackRate(playbackRate)}`}
                      className={`inline-flex h-4 px-1.5 items-center justify-center rounded-full text-[9px] font-extrabold tabular-nums transition cursor-pointer ${
                        playbackRate > 1
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground hover:text-foreground border border-border/80"
                      }`}
                    >
                      {formatAudioPlaybackRate(playbackRate)}
                    </button>
                  </SystemTooltip>
                  <SystemTooltip
                    content={openTranscript ? "Ocultar transcrição" : "Ver transcrição"}
                  >
                    <button
                      type="button"
                      onClick={handleToggleTranscript}
                      aria-label={openTranscript ? "Ocultar transcrição" : "Ver transcrição"}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-card/80 transition cursor-pointer"
                    >
                      <ChevronDown
                        className={`h-3 w-3 transition-transform duration-150 ${
                          openTranscript ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </SystemTooltip>
                  <SystemTooltip content="Baixar áudio">
                    <button
                      type="button"
                      onClick={onDownload}
                      disabled={downloading}
                      aria-label="Baixar áudio"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-card/80 transition cursor-pointer disabled:opacity-50"
                    >
                      {downloading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="h-3 w-3" />
                      )}
                    </button>
                  </SystemTooltip>
                </div>
              </div>
            )}

            <div className="relative h-1.5 w-full rounded-full bg-border/80 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-100"
                style={{ width: `${pct}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration > 0 && Number.isFinite(duration) ? duration : 1}
                step={0.05}
                value={current}
                aria-label="Progresso do áudio"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.stopPropagation();
                  const v = Number(e.target.value);
                  setCurrent(v);
                  if (audioRef.current && Number.isFinite(v)) {
                    audioRef.current.currentTime = v;
                  }
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-1.5 text-[9px] text-muted-foreground font-mono">
              <span>
                {formatAudioSeconds(current)}
                {duration > 0 ? ` / ${formatAudioSeconds(duration)}` : ""}
              </span>
              {compact && (
                <div className="flex items-center gap-1">
                  <SystemTooltip
                    content={`Velocidade ${formatAudioPlaybackRate(playbackRate)} (clique para alternar)`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cyclePlaybackRate(e);
                      }}
                      className="inline-flex h-3.5 px-1 items-center justify-center rounded-full text-[8.5px] font-bold bg-card border border-border/70 text-foreground cursor-pointer"
                    >
                      {formatAudioPlaybackRate(playbackRate)}
                    </button>
                  </SystemTooltip>
                  <SystemTooltip
                    content={openTranscript ? "Ocultar transcrição" : "Ver transcrição"}
                  >
                    <button
                      type="button"
                      onClick={handleToggleTranscript}
                      aria-label={openTranscript ? "Ocultar transcrição" : "Ver transcrição"}
                      className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground transition cursor-pointer"
                    >
                      <ChevronDown
                        className={`h-2.5 w-2.5 transition-transform duration-150 ${
                          openTranscript ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </SystemTooltip>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {openTranscript && (
        <div className="pt-1.5 border-t border-border/60 text-[10px] leading-relaxed text-foreground/85 select-text">
          {loadingTranscript ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground italic">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              Transcrevendo áudio...
            </span>
          ) : transcript ? (
            <p className="whitespace-pre-wrap break-words italic">"{transcript}"</p>
          ) : (
            <span className="text-muted-foreground italic">
              Transcrição indisponível para este áudio.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function CitedMessageMediaPreview({
  lastMessage,
  lastMessageMedia,
  clientName,
  compact = false,
  onMediaClick,
}: CitedMessageMediaPreviewProps) {
  const [mediaLoadError, setMediaLoadError] = useState(false);
  const [inlineVideoActive, setInlineVideoActive] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const resolved = useMemo(() => {
    const normalizedPropMedia = normalizeCitedMessageMedia(lastMessageMedia, BACKEND_URL);
    const parsedFromText = parseCitedMessageMedia(lastMessage, { backendUrl: BACKEND_URL });
    const media = normalizedPropMedia || parsedFromText.media;
    const previewText = parsedFromText.previewText;
    return { media, previewText };
  }, [lastMessage, lastMessageMedia]);

  const mediaUrl = resolved.media?.url || null;

  useEffect(() => {
    setMediaLoadError(false);
    setInlineVideoActive(false);
  }, [mediaUrl, resolved.media?.type]);

  const handleDownload = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!resolved.media || !mediaUrl || downloading) return;
      setDownloading(true);
      try {
        const result = await downloadChatMedia({
          type: resolved.media.type as DownloadableMediaType,
          url: mediaUrl,
          fileName: resolved.media.fileName || resolved.media.mediaId || resolved.media.type,
          hasExplicitFileName: Boolean(resolved.media.fileName),
        });
        if (!result.ok) {
          toast.error(result.error || "Não foi possível baixar o arquivo.");
        }
      } catch {
        toast.error("Não foi possível baixar o arquivo.");
      } finally {
        setDownloading(false);
      }
    },
    [resolved.media, mediaUrl, downloading],
  );

  // Sem mídia estruturada: renderiza citação textual limpa (nunca exibindo hash med_...)
  if (!resolved.media || !mediaUrl) {
    if (!resolved.previewText) return null;
    if (compact) {
      return (
        <div className="text-[10px] text-muted-foreground truncate italic">
          "{resolved.previewText}"
        </div>
      );
    }
    return (
      <div className="p-2 rounded-lg bg-muted/65 text-[10px] text-muted-foreground border-l-2 border-primary italic break-words">
        "{resolved.previewText}"
      </div>
    );
  }

  const { media } = resolved;

  // ── 1. ÁUDIO ────────────────────────────────────────────────────────────────
  if (media.type === "audio") {
    return (
      <CitedAudioPlayer
        src={mediaUrl}
        mediaId={media.mediaId}
        messageId={media.messageId}
        clientName={clientName}
        initialTranscription={media.transcription}
        compact={compact}
        onDownload={handleDownload}
        downloading={downloading}
      />
    );
  }

  // ── 2. FOTO / FIGURINHA ────────────────────────────────────────────────────
  if (media.type === "image" || media.type === "sticker") {
    const isSticker = media.type === "sticker";
    const typeLabel = isSticker ? "Figurinha" : "Foto";

    if (compact) {
      return (
        <div
          className="mt-0.5 flex items-center gap-2 rounded-lg bg-card/80 border border-border/60 p-1.5 min-w-0 max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {!mediaLoadError ? (
            <SystemTooltip content={`Ampliar ${typeLabel.toLowerCase()}`}>
              <button
                type="button"
                onClick={() =>
                  onMediaClick ? onMediaClick("image", mediaUrl) : window.open(mediaUrl, "_blank")
                }
                className="relative h-10 w-10 shrink-0 rounded-md overflow-hidden border border-border/60 bg-black/5 cursor-pointer group/thumb"
              >
                <img
                  src={mediaUrl}
                  alt={media.caption || typeLabel}
                  className={`h-full w-full ${isSticker ? "object-contain p-0.5" : "object-cover"}`}
                  onError={() => setMediaLoadError(true)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 flex items-center justify-center transition">
                  <Maximize2 className="h-3 w-3 text-white opacity-0 group-hover/thumb:opacity-100 transition" />
                </div>
              </button>
            </SystemTooltip>
          ) : (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              {isSticker ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[9.5px] font-bold text-foreground">
              {isSticker ? (
                <Sparkles className="h-2.5 w-2.5 text-primary shrink-0" />
              ) : (
                <ImageIcon className="h-2.5 w-2.5 text-primary shrink-0" />
              )}
              <span>{typeLabel}</span>
            </div>
            <p className="text-[9.5px] text-muted-foreground truncate italic">
              {media.caption ||
                (mediaLoadError
                  ? "Abra a conversa para visualizar"
                  : "Clique na miniatura para ampliar")}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div
        className="rounded-lg bg-muted/65 border-l-2 border-primary p-2 flex flex-col gap-1.5 min-w-0 max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 text-[9.5px] font-bold text-muted-foreground">
          <span className="flex items-center gap-1 text-foreground">
            {isSticker ? (
              <Sparkles className="h-3 w-3 text-primary shrink-0" />
            ) : (
              <ImageIcon className="h-3 w-3 text-primary shrink-0" />
            )}
            <span>{typeLabel} enviada pelo cliente</span>
          </span>
          <SystemTooltip content={`Baixar ${typeLabel.toLowerCase()}`}>
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              aria-label={`Baixar ${typeLabel.toLowerCase()}`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-card/80 transition cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </button>
          </SystemTooltip>
        </div>

        {!mediaLoadError ? (
          <SystemTooltip content="Clique para ampliar em tela cheia">
            <button
              type="button"
              onClick={() =>
                onMediaClick ? onMediaClick("image", mediaUrl) : window.open(mediaUrl, "_blank")
              }
              className={`relative group/img overflow-hidden rounded-lg border border-border/70 bg-black/5 cursor-pointer text-left ${
                isSticker ? "w-28 h-28 self-start p-1" : "w-full max-w-[260px]"
              }`}
            >
              <img
                src={mediaUrl}
                alt={media.caption || typeLabel}
                className={
                  isSticker
                    ? "h-full w-full object-contain"
                    : "max-h-44 w-full object-contain rounded-lg transition group-hover/img:scale-[1.01]"
                }
                onError={() => setMediaLoadError(true)}
              />
              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/25 flex items-center justify-center transition">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white opacity-0 group-hover/img:opacity-100 transition shadow-sm">
                  <Maximize2 className="h-3.5 w-3.5" />
                </div>
              </div>
            </button>
          </SystemTooltip>
        ) : (
          <div className="text-[10px] text-muted-foreground italic">
            Imagem indisponível no preview — abra a conversa para visualizar.
          </div>
        )}

        {media.caption && (
          <p className="text-[10.5px] text-foreground/90 whitespace-pre-wrap break-words leading-snug">
            "{media.caption}"
          </p>
        )}
      </div>
    );
  }

  // ── 3. VÍDEO ────────────────────────────────────────────────────────────────
  if (media.type === "video") {
    const handleOpenVideo = () => {
      if (onMediaClick) {
        onMediaClick("video", mediaUrl);
      } else {
        setInlineVideoActive(true);
      }
    };

    if (compact) {
      return (
        <div
          className="mt-0.5 flex items-center gap-2 rounded-lg bg-card/80 border border-border/60 p-1.5 min-w-0 max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          {!mediaLoadError ? (
            <SystemTooltip content="Assistir vídeo">
              <button
                type="button"
                onClick={handleOpenVideo}
                className="relative h-10 w-14 shrink-0 rounded-md overflow-hidden border border-border/60 bg-black/20 cursor-pointer flex items-center justify-center group/vid"
              >
                <video
                  src={mediaUrl}
                  preload="metadata"
                  muted
                  playsInline
                  className="h-full w-full object-cover pointer-events-none"
                  onError={() => setMediaLoadError(true)}
                />
                <div className="absolute inset-0 bg-black/25 group-hover/vid:bg-black/40 flex items-center justify-center transition">
                  <div className="grid h-5 w-5 place-items-center rounded-full bg-white/90 text-slate-900 shadow-xs">
                    <Play className="h-2.5 w-2.5 fill-current ml-0.5" />
                  </div>
                </div>
              </button>
            </SystemTooltip>
          ) : (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Film className="h-3.5 w-3.5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[9.5px] font-bold text-foreground">
              <Film className="h-2.5 w-2.5 text-primary shrink-0" />
              <span>Vídeo</span>
            </div>
            <p className="text-[9.5px] text-muted-foreground truncate italic">
              {media.caption ||
                (mediaLoadError
                  ? "Abra a conversa para reproduzir"
                  : "Clique na miniatura para assistir")}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div
        className="rounded-lg bg-muted/65 border-l-2 border-primary p-2 flex flex-col gap-1.5 min-w-0 max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 text-[9.5px] font-bold text-muted-foreground">
          <span className="flex items-center gap-1 text-foreground">
            <Film className="h-3 w-3 text-primary shrink-0" />
            <span>Vídeo enviado pelo cliente</span>
          </span>
          <SystemTooltip content="Baixar vídeo">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              aria-label="Baixar vídeo"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-card/80 transition cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
            </button>
          </SystemTooltip>
        </div>

        {!mediaLoadError ? (
          inlineVideoActive ? (
            <video
              src={mediaUrl}
              controls
              autoPlay
              playsInline
              className="max-h-52 w-full max-w-[280px] rounded-lg border border-border/70 bg-black"
              onError={() => setMediaLoadError(true)}
            />
          ) : (
            <SystemTooltip content="Clique para assistir ao vídeo">
              <button
                type="button"
                onClick={handleOpenVideo}
                className="relative group/vid w-full max-w-[260px] rounded-lg overflow-hidden border border-border/70 bg-black/25 cursor-pointer flex items-center justify-center"
              >
                <video
                  src={mediaUrl}
                  preload="metadata"
                  muted
                  playsInline
                  className="max-h-44 w-full object-contain pointer-events-none rounded-lg"
                  onError={() => setMediaLoadError(true)}
                />
                <div className="absolute inset-0 bg-black/20 group-hover/vid:bg-black/35 flex items-center justify-center transition">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-white/92 text-slate-900 shadow-md transition group-hover/vid:scale-105">
                    <Play className="h-4.5 w-4.5 fill-current ml-0.5" />
                  </div>
                </div>
              </button>
            </SystemTooltip>
          )
        ) : (
          <div className="text-[10px] text-muted-foreground italic">
            Vídeo indisponível no preview — abra a conversa para reproduzir.
          </div>
        )}

        {media.caption && (
          <p className="text-[10.5px] text-foreground/90 whitespace-pre-wrap break-words leading-snug">
            "{media.caption}"
          </p>
        )}
      </div>
    );
  }

  // ── 4. ARQUIVO / DOCUMENTO ─────────────────────────────────────────────────
  const docMeta = getDocumentMeta(media.fileName, media.mimeType);

  return (
    <div
      className={`rounded-lg bg-muted/65 border-l-2 border-primary ${
        compact ? "p-1.5" : "p-2"
      } flex flex-col gap-1.5 min-w-0 max-w-full`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`grid shrink-0 place-items-center rounded-lg border ${docMeta.iconBg} ${
            compact ? "h-7 w-7" : "h-8 w-8"
          }`}
        >
          <FileText className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-bold text-foreground truncate">{docMeta.displayName}</p>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
            {docMeta.typeLabel}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {docMeta.canOpenInline && (
            <SystemTooltip content="Visualizar arquivo em nova aba">
              <a
                href={mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Visualizar arquivo em nova aba"
                className="grid h-7 w-7 place-items-center rounded-lg bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border/80 transition cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </SystemTooltip>
          )}
          <SystemTooltip content="Baixar arquivo">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              aria-label="Baixar arquivo"
              className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 hover:bg-primary/20 text-primary border border-primary/25 transition cursor-pointer disabled:opacity-50"
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </button>
          </SystemTooltip>
        </div>
      </div>

      {media.caption && (
        <p className="text-[10px] text-foreground/90 whitespace-pre-wrap break-words leading-snug">
          "{media.caption}"
        </p>
      )}
    </div>
  );
}
