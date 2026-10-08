import { useEffect, useState, useRef } from "react";
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Trophy,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";

interface DirectiveEvidenceTarget {
  id: string;
  dealId: string;
  dealTitle: string;
  dealValue?: number | string | null;
  stageName?: string | null;
  instruction?: string | null;
  priority?: string | null;
}

interface ContactOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

interface MessageCandidate {
  id: string;
  content: string;
  createdAt: string | null;
  senderName: string;
  senderType: string;
}

interface EvidenceApiResponse {
  directive: {
    id: string;
    dealId: string;
    instruction: string;
    priority: string;
  };
  deal: {
    id: string;
    title: string;
    value: string | number | null;
    status: string;
    lossReason: string | null;
    stageName?: string | null;
  } | null;
  contacts: ContactOption[];
  activeConversationId: string | null;
  whatsapp: MessageCandidate[];
  calls: Array<{
    id: string;
    startedAt: string;
    durationSeconds: number;
  }>;
  emails: Array<{
    id: string;
    subject: string;
    sentAt: string;
  }>;
}

const TASK_SUGGESTIONS = [
  "Entrar em contato novamente",
  "Retomar contato",
  "Enviar proposta revisada",
  "Acompanhar retorno do cliente",
  "Alinhar detalhes técnicos",
  "Confirmar pedido e faturamento",
];

const LOSS_REASONS = [
  "Cliente não atende/responde aos contatos",
  "Cliente desistiu do investimento",
  "Preço / Condições de pagamento",
  "Optou pela concorrência",
  "Especificação técnica incompatível",
  "Sem orçamento / Projeto postergado",
  "Outro motivo comercial",
];

function formatBRL(val: number | string | null | undefined): string {
  const num = typeof val === "string" ? parseFloat(val) : Number(val || 0);
  if (isNaN(num)) return "R$ 0,00";
  return num.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getDefaultDateTime(): string {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1000);
  next.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = next.getFullYear();
  const month = pad(next.getMonth() + 1);
  const day = pad(next.getDate());
  const hours = pad(next.getHours());
  const minutes = pad(next.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function CommercialEvidenceDialog({
  directive,
  onClose,
  onCompleted,
  onOpenDeal,
}: {
  directive: DirectiveEvidenceTarget;
  onClose: () => void;
  onCompleted: () => void;
  onOpenDeal?: () => void;
}) {
  const [step, setStep] = useState<"evidence" | "outcome">("evidence");
  const [apiData, setApiData] = useState<EvidenceApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Passo 1: Evidência
  const [channel, setChannel] = useState<"call" | "whatsapp" | "email">("call");
  const [summary, setSummary] = useState("");
  const [emailContent, setEmailContent] = useState("");
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [selectedCallId, setSelectedCallId] = useState("");

  // Passo 2: Desfecho
  const [nextAction, setNextAction] = useState<"continue" | "won" | "lost">("continue");
  const [nextTaskDueAt, setNextTaskDueAt] = useState(getDefaultDateTime());
  const [nextTaskTitle, setNextTaskTitle] = useState("");
  const [nextTaskDescription, setNextTaskDescription] = useState("");
  const [showTaskSuggestions, setShowTaskSuggestions] = useState(false);

  // Desfecho Vendido
  const [wonValue, setWonValue] = useState<string>(
    directive.dealValue != null ? String(directive.dealValue) : "",
  );
  const [wonNotes, setWonNotes] = useState("");

  // Desfecho Perdido
  const [lossReason, setLossReason] = useState(LOSS_REASONS[0]);
  const [lostNotes, setLostNotes] = useState("");

  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/commercial/directives/${encodeURIComponent(directive.id)}/evidence`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Falha ao carregar dados da tratativa.");
        return body as EvidenceApiResponse;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setApiData(data);
          if (data.deal?.value != null && !wonValue) {
            setWonValue(String(data.deal.value));
          }
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Falha ao buscar registros.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [directive.id]);

  // Fecha dropdown de sugestões ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowTaskSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const dealValueDisplay = formatBRL(apiData?.deal?.value ?? directive.dealValue);
  const stageDisplay =
    apiData?.deal?.stageName ||
    directive.stageName ||
    "Leads Recebidos (Faltam 90d p/ maturar)";
  const instructionDisplay =
    directive.instruction ||
    apiData?.directive.instruction ||
    "GESTOR PONTUOU ATENÇÃO E EXECUÇÃO NESSA NEGOCIAÇÃO";

  // Avançar para o Passo 2 após validação da evidência
  function handleAdvanceToOutcome(e: React.FormEvent) {
    e.preventDefault();
    if (channel === "call" && summary.trim().length < 3) {
      toast.error("Por favor, descreva o relato da ligação.");
      return;
    }
    if (channel === "email" && emailContent.trim().length < 5) {
      toast.error("Por favor, cole o cabeçalho e conteúdo do e-mail.");
      return;
    }
    // Se for whatsapp e summary estiver vazio, coloca um relato padrão amigável
    if (channel === "whatsapp" && !summary.trim()) {
      if (selectedMessageIds.length > 0) {
        setSummary(`Tratativa via WhatsApp com ${selectedMessageIds.length} mensagem(ns) vinculadas.`);
      } else {
        setSummary("Mensagem de acompanhamento enviada no WhatsApp.");
      }
    }
    setStep("outcome");
  }

  // Submissão final no Passo 2
  async function handleFinalSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (nextAction === "continue") {
      if (!nextTaskTitle.trim()) {
        toast.error("Informe o nome da próxima tarefa a agendar.");
        return;
      }
      if (!nextTaskDueAt || isNaN(new Date(nextTaskDueAt).getTime())) {
        toast.error("Selecione a data e hora da próxima ação.");
        return;
      }
      if (new Date(nextTaskDueAt) <= new Date()) {
        toast.error("A data da próxima ação precisa ser no futuro.");
        return;
      }
    }

    if (nextAction === "lost" && !lossReason) {
      toast.error("Selecione o motivo da perda da negociação.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const finalSummary =
        summary.trim() ||
        (channel === "whatsapp"
          ? "Mensagem de acompanhamento enviada no WhatsApp"
          : channel === "email"
            ? "E-mail comercial enviado"
            : "Ligação efetuada");

      const payload = {
        channel,
        source:
          channel === "whatsapp" && selectedMessageIds.length > 0
            ? "internal_record"
            : channel === "call" && selectedCallId
              ? "internal_record"
              : "manual_report",
        summary: finalSummary,
        emailContent: channel === "email" ? emailContent.trim() : undefined,
        callId: channel === "call" ? selectedCallId || undefined : undefined,
        messageIds: channel === "whatsapp" ? selectedMessageIds : undefined,
        nextAction,
        nextTaskTitle: nextAction === "continue" ? nextTaskTitle.trim() : undefined,
        nextTaskDueAt: nextAction === "continue" ? new Date(nextTaskDueAt).toISOString() : undefined,
        nextTaskDescription:
          nextAction === "continue" ? nextTaskDescription.trim() || undefined : undefined,
        wonValue:
          nextAction === "won" && wonValue ? parseFloat(wonValue.replace(/[^\d.,]/g, "").replace(",", ".")) : undefined,
        wonNotes: nextAction === "won" ? wonNotes.trim() || undefined : undefined,
        lossReason: nextAction === "lost" ? lossReason : undefined,
        lostNotes: nextAction === "lost" ? lostNotes.trim() || undefined : undefined,
      };

      const response = await fetch(
        `/api/commercial/directives/${encodeURIComponent(directive.id)}/evidence`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Falha ao registrar conclusão da tratativa.");
      }

      toast.success(
        nextAction === "won"
          ? "Venda confirmada e registrada com sucesso no CRM!"
          : nextAction === "lost"
            ? "Perda registrada com motivo no CRM."
            : "Próxima ação agendada e evidência salva com sucesso!",
      );

      onCompleted();
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Falha ao concluir diretriz.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const contactsList = apiData?.contacts || [];
  const whatsappMessages = apiData?.whatsapp || [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-xs p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Concluir tratativa comercial"
    >
      <div className="relative max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[6px] border border-zinc-800 bg-[#0c0d12] p-5 sm:p-6 shadow-2xl text-zinc-100 animate-in fade-in zoom-in-95">
        {/* Cabeçalho do Modal */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-800/80">
          <div>
            <p className="text-[11px] font-bold font-mono uppercase tracking-widest text-[#ff4d6d]">
              {step === "evidence"
                ? "REGISTRAR EVIDÊNCIA DA TRATATIVA COMERCIAL"
                : "DESFECHO DA TRATATIVA"}
            </p>
            <h2 className="mt-1 text-lg sm:text-xl font-bold tracking-tight text-white">
              {step === "evidence" ? "Concluir executar diretriz" : "Qual é sua próxima ação?"}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-[4px] border border-zinc-800 p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Card Resumo da Negociação */}
        <div className="mt-4 rounded-[4px] border border-zinc-800/90 bg-[#12131a] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-sm text-zinc-100 truncate">{directive.dealTitle}</h3>
            <span className="font-mono text-sm font-bold text-emerald-400 shrink-0">
              {dealValueDisplay}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            {step === "outcome" ? `${stageDisplay} · Executar diretriz` : stageDisplay}
          </p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
            {instructionDisplay}
          </p>

          {/* Badge no Passo 2 */}
          {step === "outcome" && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-[3px] border border-emerald-800/80 bg-emerald-950/40 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
              <Check className="h-3 w-3 stroke-[3]" />
              <span>Evidência registrada com sucesso</span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex h-44 flex-col items-center justify-center gap-2 text-zinc-400">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            <span className="text-xs">Carregando tratativas recentes...</span>
          </div>
        ) : step === "evidence" ? (
          /* ========================================================
             PASSO 1: REGISTRAR EVIDÊNCIA DA TRATATIVA COMERCIAL
             ======================================================== */
          <form onSubmit={handleAdvanceToOutcome} className="mt-5 space-y-4">
            {/* Seletor de Canal */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 font-mono">
                CANAL DE ATENDIMENTO UTILIZADO <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                <SystemTooltip content="Registrar contato telefônico ou alinhamento verbal">
                  <button
                    type="button"
                    onClick={() => setChannel("call")}
                    className={`flex items-center justify-center gap-2 rounded-[4px] py-2.5 px-3 text-xs font-semibold transition-all cursor-pointer ${
                      channel === "call"
                        ? "border border-emerald-500 bg-emerald-950/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.12)]"
                        : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    <span>Ligação</span>
                  </button>
                </SystemTooltip>

                <SystemTooltip content="Registrar histórico direto das conversas do WhatsApp">
                  <button
                    type="button"
                    onClick={() => setChannel("whatsapp")}
                    className={`flex items-center justify-center gap-2 rounded-[4px] py-2.5 px-3 text-xs font-semibold transition-all cursor-pointer ${
                      channel === "whatsapp"
                        ? "border border-emerald-500 bg-emerald-950/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.12)]"
                        : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>WhatsApp</span>
                  </button>
                </SystemTooltip>

                <SystemTooltip content="Registrar conteúdo original de e-mail enviado ou recebido">
                  <button
                    type="button"
                    onClick={() => setChannel("email")}
                    className={`flex items-center justify-center gap-2 rounded-[4px] py-2.5 px-3 text-xs font-semibold transition-all cursor-pointer ${
                      channel === "email"
                        ? "border border-emerald-500 bg-emerald-950/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.12)]"
                        : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span>E-mail</span>
                  </button>
                </SystemTooltip>
              </div>
            </div>

            {/* Conteúdo Dinâmico por Canal */}
            {channel === "call" && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5 font-mono">
                  RELATO DA LIGAÇÃO (O QUE FOI TRATADO E ACORDADO?) <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={4}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Ex.: Liguei para o cliente, confirmamos o alinhamento da proposta comercial nº 204. Ele solicitou prazo até sexta para envio do pedido faturado."
                  className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-y"
                />
              </div>
            )}

            {channel === "whatsapp" && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 font-mono">
                    IDENTIFICAÇÃO DO CONTATO NO WHATSAPP <span className="text-red-500">*</span>
                  </label>
                  <p className="mt-0.5 text-[11px] text-zinc-400">
                    Selecione o contato utilizado na tratativa. O histórico completo de mensagens será sincronizado automaticamente.
                  </p>
                </div>

                {contactsList.length === 0 ? (
                  <div className="rounded-[4px] border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-300 flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <p className="font-semibold text-amber-200">
                        Nenhum contato telefônico localizado automaticamente para esta negociação.
                      </p>
                      <p className="mt-0.5 text-amber-300/80">
                        A conclusão será registrada com pendência de vínculo para conferência do gestor.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[4px] border border-zinc-800 bg-zinc-900/50 p-2.5">
                    <div className="text-[11px] font-bold text-zinc-400 uppercase font-mono mb-1">
                      Contato Vinculado:
                    </div>
                    <div className="text-xs font-semibold text-zinc-200 flex items-center justify-between">
                      <span>{contactsList[0].name}</span>
                      <span className="font-mono text-zinc-400">{contactsList[0].phone || "Sem telefone"}</span>
                    </div>
                  </div>
                )}

                {/* Mensagens recentes das 24h para seleção */}
                {whatsappMessages.length > 0 && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1 font-mono">
                      Mensagens trocadas nas últimas 24h ({whatsappMessages.length})
                    </label>
                    <div className="max-h-36 overflow-y-auto space-y-1 rounded-[4px] border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
                      {whatsappMessages.map((m) => {
                        const isSelected = selectedMessageIds.includes(m.id);
                        return (
                          <label
                            key={m.id}
                            className={`flex items-start gap-2 p-1.5 rounded-[3px] transition-colors cursor-pointer ${
                              isSelected ? "bg-emerald-950/40 text-emerald-300" : "hover:bg-zinc-800/60 text-zinc-300"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMessageIds((prev) => [...prev, m.id]);
                                } else {
                                  setSelectedMessageIds((prev) => prev.filter((id) => id !== m.id));
                                }
                              }}
                              className="mt-0.5 rounded-[2px] border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                            />
                            <div className="min-w-0 flex-1 text-[11px] leading-relaxed">
                              <span className="font-bold text-zinc-200">{m.senderName}: </span>
                              <span className="line-clamp-2">{m.content}</span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Box de Sincronização Direta do Atendimento */}
                <div className="rounded-[4px] border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-300 flex items-start gap-2.5">
                  <Zap className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <span className="font-bold text-zinc-100">Sincronização Direta do Atendimento:</span>
                    <span className="ml-1 text-zinc-400">
                      O histórico das últimas 24h desta conversa é extraído diretamente do sistema em tempo real, sem necessidade de filas noturnas ou barreiras de API.
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1.5 font-mono">
                    OBSERVAÇÃO BREVE DA TRATATIVA (OPCIONAL)
                  </label>
                  <input
                    type="text"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Ex.: Mensagem de acompanhamento enviada no WhatsApp"
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                </div>
              </div>
            )}

            {channel === "email" && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 font-mono">
                  EMAIL COMPLETO (COM CABEÇALHO E CONTEÚDO ORIGINAL) <span className="text-red-500">*</span>
                </label>
                <p className="mt-0.5 text-[11px] text-zinc-400 mb-1.5">
                  Cole o email na íntegra, preservando remetente, destinatário, assunto, data e a mensagem enviada/recebida para fins de comprovação e auditoria.
                </p>
                <textarea
                  required
                  rows={6}
                  value={emailContent}
                  onChange={(e) => setEmailContent(e.target.value)}
                  placeholder={`De: cliente@empresa.com.br\nPara: vendedor@tecfag.com.br\nData: 28 de setembro de 2026 14:15\nAssunto: Confirmação de Pedido\n\nPrezado, confirmamos a compra da embaladora a vácuo conforme proposta comercial...`}
                  className="w-full font-mono text-[11px] rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-y"
                />
              </div>
            )}

            {error && (
              <div className="rounded-[4px] border border-red-900/80 bg-red-950/20 p-2.5 text-xs text-red-400">
                {error}
              </div>
            )}

            {/* Rodapé Passo 1 */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={onClose}
                className="rounded-[4px] border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-[4px] bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 transition-colors cursor-pointer shadow-sm"
              >
                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                Salvar evidência e concluir
              </button>
            </div>
          </form>
        ) : (
          /* ========================================================
             PASSO 2: DESFECHO DA TRATATIVA NO CRM
             ======================================================== */
          <form onSubmit={handleFinalSubmit} className="mt-4 space-y-4">
            <p className="text-xs text-zinc-400">
              Escolha o resultado desta tratativa. Sua resposta será refletida diretamente no CRM.
            </p>

            {/* 3 Botões Grandes de Desfecho */}
            <div className="grid grid-cols-3 gap-2.5">
              <SystemTooltip content="Marcar negociação como ganha e contabilizar venda">
                <button
                  type="button"
                  onClick={() => setNextAction("won")}
                  className={`flex flex-col items-center justify-center rounded-[4px] p-3 text-center transition-all cursor-pointer ${
                    nextAction === "won"
                      ? "border border-emerald-500 bg-emerald-950/30 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                      : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <Trophy className="h-5 w-5 mb-1.5" />
                  <span className="text-xs font-bold uppercase tracking-wider">VENDIDO</span>
                  <span className="text-[10px] text-zinc-400 mt-0.5">Negociação ganha</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Registrar perda com motivo para inteligência comercial">
                <button
                  type="button"
                  onClick={() => setNextAction("lost")}
                  className={`flex flex-col items-center justify-center rounded-[4px] p-3 text-center transition-all cursor-pointer ${
                    nextAction === "lost"
                      ? "border border-rose-500 bg-rose-950/30 text-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                      : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <XCircle className="h-5 w-5 mb-1.5" />
                  <span className="text-xs font-bold uppercase tracking-wider">PERDIDO</span>
                  <span className="text-[10px] text-zinc-400 mt-0.5">Registrar perda</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Agendar data e horário para o próximo contato com o cliente">
                <button
                  type="button"
                  onClick={() => setNextAction("continue")}
                  className={`flex flex-col items-center justify-center rounded-[4px] p-3 text-center transition-all cursor-pointer ${
                    nextAction === "continue"
                      ? "border border-amber-500 bg-amber-950/30 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                      : "border border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <Clock className="h-5 w-5 mb-1.5" />
                  <span className="text-xs font-bold uppercase tracking-wider">EM ANDAMENTO</span>
                  <span className="text-[10px] text-zinc-400 mt-0.5">Agendar retorno</span>
                </button>
              </SystemTooltip>
            </div>

            {/* Campos Específicos de EM ANDAMENTO (Foto 5) */}
            {nextAction === "continue" && (
              <div className="space-y-3 pt-1">
                {/* Data e Hora com Tooltip */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    DATA E HORA DA PRÓXIMA AÇÃO <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      required
                      type="datetime-local"
                      value={nextTaskDueAt}
                      onChange={(e) => setNextTaskDueAt(e.target.value)}
                      className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                      <Calendar className="h-4 w-4" />
                    </div>
                  </div>
                </div>

                {/* Nome da Tarefa com Dropdown Autocomplete Estilizado */}
                <div className="relative" ref={suggestionsRef}>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    NOME DA TAREFA <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={nextTaskTitle}
                    onFocus={() => setShowTaskSuggestions(true)}
                    onChange={(e) => {
                      setNextTaskTitle(e.target.value);
                      setShowTaskSuggestions(true);
                    }}
                    placeholder="Ex.: Enviar proposta revisada, Retornar ligação..."
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                  />

                  {/* Menu Popover Escuro de Sugestões Rápidas (Foto 5) */}
                  {showTaskSuggestions && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-[4px] border border-zinc-800 bg-[#0a0a0f] p-1.5 shadow-xl">
                      {TASK_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => {
                            setNextTaskTitle(suggestion);
                            setShowTaskSuggestions(false);
                          }}
                          className="w-full text-left rounded-[3px] px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800/80 hover:text-amber-300 transition-colors cursor-pointer"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Observação da Próxima Ação */}
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    OBSERVAÇÃO <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={nextTaskDescription}
                    onChange={(e) => setNextTaskDescription(e.target.value)}
                    placeholder="Descreva o que foi tratado e qual o objetivo desta próxima ação..."
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-y"
                  />
                </div>

                {/* Box de Reajuste Automático (Foto 5) */}
                <div className="rounded-[4px] border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-300 flex items-start gap-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <span className="font-bold text-amber-200">Reajuste automático:</span>
                    <span className="ml-1 text-amber-300/90">
                      A data da sua responsabilidade será atualizada para a data selecionada, recalibrando o marcador de atraso.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Campos de VENDIDO */}
            {nextAction === "won" && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    VALOR FINAL FATURADO (R$) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={wonValue}
                    onChange={(e) => setWonValue(e.target.value)}
                    placeholder="Ex: 30000000.00"
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs font-mono text-emerald-400 font-bold focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    OBSERVAÇÃO DA VENDA (OPCIONAL)
                  </label>
                  <textarea
                    rows={3}
                    value={wonNotes}
                    onChange={(e) => setWonNotes(e.target.value)}
                    placeholder="Detalhes adicionais da venda, faturamento ou condições acordadas..."
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 resize-y"
                  />
                </div>
                <div className="rounded-[4px] border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs text-emerald-300 flex items-start gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <span className="font-bold text-emerald-200">Atualização imediata no CRM:</span>
                    <span className="ml-1 text-emerald-300/90">
                      A negociação será marcada como GANHA, o valor será contabilizado na sua meta e no faturamento da empresa.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Campos de PERDIDO */}
            {nextAction === "lost" && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    MOTIVO DA PERDA <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={lossReason}
                    onChange={(e) => setLossReason(e.target.value)}
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-200 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500/40 cursor-pointer"
                  >
                    {LOSS_REASONS.map((reason) => (
                      <option key={reason} value={reason} className="bg-zinc-900 text-zinc-200">
                        {reason}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-zinc-300 mb-1 font-mono">
                    JUSTIFICATIVA DETALHADA DA PERDA
                  </label>
                  <textarea
                    rows={3}
                    value={lostNotes}
                    onChange={(e) => setLostNotes(e.target.value)}
                    placeholder="Descreva detalhadamente o motivo para fins de auditoria e relatórios de perdas..."
                    className="w-full rounded-[4px] border border-zinc-800 bg-zinc-900/80 px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500/40 resize-y"
                  />
                </div>
                <div className="rounded-[4px] border border-rose-900/60 bg-rose-950/20 p-3 text-xs text-rose-300 flex items-start gap-2.5">
                  <XCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                  <div>
                    <span className="font-bold text-rose-200">Atualização imediata no CRM:</span>
                    <span className="ml-1 text-rose-300/90">
                      A negociação será marcada como PERDIDA com o motivo especificado para conferência da gestão.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-[4px] border border-red-900/80 bg-red-950/20 p-2.5 text-xs text-red-400">
                {error}
              </div>
            )}

            {/* Rodapé Passo 2 */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => setStep("evidence")}
                className="rounded-[4px] border border-zinc-800 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Voltar
              </button>

              {nextAction === "continue" && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-[4px] bg-[#f59e0b] hover:bg-[#d97706] text-black font-bold px-4 py-2 text-xs transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Clock className="h-3.5 w-3.5" />
                  )}
                  Agendar Próxima Ação
                </button>
              )}

              {nextAction === "won" && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-[4px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 text-xs transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trophy className="h-3.5 w-3.5" />
                  )}
                  Confirmar Venda no CRM
                </button>
              )}

              {nextAction === "lost" && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-1.5 rounded-[4px] bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 text-xs transition-colors cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Registrar Perda no CRM
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
