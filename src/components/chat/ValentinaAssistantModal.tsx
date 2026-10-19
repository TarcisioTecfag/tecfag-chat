import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  CheckCircle2,
  FileText,
  Copy,
  Check,
  Send,
  X,
  Loader2,
  Lock,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";
import { expandPtBrAbbreviationsAndAccents } from "@/lib/valentina/grammar-corrector";

interface ValentinaAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  contactName?: string;
  currentDraftText: string;
  recentMessages?: any[];
  tenantId?: string;
  operatorName?: string;
  onApplyText: (text: string, asInternalNote?: boolean) => void;
  inline?: boolean;
}

type AssistantAction = "best_response" | "grammar_fix" | "lead_summary";

interface ActionCard {
  id: AssistantAction;
  title: string;
  description: string;
  icon: React.ElementType;
  badge?: string;
  requiresDraft?: boolean;
}

function getActionCards(aiPersonaName: string): ActionCard[] {
  const isValentina = aiPersonaName === "Valentina";
  return [
    {
      id: "best_response",
      title: "Melhor Resposta",
      description: isValentina
        ? "Lê o histórico, CRM e catálogo para sugerir uma resposta comercial rápida, objetiva e natural para o WhatsApp."
        : "Analisa a conversa, o card do CRM e o catálogo Tecfag para sugerir uma resposta técnica e comercial pronta para enviar.",
      icon: Sparkles,
      badge: "Contextual",
    },
    {
      id: "grammar_fix",
      title: "Corretor Gramatical",
      description:
        "Corrige pontuação, acentuação e expande abreviações (vc → você, pra → para, mt → muito) sem mudar o sentido da sua frase.",
      icon: CheckCircle2,
      badge: "Ultra-Rápido",
      requiresDraft: true,
    },
    {
      id: "lead_summary",
      title: isValentina ? "Resumo do Lead" : "Resumo do Atendimento",
      description: isValentina
        ? "Gera uma síntese estruturada da conversa e do CRM (necessidade, perfil e próximo passo) para anotação interna."
        : "Lê todo o atendimento e dados do CRM para gerar uma síntese estruturada (cliente, máquina, aplicação, status e próximo passo).",
      icon: FileText,
    },
  ];
}

export const ValentinaAssistantModal: React.FC<ValentinaAssistantModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  contactName,
  currentDraftText,
  recentMessages = [],
  tenantId = "valem",
  operatorName = "Consultor",
  onApplyText,
  inline = true,
}) => {
  const aiPersona = getAiPersona(tenantId || "valem");
  const actionCards = getActionCards(aiPersona.name);
  const [selectedAction, setSelectedAction] = useState<AssistantAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefiningGrammar, setIsRefiningGrammar] = useState(false);
  const [generatedText, setGeneratedText] = useState<string>("");
  const [originalDraftSnapshot, setOriginalDraftSnapshot] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const userEditedResultRef = useRef(false);

  // Reseta o estado ao alternar entre conversas diferentes
  useEffect(() => {
    setSelectedAction(null);
    setGeneratedText("");
    setOriginalDraftSnapshot("");
    setErrorMessage(null);
    setIsLoading(false);
    setIsRefiningGrammar(false);
    userEditedResultRef.current = false;
  }, [conversationId]);

  if (!isOpen) return null;

  const handleQuickApplyGrammar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentDraftText || !currentDraftText.trim()) return;
    const instantFixed = expandPtBrAbbreviationsAndAccents(currentDraftText.trim());
    onApplyText(instantFixed, false);
    toast.success("Texto corrigido e aplicado no campo de mensagem!");
    handleReset();
    onClose();
  };

  const handleExecute = async (action: AssistantAction) => {
    if (action === "grammar_fix" && (!currentDraftText || !currentDraftText.trim())) {
      toast.error("Digite uma mensagem no campo de chat primeiro para usar o Corretor.");
      return;
    }

    setSelectedAction(action);
    setErrorMessage(null);
    userEditedResultRef.current = false;

    // ── MODO ULTRA-RÁPIDO (0ms) PARA O CORRETOR GRAMATICAL ───────────────────
    if (action === "grammar_fix") {
      const snapshot = currentDraftText.trim();
      setOriginalDraftSnapshot(snapshot);
      const instantFixed = expandPtBrAbbreviationsAndAccents(snapshot);
      setGeneratedText(instantFixed);
      setIsLoading(false);
      setIsRefiningGrammar(true);

      try {
        const res = await fetch("/api/valentina/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenantId,
            action,
            conversationId,
            contactName,
            operatorName,
            currentText: snapshot,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success && data.text && !userEditedResultRef.current) {
          setGeneratedText(data.text);
        }
      } catch {
        // Mantém o resultado instantâneo determinístico já exibido em tela
      } finally {
        setIsRefiningGrammar(false);
      }
      return;
    }

    // ── MELHOR RESPOSTA & RESUMO DO ATENDIMENTO ──────────────────────────────
    setIsLoading(true);
    setGeneratedText("");

    try {
      const res = await fetch("/api/valentina/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          action,
          conversationId,
          contactName,
          operatorName,
          currentText: currentDraftText,
          messages: recentMessages,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Erro ao consultar ${aiPersona.name}`);
      }

      setGeneratedText(data.text);
    } catch (err: any) {
      console.error("[ValentinaAssistantModal] Erro:", err);
      setErrorMessage(err.message || "Não foi possível gerar a resposta no momento.");
      toast.error(err.message || `Erro ao gerar resposta com ${aiPersona.name}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!generatedText) return;
    navigator.clipboard.writeText(generatedText);
    setCopied(true);
    toast.success("Texto copiado para a área de transferência");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsertIntoChat = (asInternalNote: boolean = false) => {
    if (!generatedText) return;
    onApplyText(generatedText, asInternalNote);
    toast.success(
      asInternalNote
        ? "Resumo inserido como Nota Interna"
        : "Texto inserido no campo de mensagem",
    );
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setSelectedAction(null);
    setGeneratedText("");
    setOriginalDraftSnapshot("");
    setErrorMessage(null);
    setIsLoading(false);
    setIsRefiningGrammar(false);
    userEditedResultRef.current = false;
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const panelBody = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/25 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {(generatedText || errorMessage || isLoading) && (
            <button
              type="button"
              onClick={handleReset}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              title="Voltar às opções"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <AiAvatar
            tenantId={tenantId || "valem"}
            className="h-7 w-7 rounded-lg border border-primary/20 shadow-2xs shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-xs md:text-sm font-bold text-foreground truncate">
                Assistente {aiPersona.name}
              </h3>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary border border-primary/20 shrink-0">
                {aiPersona.name === "Valentina" ? "IA Comercial" : "IA Técnica"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {contactName
                ? `Atendimento: ${contactName}`
                : aiPersona.name === "Valentina"
                  ? "Suporte inteligente para o vendedor"
                  : "Suporte inteligente para o consultor técnico"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClose}
          title="Fechar assistente"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content Area */}
      <div className="p-3.5 overflow-y-auto flex-1 space-y-3 min-h-0">
        {/* Se nenhuma ação foi gerada e não está carregando, mostra as opções */}
        {!isLoading && !generatedText && !errorMessage && (
          <div className="space-y-2.5">
            <div className="text-[11px] text-muted-foreground font-semibold">
              Selecione uma função de inteligência artificial:
            </div>

            <div className="grid gap-2">
              {actionCards.map((card) => {
                const Icon = card.icon;
                const isGrammarDisabled =
                  card.requiresDraft && (!currentDraftText || !currentDraftText.trim());

                return (
                  <div
                    key={card.id}
                    onClick={() => {
                      if (!isGrammarDisabled) void handleExecute(card.id);
                    }}
                    role="button"
                    tabIndex={isGrammarDisabled ? -1 : 0}
                    onKeyDown={(e) => {
                      if (!isGrammarDisabled && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        void handleExecute(card.id);
                      }
                    }}
                    className={`group relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      isGrammarDisabled
                        ? "opacity-55 border-border/60 bg-muted/20 cursor-not-allowed"
                        : "border-border/80 bg-background hover:border-primary/50 hover:bg-primary/5 hover:shadow-2xs cursor-pointer"
                    }`}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted border border-border group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition">
                      <Icon className="h-3.5 w-3.5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <span className="text-xs font-bold text-foreground group-hover:text-primary transition">
                          {card.title}
                        </span>
                        {card.badge && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                            {card.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">
                        {card.description}
                      </p>
                      {card.requiresDraft && isGrammarDisabled && (
                        <p className="mt-1 text-[10px] text-amber-600 font-medium">
                          Digite um rascunho no campo abaixo para habilitar a correção.
                        </p>
                      )}
                    </div>

                    {card.id === "grammar_fix" && !isGrammarDisabled ? (
                      <div className="flex items-center gap-1.5 shrink-0 self-center">
                        <button
                          type="button"
                          onClick={handleQuickApplyGrammar}
                          title="Corrigir e aplicar direto no campo de mensagem em 1 clique"
                          className="flex items-center gap-1 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground border border-primary/25 px-2 py-1 text-[10px] font-bold transition cursor-pointer"
                        >
                          <Zap className="h-3 w-3" />
                          Aplicar Direto
                        </button>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition" />
                      </div>
                    ) : (
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition mt-1.5" />
                    )}
                  </div>
                );
              })}
            </div>

            {currentDraftText && currentDraftText.trim() && (
              <div className="rounded-xl border border-border bg-muted/20 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                  Rascunho atual no chat:
                </div>
                <p className="text-xs text-foreground italic line-clamp-2">
                  "{currentDraftText}"
                </p>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-8 px-4 space-y-3">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 animate-pulse">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
            <div className="text-center space-y-1">
              <h4 className="text-xs md:text-sm font-bold text-foreground">
                {aiPersona.name} analisando o atendimento...
              </h4>
              <p className="text-xs text-muted-foreground max-w-sm">
                {selectedAction === "best_response" &&
                  (aiPersona.name === "Valentina"
                    ? "Cruzando histórico, CRM e catálogo para sugerir a melhor resposta..."
                    : "Cruzando histórico, card do CRM e catálogo Tecfag para sugerir a melhor resposta...")}
                {selectedAction === "lead_summary" &&
                  (aiPersona.name === "Valentina"
                    ? "Consolidando histórico completo, perfil e próximos passos do lead..."
                    : "Consolidando histórico completo, máquina, aplicação e próximos passos do atendimento...")}
              </p>
            </div>
          </div>
        )}

        {/* Error State */}
        {errorMessage && !isLoading && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-destructive">
              <X className="h-4 w-4" />
              <span>Ocorreu um erro</span>
            </div>
            <p className="text-xs text-muted-foreground">{errorMessage}</p>
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
            </button>
          </div>
        )}

        {/* Result State */}
        {generatedText && !isLoading && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                  <Sparkles className="h-3 w-3" />
                </span>
                <span className="text-xs font-bold text-foreground">
                  {selectedAction === "best_response" && "Melhor Resposta Sugerida"}
                  {selectedAction === "grammar_fix" && "Texto Corrigido"}
                  {selectedAction === "lead_summary" && "Resumo Estruturado do Atendimento"}
                </span>
                {selectedAction === "grammar_fix" && isRefiningGrammar && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-primary font-medium">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Refinando concordância...
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleExecute(selectedAction!)}
                className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" /> Gerar outra
              </button>
            </div>

            {selectedAction === "grammar_fix" &&
              originalDraftSnapshot &&
              originalDraftSnapshot !== generatedText && (
                <div className="rounded-lg border border-border/60 bg-muted/25 px-2.5 py-1.5 text-[11px]">
                  <span className="font-semibold text-muted-foreground mr-1.5">Original:</span>
                  <span className="line-through text-muted-foreground/80">
                    {originalDraftSnapshot}
                  </span>
                </div>
              )}

            <div className="rounded-xl border border-border bg-background p-3 shadow-2xs">
              <textarea
                value={generatedText}
                onChange={(e) => {
                  userEditedResultRef.current = true;
                  setGeneratedText(e.target.value);
                }}
                rows={selectedAction === "lead_summary" ? 6 : 4}
                className="w-full bg-transparent text-xs text-foreground leading-relaxed focus:outline-none resize-none scrollbar-thin"
              />
            </div>

            <div className="text-[11px] text-muted-foreground">
              Você pode editar o texto acima antes de inserir no chat.
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      {(generatedText || !inline) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20 shrink-0">
          {generatedText ? (
            <>
              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                Voltar às opções
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-primary" /> Copiado
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copiar
                    </>
                  )}
                </button>

                {selectedAction === "lead_summary" ? (
                  <button
                    type="button"
                    onClick={() => handleInsertIntoChat(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition shadow-xs cursor-pointer"
                  >
                    <Lock className="h-3.5 w-3.5" /> Inserir como Nota Interna
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleInsertIntoChat(false)}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition shadow-xs cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" /> Inserir no Chat
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );

  if (inline) {
    return (
      <div
        data-assistant-inline-panel="true"
        className="flex flex-col max-h-[56vh] w-full bg-card border border-border rounded-2xl overflow-hidden shadow-soft animate-in slide-in-from-bottom-2 duration-200 mb-2.5"
      >
        {panelBody}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {panelBody}
      </div>
    </div>
  );
};
