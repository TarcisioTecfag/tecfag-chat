import React, { useState, useEffect, useCallback } from "react";
import { useChat } from "@/hooks/useChatState";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar as CalendarIcon,
  List,
  ChevronLeft,
  ChevronRight,
  Plus,
  FileSpreadsheet,
  RefreshCw,
  PhoneCall,
  Clock,
  CheckCircle2,
  AlertCircle,
  CalendarDays,
  Search,
  Filter,
  X,
  User,
  Building,
  Tag,
  Phone,
  ArrowRight,
  Trash2,
  Edit2,
  Check,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VoiceAgendaItem {
  id: string;
  tenantId: string;
  clientName: string;
  clientPhone: string;
  company?: string;
  scheduledAt: string; // ISO date-time string
  type: "follow_up" | "customer_request" | "excel_list" | "sdr_outreach";
  status: "pending" | "completed" | "rescheduled" | "cancelled" | "no_answer";
  priority: "low" | "normal" | "high" | "urgent";
  notes?: string;
  campaignName?: string;
  assignedAgent: string;
  createdAt: string;
  updatedAt: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startDay = firstDay.getDay();
  for (let i = startDay - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getTypeBadge(type: VoiceAgendaItem["type"]) {
  switch (type) {
    case "customer_request":
      return { label: "Cliente Solicitou", bg: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" };
    case "follow_up":
      return { label: "Follow-up", bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" };
    case "excel_list":
      return { label: "Lista Excel", bg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
    case "sdr_outreach":
      return { label: "Prospecção SDR", bg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
    default:
      return { label: "Agendamento", bg: "bg-muted text-muted-foreground border-border" };
  }
}

function getStatusBadge(status: VoiceAgendaItem["status"]) {
  switch (status) {
    case "completed":
      return { label: "Realizada", bg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" };
    case "pending":
      return { label: "Pendente", bg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };
    case "rescheduled":
      return { label: "Reagendada", bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" };
    case "cancelled":
      return { label: "Cancelada", bg: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" };
    case "no_answer":
      return { label: "Não Atendeu", bg: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" };
    default:
      return { label: status, bg: "bg-muted text-muted-foreground border-border" };
  }
}

export function AgendaTab() {
  const { tenant } = useChat();
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [agenda, setAgenda] = useState<VoiceAgendaItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Filtros da Visão Listagem
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Navegação do Calendário
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState<Date>(today);

  // Modais
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [rescheduleItem, setRescheduleItem] = useState<VoiceAgendaItem | null>(null);

  // Form State para Nova Ligação
  const [formData, setFormData] = useState({
    clientName: "",
    clientPhone: "",
    company: "",
    date: today.toISOString().split("T")[0],
    time: "10:00",
    type: "follow_up" as VoiceAgendaItem["type"],
    priority: "normal" as VoiceAgendaItem["priority"],
    notes: "",
  });

  // Form State para Excel Batch
  const [excelText, setExcelText] = useState("");
  const [excelCampaignName, setExcelCampaignName] = useState("Lista_Agosto_Excel");

  const days = getDaysInMonth(currentYear, currentMonth);

  // Fetch Agenda Data
  const fetchAgenda = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/voice-agenda?tenantId=${tenant}`);
      const data = await res.json();
      if (data.agenda) {
        setAgenda(data.agenda);
      }
    } catch (e) {
      console.error("[AgendaTab] Erro ao buscar agenda:", e);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => {
    fetchAgenda();
  }, [fetchAgenda]);

  // Atualizar Status
  const handleUpdateStatus = async (id: string, newStatus: VoiceAgendaItem["status"]) => {
    setAgenda((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    );

    try {
      await fetch("/api/voice-agenda", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, id, status: newStatus }),
      });
    } catch (e) {
      console.error("[AgendaTab] Erro ao atualizar status:", e);
    }
  };

  // Reagendar Ligação
  const handleReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleItem) return;

    const newScheduledAt = new Date(`${formData.date}T${formData.time}:00`).toISOString();

    setAgenda((prev) =>
      prev.map((item) =>
        item.id === rescheduleItem.id
          ? { ...item, scheduledAt: newScheduledAt, status: "rescheduled" }
          : item
      )
    );

    try {
      await fetch("/api/voice-agenda", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          id: rescheduleItem.id,
          scheduledAt: newScheduledAt,
          status: "rescheduled",
        }),
      });
    } catch (e) {
      console.error("[AgendaTab] Erro ao reagendar:", e);
    }

    setRescheduleItem(null);
  };

  // Criar Nova Ligação
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const scheduledAt = new Date(`${formData.date}T${formData.time}:00`).toISOString();

    const payload = {
      tenantId: tenant,
      clientName: formData.clientName,
      clientPhone: formData.clientPhone,
      company: formData.company,
      scheduledAt,
      type: formData.type,
      priority: formData.priority,
      notes: formData.notes,
      assignedAgent: "Valentina",
    };

    try {
      const res = await fetch("/api/voice-agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        fetchAgenda();
        setIsCreateModalOpen(false);
        setFormData({
          clientName: "",
          clientPhone: "",
          company: "",
          date: today.toISOString().split("T")[0],
          time: "10:00",
          type: "follow_up",
          priority: "normal",
          notes: "",
        });
      }
    } catch (e) {
      console.error("[AgendaTab] Erro ao criar agendamento:", e);
    }
  };

  // Importar Lista Excel
  const handleImportExcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excelText.trim()) return;

    const lines = excelText.trim().split("\n");
    const items = lines.map((line, idx) => {
      const parts = line.split(/[;,\t]/);
      const name = parts[0]?.trim() || `Contato ${idx + 1}`;
      const phone = parts[1]?.trim() || "";
      const company = parts[2]?.trim() || "";
      const notes = parts[3]?.trim() || "Importado via planilha Excel";

      // Distribuir horários nas próximas horas de hoje
      const scheduledDate = new Date();
      scheduledDate.setHours(9 + Math.floor(idx / 4), (idx % 4) * 15, 0, 0);

      return {
        clientName: name,
        clientPhone: phone,
        company,
        notes,
        type: "excel_list" as const,
        priority: "normal" as const,
        campaignName: excelCampaignName,
        scheduledAt: scheduledDate.toISOString(),
      };
    });

    try {
      const res = await fetch("/api/voice-agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant, items }),
      });
      const data = await res.json();
      if (data.success) {
        fetchAgenda();
        setIsExcelModalOpen(false);
        setExcelText("");
      }
    } catch (e) {
      console.error("[AgendaTab] Erro ao importar excel:", e);
    }
  };

  // Deletar item
  const handleDeleteItem = async (id: string) => {
    setAgenda((prev) => prev.filter((it) => it.id !== id));
    try {
      await fetch(`/api/voice-agenda?tenantId=${tenant}&id=${id}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.error("[AgendaTab] Erro ao deletar:", e);
    }
  };

  // Métricas
  const totalToday = agenda.filter((item) => isSameDay(new Date(item.scheduledAt), today)).length;
  const totalPending = agenda.filter((item) => item.status === "pending").length;
  const totalCompleted = agenda.filter((item) => item.status === "completed").length;
  const totalRescheduled = agenda.filter((item) => item.status === "rescheduled" || item.type === "follow_up").length;

  // Filtragem da Lista
  const filteredAgenda = agenda.filter((item) => {
    const matchesSearch =
      item.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.clientPhone.includes(searchQuery) ||
      (item.company && item.company.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.notes && item.notes.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    const matchesType = typeFilter === "all" || item.type === typeFilter;

    return matchesSearch && matchesStatus && matchesType;
  });

  // Ligações do Dia Selecionado na visão Calendário
  const selectedDayItems = agenda
    .filter((item) => isSameDay(new Date(item.scheduledAt), selectedDate))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return (
    <div className="flex flex-col h-full overflow-hidden space-y-4">
      {/* ─── Top Bar Controls & Metrics ────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border shadow-soft shrink-0">
        {/* Metric Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
            <CalendarDays className="h-4 w-4" />
            <span className="text-xs font-semibold">Hoje:</span>
            <span className="text-sm font-extrabold">{totalToday}</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400">
            <Clock className="h-4 w-4" />
            <span className="text-xs font-semibold">Pendentes:</span>
            <span className="text-sm font-extrabold">{totalPending}</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-semibold">Atendidas:</span>
            <span className="text-sm font-extrabold">{totalCompleted}</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400">
            <PhoneCall className="h-4 w-4" />
            <span className="text-xs font-semibold">Follow-ups:</span>
            <span className="text-sm font-extrabold">{totalRescheduled}</span>
          </div>
        </div>

        {/* View Switcher & Action Buttons */}
        <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
          {/* Alternador de Visão (2 Ícones) */}
          <div className="flex items-center p-1 rounded-xl bg-muted border border-border">
            <button
              onClick={() => setViewMode("calendar")}
              title="Visão Calendário"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === "calendar"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarIcon className="h-4 w-4 text-primary" />
              <span>Calendário</span>
            </button>

            <button
              onClick={() => setViewMode("list")}
              title="Visão Listagem"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                viewMode === "list"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <List className="h-4 w-4 text-primary" />
              <span>Listagem</span>
            </button>
          </div>

          <button
            onClick={() => setIsExcelModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/20 border border-emerald-500/20 text-xs font-bold transition-all"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span className="hidden sm:inline">Importar Excel</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 text-xs font-bold transition-all shadow-soft"
          >
            <Plus className="h-4 w-4" />
            <span>Agendar Ligação</span>
          </button>

          <button
            onClick={fetchAgenda}
            disabled={loading}
            title="Atualizar Agenda"
            className="p-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-all"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* ─── VISÃO CALENDÁRIO ──────────────────────────────────────────────── */}
      {viewMode === "calendar" && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 overflow-hidden">
          {/* Main Month Grid (2 Columns on Desktop) */}
          <div className="lg:col-span-2 flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden p-4">
            {/* Month Header Navigation */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
              <h2 className="text-lg font-extrabold text-foreground flex items-center gap-2">
                {MONTHS[currentMonth]} {currentYear}
              </h2>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    let m = currentMonth - 1;
                    let y = currentYear;
                    if (m < 0) {
                      m = 11;
                      y--;
                    }
                    setCurrentMonth(m);
                    setCurrentYear(y);
                  }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>

                <button
                  onClick={() => {
                    setCurrentMonth(today.getMonth());
                    setCurrentYear(today.getFullYear());
                    setSelectedDate(today);
                  }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-muted hover:bg-muted/80 text-foreground"
                >
                  Hoje
                </button>

                <button
                  onClick={() => {
                    let m = currentMonth + 1;
                    let y = currentYear;
                    if (m > 11) {
                      m = 0;
                      y++;
                    }
                    setCurrentMonth(m);
                    setCurrentYear(y);
                  }}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Weekdays Header */}
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {WEEKDAYS.map((w, idx) => (
                <div key={w} className={`text-xs font-extrabold uppercase py-1 ${idx === 0 || idx === 6 ? "text-muted-foreground/60" : "text-primary"}`}>
                  {w}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 grid-rows-6 gap-1.5 flex-1 overflow-auto">
              {days.map((day, idx) => {
                const isCurrentMonth = day.getMonth() === currentMonth;
                const isToday = isSameDay(day, today);
                const isSelected = isSameDay(day, selectedDate);

                const dayAgendaItems = agenda.filter((item) => isSameDay(new Date(item.scheduledAt), day));
                const pendingCount = dayAgendaItems.filter((i) => i.status === "pending").length;

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedDate(day)}
                    className={`relative flex flex-col justify-between p-1.5 rounded-xl border transition-all cursor-pointer min-h-[70px] ${
                      isSelected
                        ? "border-primary bg-primary/10 shadow-sm"
                        : isToday
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : isCurrentMonth
                        ? "border-border/60 bg-background/50 hover:bg-muted/50"
                        : "border-border/20 bg-muted/20 text-muted-foreground/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-extrabold ${isToday ? "text-emerald-600 dark:text-emerald-400" : isCurrentMonth ? "text-foreground" : "text-muted-foreground/50"}`}>
                        {day.getDate()}
                      </span>

                      {dayAgendaItems.length > 0 && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          pendingCount > 0
                            ? "bg-amber-500 text-white"
                            : "bg-emerald-500 text-white"
                        }`}>
                          {dayAgendaItems.length}
                        </span>
                      )}
                    </div>

                    {/* Mini Indicators of Calls */}
                    <div className="space-y-0.5 overflow-hidden">
                      {dayAgendaItems.slice(0, 2).map((it) => {
                        const time = new Date(it.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                        return (
                          <div
                            key={it.id}
                            className={`text-[9px] truncate px-1 py-0.5 rounded font-medium ${
                              it.status === "completed"
                                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 line-through"
                                : "bg-primary/15 text-primary"
                            }`}
                          >
                            {time} - {it.clientName.split(" ")[0]}
                          </div>
                        );
                      })}
                      {dayAgendaItems.length > 2 && (
                        <span className="text-[8px] font-bold text-muted-foreground block text-right">
                          +{dayAgendaItems.length - 2} mais
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Side Panel: Selected Day Calls Timeline */}
          <div className="flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <div>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary">Agenda do Dia</span>
                <h3 className="text-sm font-extrabold text-foreground">
                  {selectedDate.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-primary/10 text-primary">
                {selectedDayItems.length} ligações
              </span>
            </div>

            {/* List of calls for selected day */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {selectedDayItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                  <CalendarIcon className="h-10 w-10 stroke-1 opacity-40 mb-2" />
                  <p className="text-xs font-medium">Nenhuma ligação agendada para esta data.</p>
                  <button
                    onClick={() => {
                      setFormData((prev) => ({
                        ...prev,
                        date: selectedDate.toISOString().split("T")[0],
                      }));
                      setIsCreateModalOpen(true);
                    }}
                    className="mt-3 text-xs font-bold text-primary hover:underline flex items-center gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agendar para este dia
                  </button>
                </div>
              ) : (
                selectedDayItems.map((item) => {
                  const typeBadge = getTypeBadge(item.type);
                  const statusBadge = getStatusBadge(item.status);
                  const time = new Date(item.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

                  return (
                    <div
                      key={item.id}
                      className="p-3 rounded-xl border border-border/80 bg-background/60 hover:bg-background space-y-2 transition-all shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded-md bg-muted font-mono font-bold text-xs text-foreground">
                            {time}
                          </span>
                          <div>
                            <h4 className="text-xs font-bold text-foreground leading-tight">{item.clientName}</h4>
                            {item.company && <p className="text-[10px] text-muted-foreground">{item.company}</p>}
                          </div>
                        </div>

                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${statusBadge.bg}`}>
                          {statusBadge.label}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="h-3 w-3 text-primary" />
                          {item.clientPhone}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md border text-[9px] font-bold ${typeBadge.bg}`}>
                          {typeBadge.label}
                        </span>
                      </div>

                      {item.notes && (
                        <p className="text-[11px] italic text-muted-foreground/90 bg-muted/30 p-2 rounded-lg border border-border/40">
                          "{item.notes}"
                        </p>
                      )}

                      {/* Quick Actions */}
                      <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/40">
                        {item.status !== "completed" && (
                          <button
                            onClick={() => handleUpdateStatus(item.id, "completed")}
                            title="Marcar como Concluída"
                            className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                          >
                            <Check className="h-3 w-3" />
                            Concluir
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setRescheduleItem(item);
                            setFormData({
                              clientName: item.clientName,
                              clientPhone: item.clientPhone,
                              company: item.company || "",
                              date: new Date(item.scheduledAt).toISOString().split("T")[0],
                              time: new Date(item.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                              type: item.type,
                              priority: item.priority,
                              notes: item.notes || "",
                            });
                          }}
                          title="Reagendar Data/Hora"
                          className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                        >
                          <Clock className="h-3 w-3" />
                          Reagendar
                        </button>

                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          title="Excluir"
                          className="p-1 text-muted-foreground hover:text-rose-500 rounded-lg hover:bg-muted"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── VISÃO LISTAGEM ────────────────────────────────────────────────── */}
      {viewMode === "list" && (
        <div className="flex-1 flex flex-col bg-card rounded-2xl border border-border shadow-soft overflow-hidden p-4 space-y-3">
          {/* Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b border-border shrink-0">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por cliente, empresa, telefone ou observação..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Filter Selectors */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 bg-background border border-border px-2 py-1 rounded-xl text-xs">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground focus:outline-none"
                >
                  <option value="all">Todos os Status</option>
                  <option value="pending">Pendentes</option>
                  <option value="completed">Realizadas</option>
                  <option value="rescheduled">Reagendadas</option>
                  <option value="cancelled">Canceladas</option>
                </select>
              </div>

              <div className="flex items-center gap-1 bg-background border border-border px-2 py-1 rounded-xl text-xs">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-foreground focus:outline-none"
                >
                  <option value="all">Todas as Origens</option>
                  <option value="follow_up">Follow-ups</option>
                  <option value="customer_request">Pedido do Cliente</option>
                  <option value="excel_list">Lista Excel</option>
                  <option value="sdr_outreach">Prospecção SDR</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground font-extrabold uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md">
                <tr>
                  <th className="py-2.5 px-3 rounded-l-xl">Cliente / Empresa</th>
                  <th className="py-2.5 px-3">Telefone</th>
                  <th className="py-2.5 px-3">Data & Hora</th>
                  <th className="py-2.5 px-3">Origem</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Observações</th>
                  <th className="py-2.5 px-3 text-right rounded-r-xl">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filteredAgenda.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-muted-foreground">
                      Nenhuma ligação encontrada com os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredAgenda.map((item) => {
                    const typeBadge = getTypeBadge(item.type);
                    const statusBadge = getStatusBadge(item.status);
                    const d = new Date(item.scheduledAt);
                    const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
                    const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

                    return (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 px-3">
                          <div className="font-bold text-foreground">{item.clientName}</div>
                          {item.company && <div className="text-[10px] text-muted-foreground">{item.company}</div>}
                        </td>

                        <td className="py-3 px-3 font-mono font-medium text-foreground">
                          {item.clientPhone}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-semibold text-foreground">{dateStr}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">{timeStr}</div>
                        </td>

                        <td className="py-3 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${typeBadge.bg}`}>
                            {typeBadge.label}
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusBadge.bg}`}>
                            {statusBadge.label}
                          </span>
                        </td>

                        <td className="py-3 px-3 max-w-xs truncate text-muted-foreground" title={item.notes}>
                          {item.notes || "—"}
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {item.status !== "completed" && (
                              <button
                                onClick={() => handleUpdateStatus(item.id, "completed")}
                                title="Concluir Ligação"
                                className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-lg"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            )}

                            <button
                              onClick={() => {
                                setRescheduleItem(item);
                                setFormData({
                                  clientName: item.clientName,
                                  clientPhone: item.clientPhone,
                                  company: item.company || "",
                                  date: new Date(item.scheduledAt).toISOString().split("T")[0],
                                  time: new Date(item.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                                  type: item.type,
                                  priority: item.priority,
                                  notes: item.notes || "",
                                });
                              }}
                              title="Reagendar"
                              className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 rounded-lg"
                            >
                              <Clock className="h-4 w-4" />
                            </button>

                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              title="Excluir"
                              className="p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-muted rounded-lg"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── MODAL: NOVA LIGAÇÃO / REAGENDAMENTO ───────────────────────────── */}
      {(isCreateModalOpen || rescheduleItem) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl overflow-hidden p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                {rescheduleItem ? "Reagendar Ligação da Valentina" : "Agendar Nova Ligação"}
              </h3>
              <button
                onClick={() => {
                  setIsCreateModalOpen(false);
                  setRescheduleItem(null);
                }}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={rescheduleItem ? handleReschedule : handleCreateSchedule} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-foreground mb-1">Nome do Cliente *</label>
                <input
                  type="text"
                  required
                  value={formData.clientName}
                  onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                  placeholder="Ex: Marcos Oliveira"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-foreground mb-1">Telefone *</label>
                  <input
                    type="text"
                    required
                    value={formData.clientPhone}
                    onChange={(e) => setFormData({ ...formData, clientPhone: e.target.value })}
                    placeholder="(11) 98765-4321"
                    className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-foreground mb-1">Empresa</label>
                  <input
                    type="text"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    placeholder="Ex: Embalagens SA"
                    className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-foreground mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold text-foreground mb-1">Horário *</label>
                  <input
                    type="time"
                    required
                    value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-foreground mb-1">Origem / Motivo do Agendamento</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as VoiceAgendaItem["type"] })}
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                >
                  <option value="follow_up">Follow-up pós-conversa</option>
                  <option value="customer_request">Solicitação Direta do Cliente ("Ligar no horário X")</option>
                  <option value="excel_list">Lista de Ligações Excel</option>
                  <option value="sdr_outreach">Prospecção Ativa SDR</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-foreground mb-1">Observações / Detalhes</label>
                <textarea
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Instruções para Valentina (ex: confirmar orçamento de válvulas spray e seladora pedal)..."
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreateModalOpen(false);
                    setRescheduleItem(null);
                  }}
                  className="px-4 py-2 rounded-xl bg-muted text-muted-foreground hover:bg-muted/80 font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 shadow-soft"
                >
                  {rescheduleItem ? "Confirmar Reagendamento" : "Salvar Agendamento"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* ─── MODAL: IMPORTAR LISTA EXCEL ────────────────────────────────────── */}
      {isExcelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden p-6 space-y-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                Importar Lista de Ligações Excel
              </h3>
              <button
                onClick={() => setIsExcelModalOpen(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleImportExcel} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-foreground mb-1">Nome da Lista / Campanha</label>
                <input
                  type="text"
                  required
                  value={excelCampaignName}
                  onChange={(e) => setExcelCampaignName(e.target.value)}
                  placeholder="Ex: Leads_Agosto_Planilha.xlsx"
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:ring-2 focus:ring-primary/30 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold text-foreground mb-1">
                  Cole os dados da planilha (Nome, Telefone, Empresa, Observação)
                </label>
                <p className="text-[11px] text-muted-foreground mb-1">
                  Formato aceito por linha (separado por vírgula, tabulação ou ponto-e-vírgula):
                  <br />
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">
                    Nome Cliente ; (11) 99999-8888 ; Nome Empresa ; Obs
                  </code>
                </p>
                <textarea
                  rows={6}
                  required
                  value={excelText}
                  onChange={(e) => setExcelText(e.target.value)}
                  placeholder={`Marcos Oliveira ; (11) 98765-4321 ; Embalagens SA ; Interessado em Seladora\nRenata Vasconcelos ; (19) 99123-8877 ; Vale Verde ; Cotar Válvulas Spray\nCarlos Eduardo ; (41) 98844-5511 ; Beleza Pura ; Frascos PET`}
                  className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs font-mono focus:ring-2 focus:ring-primary/30 outline-none resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsExcelModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-muted text-muted-foreground hover:bg-muted/80 font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 shadow-soft flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Gerar Ligações Agendadas
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
