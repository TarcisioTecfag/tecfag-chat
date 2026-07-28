import React, { useState, useEffect } from "react";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Star,
  ArrowRight,
  ChevronRight,
  MessageSquare,
  Calendar,
  RefreshCw,
  User,
  Shield,
  Zap,
  TrendingUp,
  Check,
  LogOut,
  X,
} from "lucide-react";
import { useChat } from "@/hooks/useChatState";
import { WhatsappLogo, InstagramLogo, MessengerLogo } from "@/components/chat/ChatList";
import { formatPhoneNumber } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const BACKEND_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:3000"
    : "";

interface ValentinaFeedProps {
  onOpenChat?: (chatId: string) => void;
  onSendPrompt?: (promptText: string) => void;
}

interface MyMetrics {
  activeChats: number;
  overdueAlerts: number;
  completedToday: number;
  avgResponseTimeFormatted: string;
  performanceScore: number;
}

interface SlaAlert {
  logId: string;
  conversationId: string;
  contactName: string;
  contactPhone: string;
  contactAvatar?: string;
  operatorId?: string;
  waitingMinutes: number;
  waitingSeconds: number;
  isOverdue: boolean;
  isCritical: boolean;
  lastMessagePreview: string;
}

interface TaskItem {
  id: string;
  name: string;
  type: string;
  status: string;
  dueDate: string | null;
  client?: { name: string; phone: string };
  deal?: { id: string; name: string };
}

// Subcomponente de Avatar com Fallback
function FeedAvatar({ avatar, name }: { avatar?: string | null; name: string }) {
  const [err, setErr] = useState(false);
  const initials = name ? name.slice(0, 2).toUpperCase() : "U";

  if (avatar && !err) {
    return (
      <img
        src={avatar}
        alt=""
        className="w-10 h-10 rounded-full object-cover border border-border shrink-0"
        onError={() => setErr(true)}
      />
    );
  }

  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary font-bold text-xs grid place-items-center shrink-0 border border-primary/20">
      {initials}
    </div>
  );
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 350, damping: 25 } },
};

export const ValentinaFeed: React.FC<ValentinaFeedProps> = ({
  onOpenChat,
}) => {
  const {
    tenant,
    currentOperatorId,
    operators,
    operatorProfile,
    updateOperatorProfile,
    conversations,
    setSelectedChatId,
    setActiveView,
    logout,
  } = useChat();

  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const currentOp = operators.find((o) => o.id === currentOperatorId) || operators[0];
  const opName = operatorProfile?.name || currentOp?.name || "Operador";
  const opEmail = operatorProfile?.email || currentOp?.email || "";
  const opStatus = operatorProfile?.status || currentOp?.status || "disponivel";

  const [metrics, setMetrics] = useState<MyMetrics>({
    activeChats: 0,
    overdueAlerts: 0,
    completedToday: 0,
    avgResponseTimeFormatted: "0m",
    performanceScore: 95,
  });

  const [slaAlerts, setSlaAlerts] = useState<SlaAlert[]>([]);
  const [myTasks, setMyTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Saudação com base na hora do dia
  const currentHour = new Date().getHours();
  const greetingTime =
    currentHour < 12 ? "Bom dia" : currentHour < 18 ? "Boa tarde" : "Boa noite";

  // Carrega dados reais do backend
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      if (currentOperatorId) {
        const mRes = await fetch(
          `${BACKEND_URL}/api/gestao/my-metrics?tenantId=${tenant}&operatorId=${currentOperatorId}`
        ).catch(() => null);
        if (mRes && mRes.ok) {
          const mData = await mRes.json();
          setMetrics(mData);
        }
      }

      const aRes = await fetch(
        `${BACKEND_URL}/api/gestao/alerts?tenantId=${tenant}`
      ).catch(() => null);
      if (aRes && aRes.ok) {
        const aData: SlaAlert[] = await aRes.json();
        const myAlerts = aData.filter(
          (a) => !a.operatorId || a.operatorId === currentOperatorId
        );
        setSlaAlerts(myAlerts);
      }

      if (opEmail) {
        const tRes = await fetch(
          `${BACKEND_URL}/api/tasks?tenantId=${tenant}&email=${encodeURIComponent(opEmail)}`
        ).catch(() => null);
        if (tRes && tRes.ok) {
          const tData = await tRes.json();
          setMyTasks(tData.tasks || []);
        }
      }
    } catch (err) {
      console.error("[ValentinaFeed] Erro ao carregar dados:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [tenant, currentOperatorId, opEmail]);

  const myRecentChats = conversations
    .filter(
      (c) =>
        c.operatorId === currentOperatorId ||
        c.walletOperatorId === currentOperatorId
    )
    .slice(0, 3);

  const handleOpenConversaById = (chatId: string) => {
    setSelectedChatId(chatId);
    setActiveView("chat");
    if (onOpenChat) onOpenChat(chatId);
  };

  const toggleStatus = () => {
    const nextStatus =
      opStatus === "disponivel"
        ? "pausa"
        : opStatus === "pausa"
        ? "desconectado"
        : "disponivel";
    updateOperatorProfile({ status: nextStatus });
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex flex-col gap-5 p-4 pb-24 max-w-lg mx-auto select-none"
    >
      {/* ─── 1. HEADER DO VENDEDOR & STATUS ─────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="bg-card border border-border rounded-3xl p-5 shadow-soft flex flex-col gap-3 relative z-20"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FeedAvatar avatar={operatorProfile?.avatar || currentOp?.avatar} name={opName} />
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground block">
                {greetingTime}, 👋
              </span>
              <h2 className="text-base font-bold text-foreground leading-tight">
                {opName}
              </h2>
            </div>
          </div>

          {/* Botão Seletor de Status com Micro-Animação */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setShowStatusMenu(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition shadow-soft cursor-pointer border ${
                opStatus === "disponivel"
                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                  : opStatus === "pausa"
                  ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  opStatus === "disponivel"
                    ? "bg-emerald-500 animate-pulse"
                    : opStatus === "pausa"
                    ? "bg-amber-500"
                    : "bg-gray-400"
                }`}
              />
              <span className="capitalize">{opStatus === "disponivel" ? "Disponível" : opStatus === "pausa" ? "Pausa" : "Desconectado"}</span>
            </motion.button>
          </div>
        </div>

        {/* Modal de Seleção de Status + Logout (Centralizado e Sem Corte) */}
        <AnimatePresence>
          {showStatusMenu && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div
                className="absolute inset-0"
                onClick={() => setShowStatusMenu(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 15 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 15 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="relative w-full max-w-xs bg-card border border-border rounded-3xl p-4 shadow-2xl z-10 flex flex-col gap-2.5 select-none"
              >
                <div className="flex items-center justify-between pb-2 border-b border-border text-xs font-bold text-foreground">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Alterar Status do Atendente
                  </span>
                  <button
                    onClick={() => setShowStatusMenu(false)}
                    className="w-7 h-7 rounded-full flex items-center justify-center bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* 🟢 1. Disponível */}
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    updateOperatorProfile({ status: "disponivel" });
                    setShowStatusMenu(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl px-3.5 py-2.5 text-xs font-bold transition cursor-pointer ${
                    opStatus === "disponivel"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-2xs"
                      : "bg-muted/40 hover:bg-muted text-foreground border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Disponível</span>
                  </div>
                  {opStatus === "disponivel" && <Check className="w-4 h-4 text-emerald-500" />}
                </motion.button>

                {/* 🟡 2. Pausa */}
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    updateOperatorProfile({ status: "pausa" });
                    setShowStatusMenu(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl px-3.5 py-2.5 text-xs font-bold transition cursor-pointer ${
                    opStatus === "pausa"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-2xs"
                      : "bg-muted/40 hover:bg-muted text-foreground border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                    <span>Em Pausa</span>
                  </div>
                  {opStatus === "pausa" && <Check className="w-4 h-4 text-amber-500" />}
                </motion.button>

                {/* 🔴 3. Desconectado */}
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    updateOperatorProfile({ status: "desconectado" });
                    setShowStatusMenu(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl px-3.5 py-2.5 text-xs font-bold transition cursor-pointer ${
                    opStatus === "desconectado"
                      ? "bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/30 shadow-2xs"
                      : "bg-muted/40 hover:bg-muted text-foreground border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
                    <span>Desconectado</span>
                  </div>
                  {opStatus === "desconectado" && <Check className="w-4 h-4 text-gray-400" />}
                </motion.button>

                <div className="my-1 border-t border-border/60" />

                {/* 🚪 Botão Discreto de Sair (Logout) */}
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    setShowStatusMenu(false);
                    logout();
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs font-bold text-destructive bg-destructive/10 hover:bg-destructive/20 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sair da Conta</span>
                </motion.button>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-2xl border border-border/50 flex items-center justify-between">
          <span className="font-medium">
            {metrics.overdueAlerts > 0
              ? `🚨 ${metrics.overdueAlerts} atendimento${metrics.overdueAlerts > 1 ? "s" : ""} requer${metrics.overdueAlerts > 1 ? "em" : ""} atenção!`
              : "✨ Todos os seus atendimentos estão em dia."}
          </span>
          <motion.button
            whileTap={{ scale: 0.85, rotate: 180 }}
            onClick={loadDashboardData}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition cursor-pointer"
            title="Atualizar painel"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
          </motion.button>
        </div>
      </motion.div>

      {/* ─── 2. CARROSSEL / GRID DE KPIS INDIVIDUAIS ───────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-2 gap-3">
        {/* KPI 1: SLA Médio Hoje */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          className="bg-card border border-border rounded-2xl p-4 shadow-soft flex flex-col justify-between transition-colors hover:border-primary/30"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Tempo Resposta</span>
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div>
            <span className="text-xl font-black text-foreground block">
              {metrics.avgResponseTimeFormatted || "0m"}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">Média de hoje</span>
          </div>
        </motion.div>

        {/* KPI 2: Alertas SLA Atrasados */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          className={`border rounded-2xl p-4 shadow-soft flex flex-col justify-between transition-colors ${
            metrics.overdueAlerts > 0 ? "bg-red-500/5 border-red-500/20" : "bg-card border-border"
          }`}
        >
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Atrasos SLA</span>
            <AlertTriangle className={`h-4 w-4 ${metrics.overdueAlerts > 0 ? "text-red-500 animate-bounce" : "text-emerald-500"}`} />
          </div>
          <div>
            <span className={`text-xl font-black block ${metrics.overdueAlerts > 0 ? "text-red-600" : "text-foreground"}`}>
              {metrics.overdueAlerts}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">Aguardando você</span>
          </div>
        </motion.div>

        {/* KPI 3: Atendimentos Concluídos Hoje */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          className="bg-card border border-border rounded-2xl p-4 shadow-soft flex flex-col justify-between transition-colors hover:border-emerald-500/30"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Concluídos</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </div>
          <div>
            <span className="text-xl font-black text-foreground block">
              {metrics.completedToday}
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">Encerrados hoje</span>
          </div>
        </motion.div>

        {/* KPI 4: Score de Qualidade IA */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          className="bg-card border border-border rounded-2xl p-4 shadow-soft flex flex-col justify-between transition-colors hover:border-amber-500/30"
        >
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider">Score I.A.</span>
            <Star className="h-4 w-4 text-amber-500 fill-amber-500/20" />
          </div>
          <div>
            <span className="text-xl font-black text-foreground block">
              {metrics.performanceScore}<span className="text-xs font-normal text-muted-foreground">/100</span>
            </span>
            <span className="text-[10px] text-muted-foreground font-medium">Avaliação Valentina</span>
          </div>
        </motion.div>
      </motion.div>

      {/* ─── 3. BLOCO 1: REQUER ATENÇÃO IMEDIATA (ALERTAS SLA REAIS) ───────── */}
      <motion.div variants={itemVariants} className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-red-500" />
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
              Requer Atenção Imediata
            </h3>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {slaAlerts.length}
          </span>
        </div>

        {slaAlerts.length > 0 ? (
          slaAlerts.slice(0, 3).map((alert) => (
            <motion.div
              key={alert.logId}
              whileTap={{ scale: 0.98 }}
              className="bg-card border border-red-500/30 rounded-3xl p-4 shadow-soft space-y-3 relative overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <FeedAvatar avatar={alert.contactAvatar} name={alert.contactName} />
                  <div>
                    <span className="font-bold text-sm text-foreground block leading-tight">
                      {alert.contactName}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {formatPhoneNumber(alert.contactPhone)}
                    </span>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 border border-red-500/20 shrink-0">
                  <Clock className="h-3 w-3" />
                  {alert.waitingMinutes > 0 ? `${alert.waitingMinutes}m atraso` : `${alert.waitingSeconds}s`}
                </span>
              </div>

              <div className="bg-muted/60 rounded-xl p-3 border border-border text-xs text-foreground/80 italic line-clamp-2">
                "{alert.lastMessagePreview}"
              </div>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => handleOpenConversaById(alert.conversationId)}
                className="w-full py-2.5 px-4 rounded-xl bg-primary hover:opacity-90 text-primary-foreground font-bold text-xs flex items-center justify-center gap-2 shadow-soft transition cursor-pointer"
              >
                <span>Responder Agora</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </motion.button>
            </motion.div>
          ))
        ) : (
          <div className="bg-card border border-border rounded-2xl p-5 text-center text-xs space-y-1 shadow-soft">
            <div className="h-9 w-9 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-2">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <p className="font-bold text-foreground">Nenhum atendimento atrasado!</p>
            <p className="text-[11px] text-muted-foreground">
              Você está respondendo todas as conversas dentro do limite de tempo.
            </p>
          </div>
        )}
      </motion.div>

      {/* ─── 4. BLOCO 2: MINHAS TAREFAS DO DIA (RD STATION CRM REAIS) ────────── */}
      <motion.div variants={itemVariants} className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
              Minhas Tarefas de Hoje
            </h3>
          </div>
          <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {myTasks.length}
          </span>
        </div>

        {myTasks.length > 0 ? (
          <div className="space-y-2">
            {myTasks.slice(0, 4).map((task) => (
              <motion.div
                key={task.id}
                whileTap={{ scale: 0.98 }}
                className="bg-card border border-border rounded-2xl p-3.5 shadow-soft flex items-center justify-between gap-3 hover:bg-muted/30 transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${
                    task.status === "done"
                      ? "bg-emerald-500/10 text-emerald-500"
                      : "bg-primary/10 text-primary"
                  }`}>
                    {task.status === "done" ? (
                      <Check className="h-4 w-4 stroke-[3]" />
                    ) : (
                      <Clock className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <span className={`block font-bold text-xs truncate ${task.status === "done" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {task.name}
                    </span>
                    {task.client?.name && (
                      <span className="text-[10px] text-muted-foreground font-medium truncate block">
                        Cliente: {task.client.name}
                      </span>
                    )}
                  </div>
                </div>

                <span className="text-[10px] font-extrabold uppercase px-2 py-1 rounded-lg bg-muted text-muted-foreground shrink-0">
                  {task.type || "Tarefa"}
                </span>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-5 text-center text-xs space-y-1 shadow-soft">
            <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
              <Calendar className="h-5 w-5" />
            </div>
            <p className="font-bold text-foreground">Nenhuma tarefa agendada</p>
            <p className="text-[11px] text-muted-foreground">
              Suas tarefas do RD Station CRM aparecerão aqui automaticamente.
            </p>
          </div>
        )}
      </motion.div>

      {/* ─── 5. BLOCO 3: CONVERSAS RECENTES (ACESSO RÁPIDO) ────────────────── */}
      <motion.div variants={itemVariants} className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
              Conversas Recentes
            </h3>
          </div>
          <button
            onClick={() => setActiveView("chat")}
            className="text-[10px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
          >
            Ver todas
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        {myRecentChats.length > 0 ? (
          <div className="space-y-2">
            {myRecentChats.map((c) => (
              <motion.div
                key={c.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleOpenConversaById(c.id)}
                className="bg-card border border-border hover:border-primary/40 rounded-2xl p-3.5 shadow-soft flex items-center justify-between gap-3 transition cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FeedAvatar avatar={c.avatar} name={c.name} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs text-foreground truncate">
                        {c.name}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.2 text-[8px] font-bold text-white ${
                        c.channel === "whatsapp"
                          ? "bg-emerald-500"
                          : c.channel === "instagram"
                          ? "bg-purple-600"
                          : "bg-blue-600"
                      }`}>
                        {c.channel === "whatsapp" && <WhatsappLogo className="h-2 w-2" />}
                        {c.channel === "instagram" && <InstagramLogo className="h-2 w-2" />}
                        {c.channel === "messenger" && <MessengerLogo className="h-2 w-2" />}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate block mt-0.5">
                      {c.messages && c.messages.length > 0
                        ? c.messages[c.messages.length - 1].text
                        : "Sem mensagens recentes"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 text-xs font-bold text-primary">
                  <span>Abrir</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="bg-card border border-border rounded-2xl p-5 text-center text-xs space-y-1 shadow-soft">
            <p className="font-bold text-foreground">Nenhum atendimento ativo</p>
            <p className="text-[11px] text-muted-foreground">
              Atribua atendimentos a você na aba Atendimentos para visualizá-los aqui.
            </p>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};
