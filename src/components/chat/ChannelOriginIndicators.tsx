import React from "react";
import { ArrowRight } from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import type { ChannelDividerKind } from "@/lib/chat/message-channel-origin";

/** Ícone vetorial do canal Site (sem dependência circular com ChatList). */
export function SiteChannelIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

/** Ícone vetorial do canal WhatsApp (sem dependência circular com ChatList). */
export function WhatsappChannelIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.012 2c-5.506 0-9.989 4.478-9.99 9.984a9.96 9.96 0 001.37 5.053L2 21.855l5.023-1.317a9.927 9.927 0 004.988 1.325h.004c5.505 0 9.989-4.478 9.99-9.984C22 6.478 17.518 2 12.012 2zm0 18.29h-.003a8.266 8.266 0 01-4.224-1.163l-.303-.18-3.138.823.838-3.06-.197-.314a8.273 8.273 0 01-1.267-4.409c.001-4.566 3.717-8.278 8.29-8.278 2.217.001 4.3 0.865 5.867 2.435a8.223 8.223 0 012.424 5.85c-.001 4.567-3.717 8.279-8.288 8.279z" />
    </svg>
  );
}

/**
 * Selo explícito exibido acima dos grupos de mensagens trocadas no chat do Site
 * dentro de uma conversa de WhatsApp.
 */
export function SiteOriginTag({
  side,
  compact = false,
  className = "",
}: {
  side: "in" | "out";
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center ${side === "out" ? "justify-end" : "justify-start"} select-none ${className}`}
    >
      <SystemTooltip content="Esta mensagem aconteceu durante a triagem no chat online do Site">
        <span
          className={`inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300 font-bold tracking-wide shadow-2xs ${
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
          }`}
        >
          <SiteChannelIcon className={compact ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} />
          <span>Triagem no Site</span>
        </span>
      </SystemTooltip>
    </div>
  );
}

/**
 * Divisória explícita marcando onde começa a triagem feita no Site e onde inicia
 * o atendimento efetivo no WhatsApp.
 */
export function ChannelTransitionDivider({
  kind,
  compact = false,
}: {
  kind: ChannelDividerKind;
  compact?: boolean;
}) {
  if (kind === "site_start") {
    return (
      <div
        className={`flex items-center gap-2.5 w-full select-none ${compact ? "my-2.5 px-1" : "my-3.5 px-2"}`}
        role="separator"
        aria-label="Triagem realizada no Site"
      >
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-sky-500/35 to-sky-500/50" />
        <SystemTooltip content="As mensagens abaixo foram trocadas no chat online do Site antes da continuidade no WhatsApp">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/12 text-sky-700 dark:text-sky-300 font-extrabold uppercase tracking-wider shadow-2xs shrink-0 ${
              compact ? "px-2.5 py-0.5 text-[9px]" : "px-3.5 py-1 text-[10px]"
            }`}
          >
            <SiteChannelIcon className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />
            <span>Triagem feita no Site</span>
          </div>
        </SystemTooltip>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-sky-500/35 to-sky-500/50" />
      </div>
    );
  }

  if (kind === "whatsapp_start") {
    return (
      <div
        className={`flex items-center gap-2.5 w-full select-none ${compact ? "my-2.5 px-1" : "my-4 px-2"}`}
        role="separator"
        aria-label="Início do atendimento no WhatsApp"
      >
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-500/40 to-emerald-500/60" />
        <SystemTooltip content="A partir deste ponto as mensagens acontecem diretamente no WhatsApp">
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/45 bg-emerald-500/14 text-emerald-700 dark:text-emerald-300 font-extrabold uppercase tracking-wider shadow-2xs shrink-0 ${
              compact ? "px-2.5 py-0.5 text-[9px]" : "px-3.5 py-1 text-[10px]"
            }`}
          >
            <WhatsappChannelIcon className={compact ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} />
            <span>Início do atendimento no WhatsApp</span>
          </div>
        </SystemTooltip>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-emerald-500/40 to-emerald-500/60" />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2.5 w-full select-none ${compact ? "my-2.5 px-1" : "my-4 px-2"}`}
      role="separator"
      aria-label="Fim da triagem no Site — continuação no WhatsApp"
    >
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-sky-500/35 to-emerald-500/45" />
      <SystemTooltip content="A triagem no Site foi encerrada acima. As próximas mensagens enviadas ou recebidas aqui já acontecem pelo WhatsApp.">
        <div
          className={`inline-flex flex-wrap items-center justify-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-foreground font-bold tracking-wide shadow-2xs ${
            compact ? "px-2.5 py-0.5 text-[9px]" : "px-3.5 py-1 text-[10px]"
          }`}
        >
          <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 uppercase font-extrabold">
            <SiteChannelIcon className={compact ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} />
            <span>Fim da triagem no Site</span>
          </span>
          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 uppercase font-extrabold">
            <WhatsappChannelIcon className={compact ? "h-2.5 w-2.5 shrink-0" : "h-3 w-3 shrink-0"} />
            <span>Atendimento no WhatsApp</span>
          </span>
        </div>
      </SystemTooltip>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent via-emerald-500/35 to-emerald-500/50" />
    </div>
  );
}
