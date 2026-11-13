import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Briefcase,
  Clock,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Lock,
  Music,
  Paperclip,
  X,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useChat } from "@/hooks/useChatState";
import { useConversationDealContext } from "@/components/crm/ConversationDealContext";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";
const MAX_NOTE_FILE_BYTES = 50 * 1024 * 1024;
export const INLINE_NOTE_FILES_EVENT = "inline-note:files-enqueued";

interface TransientInlineNoteDraft {
  text: string;
  attachments: File[];
}

const transientNoteDraftCache = new Map<string, TransientInlineNoteDraft>();

function fileDedupKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

export function appendUniqueNoteFiles(previous: File[], incoming: File[]): File[] {
  const seen = new Set(previous.map(fileDedupKey));
  const next = [...previous];
  for (const file of incoming) {
    if (!file || file.size <= 0) continue;
    if (file.size > MAX_NOTE_FILE_BYTES) {
      toast.error(`"${file.name || "Arquivo"}" excede o limite de 50MB.`);
      continue;
    }
    const key = fileDedupKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(file);
  }
  return next;
}

export function normalizePastedFile(file: File, index = 0): File {
  const rawName = (file.name || "").trim();
  const isGenericClipboardImage =
    !rawName || /^image\.(png|jpe?g|gif|webp|bmp)$/i.test(rawName);
  if (!isGenericClipboardImage) return file;

  const mime = (file.type || "image/png").toLowerCase();
  let ext = "png";
  if (mime.includes("jpeg") || mime.includes("jpg")) ext = "jpg";
  else if (mime.includes("webp")) ext = "webp";
  else if (mime.includes("gif")) ext = "gif";
  else if (mime.includes("bmp")) ext = "bmp";
  else if (mime.includes("pdf")) ext = "pdf";

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  const generatedName = `captura-${hh}${mm}${ss}-${index + 1}-${rand}.${ext}`;

  try {
    const mimeType = file.type || `image/${ext}`;
    const renamed = new File([new Blob([file], { type: mimeType })], generatedName, {
      type: mimeType,
      lastModified: Date.now() + index,
    });
    if (renamed.name !== generatedName) {
      Object.defineProperty(renamed, "name", {
        value: generatedName,
        configurable: true,
      });
    }
    return renamed;
  } catch {
    return file;
  }
}

export function extractFilesFromClipboard(clipboardData: DataTransfer | null | undefined): File[] {
  if (!clipboardData) return [];

  const fromItems: File[] = [];
  const items = Array.from(clipboardData.items || []);
  for (const item of items) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) fromItems.push(f);
    }
  }

  const rawFiles = fromItems.length > 0 ? fromItems : Array.from(clipboardData.files || []);
  return rawFiles.map((file, idx) => normalizePastedFile(file, idx));
}

export function hasDraggedFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes("Files");
}

export function enqueueInlineNoteFiles(conversationId: string, incomingFiles: File[]): File[] {
  if (!conversationId || conversationId === "valentina" || incomingFiles.length === 0) {
    return [];
  }
  const existing = transientNoteDraftCache.get(conversationId) ?? {
    text: "",
    attachments: [],
  };
  const merged = appendUniqueNoteFiles(existing.attachments, incomingFiles);
  transientNoteDraftCache.set(conversationId, {
    text: existing.text,
    attachments: merged,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(INLINE_NOTE_FILES_EVENT, { detail: { conversationId } }),
    );
  }
  return merged;
}

function formatNoteFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface InlineChatNoteComposerProps {
  conversationId: string;
  compact?: boolean;
  autoFocus?: boolean;
  onClose?: () => void;
  onSaved?: () => void;
}

export const InlineChatNoteComposer: React.FC<InlineChatNoteComposerProps> = ({
  conversationId,
  compact = false,
  autoFocus = true,
  onClose,
  onSaved,
}) => {
  const { sendMessage, tenant } = useChat();
  const dealContext = useConversationDealContext(conversationId);

  const [noteText, setNoteText] = useState<string>(
    () => (conversationId ? transientNoteDraftCache.get(conversationId)?.text : undefined) ?? "",
  );
  const [attachments, setAttachments] = useState<File[]>(
    () =>
      (conversationId ? transientNoteDraftCache.get(conversationId)?.attachments : undefined) ?? [],
  );
  const [previewUrls, setPreviewUrls] = useState<Array<string | null>>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const prevConvIdRef = useRef<string>(conversationId);
  const openedForConvRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      const cached = conversationId ? transientNoteDraftCache.get(conversationId) : undefined;
      setNoteText(cached?.text ?? "");
      setAttachments(cached?.attachments ?? []);
      setIsDraggingOver(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    if (noteText || attachments.length > 0) {
      transientNoteDraftCache.set(conversationId, {
        text: noteText,
        attachments,
      });
    } else {
      transientNoteDraftCache.delete(conversationId);
    }
  }, [conversationId, noteText, attachments]);

  useEffect(() => {
    const urls = attachments.map((file) =>
      file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    );
    setPreviewUrls(urls);
    return () => {
      for (const url of urls) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [attachments]);

  // Recebe arquivos enfileirados por Drag & Drop ou Ctrl+V no painel pai (ChatPanel / CrmChatWidget)
  useEffect(() => {
    const handleEnqueued = (event: Event) => {
      const custom = event as CustomEvent<{ conversationId?: string }>;
      if (!conversationId || custom.detail?.conversationId !== conversationId) return;
      const cached = transientNoteDraftCache.get(conversationId);
      if (cached) {
        setAttachments(cached.attachments);
      }
      window.setTimeout(() => textareaRef.current?.focus(), 20);
    };
    window.addEventListener(INLINE_NOTE_FILES_EVENT, handleEnqueued);
    return () => window.removeEventListener(INLINE_NOTE_FILES_EVENT, handleEnqueued);
  }, [conversationId]);

  // Captura Ctrl+V globalmente enquanto a Anotação Interna está aberta (prioridade em capture phase)
  useEffect(() => {
    if (!conversationId || conversationId === "valentina") return;
    const handleWindowPaste = (e: ClipboardEvent) => {
      if (saving) return;
      const target = e.target as HTMLElement | null;
      // Se o foco estiver dentro de um modal/dialog separado (ex.: criar card CRM), não intercepta
      if (
        target &&
        !containerRef.current?.contains(target) &&
        target.closest('[role="dialog"], [data-radix-popper-content-wrapper]')
      ) {
        return;
      }
      const pastedFiles = extractFilesFromClipboard(e.clipboardData);
      if (pastedFiles.length === 0) return;

      e.preventDefault();
      e.stopPropagation();
      setAttachments((prev) => appendUniqueNoteFiles(prev, pastedFiles));
      window.setTimeout(() => textareaRef.current?.focus(), 10);
    };

    window.addEventListener("paste", handleWindowPaste, true);
    return () => window.removeEventListener("paste", handleWindowPaste, true);
  }, [conversationId, saving]);

  useEffect(() => {
    if (!conversationId || conversationId === "valentina") return;
    if (openedForConvRef.current === conversationId) return;
    openedForConvRef.current = conversationId;

    let cancelled = false;
    void (async () => {
      try {
        const ctx = await dealContext.refresh();
        if (cancelled) return;
        await fetch(`${BACKEND_URL}/api/chats/${encodeURIComponent(conversationId)}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            eventType: "note.form_opened",
            actionId: crypto.randomUUID(),
            expectedContextVersion: ctx?.version,
          }),
        });
      } catch {
        // Silencioso: o log de auditoria de abertura nunca deve bloquear a anotação operacional
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, dealContext]);

  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(id);
  }, [autoFocus, conversationId]);

  const adjustHeight = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, compact ? 112 : 144)}px`;
    },
    [compact],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files || []);
    if (droppedFiles.length > 0) {
      setAttachments((prev) => appendUniqueNoteFiles(prev, droppedFiles));
      window.setTimeout(() => textareaRef.current?.focus(), 10);
    }
  }, []);

  const handlePasteOnInput = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedFiles = extractFilesFromClipboard(e.clipboardData);
    if (pastedFiles.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    setAttachments((prev) => appendUniqueNoteFiles(prev, pastedFiles));
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setAttachments((prev) => appendUniqueNoteFiles(prev, selectedFiles));
      window.setTimeout(() => textareaRef.current?.focus(), 10);
    }
    e.target.value = "";
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = noteText.trim();
    const currentAttachments = attachments.length > 0 ? [...attachments] : undefined;
    if (
      (!trimmed && !currentAttachments?.length) ||
      saving ||
      !conversationId ||
      conversationId === "valentina"
    ) {
      textareaRef.current?.focus();
      return;
    }
    if (!tenant) {
      toast.error("Sessão inválida. Recarregue a página.");
      return;
    }

    setSaving(true);
    try {
      const latestCtx = (await dealContext.refresh()) ?? dealContext.data;
      const hasLinkedActiveOrGraceDeal = Boolean(
        latestCtx?.hasCurrentDeal || latestCtx?.gracePeriodActive,
      );
      const effectiveNoteScope: "current" | "general" = hasLinkedActiveOrGraceDeal
        ? "current"
        : "general";

      const ok = await sendMessage(trimmed, true, currentAttachments, null, undefined, {
        id: crypto.randomUUID(),
        conversationId,
        tenantId: tenant,
        expectedContextVersion: latestCtx?.version,
        noteScope: effectiveNoteScope,
      });

      if (!ok) return;

      setNoteText("");
      setAttachments([]);
      transientNoteDraftCache.delete(conversationId);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      window.dispatchEvent(new Event("crm-deals-changed"));
      window.dispatchEvent(new Event("chat:reconnected"));
      toast.success("Anotação interna registrada.");
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [noteText, attachments, saving, conversationId, tenant, dealContext, sendMessage, onSaved]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSave();
      return;
    }
    if (e.key === "Escape" && onClose) {
      e.preventDefault();
      onClose();
    }
  };

  const renderFileIcon = (file: File) => {
    const mime = file.type || "";
    if (mime.startsWith("image/")) return <ImageIcon className="h-4 w-4 text-amber-500" />;
    if (mime.startsWith("video/")) return <Film className="h-4 w-4 text-amber-500" />;
    if (mime.startsWith("audio/")) return <Music className="h-4 w-4 text-amber-500" />;
    return <FileText className="h-4 w-4 text-amber-500" />;
  };

  const activeDealTitle =
    dealContext.data?.currentDeal?.title || dealContext.data?.graceDeal?.title || null;
  const canSave = (Boolean(noteText.trim()) || attachments.length > 0) && !saving;

  return (
    <div
      ref={containerRef}
      data-inline-chat-note-composer="true"
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative rounded-xl border bg-amber-500/[0.06] dark:bg-amber-500/[0.1] shadow-xs transition-all ${
        isDraggingOver
          ? "border-amber-500 ring-2 ring-amber-500/35 bg-amber-500/[0.14]"
          : "border-amber-500/35"
      } ${compact ? "p-2.5 space-y-2" : "p-3 md:p-3.5 space-y-2.5"}`}
    >
      {isDraggingOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-amber-500 bg-background/90 backdrop-blur-xs pointer-events-none px-3 text-center">
          <Paperclip className="h-4 w-4 shrink-0 text-amber-500 animate-bounce" />
          <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
            Solte os arquivos aqui para anexar à Anotação Interna
          </span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>Anotação Interna</span>
          </span>
          <span className="text-[11px] text-muted-foreground">
            Visível apenas para a equipe · Não envia ao cliente
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {activeDealTitle ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-background/80 px-2 py-0.5 text-[10px] font-semibold text-foreground max-w-[200px]">
              <Briefcase className="h-3 w-3 shrink-0 text-amber-500" />
              <span className="truncate">{activeDealTitle}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0 text-amber-500" />
              <span>Vínculo pendente ao card</span>
            </span>
          )}

          {onClose && (
            <SystemTooltip content="Fechar anotação">
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar anotação"
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background/80 hover:text-foreground transition cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
          )}
        </div>
      </div>

      {attachments.length > 0 && (
        <div
          data-inline-note-attachments="true"
          className="flex flex-wrap gap-2 pt-0.5"
        >
          {attachments.map((file, idx) => (
            <div
              key={`${fileDedupKey(file)}-${idx}`}
              className="group relative flex items-center gap-2 rounded-lg border border-amber-500/35 bg-background/90 px-2.5 py-1.5 max-w-[220px] shadow-2xs"
            >
              {file.type.startsWith("image/") && previewUrls[idx] ? (
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border/60 bg-black/5">
                  <img
                    src={previewUrls[idx]!}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-amber-500/10 border border-amber-500/20">
                  {renderFileIcon(file)}
                </div>
              )}
              <div className="min-w-0 flex-1 pr-1">
                <p className="truncate text-[11px] font-semibold text-foreground">
                  {file.name}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {formatNoteFileSize(file.size)}
                </p>
              </div>
              <SystemTooltip content="Remover anexo">
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  disabled={saving}
                  aria-label={`Remover ${file.name}`}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </SystemTooltip>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 rounded-lg border border-amber-500/30 bg-background/95 px-2.5 py-2 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500/25 transition">
        <SystemTooltip content="Anexar arquivo ou imagem (também aceita Ctrl+V ou arrastar e soltar)">
          <button
            type="button"
            data-attach-inline-note="true"
            disabled={saving}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Anexar arquivo à anotação interna"
            className={`relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition cursor-pointer ${
              attachments.length > 0
                ? "border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "border-transparent text-muted-foreground hover:bg-muted/70 hover:text-amber-600 dark:hover:text-amber-400"
            }`}
          >
            <Paperclip className="h-4 w-4" />
            {attachments.length > 0 && (
              <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9px] font-extrabold text-white">
                {attachments.length}
              </span>
            )}
          </button>
        </SystemTooltip>

        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={(e) => {
            setNoteText(e.target.value);
            adjustHeight(e.target);
          }}
          onPaste={handlePasteOnInput}
          onKeyDown={handleKeyDown}
          disabled={saving}
          rows={1}
          placeholder={
            compact
              ? "Escreva, cole (Ctrl+V) ou arraste arquivos..."
              : "Escreva uma anotação, cole (Ctrl+V) ou arraste arquivos aqui (Enter para salvar)..."
          }
          aria-label="Escrever anotação interna"
          className={`flex-1 resize-none bg-transparent text-xs text-foreground placeholder:text-muted-foreground/75 focus:outline-none leading-relaxed ${
            compact ? "min-h-[28px] max-h-28 py-0.5" : "min-h-[32px] max-h-36 py-1"
          }`}
        />

        <SystemTooltip content="Salvar anotação interna (Enter)">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSave()}
            disabled={!canSave}
            data-save-inline-note="true"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-45 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition cursor-pointer shrink-0"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
            <span>{saving ? "Salvando..." : "Salvar"}</span>
          </button>
        </SystemTooltip>
      </div>
    </div>
  );
};
