import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  CalendarDays,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  Settings2,
  Target,
  Users,
} from "lucide-react";
import { saoPauloDay } from "@/lib/commercial/metrics";
import { useChat } from "@/hooks/useChatState";
import { CommercialSettingsPanel } from "./CommercialSettingsPanel";
import { useNavigate } from "@tanstack/react-router";

type Consultant = {
  operatorId: string;
  name: string;
  email: string;
  avatar: string | null;
  division: string | null;
  activeOnTv: boolean | null;
};
type Goal = {
  id: string;
  operatorId: string;
  operatorName: string;
  targetValue: string;
  conversionRate: string;
};
type Directive = {
  id: string;
  dealId: string;
  dealTitle: string;
  assignedToOperatorId: string | null;
  assignedDate: string;
  priority: string;
  instruction: string;
  status: string;
};
type Deal = { id: string; title: string; operatorId?: string | null };
type CalendarDay = {
  id: string;
  date: string;
  type: string;
  description: string;
  affectsGoal: boolean;
};
type Closing = { date: string; count: number; value: number; deals: Array<{ id: string; title: string; value: number; operatorName: string }> };
type Evidence = {
  id: string;
  dealId: string;
  dealTitle: string;
  operatorName: string | null;
  channel: string;
  source: string;
  summary: string | null;
  createdAt: string;
  instruction: string;
  metadata: Record<string, unknown>;
  emailSubject: string | null;
  internalEmailContent: string | null;
  emailContent: string | null;
  callSummary: string | null;
  messages: Array<{ content: string; senderName: string }>;
};

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary";
const labelClass = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground";

async function getJson(url: string) {
  const response = await fetch(url, { credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Falha ao carregar dados comerciais.");
  return data;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Falha ao salvar configuração comercial.");
  return data;
}

export function CommercialManagementView() {
  const { setActiveView } = useChat();
  const navigate = useNavigate();
  const [tab, setTab] = useState<
    "consultants" | "goals" | "calendar" | "directives" | "evidence" | "settings"
  >("consultants");
  const [month, setMonth] = useState(() => saoPauloDay().slice(0, 7));
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(saoPauloDay());
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState({
    operatorId: "",
    targetValue: "",
    conversionRate: "10",
  });
  const [directiveForm, setDirectiveForm] = useState({
    dealId: "",
    assignedToOperatorId: "",
    assignedDate: saoPauloDay(),
    priority: "normal",
    instruction: "",
  });
  const [calendarForm, setCalendarForm] = useState({
    date: saoPauloDay(),
    type: "holiday",
    description: "",
    affectsGoal: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [consultantData, goalData, calendarData, directiveData, evidenceData, dealData] =
        await Promise.all([
          getJson("/api/commercial/consultants"),
          getJson(`/api/commercial/goals?month=${encodeURIComponent(month)}`),
          getJson(`/api/commercial/calendar?month=${encodeURIComponent(month)}`),
          getJson("/api/commercial/directives"),
          getJson("/api/commercial/evidence"),
          getJson("/api/crm/deals?status=open&limit=100&includeTotal=false"),
        ]);
      setConsultants(consultantData.consultants || []);
      setGoals(goalData.goals || []);
      setCalendarDays(calendarData.days || []);
      setClosings(calendarData.closings || []);
      setDirectives(directiveData.directives || []);
      setEvidence(evidenceData.evidence || []);
      setDeals(dealData.deals || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar gestão comercial.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const goalMap = useMemo(() => new Map(goals.map((goal) => [goal.operatorId, goal])), [goals]);
  const consultantMap = useMemo(
    () => new Map(consultants.map((consultant) => [consultant.operatorId, consultant.name])),
    [consultants],
  );
  const calendarClosingMap = useMemo(() => new Map(closings.map((item) => [item.date, item])), [closings]);
  const calendarOverrideMap = useMemo(() => new Map(calendarDays.map((item) => [item.date, item])), [calendarDays]);
  const [calendarYear, calendarMonth] = month.split("-").map(Number);
  const calendarLastDay = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();
  const calendarOffset = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay();
  const calendarSelectedDate = selectedCalendarDate.startsWith(month) ? selectedCalendarDate : `${month}-01`;
  const selectedClosing = calendarClosingMap.get(calendarSelectedDate);

  async function saveProfile(consultant: Consultant) {
    if (!consultant.division) {
      setError("Escolha Personnalité ou Máquinas antes de salvar.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/commercial/consultants", {
        operatorId: consultant.operatorId,
        division: consultant.division,
        activeOnTv: consultant.activeOnTv ?? true,
      });
      setNotice(`Consultor ${consultant.name} atualizado.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar consultor.");
    } finally {
      setSaving(false);
    }
  }

  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/commercial/goals", { month, ...goalForm });
      setNotice("Meta comercial salva.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar meta.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDirective(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/commercial/directives", directiveForm);
      setNotice("Diretriz atribuída ao consultor.");
      setDirectiveForm((current) => ({ ...current, dealId: "", instruction: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar diretriz.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCalendarDay(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/commercial/calendar", calendarForm);
      setMonth(calendarForm.date.slice(0, 7));
      setNotice("Dia comercial salvo.");
      setCalendarForm((current) => ({ ...current, description: "" }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar calendário.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCalendarDay(date: string) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/commercial/calendar?date=${encodeURIComponent(date)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao remover o dia comercial.");
      setNotice("Dia comercial removido.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao remover o dia comercial.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="h-full min-w-0 flex-1 overflow-y-auto rounded-3xl border border-border bg-background p-4 shadow-soft sm:p-7">
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-primary">
              Tecfag · Gestão Comercial
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-foreground">Operação do War Room</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Organize consultores, metas e prioridades comerciais.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveView("commercialBi")}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white"
            >
              <BarChart2 className="h-4 w-4" /> Abrir BI
            </button>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
            </button>
          </div>
        </header>

        <nav
          className="flex gap-2 overflow-x-auto border-b border-border pb-2"
          aria-label="Áreas da gestão comercial"
        >
          {(
            [
              { id: "consultants", label: "Consultores", icon: Users },
              { id: "goals", label: "Metas", icon: Target },
              { id: "calendar", label: "Calendário", icon: CalendarDays },
              { id: "directives", label: "Diretrizes", icon: ClipboardCheck },
              { id: "evidence", label: "Evidências", icon: ClipboardCheck },
              { id: "settings", label: "Configurações", icon: Settings2 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold ${tab === id ? "bg-primary text-white" : "bg-card text-muted-foreground hover:bg-muted"}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          >
            {notice}
          </p>
        )}
        {loading ? (
          <div className="flex min-h-[250px] items-center justify-center text-primary">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
        ) : (
          <>
            {tab === "consultants" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Associe cada operador a uma das duas divisões comerciais. Apenas consultores
                  marcados aparecem na TV.
                </p>
                {consultants.map((consultant) => (
                  <div
                    key={consultant.operatorId}
                    className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[minmax(190px,1fr)_minmax(160px,220px)_120px_90px] sm:items-center"
                  >
                    <div>
                      <strong className="text-sm text-foreground">{consultant.name}</strong>
                      <p className="text-xs text-muted-foreground">{consultant.email}</p>
                    </div>
                    <select
                      aria-label={`Divisão de ${consultant.name}`}
                      value={consultant.division || ""}
                      onChange={(event) =>
                        setConsultants((rows) =>
                          rows.map((row) =>
                            row.operatorId === consultant.operatorId
                              ? { ...row, division: event.target.value }
                              : row,
                          ),
                        )
                      }
                      className={fieldClass}
                    >
                      <option value="">Selecionar divisão</option>
                      <option value="personnalite">Personnalité</option>
                      <option value="maquinas">Máquinas</option>
                    </select>
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={consultant.activeOnTv ?? true}
                        onChange={(event) =>
                          setConsultants((rows) =>
                            rows.map((row) =>
                              row.operatorId === consultant.operatorId
                                ? { ...row, activeOnTv: event.target.checked }
                                : row,
                            ),
                          )
                        }
                      />
                      Na TV
                    </label>
                    <button
                      onClick={() => void saveProfile(consultant)}
                      disabled={saving}
                      className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      Salvar
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === "goals" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  <label className={labelClass}>
                    Mês comercial{" "}
                    <input
                      type="month"
                      value={month}
                      onChange={(event) => setMonth(event.target.value)}
                      className={`${fieldClass} mt-1 max-w-[200px]`}
                    />
                  </label>
                </div>
                <form
                  onSubmit={(event) => void saveGoal(event)}
                  className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[minmax(180px,1fr)_180px_140px_110px] sm:items-end"
                >
                  <label className={labelClass}>
                    Consultor
                    <select
                      required
                      value={goalForm.operatorId}
                      onChange={(event) => {
                        const operatorId = event.target.value;
                        const current = goalMap.get(operatorId);
                        setGoalForm({
                          operatorId,
                          targetValue: current?.targetValue || "",
                          conversionRate: current?.conversionRate || "10",
                        });
                      }}
                      className={`${fieldClass} mt-1`}
                    >
                      <option value="">Selecionar</option>
                      {consultants
                        .filter((item) => item.division)
                        .map((item) => (
                          <option key={item.operatorId} value={item.operatorId}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Meta em R$
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={goalForm.targetValue}
                      onChange={(event) =>
                        setGoalForm((current) => ({ ...current, targetValue: event.target.value }))
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <label className={labelClass}>
                    Conversão %
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={goalForm.conversionRate}
                      onChange={(event) =>
                        setGoalForm((current) => ({
                          ...current,
                          conversionRate: event.target.value,
                        }))
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Salvar meta
                  </button>
                </form>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="mb-3 text-sm font-extrabold text-foreground">Metas cadastradas</h2>
                  {goals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma meta definida para este mês.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {goals.map((goal) => (
                        <div
                          key={goal.id}
                          className="flex flex-wrap justify-between gap-2 border-b border-border py-2 text-sm last:border-0"
                        >
                          <span className="font-semibold text-foreground">{goal.operatorName}</span>
                          <span className="text-muted-foreground">
                            {currency.format(Number(goal.targetValue))} · {goal.conversionRate}%
                            conversão
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "calendar" && (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Feriados, pontes, suspensões e expediente extra ajustam os dias úteis usados no
                  ritmo das metas.
                </p>
                <form
                  onSubmit={(event) => void saveCalendarDay(event)}
                  className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[150px_170px_minmax(180px,1fr)_150px_100px] sm:items-end"
                >
                  <label className={labelClass}>
                    Data
                    <input
                      required
                      type="date"
                      value={calendarForm.date}
                      onChange={(event) =>
                        setCalendarForm((current) => ({ ...current, date: event.target.value }))
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <label className={labelClass}>
                    Tipo
                    <select
                      value={calendarForm.type}
                      onChange={(event) =>
                        setCalendarForm((current) => ({ ...current, type: event.target.value }))
                      }
                      className={`${fieldClass} mt-1`}
                    >
                      <option value="holiday">Feriado</option>
                      <option value="bridge">Ponte</option>
                      <option value="suspension">Suspensão</option>
                      <option value="extra_work">Expediente extra</option>
                    </select>
                  </label>
                  <label className={labelClass}>
                    Descrição
                    <input
                      required
                      maxLength={200}
                      value={calendarForm.description}
                      onChange={(event) =>
                        setCalendarForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <label className="flex items-center gap-2 pb-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      checked={calendarForm.affectsGoal}
                      onChange={(event) =>
                        setCalendarForm((current) => ({
                          ...current,
                          affectsGoal: event.target.checked,
                        }))
                      }
                    />
                    Afeta a meta
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-primary px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    Salvar
                  </button>
                </form>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div><p className="text-[11px] font-bold uppercase tracking-widest text-primary">Fechamentos do mês</p><h2 className="mt-1 text-lg font-extrabold text-foreground">Calendário comercial</h2></div>
                    <strong className="text-sm text-foreground">{currency.format(closings.reduce((total, item) => total + item.value, 0))} faturado</strong>
                  </div>
                  <div className="overflow-x-auto"><div className="min-w-[630px]"><div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-muted-foreground">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <span key={day} className="pb-2">{day}</span>)}</div><div className="grid grid-cols-7 gap-1">{Array.from({ length: calendarOffset }, (_, index) => <span key={`empty-${index}`} />)}{Array.from({ length: calendarLastDay }, (_, index) => {
                    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
                    const closing = calendarClosingMap.get(date);
                    const override = calendarOverrideMap.get(date);
                    return <button key={date} onClick={() => setSelectedCalendarDate(date)} className={`min-h-20 rounded-lg border p-2 text-left ${calendarSelectedDate === date ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"}`}><strong className="text-xs text-foreground">{index + 1}</strong>{closing && <span className="mt-1 block text-[10px] font-bold text-primary">{closing.count} ganho{closing.count === 1 ? "" : "s"}<br />{currency.format(closing.value)}</span>}{override && <span className="mt-1 block truncate text-[9px] text-muted-foreground" title={override.description}>{override.description}</span>}</button>;
                  })}</div></div></div>
                  <div className="mt-4 rounded-xl bg-muted/40 p-3"><h3 className="text-xs font-bold text-foreground">{calendarSelectedDate} · {selectedClosing?.count || 0} fechamento{selectedClosing?.count === 1 ? "" : "s"}</h3>{selectedClosing?.deals.length ? <div className="mt-2 space-y-1">{selectedClosing.deals.map((deal) => <button key={deal.id} onClick={() => void navigate({ to: "/crm/deals/$dealId", params: { dealId: deal.id }, search: { from: "crm" } })} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-border bg-card p-2 text-left text-xs text-foreground hover:border-primary/40"><span>{deal.title} · {deal.operatorName}</span><strong>{currency.format(deal.value)}</strong></button>)}</div> : <p className="mt-1 text-xs text-muted-foreground">Nenhuma negociação ganha neste dia.</p>}</div>
                </div>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <h2 className="text-sm font-extrabold text-foreground">Ajustes de expediente</h2>
                    <input
                      aria-label="Mês do calendário"
                      type="month"
                      value={month}
                      onChange={(event) => setMonth(event.target.value)}
                      className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                    />
                  </div>
                  {calendarDays.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum ajuste cadastrado neste mês.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {calendarDays.map((day) => (
                        <div
                          key={day.id}
                          className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0"
                        >
                          <span>
                            <strong className="text-foreground">{day.date}</strong> ·{" "}
                            {day.description}
                            <small className="ml-2 text-muted-foreground">
                              {day.type === "extra_work"
                                ? "Expediente extra"
                                : day.type === "holiday"
                                  ? "Feriado"
                                  : day.type === "bridge"
                                    ? "Ponte"
                                    : "Suspensão"}
                              {day.affectsGoal ? " · afeta meta" : ""}
                            </small>
                          </span>
                          <button
                            disabled={saving}
                            onClick={() => void removeCalendarDay(day.date)}
                            className="text-xs font-bold text-primary disabled:opacity-50"
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "directives" && (
              <div className="space-y-4">
                <form
                  onSubmit={(event) => void saveDirective(event)}
                  className="grid gap-3 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2"
                >
                  <label className={labelClass}>
                    Negociação aberta
                    <select
                      required
                      value={directiveForm.dealId}
                      onChange={(event) => {
                        const dealId = event.target.value;
                        const deal = deals.find((item) => item.id === dealId);
                        setDirectiveForm((current) => ({
                          ...current,
                          dealId,
                          assignedToOperatorId: deal?.operatorId || "",
                        }));
                      }}
                      className={`${fieldClass} mt-1`}
                    >
                      <option value="">Selecionar negociação</option>
                      {deals.map((deal) => (
                        <option key={deal.id} value={deal.id}>
                          {deal.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Consultor responsável
                    <select
                      required
                      value={directiveForm.assignedToOperatorId}
                      onChange={(event) =>
                        setDirectiveForm((current) => ({
                          ...current,
                          assignedToOperatorId: event.target.value,
                        }))
                      }
                      className={`${fieldClass} mt-1`}
                    >
                      <option value="">Selecionar consultor</option>
                      {consultants
                        .filter(
                          (item) =>
                            item.division &&
                            item.operatorId ===
                              deals.find((deal) => deal.id === directiveForm.dealId)?.operatorId,
                        )
                        .map((item) => (
                          <option key={item.operatorId} value={item.operatorId}>
                            {item.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className={labelClass}>
                    Data
                    <input
                      required
                      type="date"
                      value={directiveForm.assignedDate}
                      onChange={(event) =>
                        setDirectiveForm((current) => ({
                          ...current,
                          assignedDate: event.target.value,
                        }))
                      }
                      className={`${fieldClass} mt-1`}
                    />
                  </label>
                  <label className={labelClass}>
                    Prioridade
                    <select
                      value={directiveForm.priority}
                      onChange={(event) =>
                        setDirectiveForm((current) => ({
                          ...current,
                          priority: event.target.value,
                        }))
                      }
                      className={`${fieldClass} mt-1`}
                    >
                      <option value="normal">Normal</option>
                      <option value="high">Alta</option>
                      <option value="critical">Crítica</option>
                    </select>
                  </label>
                  <label className={`${labelClass} sm:col-span-2`}>
                    Instrução
                    <textarea
                      required
                      maxLength={2000}
                      rows={3}
                      value={directiveForm.instruction}
                      onChange={(event) =>
                        setDirectiveForm((current) => ({
                          ...current,
                          instruction: event.target.value,
                        }))
                      }
                      className={`${fieldClass} mt-1 resize-y`}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50 sm:col-span-2 sm:justify-self-end"
                  >
                    Atribuir diretriz
                  </button>
                </form>
                <div className="rounded-2xl border border-border bg-card p-5">
                  <h2 className="mb-3 text-sm font-extrabold text-foreground">
                    Diretrizes recentes
                  </h2>
                  {directives.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma diretriz criada.</p>
                  ) : (
                    <div className="space-y-2">
                      {directives.map((item) => (
                        <div key={item.id} className="border-b border-border py-3 last:border-0">
                          <div className="flex flex-wrap justify-between gap-2">
                            <strong className="text-sm text-foreground">{item.dealTitle}</strong>
                            <span className="text-xs text-muted-foreground">
                              {item.assignedDate} · {item.status}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {consultantMap.get(item.assignedToOperatorId || "") ||
                              "Sem responsável"}{" "}
                            · {item.instruction}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "evidence" && (
              <div className="rounded-2xl border border-border bg-card p-5">
                <h2 className="mb-2 text-sm font-extrabold text-foreground">Dossiê de execução</h2>
                <p className="mb-4 text-xs text-muted-foreground">
                  A origem identifica registros comprovados no sistema e relatos declarados pelo
                  consultor.
                </p>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Ainda não há evidências registradas.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {evidence.map((item) => (
                      <article key={item.id} className="rounded-xl border border-border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <strong className="text-sm text-foreground">{item.dealTitle}</strong>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.operatorName || "Operador"} ·{" "}
                              {new Date(item.createdAt).toLocaleString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                              })}
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-bold ${item.source === "manual_report" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"}`}
                          >
                            {item.source === "manual_report"
                              ? "Relato manual"
                              : item.metadata?.recordOrigin === "crm_manual"
                                ? "Registro manual do CRM"
                                : "Registro interno"}{" "}
                            ·{" "}
                            {item.channel === "call"
                              ? "Ligação"
                              : item.channel === "email"
                                ? "E-mail"
                                : "WhatsApp"}
                          </span>
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">
                          Diretriz: {item.instruction}
                        </p>
                        <p className="mt-2 text-sm text-foreground">{item.summary}</p>
                        <p className="mt-2 text-xs font-semibold text-primary">
                          Próximo passo:{" "}
                          {item.metadata?.nextAction === "won"
                            ? "Negociação ganha"
                            : item.metadata?.nextAction === "lost"
                              ? "Negociação perdida"
                              : "Tarefa futura"}
                        </p>
                        {item.emailSubject && (
                          <p className="mt-2 text-xs font-semibold text-foreground">
                            Assunto: {item.emailSubject}
                          </p>
                        )}
                        {(item.emailContent || item.internalEmailContent) && (
                          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs text-foreground">
                            {item.emailContent || item.internalEmailContent}
                          </p>
                        )}
                        {item.callSummary && (
                          <p className="mt-2 rounded-lg bg-muted p-3 text-xs text-foreground">
                            Resumo da ligação: {item.callSummary}
                          </p>
                        )}
                        {item.messages.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {item.messages.map((message, index) => (
                              <p
                                key={`${item.id}-${index}`}
                                className="rounded-lg bg-muted p-2 text-xs text-foreground"
                              >
                                <strong>{message.senderName}: </strong>
                                {message.content}
                              </p>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "settings" && <CommercialSettingsPanel />}
          </>
        )}
      </div>
    </section>
  );
}
