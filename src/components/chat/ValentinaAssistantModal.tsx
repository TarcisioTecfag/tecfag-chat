import React, { useState } from "react";
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
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { getAiPersona } from "@/lib/ai-persona";
import { AiAvatar } from "@/components/ui/AiAvatar";

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
  return [
    {
      id: "best_response",
      title: "Melhor Resposta",
      description:
        aiPersonaName === "Valentina"
          ? "Lê o histórico recente e sugere uma resposta comercial rápida, objetiva e natural para o WhatsApp."
          : "Lê o histórico recente e sugere uma orientação técnica clara, rápida e objetiva para o atendimento.",
      icon: Sparkles,
      badge: "Mais Rápido",
    },
    {
      id: "grammar_fix",
      title: "Corretor Gramatical",
      description:
        "Corrige pontuação, acentuação e expande abreviações (ex: vc → você, mt → muito) no seu rascunho.",
      icon: CheckCircle2,
      requiresDraft: true,
    },
    {
      id: "lead_summary",
      title: aiPersonaName === "Valentina" ? "Resumo do Lead" : "Resumo do Atendimento",
      description:
        aiPersonaName === "Valentina"
          ? "Gera uma síntese estruturada da conversa (necessidade, perfil e próximo passo) para anotação interna."
          : "Gera uma síntese estruturada do atendimento (necessidade técnica, ambiente e próximo passo) para anotação interna.",
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
  operatorName = "Vendedor",
  onApplyText,
}) => {
  const aiPersona = getAiPersona(tenantId || "valem");
  const actionCards = getActionCards(aiPersona.name);
  const [selectedAction, setSelectedAction] = useState<AssistantAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedText, setGeneratedText] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExecute = async (action: AssistantAction) => {
    if (action === "grammar_fix" && (!currentDraftText || !currentDraftText.trim())) {
      toast.error("Digite uma mensagem no campo de chat primeiro para usar o Corretor.");
      return;
    }

    setSelectedAction(action);
    setIsLoading(true);
    setErrorMessage(null);
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
        : "Resposta inserida no campo de mensagem"
    );
    handleReset();
    onClose();
  };

  const handleReset = () => {
    setSelectedAction(null);
    setGeneratedText("");
    setErrorMessage(null);
    setIsLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-foreground">Assistente {aiPersona.name}</h3>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary border border-primary/20">
                  {aiPersona.name === "Valentina" ? "IA Comercial" : "IA Técnica"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {contactName
                  ? `Atendimento: ${contactName}`
                  : aiPersona.name === "Valentina"
                  ? "Suporte inteligente para o vendedor"
                  : "Suporte inteligente para o consultor técnico"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 min-h-0">
          {/* Se nenhuma ação foi gerada e não está carregando, mostra as opções */}
          {!isLoading && !generatedText && !errorMessage && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground font-medium mb-1">
                Selecione uma função de inteligência artificial:
              </div>

              <div className="grid gap-2.5">
                {actionCards.map((card) => {
                  const Icon = card.icon;
                  const isGrammarDisabled =
                    card.requiresDraft && (!currentDraftText || !currentDraftText.trim());

                  return (
                    <button
                      key={card.id}
                      onClick={() => handleExecute(card.id)}
                      disabled={isGrammarDisabled}
                      className={`group relative flex items-start gap-3.5 rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                        isGrammarDisabled
                          ? "opacity-50 border-border/60 bg-muted/20 cursor-not-allowed"
                          : "border-border hover:border-primary/50 hover:bg-primary/5 hover:shadow-xs"
                      }`}
                    >
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted border border-border group-hover:bg-primary/10 group-hover:text-primary group-hover:border-primary/20 transition">
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold text-foreground group-hover:text-primary transition">
                            {card.title}
                          </span>
                          {card.badge && (
                            <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[9px] font-semibold text-primary">
                              {card.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {card.description}
                        </p>
                        {card.requiresDraft && isGrammarDisabled && (
                          <p className="mt-1 text-[10px] text-amber-600 font-medium">
                            Digite um rascunho no chat para habilitar a correção.
                          </p>
                        )}
                      </div>

                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition mt-2" />
                    </button>
                  );
                })}
              </div>

              {currentDraftText && currentDraftText.trim() && (
                <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
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
            <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 animate-pulse">
                <Loader2 className="h-7 w-7 animate-spin" />
              </div>
              <div className="text-center space-y-1">
                <h4 className="text-sm font-bold text-foreground">
                  {aiPersona.name} analisando a conversa...
                </h4>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {selectedAction === "best_response" &&
                    (aiPersona.name === "Valentina"
                      ? "Lendo o histórico e formulando a melhor proposta comercial..."
                      : "Lendo o histórico e formulando a melhor orientação técnica...")}
                  {selectedAction === "grammar_fix" &&
                    "Revisando ortografia, pontuação e gramática em português..."}
                  {selectedAction === "lead_summary" &&
                    (aiPersona.name === "Valentina"
                      ? "Consolidando necessidade, perfil e próximos passos do atendimento..."
                      : "Consolidando necessidade técnica e próximos passos do chamado...")}
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {errorMessage && !isLoading && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-destructive">
                <X className="h-4 w-4" />
                <span>Ocorreu um erro</span>
              </div>
              <p className="text-xs text-muted-foreground">{errorMessage}</p>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
              </button>
            </div>
          )}

          {/* Result State */}
          {generatedText && !isLoading && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                    <Sparkles className="h-3 w-3" />
                  </span>
                  <span className="text-xs font-bold text-foreground">
                    {selectedAction === "best_response" && "Melhor Resposta Sugerida"}
                    {selectedAction === "grammar_fix" && "Texto Corrigido"}
                    {selectedAction === "lead_summary" && "Resumo Estruturado do Lead"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleExecute(selectedAction!)}
                    className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" /> Gerar outra
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-4 shadow-2xs">
                <textarea
                  value={generatedText}
                  onChange={(e) => setGeneratedText(e.target.value)}
                  rows={6}
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
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/20">
          {generatedText ? (
            <>
              <button
                onClick={handleReset}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                Voltar às opções
              </button>

              <div className="flex items-center gap-2">
                <button
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
                    onClick={() => handleInsertIntoChat(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition shadow-xs cursor-pointer"
                  >
                    <Lock className="h-3.5 w-3.5" /> Inserir como Nota Interna
                  </button>
                ) : (
                  <button
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
                onClick={onClose}
                className="rounded-lg border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition cursor-pointer"
              >
                Fechar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
