// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR TAB — Monitoramento em Tempo Real do Agente SDR Valentina (100% Dados Reais)
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, CheckCircle, Clock, XCircle, Bot, User as UserIcon,
  ChevronRight, Circle, Search, ExternalLink, ShieldCheck, Smartphone,
  Power, Save, RefreshCw, MessageSquare, Square, UserCheck, Calendar, Filter
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";

export interface SdrTriageSession {
  id: string;
  conversationId: string;
  contactName: string;
  contactAvatar?: string | null;
  company: string;
  phone: string;
  currentStep: string;
  collectedData: Record<string, { value: string; status: "filled" | "pending" }>;
  startedAt: string;
  status: "active" | "completed" | "abandoned";
  outcome?: string;
  responsibleName?: string;
  messages: Array<{ sender: "client" | "bot"; text: string; time: string }>;
}

const VALENTINA_AVATAR = "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80";

const DEFAULT_SDR_FIELDS = [
  "NOME COMPLETO",
  "EMPRESA",
  "CNPJ OU CPF",
  "QUAL O TIPO DE PRODUTO?",
  "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO",
  "TIPO DE QUALIFICAÇÃO",
  "QUALIFICAÇÃO (TEMPERATURA)",
];

function normalizeKey(key: string): string {
  const clean = key.toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .trim();

  if (clean.includes("NOME")) return "NOME COMPLETO";
  if (clean.includes("EMPRESA") || clean.includes("RAZAO")) return "EMPRESA";
  if (clean.includes("CNPJ") || clean.includes("CPF") || clean.includes("DOCUMENTO")) return "CNPJ OU CPF";
  if (clean.includes("PRODUTO")) return "QUAL O TIPO DE PRODUTO?";
  if (clean.includes("PROJETO") || clean.includes("DESENVOLVIMENTO")) return "PROJETO OU DESENVOLVIMENTO? SIM OU NÃO";
  if (clean.includes("TEMPERATURA")) return "QUALIFICAÇÃO (TEMPERATURA)";
  if (clean.includes("QUALIFICACAO")) return "TIPO DE QUALIFICAÇÃO";

  return key.trim().toUpperCase();
}

function getMergedCollectedData(rawCollected: Record<string, any> = {}) {
  const merged: Record<string, { value: string; status: "filled" | "pending" }> = {};
  
  for (const field of DEFAULT_SDR_FIELDS) {
    merged[field] = {
      value: "Aguardando...",
      status: "pending",
    };
  }

  for (const [rawKey, rawVal] of Object.entries(rawCollected)) {
    if (!rawVal) continue;
    const textVal = typeof rawVal === "string" ? rawVal : rawVal.value;
    const isFilled = typeof rawVal === "object" && rawVal.status === "filled" 
      ? true 
      : Boolean(textVal && textVal.trim() !== "" && textVal !== "Aguardando..." && !textVal.toLowerCase().includes("mantem"));

    if (isFilled && textVal) {
      const canonicalKey = normalizeKey(rawKey);
      merged[canonicalKey] = {
        value: textVal.trim(),
        status: "filled",
      };
    }
  }

  return merged;
}

function StatusBadge({ status }: { status: SdrTriageSession["status"] }) {
  const styles = {
    active: "bg-primary-soft text-primary border-primary/20",
    completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
    abandoned: "bg-primary-soft/50 text-muted-foreground border-border",
  };
  const labels = { active: "Ativo", completed: "Concluído", abandoned: "Encerrado" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status]}`}>
      {status === "active" && <Circle className="h-2 w-2 fill-primary text-primary animate-pulse" />}
      {status === "completed" && <CheckCircle className="h-2.5 w-2.5 text-emerald-600" />}
      {status === "abandoned" && <Clock className="h-2.5 w-2.5 text-muted-foreground" />}
      {labels[status]}
    </span>
  );
}

export function SdrTab() {
  const { tenant, setActiveView, setSelectedChatId } = useChat();

  const [sdrEnabled, setSdrEnabled] = useState(true);
  const [testMode, setTestMode] = useState(true);
  const [whitelistPhone, setWhitelistPhone] = useState("14998364338");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Filtros
  const [onlyCompletedFilter, setOnlyCompletedFilter] = useState(false);
  const [periodFilter, setPeriodFilter] = useState<"todos" | "hoje" | "7dias" | "30dias">("todos");
  const [isStoppingValentina, setIsStoppingValentina] = useState(false);

  // ESTADOS REAIS — Sem Mocks!
  const [sessions, setSessions] = useState<SdrTriageSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<SdrTriageSession | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  // Carregar dados e configurações REAIS do SDR via API
  const fetchSdrData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr?tenantId=${tenant}`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setSdrEnabled(Boolean(data.config.enabled));
          setTestMode(Boolean(data.config.testMode));
          if (data.config.whitelistPhone) {
            setWhitelistPhone(data.config.whitelistPhone);
          }
        }
        if (Array.isArray(data.sessions)) {
          const formattedLiveSessions: SdrTriageSession[] = data.sessions.map((s: any) => ({
            id: s.id,
            conversationId: s.conversationId,
            contactName: s.contactName || "Cliente WhatsApp",
            contactAvatar: s.contactAvatar || null,
            company: s.company || "Empresa não informada",
            phone: s.phone || "",
            currentStep: s.currentStep || "Qualificação",
            collectedData: s.collectedData || {},
            startedAt: s.startedAt,
            status: s.status,
            outcome: s.outcome,
            responsibleName: s.responsibleName,
            messages: s.messages || [],
          }));

          setSessions(formattedLiveSessions);
          setSelectedSession((prev) => {
            if (!prev) return formattedLiveSessions[0] || null;
            const match = formattedLiveSessions.find((s) => s.id === prev.id);
            return match || formattedLiveSessions[0] || null;
          });
        }
      }
    } catch (e) {
      console.warn("[SdrTab] Erro ao carregar dados reais do SDR:", e);
    } finally {
      setIsLoading(false);
    }
  }, [tenant, BACKEND_URL]);

  // Polling a cada 3 segundos para atualização ao vivo da triagem no WhatsApp
  useEffect(() => {
    fetchSdrData();
    const interval = setInterval(fetchSdrData, 3000);
    return () => clearInterval(interval);
  }, [fetchSdrData]);

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          enabled: sdrEnabled,
          testMode: testMode,
          whitelistPhone: whitelistPhone,
        }),
      });

      if (res.ok) {
        toast.success("Configurações do Agente SDR salvas!");
      } else {
        toast.error("Erro ao salvar configurações do SDR.");
      }
    } catch (e) {
      console.error("Erro ao salvar config:", e);
      toast.error("Erro ao comunicar com o servidor.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleStopValentina = async () => {
    if (!selectedSession) return;
    setIsStoppingValentina(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/valentina/sdr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stop",
          conversationId: selectedSession.conversationId,
          tenantId: tenant,
        }),
      });

      if (res.ok) {
        toast.success("Atendimento da Valentina interrompido para este contato!");
        setSessions((prev) =>
          prev.map((s) =>
            s.id === selectedSession.id
              ? {
                  ...s,
                  status: "abandoned",
                  outcome: "stopped",
                  responsibleName: "Interrompido (Atendimento Manual)",
                }
              : s
          )
        );
        setSelectedSession((prev) =>
          prev
            ? {
                ...prev,
                status: "abandoned",
                outcome: "stopped",
                responsibleName: "Interrompido (Atendimento Manual)",
              }
            : null
        );
      } else {
        toast.error("Erro ao interromper a Valentina.");
      }
    } catch (e) {
      console.error("Erro ao interromper a Valentina:", e);
      toast.error("Erro de conexão ao interromper a Valentina.");
    } finally {
      setIsStoppingValentina(false);
    }
  };

  const filteredSessions = sessions.filter((session) => {
    if (onlyCompletedFilter) {
      const isCompleted = session.status === "completed" || session.outcome === "completed" || session.outcome === "transferred";
      if (!isCompleted) return false;
    }

    if (periodFilter !== "todos" && session.startedAt) {
      const sessionDate = new Date(session.startedAt);
      const now = new Date();
      if (periodFilter === "hoje") {
        if (sessionDate.toDateString() !== now.toDateString()) return false;
      } else if (periodFilter === "7dias") {
        const diffDays = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 7) return false;
      } else if (periodFilter === "30dias") {
        const diffDays = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays > 30) return false;
      }
    }

    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const matchName = session.contactName.toLowerCase().includes(q);
    const matchCompany = session.company.toLowerCase().includes(q);
    const matchPhone = session.phone.toLowerCase().includes(q);
    const matchMessages = (session.messages || []).some((msg) =>
      msg.text.toLowerCase().includes(q)
    );
    return matchName || matchCompany || matchPhone || matchMessages;
  });

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      {/* ── PAINEL SUPERIOR — Controle da Whitelist de Testes ──────────────── */}
      <div className="bg-card rounded-2xl border border-border shadow-soft px-4 py-3 shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary font-bold">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-extrabold text-foreground">Modo de Testes — Whitelist SDR</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${
                testMode ? "bg-primary-soft text-primary border-primary/30" : "bg-primary-soft/50 text-muted-foreground border-border"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testMode ? "bg-primary animate-pulse" : "bg-muted-foreground"}`} />
                {testMode ? "WHITELIST ATIVA (1 NÚMERO)" : "PRODUÇÃO (TODOS OS LEADS)"}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Valentina responde exclusivamente ao número cadastrado abaixo durante os testes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <Smartphone className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={whitelistPhone}
              onChange={(e) => setWhitelistPhone(e.target.value)}
              placeholder="Ex: 14998364338"
              className="pl-8 pr-3 py-1.5 w-44 rounded-xl border border-border bg-muted/20 text-xs font-mono font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              title="Número de telefone de teste autorizador"
            />
          </div>

          <button
            onClick={() => setTestMode(!testMode)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              testMode ? "bg-primary-soft text-primary border-primary/30" : "bg-muted text-muted-foreground border-border"
            }`}
          >
            Modo Teste: {testMode ? "ON" : "OFF"}
          </button>

          <button
            onClick={() => setSdrEnabled(!sdrEnabled)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              sdrEnabled ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {sdrEnabled ? "SDR Ativo" : "SDR Inativo"}
          </button>

          <button
            onClick={handleSaveConfig}
            disabled={isSavingConfig}
            className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold hover:bg-primary-hover transition flex items-center gap-1.5 cursor-pointer shadow-soft disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {isSavingConfig ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>

      {/* ── PAINÉIS DE CONTEÚDO AO VIVO REAIS ───────────────────────────────── */}
      <div className="flex gap-4 flex-1 overflow-hidden min-h-0">
        {/* ── PAINEL ESQUERDO — Lista de sessões reais (30%) ────────────────── */}
        <div className="w-[30%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
          <div className="px-4 py-3 border-b border-line shrink-0 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                  Triagens SDR (Ao Vivo)
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {sessions.filter((s) => s.status === "active").length} ativas de {sessions.length} total
                </p>
              </div>
              <button
                onClick={fetchSdrData}
                title="Atualizar sessões ao vivo"
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* ── BOTÕES DE FILTRO DE HARMONIA VERDE: CONCLUÍDOS E PERÍODO ───────── */}
            <div className="flex items-center gap-2 pt-0.5 flex-wrap">
              <button
                onClick={() => setOnlyCompletedFilter(!onlyCompletedFilter)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold transition flex items-center gap-1 cursor-pointer border ${
                  onlyCompletedFilter
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-primary-soft text-primary border-primary/20 hover:bg-primary-soft/80"
                }`}
              >
                <CheckCircle className="h-3 w-3" />
                Concluídos
              </button>

              <div className="relative flex items-center">
                <Calendar className="absolute left-2 h-3 w-3 text-primary pointer-events-none" />
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value as any)}
                  className="pl-6 pr-2 py-1 rounded-lg text-[10px] font-extrabold bg-primary-soft text-primary border border-primary/20 focus:outline-none focus:ring-1 focus:ring-primary/30 cursor-pointer"
                >
                  <option value="todos">Período: Todos</option>
                  <option value="hoje">Período: Hoje</option>
                  <option value="7dias">Período: 7 dias</option>
                  <option value="30dias">Período: 30 dias</option>
                </select>
              </div>
            </div>

            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
              <input
                type="text"
                placeholder="Buscar por nome, empresa ou mensagem..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-muted/20 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 text-foreground"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-6 text-center h-full gap-3">
                <div className="h-12 w-12 rounded-2xl bg-primary-soft/50 grid place-items-center text-primary">
                  <Bot className="h-6 w-6 animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xs font-extrabold text-foreground">Aguardando Triagens ao Vivo</h4>
                  <p className="text-[10px] text-muted-foreground mt-1 max-w-[200px]">
                    Envie uma mensagem pelo WhatsApp para o número cadastrado (<span className="font-mono text-primary font-bold">{whitelistPhone}</span>) para iniciar o atendimento real!
                  </p>
                </div>
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = selectedSession?.id === session.id;
                const mergedData = getMergedCollectedData(session.collectedData);
                const completedCount = Object.values(mergedData).filter((d) => d.status === "filled").length;
                const totalCount = Object.keys(mergedData).length;
                const progressPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
                
                return (
                  <button
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className={`w-full text-left px-4 py-3 border-b border-line transition cursor-pointer ${
                      isSelected
                        ? "bg-primary-soft border-l-2 border-l-primary"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-foreground truncate">{session.contactName}</span>
                      <StatusBadge status={session.status} />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{session.company} {session.phone ? `· ${session.phone}` : ""}</p>
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">
                          Campos {completedCount}/{totalCount}
                        </span>
                        <span className="text-[10px] font-semibold text-primary">
                          {Math.round(progressPct)}%
                        </span>
                      </div>
                      <div className="w-full h-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── PAINEL CENTRAL — Chat Real em Tempo Real (45%) ─────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
          {selectedSession ? (
            <>
              <div className="px-4 py-3 border-b border-line shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-extrabold text-foreground">{selectedSession.contactName}</h3>
                    <p className="text-[10px] text-muted-foreground">{selectedSession.company} · {selectedSession.currentStep}</p>
                  </div>
                  <StatusBadge status={selectedSession.status} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 scrollbar-thin">
                <AnimatePresence initial={false}>
                  {(selectedSession.messages || []).map((msg, idx) => (
                    <motion.div
                      key={`${selectedSession.id}-${idx}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: idx * 0.03 }}
                      className={`flex ${msg.sender === "bot" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.sender === "client" && (
                        selectedSession.contactAvatar ? (
                          <img
                            src={selectedSession.contactAvatar}
                            alt={selectedSession.contactName}
                            className="h-6 w-6 rounded-full object-cover shrink-0 mr-2 self-end border border-primary/20 shadow-soft"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-primary shrink-0 mr-2 self-end font-bold text-[10px] shadow-soft">
                            {selectedSession.contactName[0]?.toUpperCase() || "C"}
                          </div>
                        )
                      )}
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-[11px] leading-relaxed shadow-soft ${
                          msg.sender === "bot"
                            ? "bg-primary text-primary-foreground rounded-br-[5px]"
                            : "bg-muted border border-border text-foreground rounded-bl-[5px]"
                        }`}
                      >
                        {msg.text}
                        <span
                          className={`block mt-1 text-[9px] ${
                            msg.sender === "bot" ? "text-white/60" : "text-muted-foreground"
                          }`}
                        >
                          {msg.time}
                        </span>
                      </div>
                      {msg.sender === "bot" && (
                        <img
                          src={VALENTINA_AVATAR}
                          alt="Valentina"
                          className="h-6 w-6 rounded-full object-cover shrink-0 ml-2 self-end border border-primary/30 shadow-soft"
                          title="Valentina IA"
                        />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>

                {selectedSession.outcome && selectedSession.outcome !== "in_progress" && (
                  <div className="flex justify-center mt-3 animate-fadeIn">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-primary-soft text-primary border border-primary/20">
                      <CheckCircle className="h-3 w-3 text-primary" />
                      {selectedSession.outcome === "completed"
                        ? "Triagem Concluída"
                        : selectedSession.outcome === "transferred"
                        ? "Transferido para Vendedor"
                        : selectedSession.outcome === "stopped"
                        ? "Atendimento Interrompido"
                        : selectedSession.outcome}
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/30 mb-2" />
              <p className="text-xs font-bold text-muted-foreground">Nenhuma conversa selecionada</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">Selecione uma triagem na lista ao lado para acompanhar as mensagens em tempo real.</p>
            </div>
          )}
        </div>

        {/* ── PAINEL DIREITO — Dados Coletados Reais (25%) ─────────────────────── */}
        <div className="w-[25%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
          {selectedSession ? (
            (() => {
              const mergedData = getMergedCollectedData(selectedSession.collectedData);
              const filledCount = Object.values(mergedData).filter((d) => d.status === "filled").length;
              const totalCount = Object.keys(mergedData).length;

              return (
                <>
                  <div className="px-4 py-3 border-b border-line shrink-0 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                        <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                        Dados Coletados
                      </h3>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {filledCount} de {totalCount} campos
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={handleStopValentina}
                        disabled={isStoppingValentina || selectedSession.status === "abandoned" || selectedSession.outcome === "stopped"}
                        className="text-[10px] font-extrabold text-primary hover:text-primary-hover bg-primary-soft hover:bg-primary-soft/80 border border-primary/20 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer disabled:opacity-40"
                        title="Interromper instantaneamente as ações da Valentina para este contato"
                      >
                        <Square className="h-3 w-3 text-primary fill-primary/30" />
                        {isStoppingValentina ? "Parando..." : "Parar Valentina"}
                      </button>

                      <button
                        onClick={() => {
                          const targetChatId = selectedSession.conversationId;
                          setSelectedChatId(targetChatId);
                          setActiveView("chat");
                          toast.info("Redirecionando para o chat...");
                        }}
                        className="text-[10px] font-black text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer shrink-0"
                        title="Abrir atendimento correspondente"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Abrir
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
                    {Object.entries(mergedData).map(([key, data]) => (
                      <div
                        key={key}
                        className={`rounded-xl border p-3 transition ${
                          data.status === "filled"
                            ? "border-primary/20 bg-primary-soft/30"
                            : "border-border bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                            {key}
                          </span>
                          {data.status === "filled" ? (
                            <CheckCircle className="h-3 w-3 text-primary" />
                          ) : (
                            <Clock className="h-3 w-3 text-muted-foreground/50" />
                          )}
                        </div>
                        <p className={`text-xs font-bold ${
                          data.status === "filled" ? "text-foreground" : "text-muted-foreground/40 italic"
                        }`}>
                          {data.status === "filled" ? data.value : "Aguardando..."}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* ── SEÇÃO RESPONSÁVEL (RODÍZIO ALOCADO) ────────────────────────── */}
                  <div className="px-4 py-3 border-t border-line shrink-0 space-y-2">
                    <div className="rounded-xl border border-primary/20 bg-primary-soft/30 p-2.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] font-bold text-primary uppercase tracking-wide flex items-center gap-1">
                          <UserCheck className="h-3 w-3 text-primary" />
                          Responsável (Rodízio)
                        </span>
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 bg-primary/15 text-primary rounded-md">
                          {selectedSession.status === "completed" ? "Alocado" : "Pendente"}
                        </span>
                      </div>
                      <p className="text-xs font-extrabold text-foreground mt-0.5">
                        {selectedSession.responsibleName || "Valentina IA (Em Triagem)"}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-primary" />
                        Início: {selectedSession.startedAt ? new Date(selectedSession.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                      <span className="flex items-center gap-1 truncate max-w-[140px]">
                        <ChevronRight className="h-3 w-3 text-primary" />
                        Etapa: <span className="font-bold text-foreground truncate">{selectedSession.currentStep || "—"}</span>
                      </span>
                    </div>
                  </div>
                </>
              );
            })()
          ) : (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
              <Clock className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs font-bold text-muted-foreground">Sem dados selecionados</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
