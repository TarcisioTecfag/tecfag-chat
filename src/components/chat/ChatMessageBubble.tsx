import React, { memo } from "react";
import { motion } from "framer-motion";
import {
  Smile,
  Bookmark,
  CornerUpLeft,
  Lock,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { MessageReactionPicker } from "./MessageReactionPicker";
import { MessageReactions } from "./MessageReactions";
import { MessageStatusTicks } from "./MessageStatusTicks";
import { Message } from "@/lib/mockData";
import {
  renderTextWithLinks,
  renderMessageContent,
  isEmojiOnly,
  getFriendlyQuotedContent,
} from "./ChatPanel";

export interface ChatMessageBubbleProps {
  m: Message;
  prevLinked: boolean;
  nextLinked: boolean;
  isFirst: boolean;
  isLast: boolean;
  gap: string;
  dateLabel: string | null;
  isMe: boolean;
  isSystem: boolean;
  isExpanded: boolean;
  isMatch: boolean;
  displayQuotedContent: string | null;
  displayQuotedSender: string;
  quotedTargetId: string | null;
  activeChat: {
    id: string;
    name: string;
    avatar?: string;
    initials?: string;
  };
  aiPersona: {
    name: string;
    avatarUrl: string;
  };
  tenant: string;
  reactingMsgId: string | null;
  effectiveStatus?: string;
  effectiveError?: string | null;
  onBubbleClick: (e: React.MouseEvent, id: string) => void;
  onScrollToQuoted: (e: React.MouseEvent, targetId: string) => void;
  onSetReactingMsgId: (id: string | null) => void;
  onSetMarkingEvidenceMsg: (msg: { id: string; text: string; author: string; time: string }) => void;
  onSetReplyingTo: (msg: Message) => void;
  onToggleReaction: (chatId: string, msgId: string, emoji: string) => void;
  onMediaClick?: (type: "image" | "video", url: string) => void;
  onSaveSticker?: (messageId: string, url: string) => void;
  onOpenWarningChat?: (clientId: string) => void;
  onSendWelcomeSuggestion?: (text: string) => void;
}

function ChatMessageBubbleComponent({
  m,
  isFirst,
  isLast,
  gap,
  dateLabel,
  isMe,
  isSystem,
  isExpanded,
  isMatch,
  displayQuotedContent,
  displayQuotedSender,
  quotedTargetId,
  activeChat,
  aiPersona,
  tenant,
  reactingMsgId,
  effectiveStatus,
  effectiveError,
  onBubbleClick,
  onScrollToQuoted,
  onSetReactingMsgId,
  onSetMarkingEvidenceMsg,
  onSetReplyingTo,
  onToggleReaction,
  onMediaClick,
  onSaveSticker,
  onOpenWarningChat,
  onSendWelcomeSuggestion,
}: ChatMessageBubbleProps) {
  // ── 1. Mensagens de Sistema ──
  if (isSystem) {
    return (
      <div key={m.clientMessageId || m.id} className="w-full">
        {dateLabel && (
          <div className="flex justify-center my-3 select-none">
            <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
              {dateLabel}
            </span>
          </div>
        )}
        <div className={`flex justify-center ${gap} my-2`}>
          <span className="rounded-full bg-muted px-4 py-1 text-[10px] font-semibold text-muted-foreground uppercase border border-border">
            {renderTextWithLinks(m.text)} — {m.time}
          </span>
        </div>
      </div>
    );
  }

  // ── 2. Notas Internas ──
  if (m.isInternalNote) {
    return (
      <div key={m.clientMessageId || m.id} className="w-full">
        {dateLabel && (
          <div className="flex justify-center my-3 select-none">
            <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
              {dateLabel}
            </span>
          </div>
        )}
        <div className={`flex flex-col items-center ${gap} w-full`}>
          <div className="max-w-[85%] rounded-2xl border border-amber-500/20 bg-amber-500/10 dark:bg-amber-950/40 dark:border-amber-500/30 px-5 py-3 shadow-soft text-left">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase mb-1.5 text-amber-600 dark:text-amber-400">
              <Lock className="h-3 w-3 shrink-0" />
              Anotação Interna — {m.author} às {m.time}
            </div>
            <p className="text-xs leading-relaxed font-medium text-amber-950 dark:text-amber-200">
              {renderTextWithLinks(m.text, false, true)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isSticker = m.text.startsWith("[MEDIA:sticker]") || m.text.startsWith("[LOCAL_MEDIA:sticker]");
  const isMedia = m.text.startsWith("[MEDIA:") || m.text.startsWith("[LOCAL_MEDIA:");
  const hasCaption = isMedia && m.text.includes("\n") && m.text.split("\n").slice(1).join("\n").trim().length > 0;
  const isAudioOrDoc =
    m.text.startsWith("[MEDIA:audio]") ||
    m.text.startsWith("[LOCAL_MEDIA:audio]") ||
    m.text.startsWith("[MEDIA:document]") ||
    m.text.startsWith("[LOCAL_MEDIA:document]");

  // Border-radius por posição no grupo (estilo WhatsApp)
  const outR =
    isFirst && isLast
      ? "rounded-2xl"
      : isFirst
      ? "rounded-2xl rounded-br-[5px]"
      : isLast
      ? "rounded-2xl rounded-tr-[5px]"
      : "rounded-lg rounded-r-[5px]";

  const inR =
    isFirst && isLast
      ? "rounded-2xl"
      : isFirst
      ? "rounded-2xl rounded-bl-[5px]"
      : isLast
      ? "rounded-2xl rounded-tl-[5px]"
      : "rounded-lg rounded-l-[5px]";

  // ── 3. Mensagens Enviadas (Operador / Empresa) ──
  if (isMe) {
    return (
      <div key={m.clientMessageId || m.id} className="w-full">
        {dateLabel && (
          <div className="flex justify-center my-3 select-none">
            <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
              {dateLabel}
            </span>
          </div>
        )}
        <motion.div
          id={`msg-dom-${m.id}`}
          initial={{ opacity: 0, x: 18, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className={`flex flex-col items-end group relative w-full ${gap}`}
        >
          <div className="flex items-center gap-2 max-w-[80%] justify-end relative">
            <SystemTooltip content="Reagir">
              <button
                type="button"
                onClick={() => onSetReactingMsgId(reactingMsgId === m.id ? null : m.id)}
                className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0 ${
                  reactingMsgId === m.id ? "!opacity-100 bg-muted text-foreground" : ""
                }`}
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <SystemTooltip content="Marcar como evidência do negócio">
              <button
                type="button"
                onClick={() => onSetMarkingEvidenceMsg({ id: m.id, text: m.text, author: m.author, time: m.time })}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-amber-500 transition-all duration-150 cursor-pointer shrink-0"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <SystemTooltip content="Responder">
              <button
                type="button"
                onClick={() => onSetReplyingTo(m)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>

            {isSticker ? (
              <div className="leading-relaxed">
                {displayQuotedContent && (
                  <div
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                    className="mb-1 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                  >
                    <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                    <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                  </div>
                )}
                {renderMessageContent(m.text, onMediaClick, true, onSaveSticker, m.author, activeChat.name)}
              </div>
            ) : isAudioOrDoc ? (
              <div className="flex flex-col items-end gap-1.5">
                {displayQuotedContent && (
                  <div
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                    className="mb-0.5 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                  >
                    <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                    <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                  </div>
                )}
                {renderMessageContent(m.text, onMediaClick, true, undefined, m.author, activeChat.name)}
              </div>
            ) : isMedia && !hasCaption && !displayQuotedContent ? (
              <div>{renderMessageContent(m.text, onMediaClick, true, undefined, m.author, activeChat.name)}</div>
            ) : isEmojiOnly(m.text) && !displayQuotedContent ? (
              <div className="text-4xl leading-none select-none py-1">{m.text}</div>
            ) : (
              <div
                onClick={(e) => onBubbleClick(e, m.id)}
                className={`${outR} px-4 py-2.5 text-sm leading-relaxed shadow-soft bg-primary text-primary-foreground text-left cursor-pointer transition-all duration-300 ${
                  isMatch ? "scale-[1.01] shadow-lg" : ""
                }`}
                style={{
                  outline: isMatch ? "3px solid var(--primary)" : undefined,
                  outlineOffset: isMatch ? "2px" : undefined,
                }}
              >
                {displayQuotedContent && (
                  <div
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                    className="mb-1.5 rounded-lg border-l-4 border-l-white/60 bg-white/10 px-2.5 py-1.5 text-[11px] text-white/95 select-none max-w-full cursor-pointer hover:bg-white/20 transition"
                  >
                    <div className="font-bold text-[10px] mb-0.5 opacity-90">{displayQuotedSender}</div>
                    <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                  </div>
                )}
                {renderMessageContent(m.text, onMediaClick, true, undefined, m.author, activeChat.name)}
              </div>
            )}

            {reactingMsgId === m.id && (
              <MessageReactionPicker
                activeEmoji={m.reactions?.find((r) => r.from === "operator")?.emoji || null}
                side="out"
                onSelectEmoji={(emoji) => onToggleReaction(activeChat.id, m.id, emoji)}
                onClose={() => onSetReactingMsgId(null)}
              />
            )}
          </div>

          <MessageReactions
            reactions={m.reactions}
            side="out"
            onReactionClick={() => onToggleReaction(activeChat.id, m.id, "")}
          />

          {(() => {
            const hasTicks = m.provider === "meta" && !m.isInternalNote && !!effectiveStatus;
            const showTicks = hasTicks && (isLast || isExpanded || effectiveStatus === "failed");
            if (!isExpanded && !showTicks) return null;
            return (
              <span className="mr-1 mt-1 flex items-center gap-1 text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
                {isExpanded && <span>{m.author} · {m.time}</span>}
                {showTicks && <MessageStatusTicks status={effectiveStatus} error={effectiveError} />}
              </span>
            );
          })()}
        </motion.div>
      </div>
    );
  }

  // ── 4. Mensagens Recebidas (Cliente / Valentina IA) ──
  return (
    <div key={m.clientMessageId || m.id} className="w-full">
      {dateLabel && (
        <div className="flex justify-center my-3 select-none">
          <span className="rounded-full bg-muted/80 dark:bg-muted/50 px-4 py-1 text-[11px] font-bold text-muted-foreground/90 border border-border/60 shadow-2xs">
            {dateLabel}
          </span>
        </div>
      )}
      <motion.div
        id={`msg-dom-${m.id}`}
        initial={{ opacity: 0, x: -18, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        className={`flex items-end gap-2 group relative w-full ${gap}`}
      >
        {/* Avatar — só na última mensagem do grupo */}
        {isLast ? (
          activeChat.id === "valentina" ? (
            <AiAvatar
              tenantId={tenant}
              className="h-7 w-7 shrink-0 rounded-full border border-border self-end cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => onMediaClick && onMediaClick("image", aiPersona.avatarUrl)}
            />
          ) : activeChat.avatar ? (
            <img
              src={activeChat.avatar}
              alt=""
              className="h-7 w-7 shrink-0 rounded-full object-cover border border-border self-end cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => onMediaClick && onMediaClick("image", activeChat.avatar!)}
            />
          ) : (
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 self-end">
              {activeChat.initials || "U"}
            </div>
          )
        ) : (
          <div className="w-7 shrink-0" />
        )}

        <div className="min-w-0 max-w-[80%] flex-1">
          <div className="flex items-center gap-2 relative">
            {isSticker ? (
              <div className="leading-relaxed">
                {displayQuotedContent && (
                  <div
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                    className="mb-1 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                  >
                    <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                    <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                  </div>
                )}
                {renderMessageContent(m.text, onMediaClick, false, onSaveSticker, m.author, activeChat.name)}
              </div>
            ) : isAudioOrDoc && !m.isWarning ? (
              <div className="flex flex-col items-start gap-1.5">
                {displayQuotedContent && (
                  <div
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                    className="mb-0.5 rounded-lg border-l-4 border-l-primary bg-card/90 border border-border/80 px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-card transition shadow-xs"
                  >
                    <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                    <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                  </div>
                )}
                {renderMessageContent(m.text, onMediaClick, false, undefined, m.author, activeChat.name)}
              </div>
            ) : isMedia && !hasCaption && !displayQuotedContent && !m.isWarning ? (
              <div>{renderMessageContent(m.text, onMediaClick, false, undefined, m.author, activeChat.name)}</div>
            ) : isEmojiOnly(m.text) && !displayQuotedContent && !m.isWarning ? (
              <div className="text-4xl leading-none select-none py-1">{m.text}</div>
            ) : (
              <div
                onClick={(e) => onBubbleClick(e, m.id)}
                className={`${inR} ${
                  m.isWarning
                    ? "bg-emerald-500/5 border-emerald-500/10 dark:bg-emerald-950/15 dark:border-emerald-900/30 border-l-4 border-l-primary text-foreground text-[11px]"
                    : "bg-card border-border text-foreground text-sm"
                } border px-4 py-2.5 leading-relaxed shadow-soft text-left cursor-pointer transition-all duration-300 ${
                  isMatch ? "scale-[1.01] shadow-lg" : ""
                }`}
                style={{
                  outline: isMatch ? "3px solid var(--primary)" : undefined,
                  outlineOffset: isMatch ? "2px" : undefined,
                }}
              >
                {m.isWarning && (
                  <div className="flex items-center gap-1.5 text-[9px] font-black uppercase text-primary mb-1 select-none">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    Aviso de {aiPersona.name}
                  </div>
                )}
                {displayQuotedContent && (
                  <div
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                    className="mb-1.5 rounded-lg border-l-4 border-l-primary bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground select-none max-w-full cursor-pointer hover:bg-muted/80 transition"
                  >
                    <div className="font-bold text-[10px] mb-0.5 text-primary">{displayQuotedSender}</div>
                    <div className="truncate font-medium">{getFriendlyQuotedContent(displayQuotedContent)}</div>
                  </div>
                )}
                {renderMessageContent(m.text, onMediaClick, false, undefined, m.author, activeChat.name)}

                {/* Card interativo: Atraso de Resposta */}
                {m.isWarning && m.warningType === "delay" && m.warningMetadata && (
                  <div
                    className="mt-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[11px] font-bold text-foreground">
                      Cliente: <span className="text-primary font-black">{m.warningMetadata.clientName}</span>
                    </div>
                    {m.warningMetadata.lastMessage && (
                      <div className="p-2 rounded-lg bg-muted/65 text-[10px] text-muted-foreground border-l-2 border-primary italic">
                        "{m.warningMetadata.lastMessage}"
                      </div>
                    )}
                    {onOpenWarningChat && (
                      <button
                        type="button"
                        onClick={() => onOpenWarningChat(m.warningMetadata!.clientId)}
                        className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                      >
                        <span>Abrir Conversa</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Card interativo: Novo Cliente (Lead) */}
                {m.isWarning && m.warningType === "new_lead" && m.warningMetadata && (
                  <div
                    className="mt-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[11px] font-bold text-foreground flex items-center justify-between gap-2">
                      <span>
                        Cliente: <span className="text-primary font-black">{m.warningMetadata.clientName}</span>
                      </span>
                      {m.warningMetadata.temperature && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wider ${
                            m.warningMetadata.temperature === "quente"
                              ? "bg-red-500/10 text-red-500 border border-red-500/25"
                              : m.warningMetadata.temperature === "morno"
                              ? "bg-amber-500/10 text-amber-500 border border-amber-500/25"
                              : "bg-blue-500/10 text-blue-500 border border-blue-500/25"
                          }`}
                        >
                          {m.warningMetadata.temperature}
                        </span>
                      )}
                    </div>
                    {m.warningMetadata.interest && (
                      <div className="text-[10px] text-muted-foreground flex flex-col gap-0.5 bg-muted/40 p-2 rounded-lg">
                        <span className="font-semibold text-foreground text-[8px] uppercase tracking-wider text-muted-foreground">
                          Interesse:
                        </span>
                        <span>{m.warningMetadata.interest}</span>
                      </div>
                    )}
                    {onOpenWarningChat && (
                      <button
                        type="button"
                        onClick={() => onOpenWarningChat(m.warningMetadata!.clientId)}
                        className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                      >
                        <span>Abrir Atendimento</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <SystemTooltip content="Responder">
              <button
                type="button"
                onClick={() => onSetReplyingTo(m)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0"
              >
                <CornerUpLeft className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <SystemTooltip content="Reagir">
              <button
                type="button"
                onClick={() => onSetReactingMsgId(reactingMsgId === m.id ? null : m.id)}
                className={`opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-all duration-150 cursor-pointer shrink-0 ${
                  reactingMsgId === m.id ? "!opacity-100 bg-muted text-foreground" : ""
                }`}
              >
                <Smile className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>
            <SystemTooltip content="Marcar como evidência do negócio">
              <button
                type="button"
                onClick={() => onSetMarkingEvidenceMsg({ id: m.id, text: m.text, author: m.author, time: m.time })}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-amber-500 transition-all duration-150 cursor-pointer shrink-0"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
            </SystemTooltip>

            {reactingMsgId === m.id && (
              <MessageReactionPicker
                activeEmoji={m.reactions?.find((r) => r.from === "operator")?.emoji || null}
                side="in"
                onSelectEmoji={(emoji) => onToggleReaction(activeChat.id, m.id, emoji)}
                onClose={() => onSetReactingMsgId(null)}
              />
            )}
          </div>

          <MessageReactions
            reactions={m.reactions}
            side="in"
            onReactionClick={() => onToggleReaction(activeChat.id, m.id, "")}
          />

          {/* Sugestões dinâmicas para mensagem de boas-vindas da IA */}
          {m.id === "val_welcome" && (
            <div className="mt-2.5 flex flex-col gap-1.5 max-w-sm">
              {(aiPersona.name === "Fagner"
                ? [
                    "Quantos atendimentos tenho pendentes?",
                    "Como estão os prazos de SLA da minha fila?",
                    "Quais são meus chamados abertos hoje?",
                  ]
                : [
                    "Quantos leads tenho sem resposta?",
                    "Quais são meus leads quentes?",
                    "Como está a pontuação atual dos meus atendimentos?",
                  ]
              ).map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSendWelcomeSuggestion && onSendWelcomeSuggestion(q)}
                  className="text-left text-[11px] font-semibold text-primary hover:text-primary-foreground bg-primary/5 hover:bg-primary border border-primary/20 hover:border-primary px-3 py-2 rounded-xl transition duration-150 shadow-soft cursor-pointer flex items-center justify-between group/btn w-full"
                >
                  <span>{q}</span>
                  <ArrowRight className="h-3 w-3 opacity-60 group-hover/btn:translate-x-0.5 group-hover/btn:opacity-100 transition-all shrink-0 ml-2" />
                </button>
              ))}
            </div>
          )}

          {isExpanded && (
            <span className="ml-1 mt-1 block text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
              {m.author} · {m.time}
            </span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Componente Memoizado de Alta Performance:
 * Garante que a digitação na caixa de texto, atualizações de áudio ou re-renders
 * do painel principal NÃO provoquem re-renders em cascata dos balões do histórico.
 */
export const ChatMessageBubble = memo(
  ChatMessageBubbleComponent,
  (prev, next) => {
    // Retorna true se as props forem equivalentes (PULA O RENDER)
    if (prev.m !== next.m) return false;
    if (prev.isExpanded !== next.isExpanded) return false;
    if (prev.isMatch !== next.isMatch) return false;
    if (prev.isFirst !== next.isFirst || prev.isLast !== next.isLast) return false;
    if (prev.prevLinked !== next.prevLinked || prev.nextLinked !== next.nextLinked) return false;
    if (prev.gap !== next.gap || prev.dateLabel !== next.dateLabel) return false;
    if (prev.effectiveStatus !== next.effectiveStatus || prev.effectiveError !== next.effectiveError) return false;
    if (
      prev.reactingMsgId !== next.reactingMsgId &&
      (prev.reactingMsgId === prev.m.id || next.reactingMsgId === next.m.id)
    ) {
      return false;
    }
    if (prev.displayQuotedContent !== next.displayQuotedContent) return false;
    if (prev.activeChat.id !== next.activeChat.id) return false;

    return true; // Pula re-renderização com segurança!
  }
);
