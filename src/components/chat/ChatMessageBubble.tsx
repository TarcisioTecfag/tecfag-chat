import React, { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Smile,
  Bookmark,
  Briefcase,
  CornerUpLeft,
  Lock,
  AlertCircle,
  ArrowRight,
  Clock,
  MessageSquare,
  PhoneCall,
  UserCheck,
  Users,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { stripNotificationEmojis } from "@/lib/format-notification-text";
import { MessageReactionPicker } from "./MessageReactionPicker";
import { MessageReactions } from "./MessageReactions";
import { MessageStatusTicks } from "./MessageStatusTicks";
import { SystemAnnotationBubble } from "./SystemAnnotationBubble";
import { AgenticThoughtTrace } from "@/components/valentina/chat-blocks/AgenticThoughtTrace";
import { Message } from "@/lib/mockData";
import {
  renderTextWithLinks,
  renderMessageContent,
  isEmojiOnly,
  QuotedMessagePreview,
} from "./ChatPanel";

function getVigosPhoneLink(phone?: string | null): string {
  if (!phone) return "#";
  let n = phone.replace(/\D/g, "");
  if (n.startsWith("55") && n.length > 10) n = n.substring(2);
  if (n.startsWith("0")) n = n.substring(1);
  if (n.startsWith("14")) n = n.substring(2);
  return `tel:${n}`;
}

function formatDisplayPhone(phone?: string | null): string {
  if (!phone) return "";
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

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
  onReconcile?: (id: string, action: "resend" | "confirm_sent", uncertain: boolean) => void;
  onBubbleClick: (e: React.MouseEvent, id: string) => void;
  onScrollToQuoted: (e: React.MouseEvent, targetId: string) => void;
  onSetReactingMsgId: (id: string | null) => void;
  onSetMarkingEvidenceMsg: (msg: {
    id: string;
    text: string;
    author: string;
    time: string;
  }) => void;
  onSetReplyingTo: (msg: Message) => void;
  onToggleReaction: (chatId: string, msgId: string, emoji: string) => void;
  onMediaClick?: (type: "image" | "video", url: string) => void;
  onSaveSticker?: (messageId: string, url: string) => void;
  onOpenWarningChat?: (clientId: string, clientName?: string) => void;
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
  onReconcile,
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
  const navigate = useNavigate();
  // ── 1. Mensagens de Sistema (ocultas por padrão no ícone ? discreto) ──
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
        <SystemAnnotationBubble
          text={m.text}
          time={m.time}
          gap={gap}
          renderText={(val) => renderTextWithLinks(val)}
        />
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
                onClick={() =>
                  onSetMarkingEvidenceMsg({
                    id: m.id,
                    text: m.text,
                    author: m.author,
                    time: m.time,
                  })
                }
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
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-1"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  true,
                  onSaveSticker,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isAudioOrDoc ? (
              <div className="flex flex-col items-end gap-1.5">
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-0.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  true,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isMedia && !hasCaption && !displayQuotedContent ? (
              <div>
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  true,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
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
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="outgoing"
                    className="mb-1.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  true,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
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
          {["failed", "unknown", "uncertain", "pending"].includes(effectiveStatus || "") && (
            <div className="text-xs mt-2 space-x-3">
              <span>
                {effectiveStatus === "pending"
                  ? "Na fila de envio"
                  : effectiveStatus === "failed"
                    ? "Falha no envio"
                    : "Resultado do envio desconhecido"}
              </span>
              {effectiveError && <p>{effectiveError}</p>}
              {effectiveStatus !== "pending" && onReconcile && (
                <>
                  <button
                    className="underline"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReconcile(m.id, "resend", effectiveStatus !== "failed");
                    }}
                  >
                    Reenviar
                  </button>
                  {effectiveStatus !== "failed" && (
                    <button
                      className="underline"
                      onClick={(event) => {
                        event.stopPropagation();
                        onReconcile(m.id, "confirm_sent", true);
                      }}
                    >
                      Já foi enviado
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {(() => {
            const hasTicks = m.provider === "meta" && !m.isInternalNote && !!effectiveStatus;
            const showTicks = hasTicks && (isLast || isExpanded || effectiveStatus === "failed");
            if (!isExpanded && !showTicks) return null;
            return (
              <span className="mr-1 mt-1 flex items-center gap-1 text-[10px] text-muted-foreground font-medium animate-in fade-in slide-in-from-top-1 duration-150">
                {isExpanded && (
                  <span>
                    {m.author} · {m.time}
                  </span>
                )}
                {showTicks && (
                  <MessageStatusTicks status={effectiveStatus} error={effectiveError} />
                )}
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
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-1"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  false,
                  onSaveSticker,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isAudioOrDoc && !m.isWarning ? (
              <div className="flex flex-col items-start gap-1.5">
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="card"
                    className="mb-0.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  false,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isMedia && !hasCaption && !displayQuotedContent && !m.isWarning ? (
              <div>
                {renderMessageContent(
                  m.text,
                  onMediaClick,
                  false,
                  undefined,
                  m.author,
                  activeChat.name,
                )}
              </div>
            ) : isEmojiOnly(m.text) && !displayQuotedContent && !m.isWarning ? (
              <div className="text-4xl leading-none select-none py-1">{m.text}</div>
            ) : (
              <div
                onClick={(e) => onBubbleClick(e, m.id)}
                className={`${inR} ${
                  m.isWarning
                    ? `bg-card border-border border-l-4 ${
                        m.warningType === "delay"
                          ? "border-l-amber-500"
                          : m.warningType === "overload"
                          ? "border-l-violet-500"
                          : "border-l-primary"
                      } text-foreground text-[11px]`
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
                  <div
                    className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider mb-1.5 select-none ${
                      m.warningType === "delay"
                        ? "text-amber-600 dark:text-amber-400"
                        : m.warningType === "overload"
                        ? "text-violet-600 dark:text-violet-400"
                        : "text-primary"
                    }`}
                  >
                    {m.warningType === "delay" ? (
                      <Clock className="h-3 w-3 shrink-0" />
                    ) : m.warningType === "new_lead" ? (
                      <UserCheck className="h-3 w-3 shrink-0" />
                    ) : m.warningType === "overload" ? (
                      <Users className="h-3 w-3 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3 w-3 shrink-0" />
                    )}
                    <span>
                      {m.warningType === "delay"
                        ? `Alerta de SLA · ${aiPersona.name}`
                        : m.warningType === "new_lead"
                        ? `Novo Lead · ${aiPersona.name}`
                        : m.warningType === "overload"
                        ? `Atendimentos Ativos · ${aiPersona.name}`
                        : `Aviso de ${aiPersona.name}`}
                    </span>
                  </div>
                )}
                {activeChat.id === "valentina" && m.thoughtTrace && (
                  <AgenticThoughtTrace
                    trace={m.thoughtTrace}
                    mode="completed"
                  />
                )}
                {displayQuotedContent && (
                  <QuotedMessagePreview
                    sender={displayQuotedSender}
                    content={displayQuotedContent}
                    variant="incoming"
                    className="mb-1.5"
                    onClick={(e) => quotedTargetId && onScrollToQuoted(e, quotedTargetId)}
                  />
                )}
                {renderMessageContent(
                  m.isWarning ? stripNotificationEmojis(m.text) : m.text,
                  onMediaClick,
                  false,
                  undefined,
                  m.author,
                  activeChat.name,
                )}

                {/* Card interativo: Atraso de Resposta */}
                {m.isWarning && m.warningType === "delay" && m.warningMetadata && (
                  <div
                    className="mt-2.5 p-3 rounded-xl bg-card border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[11px] font-bold text-foreground">
                      Cliente:{" "}
                      <span className="text-primary font-black">
                        {m.warningMetadata.clientName}
                      </span>
                    </div>
                    {m.warningMetadata.lastMessage && (
                      <div className="p-2 rounded-lg bg-muted/65 text-[10px] text-muted-foreground border-l-2 border-primary italic">
                        "{m.warningMetadata.lastMessage}"
                      </div>
                    )}
                    {onOpenWarningChat &&
                      (m.warningMetadata.clientId || m.warningMetadata.clientName) && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenWarningChat(
                              m.warningMetadata!.clientId,
                              m.warningMetadata!.clientName,
                            )
                          }
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
                        Cliente:{" "}
                        <span className="text-primary font-black">
                          {m.warningMetadata.clientName}
                        </span>
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
                    {onOpenWarningChat &&
                      (m.warningMetadata.clientId || m.warningMetadata.clientName) && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenWarningChat(
                              m.warningMetadata!.clientId,
                              m.warningMetadata!.clientName,
                            )
                          }
                          className="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                        >
                          <span>Abrir Atendimento</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                  </div>
                )}

                {/* Cards interativos unificados e sem duplicidade (CRM / VigosPhone / Conversas) */}
                {(() => {
                  const dealsList = m.relatedDeals || [];
                  const dealIdsSet = new Set(dealsList.map((d) => d.dealId).filter(Boolean));
                  const dealConvIdsSet = new Set(
                    dealsList.map((d) => d.conversationId).filter(Boolean) as string[]
                  );
                  const dealPhonesSet = new Set(
                    dealsList
                      .map((d) => (d.contactPhone || "").replace(/\D/g, "").slice(-8))
                      .filter((p) => p.length >= 8)
                  );
                  const dealNamesSet = new Set(
                    dealsList
                      .flatMap((d) => [d.accountName, d.company, d.contactName])
                      .map((n) => (n || "").trim().toLowerCase())
                      .filter((n) => n.length >= 3)
                  );

                  // Filtra ligações que JÁ possuem card em Negociações do CRM (pois o card do CRM já tem o botão VigosPhone!)
                  const dedupedCalls = (m.relatedCalls || []).filter((c) => {
                    if (c.dealId && dealIdsSet.has(c.dealId)) return false;
                    if (c.conversationId && dealConvIdsSet.has(c.conversationId)) return false;
                    const phoneKey = (c.phone || "").replace(/\D/g, "").slice(-8);
                    if (phoneKey.length >= 8 && dealPhonesSet.has(phoneKey)) return false;
                    const nameKey = (c.clientName || "").trim().toLowerCase();
                    if (nameKey.length >= 3 && dealNamesSet.has(nameKey)) return false;
                    return true;
                  });

                  const callConvIdsSet = new Set(
                    dedupedCalls.map((c) => c.conversationId).filter(Boolean) as string[]
                  );
                  const callPhonesSet = new Set(
                    dedupedCalls
                      .map((c) => (c.phone || "").replace(/\D/g, "").slice(-8))
                      .filter((p) => p.length >= 8)
                  );
                  const callNamesSet = new Set(
                    dedupedCalls
                      .map((c) => (c.clientName || "").trim().toLowerCase())
                      .filter((n) => n.length >= 3)
                  );

                  const rawConvList =
                    m.warningType === "overload" && m.warningMetadata?.conversations?.length
                      ? m.warningMetadata.conversations
                      : m.relatedConversations?.length
                        ? m.relatedConversations
                        : null;

                  // Se não for card de sobrecarga, remove conversas cujo contato JÁ está em Negociações do CRM ou Discagem Direta
                  const dedupedConvs =
                    rawConvList && m.warningType !== "overload"
                      ? rawConvList.filter((conv) => {
                          if (
                            conv.clientId &&
                            (dealConvIdsSet.has(conv.clientId) || callConvIdsSet.has(conv.clientId))
                          ) {
                            return false;
                          }
                          const phoneKey = (conv.clientPhone || "").replace(/\D/g, "").slice(-8);
                          if (
                            phoneKey.length >= 8 &&
                            (dealPhonesSet.has(phoneKey) || callPhonesSet.has(phoneKey))
                          ) {
                            return false;
                          }
                          const nameKey = (conv.clientName || "").trim().toLowerCase();
                          if (
                            nameKey.length >= 3 &&
                            (dealNamesSet.has(nameKey) || callNamesSet.has(nameKey))
                          ) {
                            return false;
                          }
                          return true;
                        })
                      : rawConvList;

                  return (
                    <>
                      {/* 1. Balão/Card interativo: Ligação Direta via VigosPhone (apenas para contatos fora dos cards de CRM) */}
                      {dedupedCalls.length > 0 && (
                        <div
                          className="mt-2.5 p-2.5 rounded-xl bg-emerald-500/10 dark:bg-emerald-950/35 border border-emerald-500/35 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <PhoneCall className="h-3 w-3" />
                              {dedupedCalls.length === 1
                                ? "Discagem Direta • VigosPhone"
                                : `Discagem Direta • VigosPhone (${dedupedCalls.length})`}
                            </span>
                            <span className="text-[9px] font-semibold">Clique para ligar</span>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            {dedupedCalls.map((callItem) => (
                              <a
                                key={callItem.id || callItem.phone}
                                href={getVigosPhoneLink(callItem.phone)}
                                className="group/call p-2 rounded-lg bg-card/95 hover:bg-emerald-500/15 border border-emerald-500/30 hover:border-emerald-500/60 flex items-center justify-between gap-2.5 transition cursor-pointer no-underline"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 group-hover/call:bg-emerald-500 group-hover/call:text-white transition">
                                    <PhoneCall className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[11px] font-bold text-foreground truncate">
                                        {callItem.clientName}
                                      </span>
                                      {callItem.company &&
                                        callItem.company !== callItem.clientName && (
                                          <span className="text-[9px] text-muted-foreground truncate">
                                            • {callItem.company}
                                          </span>
                                        )}
                                    </div>
                                    <div className="text-[10.5px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                      {formatDisplayPhone(callItem.phone)}
                                    </div>
                                    {(callItem.dealTitle || callItem.reason) && (
                                      <div className="text-[9px] text-muted-foreground truncate">
                                        {callItem.dealTitle
                                          ? `${callItem.dealTitle}${callItem.dealValueFormatted ? ` • ${callItem.dealValueFormatted}` : ""}`
                                          : callItem.reason}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 group-hover/call:bg-emerald-500 text-white text-[10px] font-bold shadow-soft transition">
                                  <PhoneCall className="h-3 w-3" />
                                  <span>Ligar</span>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 2. Card interativo unificado: Negociações do CRM (com VigosPhone + Chat + Abrir CRM em 1 único card!) */}
                      {dealsList.length > 0 && (
                        <div
                          className="mt-2.5 p-2.5 rounded-xl bg-card/95 border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Briefcase className="h-3 w-3 text-primary" />
                              {`Negociações do CRM (${dealsList.length})`}
                            </span>
                            <span className="text-[9px] font-semibold text-primary">
                              Ações rápidas
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                            {dealsList.map((deal) => {
                              const formattedVal =
                                deal.valueFormatted ||
                                (deal.value != null && Number(deal.value) > 0
                                  ? Number(deal.value).toLocaleString("pt-BR", {
                                      style: "currency",
                                      currency: "BRL",
                                    })
                                  : null);
                              const stageText =
                                deal.stageLabel ||
                                [deal.pipelineName, deal.stageName].filter(Boolean).join(" › ") ||
                                null;
                              const companyText = deal.company || deal.accountName || null;

                              return (
                                <div
                                  key={deal.dealId}
                                  className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between gap-2.5 transition"
                                >
                                  <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[11px] font-bold text-foreground truncate">
                                        {deal.title}
                                      </span>
                                      {formattedVal && (
                                        <span className="px-1.5 py-0.2 rounded-full text-[8.5px] font-bold bg-primary/15 text-primary border border-primary/30">
                                          {formattedVal}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[9.5px] font-semibold text-muted-foreground truncate">
                                      {[
                                        stageText,
                                        companyText && companyText !== "Sem empresa"
                                          ? companyText
                                          : null,
                                        deal.contactName && deal.contactName !== companyText
                                          ? deal.contactName
                                          : null,
                                        deal.daysIdle && deal.daysIdle >= 3
                                          ? `Parada há ${deal.daysIdle}d`
                                          : null,
                                      ]
                                        .filter(Boolean)
                                        .join(" • ")}
                                    </div>
                                    {deal.contactPhone ? (
                                      <div className="text-[9.5px] font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                        📞 {formatDisplayPhone(deal.contactPhone)}
                                      </div>
                                    ) : (
                                      <div className="text-[9px] text-muted-foreground/80 italic">
                                        Sem telefone vinculado no card
                                      </div>
                                    )}
                                    {deal.lastActivitySummary && (
                                      <div className="text-[9.5px] text-muted-foreground truncate italic">
                                        "{deal.lastActivitySummary}"
                                      </div>
                                    )}
                                  </div>
                                  <div className="shrink-0 flex items-center gap-1">
                                    {deal.contactPhone && (
                                      <a
                                        href={getVigosPhoneLink(deal.contactPhone)}
                                        title={`Ligar para ${formatDisplayPhone(deal.contactPhone)} via VigosPhone`}
                                        className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 hover:bg-emerald-600 text-emerald-600 dark:text-emerald-400 hover:text-white border border-emerald-500/30 transition cursor-pointer"
                                      >
                                        <PhoneCall className="h-3.5 w-3.5" />
                                      </a>
                                    )}
                                    {deal.conversationId && onOpenWarningChat && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onOpenWarningChat(
                                            deal.conversationId!,
                                            deal.contactName || deal.accountName || deal.title
                                          )
                                        }
                                        title="Abrir conversa no WhatsApp"
                                        className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/25 transition cursor-pointer"
                                      >
                                        <MessageSquare className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        navigate({
                                          to: "/crm/deals/$dealId",
                                          params: { dealId: deal.dealId },
                                          search: { from: "crm" },
                                        })
                                      }
                                      className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                    >
                                      <span>Abrir CRM</span>
                                      <ArrowRight className="h-3 w-3" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 3. Card interativo: Lista de Conversas Citadas (apenas conversas que não estão nos cards acima) */}
                      {dedupedConvs && dedupedConvs.length > 0 && (
                        <div
                          className="mt-2.5 p-2.5 rounded-xl bg-card/95 border border-border/80 shadow-sm flex flex-col gap-2 cursor-default text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <span>
                              {m.warningType === "overload"
                                ? `Atendimentos Ativos (${dedupedConvs.length})`
                                : `Conversas Citadas (${dedupedConvs.length})`}
                            </span>
                            <span className="text-[9px] font-semibold text-primary">
                              Clique para abrir
                            </span>
                          </div>
                          <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-0.5">
                            {dedupedConvs.map((conv) => (
                              <div
                                key={conv.clientId}
                                className="p-2 rounded-lg bg-muted/40 hover:bg-muted/70 border border-border/60 flex items-center justify-between gap-2.5 transition"
                              >
                                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[11px] font-bold text-foreground truncate">
                                      {conv.clientName}
                                    </span>
                                    {conv.company && (
                                      <span className="text-[9px] text-muted-foreground truncate">
                                        • {conv.company}
                                      </span>
                                    )}
                                    {conv.isWaiting && (
                                      <span className="px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                                        {conv.waitMinutes && conv.waitMinutes > 0
                                          ? `Aguardando há ${conv.waitMinutes}min`
                                          : "Aguardando resposta"}
                                      </span>
                                    )}
                                  </div>
                                  {(conv.dealTitle || conv.funnelName) && (
                                    <div className="text-[9px] font-semibold text-primary/90 truncate">
                                      {[conv.funnelName, conv.dealTitle].filter(Boolean).join(" • ")}
                                    </div>
                                  )}
                                  {conv.lastMessage && (
                                    <div className="text-[10px] text-muted-foreground truncate italic">
                                      "{conv.lastMessage}"
                                    </div>
                                  )}
                                </div>
                                {onOpenWarningChat && conv.clientId && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenWarningChat(conv.clientId)}
                                    className="shrink-0 flex items-center gap-1 py-1.5 px-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-bold shadow-soft transition cursor-pointer border-none"
                                  >
                                    <span>Abrir</span>
                                    <ArrowRight className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
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
                onClick={() =>
                  onSetMarkingEvidenceMsg({
                    id: m.id,
                    text: m.text,
                    author: m.author,
                    time: m.time,
                  })
                }
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
              {[
                "Como está minha meta do mês e meu ritmo hoje?",
                "Quais são minhas tarefas e ligações agendadas para hoje?",
                "Quais negociações minhas estão paradas ou esfriando?",
                "Quais clientes estão aguardando minha resposta agora?",
              ].map((q, idx) => (
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
