import React, { useState, useEffect } from "react";
import {
  X,
  Building2,
  DollarSign,
  Star,
  User,
  Clock,
  CheckCircle2,
  XCircle,
  PauseCircle,
  MessageSquare,
  ListTodo,
  History,
  Phone,
  Mail,
  Send,
  Plus,
  ChevronRight,
  ExternalLink,
  Edit2,
  Check,
  AlertCircle,
  Loader2,
  Calendar,
  Bookmark,
  Trash2,
  MessageCircle,
  Package,
  FileText,
  Copy,
  Percent,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";

interface DealDetailModalProps {
  dealId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onDealUpdated: (updatedDeal: any) => void;
  pipelineStages: Array<{ id: string; name: string; orderIndex: number }>;
  operatorsMap: Map<string, string>;
}

export function DealDetailModal({
  dealId,
  isOpen,
  onClose,
  onDealUpdated,
  pipelineStages,
  operatorsMap,
}: DealDetailModalProps) {
  const { setActiveView, setSelectedChatId } = useChat();

  const [loading, setLoading] = useState(true);
  const [deal, setDeal] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"history" | "tasks" | "conversations" | "evidence" | "products">("products");

  // Edição rápida de título e valor
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingValue, setIsEditingValue] = useState(false);
  const [editValue, setEditValue] = useState("");

  // Produtos e Catálogo
  const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedCatalogId, setSelectedCatalogId] = useState("");
  const [newProductName, setNewProductName] = useState("");
  const [newProductQty, setNewProductQty] = useState("1");
  const [newProductUnitPrice, setNewProductUnitPrice] = useState("");
  const [newProductDiscount, setNewProductDiscount] = useState("0");
  const [newProductNotes, setNewProductNotes] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);

  // Proposta Comercial
  const [showProposalModal, setShowProposalModal] = useState(false);
  const [proposalTitle, setProposalTitle] = useState("");
  const [proposalPaymentTerms, setProposalPaymentTerms] = useState("À vista / Boleto bancário 30 dias");
  const [proposalDeliveryTerms, setProposalDeliveryTerms] = useState("FOB - Retirada na fábrica ou frete a combinar");
  const [proposalValidityDays, setProposalValidityDays] = useState(15);
  const [generatingProposal, setGeneratingProposal] = useState(false);

  // Ações de Ganho/Perda
  const [showWinPrompt, setShowWinPrompt] = useState(false);
  const [winReason, setWinReason] = useState("");
  const [showLossPrompt, setShowLossPrompt] = useState(false);
  const [lossReason, setLossReason] = useState("");

  // Criação de Nova Atividade / Tarefa / Nota
  const [newActivityType, setNewActivityType] = useState<"note" | "task" | "call" | "meeting">("note");
  const [newActivityTitle, setNewActivityTitle] = useState("");
  const [newActivityDesc, setNewActivityDesc] = useState("");
  const [newActivityDueDate, setNewActivityDueDate] = useState("");
  const [submittingActivity, setSubmittingActivity] = useState(false);

  // Carrega detalhes do Deal
  const loadDealDetail = async () => {
    if (!dealId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/crm/deals/${dealId}`);
      if (!res.ok) {
        throw new Error("Não foi possível carregar a negociação.");
      }
      const data = await res.json();
      setDeal(data.deal);
      setEditTitle(data.deal.title);
      setEditValue(data.deal.value ? String(data.deal.value) : "");
    } catch (err: any) {
      console.error("[DealDetailModal] Erro ao carregar deal:", err);
      toast.error(err.message || "Erro ao carregar detalhes.");
    } finally {
      setLoading(false);
    }
  };

  // Carrega Catálogo de Produtos
  const loadCatalog = async () => {
    setLoadingCatalog(true);
    try {
      const res = await fetch("/api/crm/products?isActive=true");
      if (res.ok) {
        const data = await res.json();
        setCatalogProducts(data.products || []);
      }
    } catch (err: any) {
      console.warn("[DealDetailModal] Falha ao carregar catálogo:", err.message);
    } finally {
      setLoadingCatalog(false);
    }
  };

  useEffect(() => {
    if (isOpen && dealId) {
      loadDealDetail();
      loadCatalog();
    } else {
      setDeal(null);
      setShowWinPrompt(false);
      setShowLossPrompt(false);
    }
  }, [isOpen, dealId]);

  // Manipulação de Produto do Catálogo
  const handleSelectCatalogItem = (productId: string) => {
    setSelectedCatalogId(productId);
    if (!productId) return;
    const prod = catalogProducts.find((p) => p.id === productId);
    if (prod) {
      setNewProductName(prod.name);
      setNewProductUnitPrice(String(prod.unitPrice));
    }
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deal || !newProductName.trim() || !newProductUnitPrice) return;

    setAddingProduct(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedCatalogId || null,
          name: newProductName.trim(),
          quantity: parseFloat(newProductQty) || 1,
          unitPrice: parseFloat(newProductUnitPrice) || 0,
          discountPercent: parseFloat(newProductDiscount) || 0,
          notes: newProductNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao adicionar produto.");
      }

      toast.success("Produto adicionado e valor da negociação recalculado!");
      setSelectedCatalogId("");
      setNewProductName("");
      setNewProductQty("1");
      setNewProductUnitPrice("");
      setNewProductDiscount("0");
      setNewProductNotes("");
      await loadDealDetail();
      if (onDealUpdated && deal) {
        onDealUpdated({ ...deal, value: editValue });
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao adicionar produto.");
    } finally {
      setAddingProduct(false);
    }
  };

  const handleRemoveProduct = async (dealProductId: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/products?dealProductId=${dealProductId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Erro ao remover produto.");
      }

      toast.success("Produto removido e valor recalculado!");
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Falha ao remover produto.");
    }
  };

  const handleGenerateProposal = async () => {
    if (!deal) return;
    setGeneratingProposal(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: proposalTitle.trim() || undefined,
          paymentTerms: proposalPaymentTerms.trim() || undefined,
          deliveryTerms: proposalDeliveryTerms.trim() || undefined,
          validityDays: proposalValidityDays,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao gerar proposta.");
      }

      const data = await res.json();
      toast.success(`Proposta ${data.proposal.proposalNumber} gerada com sucesso!`);
      setShowProposalModal(false);
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao emitir proposta.");
    } finally {
      setGeneratingProposal(false);
    }
  };

  const handleUpdateProposalStatus = async (proposalId: string, status: string) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/proposals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, status }),
      });

      if (!res.ok) throw new Error("Erro ao atualizar status da proposta.");
      toast.success(`Status da proposta atualizado para ${status}!`);
      await loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Erro ao alterar status.");
    }
  };

  const handleCopyProposalText = async (prop: any) => {
    try {
      const itemsList = Array.isArray(prop.items)
        ? prop.items
            .map(
              (it: any) =>
                `• *${it.name}*\n  Qtd: ${it.quantity} | Preço: R$ ${parseFloat(it.unitPrice).toFixed(2)}${
                  parseFloat(it.discountPercent) > 0 ? ` (Desc: ${it.discountPercent}%)` : ""
                } = R$ ${parseFloat(it.totalPrice).toFixed(2)}`
            )
            .join("\n")
        : "";

      const text = `📋 *PROPOSTA COMERCIAL: ${prop.proposalNumber}*\n` +
        `*Cliente / Negócio:* ${deal.title}\n` +
        `*Data:* ${new Date(prop.createdAt).toLocaleDateString("pt-BR")}\n\n` +
        `*ITENS / ESPECIFICAÇÕES:*\n${itemsList || "• Conforme alinhamento comercial"}\n\n` +
        `*Subtotal:* R$ ${parseFloat(prop.subtotal).toFixed(2)}\n` +
        `${parseFloat(prop.discount) > 0 ? `*Desconto Concedido:* R$ ${parseFloat(prop.discount).toFixed(2)}\n` : ""}` +
        `*VALOR TOTAL:* R$ ${parseFloat(prop.total).toFixed(2)}\n\n` +
        `*Condições de Pagamento:* ${prop.paymentTerms || "À vista / Boleto bancário"}\n` +
        `*Prazo & Frete:* ${prop.deliveryTerms || "FOB - Retirada na fábrica ou frete a combinar"}\n` +
        `*Validade:* ${prop.validityDays || 15} dias`;

      await navigator.clipboard.writeText(text);
      if (prop.status === "draft") {
        await handleUpdateProposalStatus(prop.id, "copied");
      }
      toast.success("Texto copiado para a área de transferência! Cole no chat e confirme o envio real após despachar.");
    } catch (err: any) {
      toast.error("Não foi possível copiar para a área de transferência.");
    }
  };

  if (!isOpen || !dealId) return null;

  // Atualização com concorrência otimista
  const updateDeal = async (patch: Record<string, any>) => {
    if (!deal) return;
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...patch,
          expectedVersion: deal.version,
        }),
      });

      if (res.status === 409) {
        toast.error("Esta negociação foi alterada por outro operador. Os dados foram atualizados.");
        loadDealDetail();
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Erro ao atualizar negociação.");
      }

      const data = await res.json();
      setDeal((prev: any) => ({ ...prev, ...data.deal }));
      onDealUpdated(data.deal);
      toast.success("Negociação atualizada com sucesso.");
    } catch (err: any) {
      console.error("[DealDetailModal] Erro no patch:", err);
      toast.error(err.message || "Falha ao salvar alteração.");
    }
  };

  // Salvar título
  const handleSaveTitle = async () => {
    if (!editTitle.trim() || editTitle === deal.title) {
      setIsEditingTitle(false);
      return;
    }
    await updateDeal({ title: editTitle.trim() });
    setIsEditingTitle(false);
  };

  // Salvar valor
  const handleSaveValue = async () => {
    const num = editValue ? parseFloat(editValue.replace(/\./g, "").replace(",", ".")) : null;
    await updateDeal({ value: num && !isNaN(num) ? num : null });
    setIsEditingValue(false);
  };

  // Mudar etapa
  const handleStageChange = async (newStageId: string) => {
    if (newStageId === deal.stageId) return;
    await updateDeal({ stageId: newStageId });
  };

  // Marcar como Ganho
  const handleConfirmWin = async () => {
    await updateDeal({
      status: "won",
      winReason: winReason.trim() || undefined,
      closedAt: new Date().toISOString(),
    });
    setShowWinPrompt(false);
  };

  // Marcar como Perdido
  const handleConfirmLoss = async () => {
    await updateDeal({
      status: "lost",
      lossReason: lossReason.trim() || undefined,
      closedAt: new Date().toISOString(),
    });
    setShowLossPrompt(false);
  };

  // Reabrir negociação
  const handleReopen = async () => {
    await updateDeal({
      status: "open",
      winReason: null,
      lossReason: null,
      closedAt: null,
    });
  };

  // Criar nova atividade / nota
  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newActivityTitle.trim()) {
      toast.error("Informe o assunto da atividade.");
      return;
    }

    setSubmittingActivity(true);
    try {
      const res = await fetch(`/api/crm/deals/${deal.id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newActivityType,
          title: newActivityTitle.trim(),
          description: newActivityDesc.trim() || undefined,
          dueDate: newActivityDueDate || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Erro ao criar atividade.");
      }

      toast.success(newActivityType === "note" ? "Nota adicionada!" : "Tarefa agendada!");
      setNewActivityTitle("");
      setNewActivityDesc("");
      setNewActivityDueDate("");
      loadDealDetail();
    } catch (err: any) {
      console.error("[DealDetailModal] Erro ao criar atividade:", err);
      toast.error(err.message || "Falha ao registrar atividade.");
    } finally {
      setSubmittingActivity(false);
    }
  };

  // Abrir conversa vinculada diretamente no chat
  const handleOpenConversation = (conversationId: string) => {
    setSelectedChatId(conversationId);
    setActiveView("chat");
    onClose();
  };

  // Remover evidência comercial
  const handleRemoveEvidence = async (evidenceId: string) => {
    if (!dealId) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/evidence?evidenceId=${evidenceId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erro ao remover evidência.");
      toast.success("Evidência removida com sucesso.");
      loadDealDetail();
    } catch (err: any) {
      toast.error(err.message || "Falha ao remover evidência.");
    }
  };

  // Etapas ordenadas
  const sortedStages = [...pipelineStages].sort((a, b) => a.orderIndex - b.orderIndex);
  const currentStageIndex = sortedStages.findIndex((s) => s.id === deal?.stageId);

  // Formatação de valor
  const rawValue = deal?.value ? Number(deal.value) : null;
  const formattedValue = rawValue !== null && !isNaN(rawValue)
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
    : "Adicionar valor";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="relative flex flex-col h-[90vh] w-full max-w-4xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Cabeçalho */}
        <div className="border-b border-border bg-muted/20 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Título Editável */}
              {isEditingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-8 flex-1 rounded-lg border border-primary bg-card px-2 text-sm font-bold text-foreground focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSaveTitle}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      setEditTitle(deal.title);
                      setIsEditingTitle(false);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group">
                  <h2 className="text-base font-extrabold text-foreground truncate">
                    {loading ? "Carregando negociação..." : deal?.title}
                  </h2>
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    title="Editar título"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Linha de Subtítulo: Valor + Responsável + Classificação */}
              {!loading && deal && (
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                  {/* Valor Comercial */}
                  {isEditingValue ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-muted-foreground">R$</span>
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="0,00"
                        className="h-7 w-28 rounded-md border border-primary bg-card px-2 text-xs font-extrabold text-foreground focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveValue}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsEditingValue(true)}
                      className="font-extrabold text-foreground text-sm hover:text-primary transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <span>{formattedValue}</span>
                      <Edit2 className="h-3 w-3 opacity-50" />
                    </button>
                  )}

                  <span className="text-muted-foreground/40">•</span>

                  {/* Vendedor / Responsável */}
                  <span className="text-muted-foreground">
                    Responsável:{" "}
                    <strong className="text-foreground font-semibold">
                      {deal.ownerId ? operatorsMap.get(deal.ownerId) || "Não atribuído" : "Sem responsável"}
                    </strong>
                  </span>

                  <span className="text-muted-foreground/40">•</span>

                  {/* Estrelas */}
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        onClick={() => updateDeal({ rating: s })}
                        className={`h-3.5 w-3.5 cursor-pointer hover:scale-110 transition-transform ${
                          (deal.rating || 0) >= s
                            ? "fill-amber-400 text-amber-400"
                            : "text-muted-foreground/30"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Ações de Fechamento + Fechar Modal */}
            <div className="flex items-center gap-2 shrink-0">
              {!loading && deal && (
                <>
                  {deal.status === "open" ? (
                    <>
                      <button
                        onClick={() => setShowWinPrompt(true)}
                        className="flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition-colors cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Ganho</span>
                      </button>
                      <button
                        onClick={() => setShowLossPrompt(true)}
                        className="flex h-8 items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/10 px-3 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Perdido</span>
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleReopen}
                      className="flex h-8 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                      <span>Reabrir Negociação</span>
                    </button>
                  )}
                </>
              )}

              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Modal / Prompt de Ganho */}
          {showWinPrompt && (
            <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 animate-in fade-in">
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 block mb-1">
                Confirmar Ganho da Negociação
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Motivo do ganho (opcional, ex: Melhor preço / Atendimento rápido)..."
                  value={winReason}
                  onChange={(e) => setWinReason(e.target.value)}
                  className="h-8 flex-1 rounded-lg border border-emerald-500/40 bg-card px-2.5 text-xs text-foreground focus:outline-none"
                />
                <button
                  onClick={handleConfirmWin}
                  className="h-8 px-4 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                >
                  Confirmar Venda
                </button>
                <button
                  onClick={() => setShowWinPrompt(false)}
                  className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Modal / Prompt de Perda */}
          {showLossPrompt && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 animate-in fade-in">
              <span className="text-xs font-bold text-red-800 dark:text-red-300 block mb-1">
                Confirmar Perda da Negociação
              </span>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Motivo da perda (ex: Concorrente mais barato / Cliente desistiu)..."
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value)}
                  className="h-8 flex-1 rounded-lg border border-red-500/40 bg-card px-2.5 text-xs text-foreground focus:outline-none"
                />
                <button
                  onClick={handleConfirmLoss}
                  className="h-8 px-4 rounded-lg bg-red-600 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
                >
                  Confirmar Perda
                </button>
                <button
                  onClick={() => setShowLossPrompt(false)}
                  className="h-8 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Trilha de Etapas do Funil */}
          {!loading && deal && sortedStages.length > 0 && (
            <div className="mt-4 flex items-center gap-1 overflow-x-auto pb-1">
              {sortedStages.map((stage, idx) => {
                const isPassed = idx < currentStageIndex;
                const isCurrent = stage.id === deal.stageId;
                return (
                  <button
                    key={stage.id}
                    onClick={() => handleStageChange(stage.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isCurrent
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isPassed
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{stage.name}</span>
                    {idx < sortedStages.length - 1 && (
                      <ChevronRight className="h-3 w-3 opacity-40 shrink-0 ml-1" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Corpo Principal: Lado Esquerdo (Dados Comprador) + Lado Direito (Abas) */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Painel Esquerdo: Dados do Comprador / Empresa */}
            <div className="w-72 border-r border-border p-4 bg-muted/10 overflow-y-auto space-y-4">
              {/* Card da Conta */}
              <div className="rounded-xl border border-border bg-card p-3.5 space-y-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Cliente / Empresa
                </span>

                {deal?.account ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {deal.account.isCompany ? (
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                      ) : (
                        <User className="h-4 w-4 text-primary shrink-0" />
                      )}
                      <span className="text-xs font-bold text-foreground truncate">
                        {deal.account.name}
                      </span>
                    </div>

                    {deal.account.legalName && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {deal.account.legalName}
                      </p>
                    )}

                    {deal.account.cnpj && (
                      <div className="text-[11px] text-muted-foreground">
                        CNPJ: <span className="font-semibold text-foreground">{deal.account.cnpj}</span>
                      </div>
                    )}

                    {deal.account.phone && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <span>{deal.account.phone}</span>
                      </div>
                    )}

                    {deal.account.email && (
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground truncate">
                        <Mail className="h-3 w-3" />
                        <span className="truncate">{deal.account.email}</span>
                      </div>
                    )}

                    {(deal.account.city || deal.account.state) && (
                      <div className="text-[11px] text-muted-foreground">
                        {deal.account.city}{deal.account.state ? ` - ${deal.account.state}` : ""}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground/60 italic py-2">
                    Nenhum cliente ou empresa vinculado.
                  </div>
                )}
              </div>

              {/* Contatos Vinculados */}
              <div className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Contatos Participantes ({deal?.contacts?.length || 0})
                </span>

                {deal?.contacts && deal.contacts.length > 0 ? (
                  deal.contacts.map((c: any) => (
                    <div key={c.id} className="rounded-lg bg-muted/40 p-2 text-xs">
                      <div className="font-bold text-foreground">{c.contact.name}</div>
                      <div className="text-[11px] text-muted-foreground">{c.contact.phone}</div>
                      {c.role && (
                        <span className="mt-1 inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                          {c.role}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-muted-foreground/60 italic">Nenhum contato específico vinculado.</p>
                )}
              </div>
            </div>

            {/* Painel Direito: Abas (Histórico, Tarefas, Conversas) */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Barra de Abas */}
              <div className="flex border-b border-border bg-muted/20 px-4">
                <button
                  onClick={() => setActiveTab("tasks")}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "tasks"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                  <span>Tarefas & Notas ({deal?.activities?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveTab("conversations")}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "conversations"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Conversas ({deal?.conversations?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveTab("evidence")}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "evidence"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  <span>Evidências ({deal?.evidences?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveTab("products")}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "products"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>Produtos & Proposta ({deal?.products?.length || 0})</span>
                </button>

                <button
                  onClick={() => setActiveTab("history")}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-all cursor-pointer ${
                    activeTab === "history"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <History className="h-3.5 w-3.5" />
                  <span>Histórico ({deal?.events?.length || 0})</span>
                </button>
              </div>

              {/* Conteúdo da Aba */}
              <div className="flex-1 overflow-y-auto p-5">
                {/* ABA 1: TAREFAS & NOTAS */}
                {activeTab === "tasks" && (
                  <div className="space-y-6">
                    {/* Formulário de Nova Nota / Tarefa */}
                    <form onSubmit={handleCreateActivity} className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">Nova Atividade Comercial</span>
                        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
                          {(
                            [
                              { id: "note", label: "Nota" },
                              { id: "task", label: "Tarefa" },
                              { id: "call", label: "Ligação" },
                              { id: "meeting", label: "Reunião" },
                            ] as const
                          ).map((t) => (
                            <button
                              type="button"
                              key={t.id}
                              onClick={() => setNewActivityType(t.id)}
                              className={`rounded px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                                newActivityType === t.id
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <input
                        type="text"
                        required
                        placeholder={
                          newActivityType === "note"
                            ? "Escreva o resumo da nota..."
                            : "Qual a próxima ação com este cliente?"
                        }
                        value={newActivityTitle}
                        onChange={(e) => setNewActivityTitle(e.target.value)}
                        className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />

                      <div className="flex items-center gap-2">
                        {newActivityType !== "note" && (
                          <input
                            type="datetime-local"
                            value={newActivityDueDate}
                            onChange={(e) => setNewActivityDueDate(e.target.value)}
                            className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground focus:outline-none"
                          />
                        )}

                        <button
                          type="submit"
                          disabled={submittingActivity || !newActivityTitle.trim()}
                          className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer ml-auto"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Adicionar</span>
                        </button>
                      </div>
                    </form>

                    {/* Lista de Atividades */}
                    <div className="space-y-2.5">
                      {deal?.activities && deal.activities.length > 0 ? (
                        deal.activities.map((act: any) => (
                          <div
                            key={act.id}
                            className="rounded-xl border border-border/80 bg-card p-3 shadow-xs space-y-1"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-foreground">{act.title}</span>
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase font-semibold">
                                {act.type}
                              </span>
                            </div>
                            {act.description && (
                              <p className="text-[11px] text-muted-foreground">{act.description}</p>
                            )}
                            <div className="flex items-center justify-between pt-1 text-[10px] text-muted-foreground">
                              <span>
                                {act.dueDate ? `Vence em: ${new Date(act.dueDate).toLocaleString("pt-BR")}` : ""}
                              </span>
                              <span>
                                Registrado em: {new Date(act.createdAt).toLocaleDateString("pt-BR")}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-center py-8 text-xs text-muted-foreground/60 italic">
                          Nenhuma tarefa ou nota registrada nesta negociação.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ABA 2: CONVERSAS VINCULADAS */}
                {activeTab === "conversations" && (
                  <div className="space-y-3">
                    {deal?.conversations && deal.conversations.length > 0 ? (
                      deal.conversations.map((c: any) => (
                        <div
                          key={c.id}
                          className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 shadow-xs hover:border-primary/40 transition-colors"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-foreground">
                                {c.conversation?.customerName || "Cliente sem nome"}
                              </span>
                              {c.isPrimary && (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                                  Principal
                                </span>
                              )}
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground uppercase">
                                {c.conversation?.channel || "WhatsApp"}
                              </span>
                              {c.conversation?.status && (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                    c.conversation.status === "finished"
                                      ? "bg-muted text-muted-foreground"
                                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  }`}
                                >
                                  {c.conversation.status === "finished" ? "Finalizado" : "Ativo"}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">
                              Telefone: {c.conversation?.phone}
                            </p>
                            {c.conversation?.lastMessage && (
                              <p className="text-[11px] text-muted-foreground/80 italic truncate max-w-md">
                                "{c.conversation.lastMessage}"
                              </p>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleOpenConversation(c.conversationId)}
                            className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer shrink-0"
                          >
                            <span>Abrir Chat</span>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-center py-8 text-xs text-muted-foreground/60 italic">
                        Nenhuma conversa vinculada a este card.
                      </p>
                    )}
                  </div>
                )}

                {/* ABA DE EVIDÊNCIAS COMERCIAIS */}
                {activeTab === "evidence" && (
                  <div className="space-y-3">
                    {deal?.evidences && deal.evidences.length > 0 ? (
                      deal.evidences.map((evi: any) => (
                        <div
                          key={evi.id}
                          className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Bookmark className="h-4 w-4 text-primary fill-primary/20" />
                              <span className="text-xs font-bold text-foreground">
                                {evi.message?.author || "Mensagem de Chat"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {evi.createdAt ? new Date(evi.createdAt).toLocaleString("pt-BR") : ""}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {evi.message?.conversationId && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenConversation(evi.message.conversationId)}
                                  className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer"
                                  title="Abrir no Chat"
                                >
                                  <MessageCircle className="h-3 w-3" />
                                  <span>Ver no Chat</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleRemoveEvidence(evi.id)}
                                className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-600 hover:bg-red-500 hover:text-white transition-colors cursor-pointer"
                                title="Desmarcar evidência"
                              >
                                <Trash2 className="h-3 w-3" />
                                <span>Remover</span>
                              </button>
                            </div>
                          </div>

                          {/* Balão da Mensagem */}
                          <div className="rounded-lg bg-muted/50 p-3 text-xs text-foreground font-mono whitespace-pre-wrap border border-border/40">
                            {evi.message?.content || evi.message?.text || "(Mensagem sem conteúdo textual)"}
                          </div>

                          {/* Nota Explicativa Comercial */}
                          {evi.note && (
                            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-900 dark:text-amber-200">
                              <span className="font-bold shrink-0">Nota:</span>
                              <span className="italic">{evi.note}</span>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-12 space-y-2">
                        <Bookmark className="h-8 w-8 text-muted-foreground/40 mx-auto" />
                        <p className="text-xs text-muted-foreground font-medium">
                          Nenhuma mensagem foi marcada como evidência comercial nesta negociação.
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 max-w-sm mx-auto">
                          No painel de atendimento, passe o mouse sobre mensagens importantes (propostas, aprovações, dados de pagamento) e clique no ícone de evidência.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ABA 4: PRODUTOS & PROPOSTA COMERCIAL */}
                {activeTab === "products" && (
                  <div className="space-y-6">
                    {/* Cabeçalho da Seção de Produtos */}
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
                      <div>
                        <span className="text-xs font-bold text-foreground block">
                          Composição Comercial & Itens da Negociação
                        </span>
                        <p className="text-[11px] text-muted-foreground">
                          Adicione itens do catálogo ou personalizados. O valor da negociação é recalculado automaticamente.
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowProposalModal(true)}
                          className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>Emitir Proposta Comercial</span>
                        </button>
                      </div>
                    </div>

                    {/* Modal / Card Inline de Emissão de Proposta */}
                    {showProposalModal && (
                      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 animate-in fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                            <FileText className="h-4 w-4 text-primary" />
                            Formalizar Proposta Comercial
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowProposalModal(false)}
                            className="text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Título da Proposta
                            </label>
                            <input
                              type="text"
                              value={proposalTitle}
                              onChange={(e) => setProposalTitle(e.target.value)}
                              placeholder={`Proposta Comercial - ${deal?.title || ""}`}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Validade (Dias)
                            </label>
                            <input
                              type="number"
                              value={proposalValidityDays}
                              onChange={(e) => setProposalValidityDays(parseInt(e.target.value, 10) || 15)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Condições de Pagamento
                            </label>
                            <input
                              type="text"
                              value={proposalPaymentTerms}
                              onChange={(e) => setProposalPaymentTerms(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <div>
                            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                              Condições de Frete / Entrega
                            </label>
                            <input
                              type="text"
                              value={proposalDeliveryTerms}
                              onChange={(e) => setProposalDeliveryTerms(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                          <button
                            type="button"
                            onClick={() => setShowProposalModal(false)}
                            className="h-7 px-3 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleGenerateProposal}
                            disabled={generatingProposal}
                            className="flex h-7 items-center gap-1.5 px-4 rounded-lg bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                          >
                            {generatingProposal ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            <span>Gerar Proposta Oficial</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Formulário: Adicionar Item ao Deal */}
                    <form onSubmit={handleAddProduct} className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                          <Plus className="h-3.5 w-3.5 text-primary" />
                          Adicionar Item à Negociação
                        </span>

                        {/* Atalho Catálogo */}
                        {catalogProducts.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <ShoppingBag className="h-3 w-3 text-muted-foreground" />
                            <select
                              value={selectedCatalogId}
                              onChange={(e) => handleSelectCatalogItem(e.target.value)}
                              className="h-7 rounded-lg border border-border bg-card px-2 text-[11px] text-foreground focus:outline-none"
                            >
                              <option value="">-- Puxar do Catálogo --</option>
                              {catalogProducts.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (R$ {parseFloat(p.unitPrice).toFixed(2)})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
                        <div className="md:col-span-5">
                          <input
                            type="text"
                            required
                            placeholder="Nome / Descrição do produto ou serviço..."
                            value={newProductName}
                            onChange={(e) => setNewProductName(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-card px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <input
                            type="number"
                            step="any"
                            min="0.001"
                            required
                            placeholder="Qtd"
                            value={newProductQty}
                            onChange={(e) => setNewProductQty(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required
                            placeholder="Preço R$"
                            value={newProductUnitPrice}
                            onChange={(e) => setNewProductUnitPrice(e.target.value)}
                            className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <div className="relative">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              placeholder="Desc %"
                              value={newProductDiscount}
                              onChange={(e) => setNewProductDiscount(e.target.value)}
                              className="h-8 w-full rounded-lg border border-border bg-card px-2 pr-6 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                            <Percent className="h-3 w-3 text-muted-foreground absolute right-2 top-2.5 pointer-events-none" />
                          </div>
                        </div>

                        <div className="md:col-span-1 flex items-center">
                          <button
                            type="submit"
                            disabled={addingProduct || !newProductName.trim() || !newProductUnitPrice}
                            className="flex h-8 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
                            title="Adicionar produto"
                          >
                            {addingProduct ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </form>

                    {/* Tabela de Produtos Vinculados */}
                    <div className="space-y-3">
                      <span className="text-xs font-bold text-foreground block">
                        Itens Cadastrados ({deal?.products?.length || 0})
                      </span>

                      {deal?.products && deal.products.length > 0 ? (
                        <div className="rounded-xl border border-border overflow-hidden bg-card">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-border bg-muted/40 text-[11px] font-bold text-muted-foreground">
                                <th className="p-3">Produto / Serviço</th>
                                <th className="p-3 text-right">Qtd</th>
                                <th className="p-3 text-right">Unitário</th>
                                <th className="p-3 text-right">Desconto</th>
                                <th className="p-3 text-right">Subtotal</th>
                                <th className="p-3 text-center w-12">Ação</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {deal.products.map((item: any) => (
                                <tr key={item.id} className="hover:bg-muted/10 transition-colors">
                                  <td className="p-3 font-semibold text-foreground">
                                    {item.name}
                                    {item.notes && (
                                      <span className="block text-[10px] text-muted-foreground font-normal">
                                        {item.notes}
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    {parseFloat(item.quantity).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    R$ {parseFloat(item.unitPrice).toFixed(2)}
                                  </td>
                                  <td className="p-3 text-right text-muted-foreground">
                                    {parseFloat(item.discountPercent) > 0 ? `${item.discountPercent}%` : "-"}
                                  </td>
                                  <td className="p-3 text-right font-bold text-foreground">
                                    R$ {parseFloat(item.totalPrice).toFixed(2)}
                                  </td>
                                  <td className="p-3 text-center">
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveProduct(item.id)}
                                      className="p-1 rounded text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                                      title="Remover item"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-border bg-muted/30 font-bold text-xs">
                                <td colSpan={4} className="p-3 text-right text-muted-foreground">
                                  Valor Total Recalculado:
                                </td>
                                <td className="p-3 text-right text-primary font-extrabold text-sm">
                                  R$ {parseFloat(deal.value || "0").toFixed(2)}
                                </td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-1 bg-muted/5">
                          <Package className="h-6 w-6 text-muted-foreground/40 mx-auto" />
                          <p className="text-xs text-muted-foreground font-medium">
                            Nenhum item específico adicionado a esta negociação.
                          </p>
                          <p className="text-[11px] text-muted-foreground/60">
                            Adicione os produtos para que o orçamento seja gerado com precisão e transparência.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Propostas Comerciais Emitidas */}
                    <div className="space-y-3 pt-2">
                      <span className="text-xs font-bold text-foreground block">
                        Propostas Comerciais Emitidas ({deal?.proposals?.length || 0})
                      </span>

                      {deal?.proposals && deal.proposals.length > 0 ? (
                        <div className="space-y-3">
                          {deal.proposals.map((prop: any) => {
                            const statusColor =
                              prop.status === "accepted"
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                : prop.status === "sent"
                                ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                                : prop.status === "copied"
                                ? "bg-indigo-500/10 text-indigo-600 border-indigo-500/20"
                                : prop.status === "rejected"
                                ? "bg-red-500/10 text-red-600 border-red-500/20"
                                : prop.status === "expired"
                                ? "bg-zinc-500/10 text-zinc-600 border-zinc-500/20"
                                : "bg-amber-500/10 text-amber-600 border-amber-500/20";

                            const statusLabel =
                              prop.status === "accepted"
                                ? "Aceita"
                                : prop.status === "sent"
                                ? "Enviada"
                                : prop.status === "copied"
                                ? "Texto Copiado"
                                : prop.status === "rejected"
                                ? "Recusada"
                                : prop.status === "expired"
                                ? "Expirada"
                                : "Rascunho";

                            return (
                              <div
                                key={prop.id}
                                className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-xs"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-primary" />
                                    <span className="text-xs font-bold text-foreground">
                                      {prop.proposalNumber}
                                    </span>
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusColor}`}>
                                      {statusLabel}
                                    </span>
                                    <span className="text-[11px] text-muted-foreground">
                                      • {new Date(prop.createdAt).toLocaleDateString("pt-BR")}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleCopyProposalText(prop)}
                                      className="flex h-7 items-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                                      title="Copiar texto formatado para o WhatsApp (marca como 'Texto Copiado')"
                                    >
                                      <Copy className="h-3 w-3" />
                                      <span>Copiar p/ WhatsApp</span>
                                    </button>

                                    {/* Ações de Status */}
                                    {(prop.status === "draft" || prop.status === "copied") && (
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateProposalStatus(prop.id, "sent")}
                                        className="h-7 px-2.5 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
                                        title="Confirmar que a proposta foi efetivamente enviada ao cliente"
                                      >
                                        Confirmar Envio
                                      </button>
                                    )}

                                    {prop.status === "sent" && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateProposalStatus(prop.id, "accepted")}
                                          className="h-7 px-2.5 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                                        >
                                          Aceita
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleUpdateProposalStatus(prop.id, "rejected")}
                                          className="h-7 px-2.5 rounded-lg border border-red-500/30 text-xs font-bold text-red-600 hover:bg-red-500/10 cursor-pointer"
                                        >
                                          Recusada
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="text-xs text-muted-foreground space-y-1">
                                  <div className="flex justify-between font-semibold text-foreground">
                                    <span>{prop.title}</span>
                                    <span className="text-primary font-bold text-sm">
                                      R$ {parseFloat(prop.total).toFixed(2)}
                                    </span>
                                  </div>
                                  <div className="text-[11px]">
                                    Pagamento: <span className="text-foreground">{prop.paymentTerms}</span> | Frete:{" "}
                                    <span className="text-foreground">{prop.deliveryTerms}</span> | Validade:{" "}
                                    <span className="text-foreground">{prop.validityDays} dias</span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/60 italic">
                          Nenhuma proposta formal emitida para este negócio ainda.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ABA 5: HISTÓRICO DE AUDITORIA */}
                {activeTab === "history" && (
                  <div className="space-y-4">
                    {deal?.events && deal.events.length > 0 ? (
                      <div className="relative pl-4 border-l border-border/80 space-y-4">
                        {deal.events.map((evt: any) => (
                          <div key={evt.id} className="relative group">
                            <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
                            <div className="rounded-xl border border-border/60 bg-muted/20 p-2.5 text-xs space-y-0.5">
                              <div className="flex items-center justify-between text-muted-foreground">
                                <span className="font-bold text-foreground uppercase text-[10px]">
                                  {evt.eventType}
                                </span>
                                <span className="text-[10px]">
                                  {new Date(evt.createdAt).toLocaleString("pt-BR")}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground">
                                {evt.metadata ? JSON.stringify(evt.metadata) : "Evento registrado no sistema"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-center py-8 text-xs text-muted-foreground/60 italic">
                        Nenhum evento registrado ainda.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
