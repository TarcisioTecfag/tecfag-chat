import React, { useState, useEffect, useCallback } from "react";
import {
  Columns3,
  Plus,
  Link2,
  Unlink,
  CheckCircle2,
  XCircle,
  PauseCircle,
  ExternalLink,
  Loader2,
  Star,
  Search,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { CreateDealDialog } from "./CreateDealDialog";
import { useChat } from "@/hooks/useChatState";
import { useNavigate } from "@tanstack/react-router";

interface ConversationDealsPanelProps {
  conversationId: string;
  contactId?: string;
  customerName?: string;
}

export function ConversationDealsPanel({
  conversationId,
  contactId,
  customerName,
}: ConversationDealsPanelProps) {
  const { tenant, currentOperatorId } = useChat();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<any[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLinkingOpen, setIsLinkingOpen] = useState(false);

  // Dados para os modais
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [operators, setOperators] = useState<any[]>([]);

  // Estado para busca no modal de vincular existente
  const [searchDealsQuery, setSearchDealsQuery] = useState("");
  const [searchingDeals, setSearchingDeals] = useState(false);
  const [availableDealsToLink, setAvailableDealsToLink] = useState<any[]>([]);

  const [contactInfo, setContactInfo] = useState<{
    id: string;
    name: string;
    accountId: string | null;
    accountName: string | null;
  } | null>(null);

  // Carrega pipelines e operadores
  useEffect(() => {
    fetch("/api/crm/pipelines")
      .then((res) => (res.ok ? res.json() : { pipelines: [] }))
      .then((data) => setPipelines(data.pipelines || []))
      .catch(() => {});

    fetch("/api/operators")
      .then((res) => (res.ok ? res.json() : { operators: [] }))
      .then((data) => setOperators(Array.isArray(data) ? data : data.operators || []))
      .catch(() => {});
  }, []);

  // Carrega negócios vinculados a esta conversa
  const fetchLinkedDeals = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/chats/${conversationId}/deals`);
      if (!res.ok) throw new Error("Erro ao carregar negociações da conversa.");
      const data = await res.json();
      setDeals(data.deals || []);
      if (data.contact) {
        setContactInfo(data.contact);
      }
    } catch (err: any) {
      console.warn("[ConversationDealsPanel] Erro ao buscar deals:", err);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchLinkedDeals();
  }, [fetchLinkedDeals]);

  // Desvincular conversa de um deal
  const handleUnlink = async (dealId: string) => {
    if (!confirm("Deseja realmente desvincular esta conversa da negociação?")) return;
    try {
      const res = await fetch(`/api/crm/deals/${dealId}/conversations`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      if (!res.ok) throw new Error("Falha ao desvincular conversa.");
      toast.success("Conversa desvinculada da negociação.");
      fetchLinkedDeals();
    } catch (e: any) {
      toast.error(e.message || "Erro ao desvincular.");
    }
  };

  // Buscar negociações existentes para vincular (sem filtro prévio restritivo)
  const handleSearchDeals = async () => {
    setSearchingDeals(true);
    try {
      const params = new URLSearchParams();
      if (searchDealsQuery.trim()) {
        params.set("search", searchDealsQuery.trim());
      }
      params.set("limit", "15");
      const res = await fetch(`/api/crm/deals?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        // Filtra os que já estão vinculados nesta conversa
        const linkedIds = new Set(deals.map((d) => d.id));
        setAvailableDealsToLink((data.deals || []).filter((d: any) => !linkedIds.has(d.id)));
      }
    } catch (e) {
      console.error("[ConversationDealsPanel] Erro ao buscar deals existentes:", e);
    } finally {
      setSearchingDeals(false);
    }
  };

  // Vincular negociação existente com aviso preventivo de divergência de conta
  const handleLinkExistingDeal = async (dealItem: any) => {
    if (
      dealItem.accountId &&
      contactInfo?.accountId &&
      dealItem.accountId !== contactInfo.accountId
    ) {
      const dealAccName = dealItem.account?.name || "Empresa da Negociação";
      const contactAccName = contactInfo.accountName || "Empresa do Contato";
      const proceed = window.confirm(
        `Aviso preventivo:\nA negociação "${dealItem.title}" pertence à empresa "${dealAccName}", mas o contato deste atendimento está vinculado à empresa "${contactAccName}".\n\nDeseja confirmar o vínculo desta negociação mesmo com empresas diferentes?`
      );
      if (!proceed) return;
    }

    try {
      const res = await fetch(`/api/crm/deals/${dealItem.id}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, isPrimary: deals.length === 0 }),
      });
      if (!res.ok) throw new Error("Falha ao vincular conversa.");
      toast.success("Negociação vinculada com sucesso!");
      setIsLinkingOpen(false);
      setSearchDealsQuery("");
      fetchLinkedDeals();
    } catch (e: any) {
      toast.error(e.message || "Erro ao vincular.");
    }
  };


  return (
    <div className="space-y-3 bg-muted/40 p-3.5 rounded-2xl border border-line">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Columns3 className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">Negociações CRM</span>
          <span className="flex h-4 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[9px] font-bold text-primary">
            {deals.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              handleSearchDeals();
              setIsLinkingOpen(true);
            }}
            title="Vincular negociação existente"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground transition-colors cursor-pointer"
          >
            <Link2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => setIsCreateOpen(true)}
            title="Criar nova negociação para este atendimento"
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Lista de Cards Vinculados */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      ) : deals.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[11px] text-muted-foreground/60 italic">
            Nenhuma negociação vinculada a esta conversa.
          </p>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            <span>Criar primeira negociação</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {deals.map((deal) => {
            const rawValue = deal.value ? Number(deal.value) : null;
            const formattedValue = rawValue !== null && !isNaN(rawValue)
              ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(rawValue)
              : null;

            return (
              <div
                key={deal.id}
                onClick={() => navigate({ to: "/crm/deals/$dealId", params: { dealId: deal.id }, search: { from: "chat" } })}
                className="group relative rounded-xl border border-border/80 bg-card p-2.5 shadow-xs hover:border-primary/40 transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-1">
                  <h5 className="text-xs font-bold text-foreground truncate group-hover:text-primary transition-colors">
                    {deal.title}
                  </h5>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnlink(deal.id);
                    }}
                    title="Desvincular negociação"
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/60 hover:text-red-500 transition-opacity cursor-pointer"
                  >
                    <Unlink className="h-3 w-3" />
                  </button>
                </div>

                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="font-extrabold text-foreground">
                    {formattedValue || "Sem valor"}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {deal.stageName || "Etapa ativa"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para Vincular Negociação Existente */}
      {isLinkingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-2xl animate-in fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h4 className="text-xs font-bold text-foreground">Vincular Negociação Existente</h4>
              <button
                onClick={() => setIsLinkingOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            <div className="my-3 flex gap-2">
              <input
                type="text"
                placeholder="Buscar negociação por título..."
                value={searchDealsQuery}
                onChange={(e) => setSearchDealsQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchDeals()}
                className="h-8 flex-1 rounded-xl border border-border bg-muted/20 px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleSearchDeals}
                className="h-8 px-3 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 cursor-pointer"
              >
                Buscar
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {searchingDeals ? (
                <div className="py-6 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
                </div>
              ) : availableDealsToLink.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground/60 italic">
                  Nenhuma negociação disponível para vincular.
                </p>
              ) : (
                availableDealsToLink.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between p-2 rounded-xl border border-border/60 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-foreground truncate">{d.title}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {d.account?.name && (
                          <span className="text-[10px] text-primary font-medium truncate max-w-[140px]" title={d.account.name}>
                            🏢 {d.account.name}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {d.value ? `R$ ${Number(d.value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "Sem valor"}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleLinkExistingDeal(d)}
                      className="flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer shrink-0"
                    >
                      <Check className="h-3 w-3" />
                      <span>Vincular</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Criação de Negociação a partir do Chat */}
      <CreateDealDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(newDeal, createAnother) => {
          fetchLinkedDeals();
          if (!createAnother) navigate({ to: "/crm/deals/$dealId", params: { dealId: newDeal.id }, search: { from: "chat" } });
        }}
        pipelines={pipelines}
        operators={operators}
        defaultContactId={contactId}
        defaultConversationId={conversationId}
        defaultAccountName={customerName}
        currentOperatorId={currentOperatorId}
      />

    </div>
  );
}
