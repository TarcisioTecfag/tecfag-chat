import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  FileCheck,
  Loader2,
  RefreshCw,
  Settings2,
  Target,
  Users,
} from "lucide-react";
import { saoPauloDay } from "@/lib/commercial/metrics";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { CommercialSettingsPanel } from "./CommercialSettingsPanel";
import { CommercialOperationalPanel } from "./CommercialAnalysisPanels";
import { CommercialGoalsView } from "./CommercialGoalsView";
import { CommercialConsultantsView, type ConsultantRow } from "./CommercialConsultantsView";
import { CommercialCalendarView } from "./CommercialCalendarView";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";

const COMMERCIAL_TABS = [
  { id: "consultants", label: "Consultores", icon: Users },
  { id: "goals", label: "Metas", icon: Target },
  { id: "calendar", label: "Calendário", icon: CalendarDays },
  { id: "directives", label: "Diretrizes", icon: ClipboardCheck },
  { id: "evidence", label: "Evidências", icon: FileCheck },
  { id: "operation", label: "Operação", icon: BarChart2 },
  { id: "settings", label: "Configurações", icon: Settings2 },
] as const;

type CommercialTab = (typeof COMMERCIAL_TABS)[number]["id"];

type Consultant = ConsultantRow;
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
type Closing = {
  date: string;
  count: number;
  value: number;
  deals: Array<{ id: string; title: string; value: number; operatorName: string }>;
};
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
  const [tab, setTab] = useState<CommercialTab>("consultants");
  const tabIds = useMemo(() => COMMERCIAL_TABS.map((t) => t.id), []);

  useTabNavigation({
    tabs: tabIds,
    activeTab: tab,
    onChange: setTab,
  });
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

  const consultantMap = useMemo(
    () => new Map(consultants.map((consultant) => [consultant.operatorId, consultant.name])),
    [consultants],
  );
  const calendarClosingMap = useMemo(
    () => new Map(closings.map((item) => [item.date, item])),
    [closings],
  );
  const calendarOverrideMap = useMemo(
    () => new Map(calendarDays.map((item) => [item.date, item])),
    [calendarDays],
  );
  const [calendarYear, calendarMonth] = month.split("-").map(Number);
  const calendarLastDay = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();
  const calendarOffset = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).getUTCDay();
  const calendarSelectedDate = selectedCalendarDate.startsWith(month)
    ? selectedCalendarDate
    : `${month}-01`;
  const selectedClosing = calendarClosingMap.get(calendarSelectedDate);

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
    <div className="flex flex-col h-full min-w-0 flex-1 bg-card rounded-3xl border border-border shadow-soft overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <div>
          <h1 className="text-base font-extrabold text-foreground flex items-center gap-2">
            <BriefcaseBusiness className="h-4.5 w-4.5 text-primary" />
            Gestão Comercial
          </h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Operação do War Room — consultores, metas, calendário e diretrizes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SystemTooltip content="Abrir cockpit executivo do War Room">
            <button
              onClick={() => setActiveView("commercialBi")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:brightness-110 transition shadow-soft cursor-pointer"
            >
              <BarChart2 className="h-3.5 w-3.5" />
              <span>Abrir War Room</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Atualizar dados agora">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
              <span>Atualizar</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-line bg-muted/30 shrink-0 overflow-x-auto scrollbar-none">
        {COMMERCIAL_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <SystemTooltip key={t.id} content={`Acessar aba ${t.label}`}>
              <button
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            </SystemTooltip>
          );
        })}
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="mx-auto max-w-[1400px] space-y-6">
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
                <CommercialConsultantsView
                  consultants={consultants}
                  loading={loading}
                  onRefresh={load}
                />
              )}

              {tab === "goals" && <CommercialGoalsView initialMonth={month} />}

              {tab === "calendar" && <CommercialCalendarView initialMonth={month} />}


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
                  <h2 className="mb-2 text-sm font-extrabold text-foreground">
                    Dossiê de execução
                  </h2>
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
              {tab === "operation" && <CommercialOperationalPanel />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
