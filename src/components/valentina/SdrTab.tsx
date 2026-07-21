// ══════════════════════════════════════════════════════════════════════════════
// 📋 SDR TAB — Monitoramento de triagens SDR & Controle de Whitelist de Testes
// ══════════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserPlus, CheckCircle, Clock, XCircle, Bot, User as UserIcon,
  ChevronRight, Circle, Search, ExternalLink, ShieldCheck, Smartphone,
  Power, Save, RefreshCw
} from "lucide-react";
import { SDR_TRIAGE_SESSIONS, SdrTriageSession } from "./valentina-mock-data";
import { useChat } from "@/hooks/useChatState";
import { toast } from "sonner";

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SdrTriageSession["status"] }) {
  const styles = {
    active: "bg-primary-soft text-primary border-primary/20",
    completed: "bg-gray-100 text-gray-600 border-gray-200",
    abandoned: "bg-red-100 text-red-600 border-red-200",
  };
  const labels = { active: "Ativo", completed: "Concluído", abandoned: "Abandonado" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${styles[status]}`}>
      {status === "active" && <Circle className="h-2 w-2 fill-primary text-primary" />}
      {status === "completed" && <CheckCircle className="h-2.5 w-2.5" />}
      {status === "abandoned" && <XCircle className="h-2.5 w-2.5" />}
      {labels[status]}
    </span>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export function SdrTab() {
  const { tenant, setActiveView, setSelectedChatId } = useChat();

  // Configurações de Whitelist e Status do Agente
  const [sdrEnabled, setSdrEnabled] = useState(true);
  const [testMode, setTestMode] = useState(true);
  const [whitelistPhone, setWhitelistPhone] = useState("14998364338");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Lista de sessões (Mock + Reais)
  const [sessions, setSessions] = useState<SdrTriageSession[]>(SDR_TRIAGE_SESSIONS);
  const [selectedSession, setSelectedSession] = useState<SdrTriageSession>(SDR_TRIAGE_SESSIONS[0]);
  const [searchQuery, setSearchQuery] = useState("");

  // Carregar dados e configurações do SDR via API
  const fetchSdrData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/valentina/sdr?tenantId=${tenant}`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setSdrEnabled(Boolean(data.config.enabled));
          setTestMode(Boolean(data.config.testMode));
          if (data.config.whitelistPhone) {
            setWhitelistPhone(data.config.whitelistPhone);
          }
        }
        if (Array.isArray(data.sessions) && data.sessions.length > 0) {
          // Mapear mensagens mock de exibição se a sessão real não tiver mensagens separadas
          const formattedLiveSessions: SdrTriageSession[] = data.sessions.map((s: any) => ({
            id: s.id,
            contactName: s.contactName || "Cliente",
            company: s.company || "Empresa não informada",
            currentStep: s.currentStep || "Qualificação",
            stepNumber: 1,
            totalSteps: 7,
            collectedData: s.collectedData || {},
            startedAt: s.startedAt,
            status: s.status,
            outcome: s.outcome,
            messages: [
              { sender: "bot", text: "Olá! Sou a Valentina. Vamos realizar sua qualificação?", time: "Hoje" },
            ],
          }));

          // Combina sessões reais com os mocks de demonstração
          setSessions([...formattedLiveSessions, ...SDR_TRIAGE_SESSIONS]);
        }
      }
    } catch (e) {
      console.warn("[SdrTab] Erro ao carregar dados da API SDR, usando fallback local:", e);
    } finally {
      setIsLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchSdrData();
  }, [fetchSdrData]);

  // Salvar configurações de Whitelist
  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const res = await fetch("/api/valentina/sdr", {
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
        toast.success("Configurações do Agente SDR salvas com sucesso!");
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

  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    
    const matchName = session.contactName.toLowerCase().includes(q);
    const matchCompany = session.company.toLowerCase().includes(q);
    const matchMessages = session.messages.some((msg) =>
      msg.text.toLowerCase().includes(q)
    );

    return matchName || matchCompany || matchMessages;
  });

  useEffect(() => {
    if (filteredSessions.length > 0 && !filteredSessions.some(s => s.id === selectedSession.id)) {
      setSelectedSession(filteredSessions[0]);
    }
  }, [searchQuery, filteredSessions, selectedSession]);

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
              <h3 className="text-xs font-extrabold text-foreground">Modo de Testes — Whitelist</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${
                testMode ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-emerald-100 text-emerald-800 border-emerald-300"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testMode ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} />
                {testMode ? "WHITELIST ATIVA (1 NÚMERO)" : "PRODUÇÃO (TODOS OS LEADS)"}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Valentina responde exclusivamente ao número cadastrado abaixo durante os testes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Input do número Whitelist */}
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

          {/* Toggle Modo Teste */}
          <button
            onClick={() => setTestMode(!testMode)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              testMode ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" : "bg-muted text-muted-foreground border-border"
            }`}
          >
            Modo Teste: {testMode ? "ON" : "OFF"}
          </button>

          {/* Toggle Ativar Agente */}
          <button
            onClick={() => setSdrEnabled(!sdrEnabled)}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer border ${
              sdrEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
            }`}
          >
            <Power className="h-3.5 w-3.5" />
            {sdrEnabled ? "SDR Ativo" : "SDR Inativo"}
          </button>

          {/* Botão Salvar */}
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

      {/* ── PAINÉIS DE CONTEÚDO (Lista, Preview, Dados) ────────────────────── */}
      <div className="flex gap-4 flex-1 overflow-hidden min-h-0">
        {/* ── PAINEL ESQUERDO — Lista de sessões (30%) ──────────────────────── */}
        <div className="w-[30%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
          <div className="px-4 py-3 border-b border-line shrink-0 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-extrabold text-foreground flex items-center gap-2">
                  <UserPlus className="h-3.5 w-3.5 text-primary" />
                  Triagens SDR
                </h3>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {sessions.filter((s) => s.status === "active").length} ativas de {sessions.length} total
                </p>
              </div>
              <button
                onClick={fetchSdrData}
                title="Atualizar sessões"
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </button>
            </div>

            {/* Barra de Pesquisa */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
              <input
                type="text"
                placeholder="Buscar por nome, empresa ou fala..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-border bg-muted/20 text-[11px] focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50 text-foreground"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {filteredSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-10 italic">Nenhuma triagem encontrada.</p>
            ) : (
              filteredSessions.map((session) => {
                const isSelected = selectedSession.id === session.id;
                const completedCount = Object.values(session.collectedData || {}).filter(d => d.status === "filled").length;
                const totalCount = Math.max(Object.keys(session.collectedData || {}).length, 7);
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
                    <p className="text-[10px] text-muted-foreground truncate">{session.company}</p>
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

        {/* ── PAINEL CENTRAL — Preview do chat (45%) ───────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
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
                    <div className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-primary shrink-0 mr-2 self-end">
                      <UserIcon className="h-3 w-3" />
                    </div>
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
                    <div className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground shrink-0 ml-2 self-end">
                      <Bot className="h-3 w-3" />
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Resultado se concluído/abandonado */}
            {selectedSession.outcome && (
              <div className="flex justify-center mt-3 animate-fadeIn">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold ${
                  selectedSession.status === "completed"
                    ? "bg-primary-soft text-primary"
                    : "bg-red-100 text-red-600"
                }`}>
                  {selectedSession.status === "completed" ? (
                    <CheckCircle className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  {selectedSession.outcome}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── PAINEL DIREITO — Dados coletados (25%) ───────────────────────── */}
        <div className="w-[25%] shrink-0 flex flex-col overflow-hidden bg-card rounded-2xl border border-border shadow-soft">
          <div className="px-4 py-3 border-b border-line shrink-0 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                Dados Coletados
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {Object.values(selectedSession.collectedData || {}).filter((d) => d.status === "filled").length} de{" "}
                {Object.keys(selectedSession.collectedData || {}).length} campos
              </p>
            </div>

            <button
              onClick={() => {
                const idMap: Record<string, string> = {
                  "sdr-001": "chat-mock-1",
                  "sdr-002": "chat-mock-2",
                  "sdr-003": "chat-mock-3",
                  "sdr-004": "chat-mock-4",
                };
                const targetChatId = (selectedSession as any).conversationId || idMap[selectedSession.id] || "chat-mock-1";
                setSelectedChatId(targetChatId);
                setActiveView("chat");
                toast.info("Redirecionando para a conversa...");
              }}
              className="text-[10px] font-black text-primary hover:text-primary-hover bg-primary/10 hover:bg-primary/15 px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 cursor-pointer shrink-0"
              title="Abrir atendimento correspondente"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 scrollbar-thin">
            {Object.entries(selectedSession.collectedData || {}).map(([key, data]) => (
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

          {/* Informações extras no rodapé */}
          <div className="px-4 py-3 border-t border-line shrink-0 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              Início: {new Date(selectedSession.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ChevronRight className="h-3 w-3" />
              Etapa atual: <span className="font-semibold text-foreground truncate block max-w-[150px]">{selectedSession.currentStep}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
