import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Info,
  LayoutTemplate,
  Loader2,
  Mail,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  analyzeContactPhoneForUndeliverable,
  buildExperimentFallbackCandidates,
  formatMetaErrorMessagePt,
  formatTemplateFirstName,
  isMetaEcosystemEngagementError,
  type TemplateBindings,
} from "@/lib/whatsapp/meta-template-common";
import type { ApprovedMetaTemplate } from "./MetaTemplateSelectModal";

export interface MetaExperimentFallbackCardProps {
  error?: string | null;
  failedMessageText: string;
  customerName: string;
  operatorName: string;
  tenantId: string;
  templates: ApprovedMetaTemplate[];
  loadingTemplates?: boolean;
  resolvedByLaterMessage?: boolean;
  onSendTemplate?: (template: ApprovedMetaTemplate, parameters: string[]) => Promise<boolean>;
  onOpenAllTemplates?: () => void;
  compact?: boolean;
}

export function MetaExperimentFallbackCard({
  error,
  failedMessageText,
  customerName,
  operatorName,
  tenantId,
  templates,
  loadingTemplates = false,
  resolvedByLaterMessage = false,
  onSendTemplate,
  onOpenAllTemplates,
  compact = false,
}: MetaExperimentFallbackCardProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);
  const [expandedWhenResolved, setExpandedWhenResolved] = useState(false);

  const isEcosystemLimit = useMemo(
    () => isMetaEcosystemEngagementError(error),
    [error],
  );
  const metaCodeBadge = isEcosystemLimit ? "Meta #131049" : "Meta #130472";

  const candidates = useMemo(
    () =>
      buildExperimentFallbackCandidates(templates, {
        failedMessageText,
        customerName,
        operatorName,
        tenantId,
      }),
    [templates, failedMessageText, customerName, operatorName, tenantId],
  );

  const activeIndex = candidates.length > 0 ? selectedIdx % candidates.length : 0;
  const activeCandidate = candidates[activeIndex] || null;

  // Quando já houve outra mensagem enviada/recebida com sucesso depois desta falha,
  // recolhemos para uma pílula suave de 1 linha (expansível caso o operador queira reler).
  if ((resolvedByLaterMessage || sentSuccess) && !expandedWhenResolved) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-1.5 flex justify-end w-full"
      >
        <SystemTooltip content="Clique para ver detalhes sobre a restrição de Marketing da Meta neste envio">
          <button
            type="button"
            onClick={() => setExpandedWhenResolved(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-card/90 hover:bg-muted/60 px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground hover:text-foreground shadow-2xs transition cursor-pointer"
          >
            <Info className="h-3 w-3 text-primary shrink-0" />
            <span>
              {sentSuccess
                ? `Bloqueio ${metaCodeBadge} • Template alternativo enviado`
                : isEcosystemLimit
                  ? "Limite de frequência de Marketing da Meta (#131049)"
                  : "Bloqueio experimental de Marketing da Meta (#130472)"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </button>
        </SystemTooltip>
      </div>
    );
  }

  const handleOneClickSend = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeCandidate || !onSendTemplate || sending || sentSuccess) return;
    setSending(true);
    try {
      const ok = await onSendTemplate(activeCandidate.template, activeCandidate.parameters);
      if (ok) {
        setSentSuccess(true);
        setExpandedWhenResolved(false);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`mt-2 ml-auto w-full ${
        compact ? "max-w-[330px] p-3" : "max-w-[430px] p-3.5"
      } rounded-2xl border border-primary/20 bg-card/95 dark:bg-card/90 backdrop-blur-md text-left shadow-soft transition-all animate-in fade-in slide-in-from-top-1 duration-200`}
    >
      {/* Cabeçalho explicativo suave */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-foreground">
                {isEcosystemLimit
                  ? "Limite de frequência de Marketing neste número"
                  : "Restrição automática da Meta neste número"}
              </span>
              <span className="rounded-md border border-border/80 bg-muted/70 px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground">
                {metaCodeBadge}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {isEcosystemLimit ? (
                <>
                  A Meta bloqueou este envio porque o WhatsApp deste cliente já atingiu o limite
                  temporário de mensagens da categoria{" "}
                  <strong className="font-semibold text-foreground">Marketing</strong> recebidas de
                  empresas. Reenviar o mesmo template não funcionará agora.
                </>
              ) : (
                <>
                  O WhatsApp incluiu o número deste cliente em um grupo de teste da Meta (~1% dos
                  usuários) que bloqueia templates de{" "}
                  <strong className="font-semibold text-foreground">Marketing</strong> fora da
                  janela de 24h. Reenviar o mesmo template não funcionará.
                </>
              )}
            </p>
          </div>
        </div>

        {(resolvedByLaterMessage || sentSuccess) && (
          <SystemTooltip content="Recolher explicação">
            <button
              type="button"
              onClick={() => setExpandedWhenResolved(false)}
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer shrink-0"
            >
              <ChevronDown className="h-3.5 w-3.5 rotate-180" />
            </button>
          </SystemTooltip>
        )}
      </div>

      {/* Área de Sugestão de Template com 1 Clique */}
      {loadingTemplates && templates.length === 0 ? (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-border/70 bg-muted/35 px-3 py-2.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
          <span>Preparando sugestão de mensagem alternativa...</span>
        </div>
      ) : activeCandidate ? (
        <div className="mt-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] dark:bg-primary/[0.08] p-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <LayoutTemplate className="h-3 w-3 text-primary shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary truncate">
                Sugestão pronta para enviar
              </span>
              {activeCandidate.isUtility ? (
                <span className="shrink-0 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-600 dark:text-emerald-400">
                  Utilidade • Passa no bloqueio
                </span>
              ) : (
                <span className="shrink-0 rounded-md border border-border/80 bg-muted/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground">
                  {activeCandidate.template.name}
                </span>
              )}
            </div>

            {candidates.length > 1 && (
              <SystemTooltip content="Alternar para outra opção de template aprovado">
                <button
                  type="button"
                  onClick={() => setSelectedIdx((prev) => (prev + 1) % candidates.length)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-background/85 hover:bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer shrink-0"
                >
                  <RefreshCw className="h-2.5 w-2.5" />
                  <span>
                    Outra opção ({activeIndex + 1}/{candidates.length})
                  </span>
                </button>
              </SystemTooltip>
            )}
          </div>

          {/* Prévia da mensagem já preenchida com nome do cliente e operador */}
          <div className="rounded-xl border border-border/75 bg-background/90 dark:bg-background/60 px-3 py-2 text-xs leading-relaxed text-foreground shadow-2xs whitespace-pre-wrap break-words">
            {activeCandidate.previewText}
          </div>

          {/* Botão de Envio com 1 Clique */}
          <div className="flex items-center gap-2 pt-0.5">
            {onSendTemplate && (
              <button
                type="button"
                disabled={sending || sentSuccess}
                onClick={handleOneClickSend}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary/90 active:scale-[0.99] text-primary-foreground px-3 py-2 text-xs font-bold shadow-soft transition cursor-pointer disabled:opacity-60"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span>Enviando template...</span>
                  </>
                ) : sentSuccess ? (
                  <>
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    <span>Mensagem enviada!</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5 shrink-0" />
                    <span>Enviar esta mensagem agora</span>
                  </>
                )}
              </button>
            )}

            {onOpenAllTemplates && (
              <SystemTooltip content="Ver todos os templates aprovados da Meta">
                <button
                  type="button"
                  onClick={onOpenAllTemplates}
                  className="inline-flex items-center justify-center rounded-xl border border-border/80 bg-background hover:bg-muted px-2.5 py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer shrink-0"
                >
                  Ver todos
                </button>
              </SystemTooltip>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2.5 rounded-xl border border-border/75 bg-muted/35 p-2.5 space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Para falar com este cliente sem depender da categoria Marketing, selecione ou cadastre
            um template de <strong className="font-semibold text-foreground">Utilidade (Utility)</strong> ou
            peça ao cliente para enviar um <strong className="font-semibold text-foreground">"Oi"</strong> (o
            que abre a janela livre de 24h).
          </p>
          {onOpenAllTemplates && (
            <button
              type="button"
              onClick={onOpenAllTemplates}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary hover:text-primary-foreground px-3 py-1.5 text-xs font-bold text-primary transition cursor-pointer"
            >
              <LayoutTemplate className="h-3.5 w-3.5 shrink-0" />
              <span>Abrir Templates Meta</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface MetaUndeliverableNoticeCardProps {
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  collapsedByDefault?: boolean;
  onResend?: () => void;
  compact?: boolean;
}

/**
 * Balão inteligente e harmonioso exibido quando a Meta retorna "Message undeliverable" (#131026).
 * Identifica automaticamente se o número cadastrado é um telefone fixo brasileiro sem WhatsApp
 * ou um número sem conta ativa, orientando o operador com ações de 1 clique (copiar telefone / e-mail).
 */
export function MetaUndeliverableNoticeCard({
  customerName,
  customerPhone,
  customerEmail,
  collapsedByDefault = false,
  onResend,
  compact = false,
}: MetaUndeliverableNoticeCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsedByDefault);
  const [copiedField, setCopiedField] = useState<"phone" | "email" | null>(null);

  const phoneInfo = useMemo(
    () => analyzeContactPhoneForUndeliverable(customerPhone),
    [customerPhone],
  );

  const cleanEmail = useMemo(() => {
    const raw = String(customerEmail || "").trim();
    if (!raw || raw.endsWith(".ai")) return "";
    return raw;
  }, [customerEmail]);

  const firstName = useMemo(
    () => formatTemplateFirstName(customerName, "o cliente") || "o cliente",
    [customerName],
  );

  const handleCopy = (field: "phone" | "email", value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedField(field);
    toast.success(field === "phone" ? "Telefone copiado!" : "E-mail copiado!");
    setTimeout(() => {
      setCopiedField((prev) => (prev === field ? null : prev));
    }, 2200);
  };

  if (isCollapsed) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-1.5 flex justify-end w-full"
      >
        <SystemTooltip content="Clique para abrir a explicação e opções de contato para este número sem WhatsApp">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-primary/20 bg-card/95 hover:bg-muted/65 px-2.5 py-1 text-[10.5px] font-medium text-muted-foreground hover:text-foreground shadow-2xs transition cursor-pointer"
          >
            <PhoneOff className="h-3 w-3 text-primary shrink-0" />
            <span>
              {phoneInfo.isBrazilLandline
                ? `Não entregue • Telefone fixo ${phoneInfo.formattedPhone || ""} sem WhatsApp`
                : "Não entregue • Número sem WhatsApp ativo (#131026)"}
            </span>
            <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
          </button>
        </SystemTooltip>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`mt-2 ml-auto w-full ${
        compact ? "max-w-[330px] p-3" : "max-w-[430px] p-3.5"
      } rounded-2xl border border-primary/20 bg-card/95 dark:bg-card/90 backdrop-blur-md text-left shadow-soft transition-all animate-in fade-in slide-in-from-top-1 duration-200`}
    >
      {/* Cabeçalho harmonioso com a identidade do sistema */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <PhoneOff className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-bold text-foreground">
                {phoneInfo.isBrazilLandline
                  ? "Telefone fixo sem WhatsApp ativo"
                  : phoneInfo.isMissingNinthDigit
                    ? "Número sem 9º dígito ou sem WhatsApp"
                    : "Este número não possui WhatsApp ativo"}
              </span>
              <span className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-primary">
                {phoneInfo.isBrazilLandline ? "Linha Fixa • #131026" : "Meta #131026"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {phoneInfo.isBrazilLandline ? (
                <>
                  O telefone cadastrado{" "}
                  {phoneInfo.formattedPhone && (
                    <strong className="font-semibold text-foreground">
                      {phoneInfo.formattedPhone}
                    </strong>
                  )}{" "}
                  é uma <strong className="font-semibold text-foreground">linha fixa comercial</strong>{" "}
                  e não possui conta de WhatsApp vinculada. Reenviar mensagens ou trocar de template
                  por aqui não funcionará.
                </>
              ) : phoneInfo.isMissingNinthDigit ? (
                <>
                  O número cadastrado{" "}
                  {phoneInfo.formattedPhone && (
                    <strong className="font-semibold text-foreground">
                      {phoneInfo.formattedPhone}
                    </strong>
                  )}{" "}
                  está sem o 9º dígito de celular ou não possui conta de WhatsApp ativa. Reenviar por
                  aqui não funcionará.
                </>
              ) : (
                <>
                  A Meta informou que o número{" "}
                  {phoneInfo.formattedPhone && (
                    <strong className="font-semibold text-foreground">
                      {phoneInfo.formattedPhone}
                    </strong>
                  )}{" "}
                  não possui uma conta de WhatsApp ativa no momento. Reenviar ou trocar de template
                  por aqui não funcionará.
                </>
              )}
            </p>
          </div>
        </div>

        <SystemTooltip content="Recolher aviso">
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer shrink-0"
          >
            <ChevronDown className="h-3.5 w-3.5 rotate-180" />
          </button>
        </SystemTooltip>
      </div>

      {/* Bloco de Recomendação e Ações Rápidas (Ligação / E-mail) */}
      <div className="mt-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] dark:bg-primary/[0.08] p-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <PhoneCall className="h-3 w-3 text-primary shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
            Como atender {firstName} agora
          </span>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Entre em contato por{" "}
          <strong className="font-semibold text-foreground">ligação telefônica</strong>
          {cleanEmail ? (
            <>
              {" "}
              ou <strong className="font-semibold text-foreground">e-mail</strong>
            </>
          ) : null}{" "}
          para falar com o cliente e solicitar um número de celular com WhatsApp:
        </p>

        {(phoneInfo.formattedPhone || cleanEmail) && (
          <div className="flex flex-col gap-1.5 pt-0.5">
            {phoneInfo.formattedPhone && (
              <SystemTooltip content="Clique para copiar o número e ligar para o cliente">
                <button
                  type="button"
                  onClick={(e) => handleCopy("phone", phoneInfo.formattedPhone!, e)}
                  className="w-full flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/90 hover:bg-muted/80 hover:border-primary/35 px-3 py-2 text-xs transition cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <PhoneCall className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-bold text-foreground truncate">
                      {phoneInfo.formattedPhone}
                    </span>
                    {phoneInfo.isBrazilLandline && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shrink-0">
                        Fixo
                      </span>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-primary shrink-0">
                    {copiedField === "phone" ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 opacity-80 group-hover:opacity-100" />
                        <span>Copiar telefone</span>
                      </>
                    )}
                  </span>
                </button>
              </SystemTooltip>
            )}

            {cleanEmail && (
              <SystemTooltip content="Clique para copiar o e-mail do cliente">
                <button
                  type="button"
                  onClick={(e) => handleCopy("email", cleanEmail, e)}
                  className="w-full flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/90 hover:bg-muted/80 hover:border-primary/35 px-3 py-2 text-xs transition cursor-pointer group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-medium text-foreground truncate">{cleanEmail}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-primary shrink-0">
                    {copiedField === "email" ? (
                      <>
                        <Check className="h-3 w-3" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 opacity-80 group-hover:opacity-100" />
                        <span>Copiar e-mail</span>
                      </>
                    )}
                  </span>
                </button>
              </SystemTooltip>
            )}
          </div>
        )}

        {onResend && (
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/60 text-[10.5px] text-muted-foreground">
            <span>O cliente ativou o WhatsApp neste número?</span>
            <SystemTooltip content="Tentar reenviar a mensagem para este número">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResend();
                }}
                className="inline-flex items-center gap-1 font-bold text-primary hover:underline cursor-pointer shrink-0"
              >
                <RotateCcw className="h-2.5 w-2.5" />
                <span>Tentar reenviar</span>
              </button>
            </SystemTooltip>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Barra de status harmoniosa com o Design System para demais estados de envio
 * (pending, unknown/uncertain ou falhas genéricas que não sejam 130472 nem 131026).
 */
export function MetaGenericDeliveryStatusBar({
  status,
  error,
  phone,
  onResend,
  onConfirmSent,
}: {
  status: string;
  error?: string | null;
  phone?: string | null;
  onResend?: () => void;
  onConfirmSent?: () => void;
}) {
  const friendlyError = formatMetaErrorMessagePt(error, phone);
  const isPending = status === "pending";
  const isFailed = status === "failed";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 ml-auto inline-flex flex-wrap items-center justify-end gap-2 rounded-xl border border-primary/20 bg-card/95 dark:bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-2xs max-w-[420px]"
    >
      <div className="flex items-center gap-1.5 text-foreground font-semibold">
        {isPending ? (
          <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-primary shrink-0" />
        )}
        <span>
          {isPending
            ? "Na fila de envio"
            : isFailed
              ? "Não foi possível concluir o envio"
              : "Confirmação de envio pendente"}
        </span>
      </div>

      {friendlyError && (
        <span className="text-[10.5px] text-muted-foreground leading-snug">
          • {friendlyError}
        </span>
      )}

      {!isPending && (onResend || onConfirmSent) && (
        <div className="flex items-center gap-1.5 ml-1">
          {onResend && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResend();
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/25 bg-primary/10 hover:bg-primary hover:text-primary-foreground px-2 py-0.5 text-[10.5px] font-bold text-primary transition cursor-pointer"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              <span>Reenviar</span>
            </button>
          )}
          {!isFailed && onConfirmSent && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onConfirmSent();
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-background hover:bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              <Check className="h-2.5 w-2.5" />
              <span>Já foi enviado</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
