// ══════════════════════════════════════════════════════════════════════════════
// 🔄 RODÍZIO TAB — Gestão em Tempo Real do Rodízio de Leads (100% Dados Reais)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Shuffle,
  UserCheck,
  UserX,
  Palmtree,
  Ban,
  ExternalLink,
  Users,
  RefreshCw,
  Clock,
  CheckCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

export type RodizioOperator = {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  isParticipating: boolean;
  isOnLeave: boolean;
  isPenalized: boolean;
  leadsReceivedCount: number;
  recentLeads: Array<{
    chatId: string;
    clientName: string;
    receivedAt: string;
  }>;
};

function OperatorAvatar({
  name,
  avatar,
  id,
  size = "h-10 w-10",
  fontSize = "text-xs",
}: {
  name: string;
  avatar?: string | null;
  id?: string;
  size?: string;
  fontSize?: string;
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [avatar]);

  // Se não houver foto cadastrada no banco de dados, gera uma foto padrão estilizada por operador
  const resolvedAvatar =
    avatar && avatar.trim() !== ""
      ? avatar
      : `https://i.pravatar.cc/150?u=${encodeURIComponent(id || name)}`;

  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);

  if (resolvedAvatar && !imgError) {
    return (
      <img
        src={resolvedAvatar}
        alt={name}
        className={`${size} rounded-full object-cover shrink-0 border border-primary/20 shadow-sm`}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className={`${size} rounded-full bg-primary-soft flex items-center justify-center font-black ${fontSize} text-primary shrink-0 border border-primary/20`}
    >
      {initials}
    </div>
  );
}

export function RodizioTab() {
  const { tenant, operators: globalOperators, setActiveView, setSelectedChatId } = useChat();

  const [operators, setOperators] = useState<RodizioOperator[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Carregar dados REAIS do Rodízio via API
  const fetchRodizioData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio?tenantId=${tenant}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.operators)) {
          setOperators(data.operators);
        }
      }
    } catch (e) {
      console.warn("[RodizioTab] Erro ao carregar operadores do rodízio:", e);
    } finally {
      setIsLoading(false);
    }
  }, [tenant, BACKEND_URL]);

  // Polling a cada 3 segundos para sincronização ao vivo
  useEffect(() => {
    fetchRodizioData();
    const interval = setInterval(fetchRodizioData, 3000);
    return () => clearInterval(interval);
  }, [fetchRodizioData]);

  // Salvar estado alterado do operador no banco de dados
  const updateOperatorState = async (
    opId: string,
    key: "isParticipating" | "isOnLeave" | "isPenalized"
  ) => {
    const targetOp = operators.find((o) => o.id === opId);
    if (!targetOp) return;

    const updatedValue = !targetOp[key];
    const updatedOps = operators.map((op) => {
      if (op.id !== opId) return op;
      const updated = { ...op, [key]: updatedValue };

      // Regras de exclusividade amigáveis:
      if (key === "isOnLeave" && updated.isOnLeave) {
        updated.isPenalized = false;
      }
      if (key === "isPenalized" && updated.isPenalized) {
        updated.isOnLeave = false;
      }
      return updated;
    });

    setOperators(updatedOps);

    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          operators: updatedOps,
        }),
      });

      if (res.ok) {
        toast.success(`Status de ${targetOp.name} atualizado no rodízio!`);
      } else {
        toast.error("Erro ao salvar status no banco de dados.");
        fetchRodizioData();
      }
    } catch (e) {
      console.error("Erro ao atualizar status do operador:", e);
      toast.error("Erro de comunicação ao salvar rodízio.");
      fetchRodizioData();
    }
  };

  // Zerar contadores de leads de todos os vendedores no banco
  const handleResetCounters = async () => {
    setIsResetting(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/rodizio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          tenantId: tenant,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.operators)) {
          setOperators(data.operators);
        }
        toast.success("Contadores de leads do rodízio reiniciados!");
      } else {
        toast.error("Erro ao reiniciar contadores.");
      }
    } catch (e) {
      console.error("Erro ao zerar contadores:", e);
      toast.error("Erro de comunicação ao zerar contadores.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleOpenLeadChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setActiveView("chat");
    toast.info("Redirecionando para a conversa...");
  };

  // Cálculo de estatísticas gerais
  const totalLeadsToday = operators.reduce((acc, o) => acc + (o.leadsReceivedCount || 0), 0);
  const activeOpsCount = operators.filter((o) => o.isParticipating && !o.isOnLeave && !o.isPenalized).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full overflow-hidden">
      {/* ── ESQUERDA: Painel de Controle de Participantes (7 cols) ─────────── */}
      <div className="lg:col-span-7 flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1 animate-fadeIn">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <Users className="h-4.5 w-4.5 text-primary" />
              Configuração do Rodízio
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Defina a disponibilidade da equipe para recebimento automático de leads pós-triagem da Valentina.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchRodizioData}
              title="Atualizar lista ao vivo"
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-primary" : ""}`} />
            </button>

            <button
              onClick={handleResetCounters}
              disabled={isResetting}
              className="text-[11px] font-extrabold text-primary hover:text-primary-hover bg-primary-soft/80 hover:bg-primary-soft border border-primary/20 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isResetting ? "animate-spin" : ""}`} />
              {isResetting ? "Zerando..." : "Zerar Tudo"}
            </button>
          </div>
        </div>

        {/* ── LISTA DE OPERADORES REAIS DO BANCO ────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {operators.length === 0 ? (
            <div className="p-8 rounded-2xl border border-border bg-card text-center space-y-2">
              <Users className="h-8 w-8 text-muted-foreground/40 mx-auto animate-pulse" />
              <p className="text-xs font-extrabold text-foreground">Carregando operadores do sistema...</p>
              <p className="text-[10px] text-muted-foreground">Cadastre novos operadores na aba de gestão para ativá-los no rodízio.</p>
            </div>
          ) : (
            operators.map((op) => {
              const isAvailable = op.isParticipating && !op.isOnLeave && !op.isPenalized;

              return (
                <div
                  key={op.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    isAvailable
                      ? "bg-card border-primary/20 shadow-soft"
                      : "bg-muted/20 border-border opacity-80"
                  }`}
                >
                  {/* Nome & Status Badge (Harmonia Verde) */}
                  <div className="flex items-center gap-3">
                    <OperatorAvatar
                      id={op.id}
                      name={op.name}
                      avatar={op.avatar || globalOperators?.find((g) => g.id === op.id || (g.email && op.email && g.email.toLowerCase() === op.email.toLowerCase()))?.avatar}
                      size="h-10 w-10"
                      fontSize="text-xs"
                    />
                    <div>
                      <h3 className="text-xs font-extrabold text-foreground">{op.name}</h3>
                      <div className="flex items-center gap-1.5 mt-1">
                        {op.isOnLeave ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-extrabold bg-primary-soft/60 text-primary border border-primary/20">
                            <Palmtree className="h-2.5 w-2.5" />
                            Em Folga
                          </span>
                        ) : op.isPenalized ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-extrabold bg-muted text-muted-foreground border border-border italic">
                            <Ban className="h-2.5 w-2.5" />
                            Penalizado (Pausado)
                          </span>
                        ) : op.isParticipating ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-extrabold bg-primary-soft text-primary border border-primary/30">
                            <UserCheck className="h-2.5 w-2.5 text-primary" />
                            Participando
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-extrabold bg-muted text-muted-foreground border border-border">
                            <UserX className="h-2.5 w-2.5" />
                            Inativo
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Botões de Ação com Estilo Verde Harmonizado */}
                  <div className="flex items-center gap-2 border-t md:border-t-0 pt-3 md:pt-0 border-line/60">
                    {/* Toggle Participando */}
                    <button
                      onClick={() => updateOperatorState(op.id, "isParticipating")}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-extrabold transition cursor-pointer flex items-center gap-1 border ${
                        op.isParticipating
                          ? "bg-primary text-primary-foreground border-primary shadow-soft"
                          : "bg-muted text-muted-foreground hover:bg-muted/80 border-border"
                      }`}
                    >
                      {op.isParticipating ? "Participando" : "Ignorar no Rodízio"}
                    </button>

                    {/* Toggle Folga */}
                    <button
                      onClick={() => updateOperatorState(op.id, "isOnLeave")}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-extrabold transition cursor-pointer flex items-center gap-1 border ${
                        op.isOnLeave
                          ? "bg-primary-soft text-primary border-primary/30 font-black"
                          : "bg-muted text-muted-foreground hover:bg-muted/80 border-border"
                      }`}
                      title="Marcar Folga do Operador"
                    >
                      <Palmtree className="h-3 w-3" />
                      Folga
                    </button>

                    {/* Toggle Penalizar */}
                    <button
                      onClick={() => updateOperatorState(op.id, "isPenalized")}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-extrabold transition cursor-pointer flex items-center gap-1 border ${
                        op.isPenalized
                          ? "bg-primary-soft/50 text-muted-foreground border-border italic"
                          : "bg-muted text-muted-foreground hover:bg-muted/80 border-border"
                      }`}
                      title="Penalizar Operador (Sem novos leads hoje)"
                    >
                      <Ban className="h-3 w-3" />
                      Penalizar
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── DIREITA: Estatísticas & Fila de Contabilidade (5 cols) ─────────── */}
      <div className="lg:col-span-5 flex flex-col gap-4 bg-muted/20 border border-border rounded-2xl p-4 overflow-y-auto scrollbar-thin">
        {/* Métricas Rápidas */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-card border border-primary/20 rounded-2xl flex flex-col gap-1 shadow-soft">
            <span className="text-[9px] font-extrabold text-muted-foreground uppercase tracking-wider">Leads Hoje</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black text-primary">{totalLeadsToday}</span>
              <span className="text-[10px] text-muted-foreground">recebidos</span>
            </div>
          </div>
          <div className="p-3 bg-card border border-primary/20 rounded-2xl flex flex-col gap-1 shadow-soft">
            <span className="text-[9px] font-extrabold text-muted-foreground uppercase tracking-wider">Disponíveis</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black text-primary">{activeOpsCount}</span>
              <span className="text-[10px] text-muted-foreground">operadores</span>
            </div>
          </div>
        </div>

        {/* ── CONTABILIDADE DE ATENDIMENTOS (LEADS ALOCADOS PELA VALENTINA) ────── */}
        <div className="flex flex-col gap-3 flex-1">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <h3 className="text-xs font-extrabold text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Shuffle className="h-3.5 w-3.5 text-primary" />
              Contabilidade de Atendimentos
            </h3>
            <span className="text-[10px] text-muted-foreground font-semibold">Ordem do Rodízio</span>
          </div>

          <div className="flex flex-col gap-2.5">
            {operators.filter((o) => o.isParticipating).length === 0 ? (
              <div className="p-6 bg-card border border-border rounded-xl text-center">
                <p className="text-xs font-bold text-muted-foreground">Nenhum vendedor participando no momento.</p>
              </div>
            ) : (
              operators
                .filter((o) => o.isParticipating)
                .sort((a, b) => (a.leadsReceivedCount || 0) - (b.leadsReceivedCount || 0))
                .map((op, idx) => {
                  return (
                    <div key={op.id} className="p-3 bg-card border border-border rounded-xl flex flex-col gap-2 shadow-soft">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black text-primary bg-primary-soft px-1.5 py-0.5 rounded-md">
                            {idx + 1}º
                          </span>
                          <OperatorAvatar
                            id={op.id}
                            name={op.name}
                            avatar={op.avatar || globalOperators?.find((g) => g.id === op.id || (g.email && op.email && g.email.toLowerCase() === op.email.toLowerCase()))?.avatar}
                            size="h-6 w-6"
                            fontSize="text-[9px]"
                          />
                          <span className="text-xs font-extrabold text-foreground">{op.name}</span>
                        </div>
                        <span className="text-[10px] font-extrabold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-md">
                          {op.leadsReceivedCount || 0} leads
                        </span>
                      </div>

                      {/* Histórico dos Leads Recentes alocados pela Valentina */}
                      {op.recentLeads && op.recentLeads.length > 0 && (
                        <div className="flex flex-col gap-1 border-t border-line/60 pt-2 mt-1">
                          {op.recentLeads.map((lead, lIdx) => (
                            <div key={lIdx} className="flex items-center justify-between text-[10px] hover:bg-muted/40 p-1.5 rounded-lg transition">
                              <span className="text-foreground font-bold truncate max-w-[160px]">
                                {lead.clientName}
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[9px] text-muted-foreground">{lead.receivedAt}</span>
                                <button
                                  onClick={() => handleOpenLeadChat(lead.chatId)}
                                  className="text-primary hover:text-primary-hover flex items-center gap-0.5 cursor-pointer font-black"
                                >
                                  Abrir
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
