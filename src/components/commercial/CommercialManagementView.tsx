import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  UserCheck,
  Users,
} from "lucide-react";
import { saoPauloDay } from "@/lib/commercial/metrics";
import { useChat } from "@/hooks/useChatState";
import { useTabNavigation } from "@/hooks/useTabNavigation";
import { CommercialSettingsPanel } from "./CommercialSettingsPanel";
import { CommercialOperationalPanel } from "./CommercialAnalysisPanels";
import { CommercialGoalsView } from "./CommercialGoalsView";
import { CommercialConsultantsView, type ConsultantRow } from "./CommercialConsultantsView";
import { CommercialProfilesView } from "./CommercialProfilesView";
import { CommercialCalendarView } from "./CommercialCalendarView";
import { SystemTooltip } from "@/components/ui/tooltip";
import { useNavigate } from "@tanstack/react-router";
import { CommercialDiretrizesTableView } from "./CommercialDiretrizesTableView";
import { CommercialDiretrizesDetailModal } from "./CommercialDiretrizesDetailModal";
import { CommercialDiretrizesBreakdownModal } from "./CommercialDiretrizesBreakdownModal";
import type { DiretrizesConsultantRow } from "@/lib/commercial/diretrizes-crm-data";
import { toDiretrizesPresentation } from "@/lib/commercial/presentation-data";
import { buildConsultantAvatarResolver, getDeterministicConsultantAvatar } from "@/lib/commercial/avatar-matcher";

const COMMERCIAL_TABS = [
  { id: "consultants", label: "Consultores", icon: Users },
  { id: "profiles", label: "Perfis", icon: UserCheck },
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
  "w-full rounded-[4px] border border-border/80 dark:border-zinc-800 bg-background dark:bg-zinc-900/80 px-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary transition-colors";
const labelClass =
  "text-[10px] font-mono font-bold uppercase tracking-[.14em] text-muted-foreground dark:text-zinc-400";

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

async function getOpenCommercialDeals(): Promise<Deal[]> {
  const deals: Deal[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await getJson(
      `/api/commercial/analysis?view=deals&mode=pipeline&includeHidden=true&page=${page}&limit=100`,
    );
    total = result.total;
    if (!result.deals.length) break;
    deals.push(
      ...result.deals.map((deal: Deal) => ({
        id: deal.id,
        title: deal.title,
        operatorId: deal.operatorId,
      })),
    );
    page += 1;
  } while (deals.length < total);
  return deals;
}

export function CommercialManagementView() {
  const { setActiveView, operators } = useChat();
  const operatorsRef = useRef(operators);
  operatorsRef.current = operators;
  const navigate = useNavigate();
  const [tab, setTab] = useState<CommercialTab>("consultants");
  const tabIds = useMemo(() => COMMERCIAL_TABS.map((t) => t.id), []);

  useTabNavigation({
    tabs: tabIds,
    activeTab: tab,
    onChange: setTab,
  });
  const [month, setMonth] = useState(() => saoPauloDay().slice(0, 7));
  const [activeProfileOperatorId, setActiveProfileOperatorId] = useState<string | null>(null);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [responsibilities, setResponsibilities] = useState<ReturnType<
    typeof toDiretrizesPresentation
  > | null>(null);
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

  // Estados para o Cockpit de Diretrizes CRM (Fotos 1, 2, 3 e 4)
  const [diretrizesModalConsultant, setDiretrizesModalConsultant] =
    useState<DiretrizesConsultantRow | null>(null);
  const [diretrizesDetailOpen, setDiretrizesDetailOpen] = useState(false);
  const [diretrizesBreakdownOpen, setDiretrizesBreakdownOpen] = useState(false);
  const [showManualDirectiveForm, setShowManualDirectiveForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        consultantData,
        goalData,
        calendarData,
        directiveData,
        evidenceData,
        dealData,
        responsibilityData,
      ] = await Promise.all([
        getJson("/api/commercial/consultants"),
        getJson(`/api/commercial/goals?month=${encodeURIComponent(month)}`),
        getJson(`/api/commercial/calendar?month=${encodeURIComponent(month)}`),
        getJson("/api/commercial/directives"),
        getJson("/api/commercial/evidence"),
        getOpenCommercialDeals(),
        getJson(
          `/api/commercial/analysis?view=responsibilities&includeHidden=true&month=${encodeURIComponent(month)}`,
        ),
      ]);
      setConsultants(consultantData.consultants || []);
      setGoals(goalData.goals || []);
      setCalendarDays(calendarData.days || []);
      setClosings(calendarData.closings || []);
      setDirectives(directiveData.directives || []);
      setEvidence(evidenceData.evidence || []);
      setDeals(dealData);

      // Enriquecer responsibilityData com avatares carregados de consultants de forma resiliente
      const avatarResolver = buildConsultantAvatarResolver([
        operatorsRef.current,
        consultantData.consultants,
        responsibilityData?.consultants,
      ]);
      if (responsibilityData?.consultants) {
        for (const c of responsibilityData.consultants) {
          c.avatar = avatarResolver.getAvatar(c.operatorId, c.name) || c.avatar || null;
        }
      }
      setResponsibilities(toDiretrizesPresentation(responsibilityData, avatarResolver.getAvatar));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar gestão comercial.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const avatarResolver = useMemo(
    () => buildConsultantAvatarResolver([operators, consultants]),
    [operators, consultants],
  );

  const consultantMap = useMemo(
    () => new Map(consultants.map((consultant) => [consultant.operatorId, consultant.name])),
    [consultants],
  );
  const consultantAvatarMap = useMemo(
    () => new Map(consultants.map((c) => [c.operatorId, c.avatar])),
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
    <div className="flex flex-col h-full min-w-0 flex-1 bg-card dark:bg-[#0c0d12] rounded-[4px] border border-border/80 dark:border-zinc-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 dark:border-zinc-800 shrink-0 bg-card/60 dark:bg-zinc-950/40 backdrop-blur-sm">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[.22em] text-primary font-mono">
            WAR ROOM OPERACIONAL
          </div>
          <h1 className="font-mono text-xl sm:text-2xl font-bold tracking-[-.04em] text-foreground dark:text-zinc-50 flex items-center gap-2.5 mt-0.5">
            <BriefcaseBusiness className="h-5 w-5 text-primary" />
            Gestão Comercial
            <span className="text-primary animate-pulse">.</span>
          </h1>
          <p className="text-xs text-muted-foreground dark:text-zinc-400 mt-0.5">
            Operação do War Room — consultores, metas, calendário e diretrizes táticas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SystemTooltip content="Abrir cockpit executivo do War Room">
            <button
              onClick={() => setActiveView("commercialBi")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-[4px] bg-primary text-primary-foreground text-xs font-bold hover:brightness-110 transition shadow-sm cursor-pointer"
            >
              <BarChart2 className="h-3.5 w-3.5" />
              <span>Abrir War Room</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content="Atualizar dados agora">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[4px] border border-border/80 dark:border-zinc-800 bg-card dark:bg-zinc-950/70 text-xs font-bold font-mono text-muted-foreground hover:text-foreground hover:border-zinc-700 transition cursor-pointer disabled:opacity-50 shadow-sm"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin text-primary" : ""}`} />
              <span>Atualizar</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Internal Tab Bar */}
      <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-border/80 dark:border-zinc-800 bg-muted/20 dark:bg-zinc-950/60 shrink-0 overflow-x-auto scrollbar-none font-mono">
        {COMMERCIAL_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <SystemTooltip key={t.id} content={`Acessar aba ${t.label}`}>
              <button
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-2 px-3 py-1.5 rounded-[4px] text-xs font-bold transition-all cursor-pointer whitespace-nowrap border shadow-sm ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-card/60 dark:border-zinc-800 dark:bg-zinc-900/60 text-muted-foreground hover:border-zinc-600 hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100"
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
        <div className="w-full space-y-6">
          {error && (
            <p
              role="alert"
              className="rounded-[4px] border border-red-300 bg-red-50 p-3 text-xs font-mono text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-[4px] border border-emerald-300 bg-emerald-50 p-3 text-xs font-mono text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
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
                  onSelectProfile={(opId) => {
                    setActiveProfileOperatorId(opId);
                    setTab("profiles");
                  }}
                />
              )}

              {tab === "profiles" && (
                <CommercialProfilesView
                  consultants={consultants}
                  onRefresh={load}
                  initialOperatorId={activeProfileOperatorId}
                />
              )}

              {tab === "goals" && <CommercialGoalsView initialMonth={month} />}

              {tab === "calendar" && <CommercialCalendarView initialMonth={month} />}

              {tab === "directives" && (
                <div className="space-y-4">
                  {/* Cockpit Executivo Oficial de Diretrizes CRM (Fotos 1 e 4) */}
                  {responsibilities && (
                    <div className="rounded-[4px] border border-zinc-800 bg-[#0c0d12] p-4 text-white shadow-sm">
                      <CommercialDiretrizesTableView
                        kpis={responsibilities.kpis}
                        personnaliteData={responsibilities.personnaliteData}
                        semiMaquinasData={responsibilities.semiMaquinasData}
                        onConsultantClick={(consultant) => {
                          setDiretrizesModalConsultant(consultant);
                          setDiretrizesDetailOpen(true);
                        }}
                        onBreakdownClick={() => setDiretrizesBreakdownOpen(true)}
                      />
                    </div>
                  )}

                  {/* Alternador para Atribuição Manual de Diretriz */}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowManualDirectiveForm((prev) => !prev)}
                      className="rounded-[3px] border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
                    >
                      {showManualDirectiveForm
                        ? "▲ Ocultar Atribuição Manual"
                        : "➕ Atribuir Nova Diretriz Manualmente"}
                    </button>
                  </div>

                  {showManualDirectiveForm && (
                    <>
                      <form
                        onSubmit={(event) => void saveDirective(event)}
                        className="grid gap-3 rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 sm:grid-cols-2 shadow-sm"
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
                                    deals.find((deal) => deal.id === directiveForm.dealId)
                                      ?.operatorId,
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
                          className="rounded-[4px] bg-primary px-4 py-2 text-xs font-mono font-bold text-white hover:opacity-95 disabled:opacity-50 sm:col-span-2 sm:justify-self-end shadow-sm cursor-pointer"
                        >
                          {saving ? "Atribuindo..." : "Atribuir diretriz"}
                        </button>
                      </form>
                      <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 shadow-sm">
                        <h2 className="mb-3 font-mono text-base font-bold text-foreground dark:text-zinc-50">
                          Diretrizes recentes
                        </h2>
                        {directives.length === 0 ? (
                          <p className="text-xs text-muted-foreground dark:text-zinc-400">
                            Nenhuma diretriz criada.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {directives.map((item) => (
                              <div
                                key={item.id}
                                className="border-b border-border/80 dark:border-zinc-800/80 py-3 last:border-0"
                              >
                                <div className="flex flex-wrap justify-between gap-2">
                                  <strong className="text-xs font-bold text-foreground dark:text-zinc-100">
                                    {item.dealTitle}
                                  </strong>
                                  <span className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400">
                                    {item.assignedDate} · {item.status}
                                  </span>
                                </div>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="relative h-5 w-5 shrink-0 overflow-hidden rounded-[2px] border border-border dark:border-zinc-800 bg-muted">
                                    <img
                                      src={
                                        consultantAvatarMap.get(item.assignedToOperatorId || "") ||
                                        avatarResolver.getAvatar(
                                          item.assignedToOperatorId,
                                          consultantMap.get(item.assignedToOperatorId || ""),
                                        )
                                      }
                                      alt={consultantMap.get(item.assignedToOperatorId || "") || "Consultor"}
                                      className="h-full w-full object-cover"
                                      onError={(e) => {
                                        const img = e.currentTarget;
                                        const name = consultantMap.get(item.assignedToOperatorId || "") || "Consultor";
                                        const fallback = getDeterministicConsultantAvatar(name);
                                        if (img.src !== fallback) img.src = fallback;
                                      }}
                                    />
                                  </div>
                                  <p className="text-xs text-muted-foreground dark:text-zinc-400">
                                    <strong className="text-foreground dark:text-zinc-200">
                                      {consultantMap.get(item.assignedToOperatorId || "") ||
                                        "Sem responsável"}
                                    </strong>{" "}
                                    · {item.instruction}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === "evidence" && (
                <div className="rounded-[4px] border border-border/80 bg-card dark:border-zinc-800 dark:bg-zinc-950/70 p-5 shadow-sm">
                  <h2 className="mb-1 font-mono text-base font-bold text-foreground dark:text-zinc-50">
                    Dossiê de execução
                  </h2>
                  <p className="mb-4 text-xs text-muted-foreground dark:text-zinc-400">
                    A origem identifica registros comprovados no sistema e relatos declarados pelo
                    consultor.
                  </p>
                  {evidence.length === 0 ? (
                    <p className="text-xs text-muted-foreground dark:text-zinc-400">
                      Ainda não há evidências registradas.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {evidence.map((item) => (
                        <article
                          key={item.id}
                          className="rounded-[2px] border border-border/80 dark:border-zinc-800 bg-card/60 dark:bg-zinc-900/40 p-4 hover:border-primary/40 transition-colors"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <strong className="text-xs font-bold text-foreground dark:text-zinc-100">
                                {item.dealTitle}
                              </strong>
                              <div className="mt-1.5 flex items-center gap-2">
                                <div className="relative h-5 w-5 shrink-0 overflow-hidden rounded-[2px] border border-border dark:border-zinc-800 bg-muted">
                                  <img
                                    src={avatarResolver.getAvatar(undefined, item.operatorName)}
                                    alt={item.operatorName || "Operador"}
                                    className="h-full w-full object-cover"
                                    onError={(e) => {
                                      const img = e.currentTarget;
                                      const fallback = getDeterministicConsultantAvatar(item.operatorName || "Operador");
                                      if (img.src !== fallback) img.src = fallback;
                                    }}
                                  />
                                </div>
                                <p className="text-[11px] font-mono text-muted-foreground dark:text-zinc-400">
                                  <strong className="text-foreground dark:text-zinc-200">
                                    {item.operatorName || "Operador"}
                                  </strong>{" "}
                                  ·{" "}
                                  {new Date(item.createdAt).toLocaleString("pt-BR", {
                                    timeZone: "America/Sao_Paulo",
                                  })}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`rounded-[2px] px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider ${item.source === "manual_report" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"}`}
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
                          <p className="mt-2 text-xs text-muted-foreground dark:text-zinc-400">
                            <span className="font-semibold text-foreground/80 dark:text-zinc-300">
                              Diretriz:
                            </span>{" "}
                            {item.instruction}
                          </p>
                          <p className="mt-2 text-xs text-foreground dark:text-zinc-200">
                            {item.summary}
                          </p>
                          <p className="mt-2 text-[11px] font-mono font-semibold text-primary">
                            Próximo passo:{" "}
                            {item.metadata?.nextAction === "won"
                              ? "Negociação ganha"
                              : item.metadata?.nextAction === "lost"
                                ? "Negociação perdida"
                                : "Tarefa futura"}
                          </p>
                          {item.emailSubject && (
                            <p className="mt-2 text-xs font-semibold text-foreground dark:text-zinc-200">
                              Assunto: {item.emailSubject}
                            </p>
                          )}
                          {(item.emailContent || item.internalEmailContent) && (
                            <p className="mt-2 whitespace-pre-wrap rounded-[2px] bg-muted/40 dark:bg-zinc-950/60 p-3 text-xs text-foreground dark:text-zinc-300 border border-border/40 dark:border-zinc-800/60 font-mono">
                              {item.emailContent || item.internalEmailContent}
                            </p>
                          )}
                          {item.callSummary && (
                            <p className="mt-2 rounded-[2px] bg-muted/40 dark:bg-zinc-950/60 p-3 text-xs text-foreground dark:text-zinc-300 border border-border/40 dark:border-zinc-800/60">
                              Resumo da ligação: {item.callSummary}
                            </p>
                          )}
                          {item.messages.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {item.messages.map((message, index) => (
                                <p
                                  key={`${item.id}-${index}`}
                                  className="rounded-[2px] bg-muted/40 dark:bg-zinc-950/60 p-2 text-xs text-foreground dark:text-zinc-300 border border-border/40 dark:border-zinc-800/60"
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
              {tab === "operation" && (
                <CommercialOperationalPanel
                  onOpenDeal={(dealId) => {
                    navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ─── MODAL DETALHADO DE TRATATIVAS POR CONSULTOR (DIRETRIZES CRM) ─── */}
      <CommercialDiretrizesDetailModal
        isOpen={diretrizesDetailOpen}
        onClose={() => setDiretrizesDetailOpen(false)}
        consultant={diretrizesModalConsultant}
        onOpenDeal={(dealId) => {
          navigate({ to: "/crm/deals/$dealId", params: { dealId }, search: { from: "crm" } });
        }}
      />

      {/* ─── MODAL BREAKDOWN DE TAXA DE EXECUÇÃO (DIRETRIZES CRM) ─── */}
      {responsibilities && (
        <CommercialDiretrizesBreakdownModal
          isOpen={diretrizesBreakdownOpen}
          onClose={() => setDiretrizesBreakdownOpen(false)}
          kpis={responsibilities.kpis}
          consultants={responsibilities.consultants}
          onSelectConsultant={(c) => {
            setDiretrizesBreakdownOpen(false);
            setDiretrizesModalConsultant(c);
            setDiretrizesDetailOpen(true);
          }}
        />
      )}
    </div>
  );
}
