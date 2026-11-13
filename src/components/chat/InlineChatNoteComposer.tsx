import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Briefcase, Clock, Loader2, Lock, X } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useChat } from "@/hooks/useChatState";
import { useConversationDealContext } from "@/components/crm/ConversationDealContext";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

const transientNoteDraftCache = new Map<string, string>();

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
    () => (conversationId ? transientNoteDraftCache.get(conversationId) : undefined) ?? "",
  );
  const [saving, setSaving] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevConvIdRef = useRef<string>(conversationId);
  const openedForConvRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevConvIdRef.current !== conversationId) {
      prevConvIdRef.current = conversationId;
      setNoteText((conversationId ? transientNoteDraftCache.get(conversationId) : undefined) ?? "");
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    if (noteText) {
      transientNoteDraftCache.set(conversationId, noteText);
    } else {
      transientNoteDraftCache.delete(conversationId);
    }
  }, [conversationId, noteText]);

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

  const adjustHeight = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 112 : 144)}px`;
  }, [compact]);

  const handleSave = useCallback(async () => {
    const trimmed = noteText.trim();
    if (!trimmed || saving || !conversationId || conversationId === "valentina") {
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

      const ok = await sendMessage(trimmed, true, undefined, null, undefined, {
        id: crypto.randomUUID(),
        conversationId,
        tenantId: tenant,
        expectedContextVersion: latestCtx?.version,
        noteScope: effectiveNoteScope,
      });

      if (!ok) return;

      setNoteText("");
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
  }, [noteText, saving, conversationId, tenant, dealContext, sendMessage, onSaved]);

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

  const activeDealTitle =
    dealContext.data?.currentDeal?.title || dealContext.data?.graceDeal?.title || null;

  return (
    <div
      data-inline-chat-note-composer="true"
      className={`rounded-xl border border-amber-500/35 bg-amber-500/[0.06] dark:bg-amber-500/[0.1] shadow-xs transition-all ${
        compact ? "p-2.5 space-y-2" : "p-3 md:p-3.5 space-y-2.5"
      }`}
    >
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

      <div className="flex items-end gap-2 rounded-lg border border-amber-500/30 bg-background/95 px-3 py-2 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500/25 transition">
        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={(e) => {
            setNoteText(e.target.value);
            adjustHeight(e.target);
          }}
          onKeyDown={handleKeyDown}
          disabled={saving}
          rows={1}
          placeholder="Escreva uma anotação interna sobre este atendimento (Enter para salvar)..."
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
            disabled={!noteText.trim() || saving}
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
