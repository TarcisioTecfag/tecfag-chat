import React, { useState, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  Shuffle,
  Play,
  UserCheck,
  UserX,
  Palmtree,
  Ban,
  ExternalLink,
  Users,
  Activity,
  Award,
  RefreshCw,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

type RodizioOperator = {
  id: string;
  name: string;
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

const SIMULATED_NAMES = [
  "Marcela Santos",
  "Bruno Lima",
  "Fernanda Azevedo",
  "Rodrigo Rocha",
  "Cláudia Medeiros",
  "Gustavo Alencar",
  "Letícia Peixoto",
  "Thiago Cardoso",
  "Aline Vieira",
  "Felipe Rezende"
];

export function RodizioTab() {
  const { tenant, setActiveView, setSelectedChatId } = useChat();

  const [operators, setOperators] = useState<RodizioOperator[]>(() => {
    const saved = localStorage.getItem(`valem_rodizio_operators_${tenant}`);
    if (saved) return JSON.parse(saved);
    
    // Default initial mock data matching our system operators
    return [
      {
        id: "op-mock-1",
        name: "Faggner Silva",
        isParticipating: true,
        isOnLeave: false,
        isPenalized: false,
        leadsReceivedCount: 4,
        recentLeads: [
          { chatId: "chat-mock-1", clientName: "Carlos Mendes (SM Ltda)", receivedAt: "10:30" },
          { chatId: "chat-mock-2", clientName: "Eduardo Souza", receivedAt: "14:15" },
        ]
      },
      {
        id: "op-mock-2",
        name: "Ana Paula",
        isParticipating: true,
        isOnLeave: false,
        isPenalized: false,
        leadsReceivedCount: 5,
        recentLeads: [
          { chatId: "chat-mock-3", clientName: "Roberto Silveira", receivedAt: "09:12" },
        ]
      },
      {
        id: "op-mock-3",
        name: "Pedro Henrique",
        isParticipating: true,
        isOnLeave: true, // Folga
        isPenalized: false,
        leadsReceivedCount: 1,
        recentLeads: []
      },
      {
        id: "op-mock-4",
        name: "Juliana Costa",
        isParticipating: true,
        isOnLeave: false,
        isPenalized: true, // Penalizado
        leadsReceivedCount: 2,
        recentLeads: []
      },
      {
        id: "op-mock-5",
        name: "Marcos Vinícius",
        isParticipating: false, // Inativo
        isOnLeave: false,
        isPenalized: false,
        leadsReceivedCount: 0,
        recentLeads: []
      }
    ];
  });

  useEffect(() => {
    localStorage.setItem(`valem_rodizio_operators_${tenant}`, JSON.stringify(operators));
  }, [operators, tenant]);

  const updateOperatorState = (
    opId: string,
    key: "isParticipating" | "isOnLeave" | "isPenalized"
  ) => {
    setOperators(prev =>
      prev.map(op => {
        if (op.id !== opId) return op;
        const updated = { ...op, [key]: !op[key] };
        
        // Mutuamente exclusivos para melhor usabilidade:
        if (key === "isOnLeave" && updated.isOnLeave) {
          updated.isPenalized = false;
        }
        if (key === "isPenalized" && updated.isPenalized) {
          updated.isOnLeave = false;
        }

        return updated;
      })
    );
    toast.success("Status do operador atualizado!");
  };

  const handleResetCounters = () => {
    setOperators(prev =>
      prev.map(op => ({
        ...op,
        leadsReceivedCount: 0,
        recentLeads: []
      }))
    );
    toast.success("Contadores de leads reiniciados!");
  };

  const handleSimulateLead = () => {
    // Filtra operadores elegíveis (Ativos, Sem folga e Sem penalização)
    const eligible = operators.filter(o => o.isParticipating && !o.isOnLeave && !o.isPenalized);
    
    if (eligible.length === 0) {
      toast.error("Erro: Nenhum operador elegível no momento para receber leads!");
      return;
    }

    // Algoritmo Round-Robin simplificado por contador:
    // Seleciona quem tem menos leads recebidos para balanceamento perfeito
    const sorted = [...eligible].sort((a, b) => a.leadsReceivedCount - b.leadsReceivedCount);
    const chosen = sorted[0];

    const randomName = SIMULATED_NAMES[Math.floor(Math.random() * SIMULATED_NAMES.length)];
    const timeNow = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const mockChatId = `chat-sim-${Math.floor(Math.random() * 9000) + 1000}`;

    setOperators(prev =>
      prev.map(op => {
        if (op.id !== chosen.id) return op;
        return {
          ...op,
          leadsReceivedCount: op.leadsReceivedCount + 1,
          recentLeads: [
            { chatId: mockChatId, clientName: randomName, receivedAt: timeNow },
            ...op.recentLeads.slice(0, 4) // Mantém as 5 mais recentes
          ]
        };
      })
    );

    toast.success(`Novo Lead (${randomName}) direcionado para ${chosen.name}!`);
  };

  const handleOpenLeadChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setActiveView("chat");
    toast.info("Redirecionando para a conversa...");
  };

  // Cálculo de estatísticas gerais
  const totalLeadsToday = operators.reduce((acc, o) => acc + o.leadsReceivedCount, 0);
  const activeOpsCount = operators.filter(o => o.isParticipating && !o.isOnLeave && !o.isPenalized).length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full overflow-hidden">
      {/* Esquerda: Painel de Controle de Participantes */}
      <div className="lg:col-span-7 flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1 animate-fadeIn">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h2 className="text-sm font-extrabold text-foreground flex items-center gap-2">
              <Users className="h-4.5 w-4.5 text-primary" />
              Configuração do Rodízio
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Defina quem está disponível hoje para receber novos leads</p>
          </div>
          <button
            onClick={handleResetCounters}
            className="text-[11px] font-extrabold text-muted-foreground hover:text-foreground hover:bg-muted border border-border px-3 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            Zerar Tudo
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {operators.map(op => {
            const isAvailable = op.isParticipating && !op.isOnLeave && !op.isPenalized;
            
            return (
              <div
                key={op.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isAvailable 
                    ? "bg-card border-border shadow-soft" 
                    : "bg-muted/15 border-border/60 opacity-90"
                }`}
              >
                {/* Nome & Status Badge */}
                <div className="flex items-center gap-3">
                  <div className={`h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-xs text-primary shrink-0`}>
                    {op.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <div>
                    <h3 className="text-xs font-black text-foreground">{op.name}</h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      {op.isOnLeave ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          <Palmtree className="h-2.5 w-2.5" />
                          Folga
                        </span>
                      ) : op.isPenalized ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-50 text-red-700 border border-red-200">
                          <Ban className="h-2.5 w-2.5" />
                          Penalizado (Bloqueado)
                        </span>
                      ) : op.isParticipating ? (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <UserCheck className="h-2.5 w-2.5" />
                          Participando
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-gray-50 text-gray-500 border border-gray-200">
                          <UserX className="h-2.5 w-2.5" />
                          Inativo
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Ações / Toggles */}
                <div className="flex items-center gap-2 border-t md:border-t-0 pt-3 md:pt-0 border-line/60">
                  {/* Toggle Participando */}
                  <button
                    onClick={() => updateOperatorState(op.id, "isParticipating")}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer flex items-center gap-1 ${
                      op.isParticipating
                        ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200"
                        : "bg-muted text-muted-foreground hover:bg-muted/70 border border-border"
                    }`}
                  >
                    {op.isParticipating ? "Participando" : "Ignorar no Rodízio"}
                  </button>

                  {/* Toggle Folga */}
                  <button
                    onClick={() => updateOperatorState(op.id, "isOnLeave")}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer flex items-center gap-1 ${
                      op.isOnLeave
                        ? "bg-amber-500 text-white hover:bg-amber-600"
                        : "bg-muted text-muted-foreground hover:bg-muted/70 border border-border"
                    }`}
                    title="Marcar Folga"
                  >
                    <Palmtree className="h-3 w-3" />
                    Folga
                  </button>

                  {/* Toggle Penalizar */}
                  <button
                    onClick={() => updateOperatorState(op.id, "isPenalized")}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer flex items-center gap-1 ${
                      op.isPenalized
                        ? "bg-red-600 text-white hover:bg-red-700"
                        : "bg-muted text-muted-foreground hover:bg-muted/70 border border-border"
                    }`}
                    title="Penalizar Operador (Sem leads hoje)"
                  >
                    <Ban className="h-3 w-3" />
                    Penalizar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Direita: Métricas & Histórico Recente do Rodízio */}
      <div className="lg:col-span-5 flex flex-col gap-5 bg-muted/20 border border-border/80 rounded-2xl p-5 overflow-y-auto scrollbar-thin">
        {/* Ativação do Simulador */}
        <div className="flex flex-col gap-3">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-black text-foreground">Simulador de Leads</h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Teste o algoritmo distribuindo um lead agora.</p>
            </div>
            <button
              onClick={handleSimulateLead}
              className="bg-primary hover:bg-primary-hover text-primary-foreground font-black text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 shadow-soft transition cursor-pointer"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              Direcionar Lead
            </button>
          </div>
        </div>

        {/* Estatísticas Rápidas */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-card border border-border rounded-xl flex flex-col gap-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Leads Hoje</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-black text-foreground">{totalLeadsToday}</span>
              <span className="text-[10px] text-muted-foreground">recebidos</span>
            </div>
          </div>
          <div className="p-3 bg-card border border-border rounded-xl flex flex-col gap-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Disponíveis</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-black text-foreground">{activeOpsCount}</span>
              <span className="text-[10px] text-muted-foreground">operadores</span>
            </div>
          </div>
        </div>

        {/* Fila Real-Time / Contadores */}
        <div className="flex flex-col gap-3 flex-1">
          <h3 className="text-xs font-bold text-foreground uppercase tracking-widest flex items-center gap-1">
            <Shuffle className="h-4 w-4 text-primary" />
            Contabilidade de Atendimentos
          </h3>

          <div className="flex flex-col gap-2">
            {operators
              .filter(o => o.isParticipating)
              .map((op, idx) => {
                return (
                  <div key={op.id} className="p-3 bg-card border border-border rounded-xl flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-muted-foreground w-4">{idx + 1}º</span>
                        <span className="text-xs font-black text-foreground">{op.name}</span>
                      </div>
                      <span className="text-xs font-black text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                        {op.leadsReceivedCount} leads
                      </span>
                    </div>

                    {/* Leads Recentes */}
                    {op.recentLeads.length > 0 && (
                      <div className="flex flex-col gap-1 border-t border-line/60 pt-2 mt-1">
                        {op.recentLeads.map((lead, lIdx) => (
                          <div key={lIdx} className="flex items-center justify-between text-[10px] hover:bg-muted/30 p-1 rounded transition">
                            <span className="text-muted-foreground truncate max-w-[150px]">
                              {lead.clientName}
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[9px] text-muted-foreground">{lead.receivedAt}</span>
                              <button
                                onClick={() => handleOpenLeadChat(lead.chatId)}
                                className="text-primary hover:text-primary-hover flex items-center gap-0.5 cursor-pointer font-bold animate-pulse"
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
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
