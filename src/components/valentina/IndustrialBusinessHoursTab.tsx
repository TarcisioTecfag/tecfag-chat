import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Info,
  Moon,
  Sparkles,
  Sun,
} from "lucide-react";
import { SystemTooltip } from "@/components/ui/tooltip";
import { SimpleSelect } from "@/components/ui/select";
import {
  buildFallbackIndustrialBusinessHoursClosing,
  evaluateIndustrialBusinessHours,
  formatHm,
  formatHumanHourPt,
  getZonedDateParts,
  parseIndustrialScheduleConfig,
  parseTimeToMinutes,
  WEEKDAY_NAMES_PT,
  WEEKDAY_SHORT_PT,
  type IndustrialScheduleSettings,
  type NonWorkingCalendarDay,
} from "@/lib/triage/industrial-business-hours";

interface IndustrialBusinessHoursTabProps {
  schedule: IndustrialScheduleSettings;
  onChange: (next: IndustrialScheduleSettings) => void;
  upcomingNonWorkingDays: NonWorkingCalendarDay[];
  disabled?: boolean;
}

const START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h).padStart(2, "0"),
  label: `${String(h).padStart(2, "0")}h`,
}));

const END_HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => ({
  value: String(h).padStart(2, "0"),
  label: `${String(h).padStart(2, "0")}h`,
}));

const MINUTE_OPTIONS = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map(
  (m) => ({
    value: m,
    label: `${m} min`,
  }),
);

const CLOSING_SOON_OPTIONS = [
  { value: "0", label: "Desativada (0 min)" },
  { value: "10", label: "10 minutos antes" },
  { value: "15", label: "15 minutos antes (Recomendado)" },
  { value: "20", label: "20 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "45", label: "45 minutos antes" },
  { value: "60", label: "60 minutos antes" },
];

const SCHEDULE_PRESETS = [
  { label: "08:00 – 18:00 (Padrão)", startTime: "08:00", endTime: "18:00" },
  { label: "08:00 – 17:30", startTime: "08:00", endTime: "17:30" },
  { label: "07:30 – 17:30", startTime: "07:30", endTime: "17:30" },
  { label: "09:00 – 18:00", startTime: "09:00", endTime: "18:00" },
];

const DISPLAY_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type SimulationPreset = "live" | "closing_soon" | "night" | "saturday" | "next_holiday";

function buildBrtDate(dateIso: string, hour: number, minute: number): Date {
  const hh = String(Math.max(0, Math.min(23, hour))).padStart(2, "0");
  const mm = String(Math.max(0, Math.min(59, minute))).padStart(2, "0");
  return new Date(`${dateIso}T${hh}:${mm}:00-03:00`);
}

function nextSaturdayIso(baseDateIso: string): string {
  const baseNoon = new Date(`${baseDateIso}T12:00:00.000Z`);
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(baseNoon.getTime() + offset * 86_400_000);
    if (d.getUTCDay() === 6) return d.toISOString().slice(0, 10);
  }
  return baseDateIso;
}

function formatDateBr(dateIso: string): string {
  const [yyyy, mm, dd] = dateIso.split("-");
  if (!yyyy || !mm || !dd) return dateIso;
  return `${dd}/${mm}/${yyyy}`;
}

function formatWeekdayFromIso(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00.000Z`);
  return WEEKDAY_NAMES_PT[d.getUTCDay()] || "";
}

function calendarTypeBadgeLabel(type: NonWorkingCalendarDay["type"]): string {
  switch (type) {
    case "bridge":
      return "Emenda";
    case "suspension":
      return "Suspensão";
    default:
      return "Feriado";
  }
}

export function IndustrialBusinessHoursTab({
  schedule,
  onChange,
  upcomingNonWorkingDays,
  disabled = false,
}: IndustrialBusinessHoursTabProps) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [simulation, setSimulation] = useState<SimulationPreset>("live");

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const parsedConfig = useMemo(() => parseIndustrialScheduleConfig({ schedule }), [schedule]);

  const [startH, startM] = useMemo(() => {
    const parts = (schedule.startTime || "08:00").split(":");
    return [parts[0] || "08", parts[1] || "00"];
  }, [schedule.startTime]);

  const [endH, endM] = useMemo(() => {
    const parts = (schedule.endTime || "18:00").split(":");
    return [parts[0] || "18", parts[1] || "00"];
  }, [schedule.endTime]);

  const startMinutesRaw = parseTimeToMinutes(schedule.startTime) ?? 480;
  const endMinutesRaw = parseTimeToMinutes(schedule.endTime) ?? 1080;
  const isTimeRangeInvalid = endMinutesRaw <= startMinutesRaw;

  const zonedNow = useMemo(
    () => getZonedDateParts(now, parsedConfig.timezone),
    [now, parsedConfig.timezone],
  );

  const futureNonWorkingDays = useMemo(() => {
    return upcomingNonWorkingDays
      .filter(
        (d) =>
          (d.type === "holiday" || d.type === "bridge" || d.type === "suspension") &&
          d.date >= zonedNow.dateIso,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [upcomingNonWorkingDays, zonedNow.dateIso]);

  const nextHoliday = futureNonWorkingDays[0] || null;

  const effectiveSimulatedDate = useMemo(() => {
    if (simulation === "live") return now;
    if (simulation === "closing_soon") {
      const targetMins = Math.max(
        parsedConfig.startHour * 60 + parsedConfig.startMinute,
        parsedConfig.endHour * 60 +
          parsedConfig.endMinute -
          Math.max(5, Math.floor(parsedConfig.closingSoonMinutes / 2) || 10),
      );
      return buildBrtDate(zonedNow.dateIso, Math.floor(targetMins / 60), targetMins % 60);
    }
    if (simulation === "night") {
      return buildBrtDate(zonedNow.dateIso, 20, 30);
    }
    if (simulation === "saturday") {
      return buildBrtDate(nextSaturdayIso(zonedNow.dateIso), 10, 0);
    }
    if (simulation === "next_holiday" && nextHoliday) {
      return buildBrtDate(nextHoliday.date, 11, 0);
    }
    return now;
  }, [simulation, now, zonedNow.dateIso, parsedConfig, nextHoliday]);

  const liveEvaluation = useMemo(
    () => evaluateIndustrialBusinessHours(now, parsedConfig, upcomingNonWorkingDays),
    [now, parsedConfig, upcomingNonWorkingDays],
  );

  const previewEvaluation = useMemo(
    () =>
      evaluateIndustrialBusinessHours(effectiveSimulatedDate, parsedConfig, upcomingNonWorkingDays),
    [effectiveSimulatedDate, parsedConfig, upcomingNonWorkingDays],
  );

  const transitionWindowLabel = useMemo(() => {
    if (!parsedConfig.closingSoonMinutes) return "Transição desativada";
    const endTotal = parsedConfig.endHour * 60 + parsedConfig.endMinute;
    const startTrans = Math.max(0, endTotal - parsedConfig.closingSoonMinutes);
    const endTrans = Math.max(0, endTotal - 1);
    return `${formatHm(Math.floor(startTrans / 60), startTrans % 60)} às ${formatHm(
      Math.floor(endTrans / 60),
      endTrans % 60,
    )} BRT`;
  }, [parsedConfig.closingSoonMinutes, parsedConfig.endHour, parsedConfig.endMinute]);

  const toggleWorkDay = (day: number) => {
    const exists = schedule.workDays.includes(day);
    if (exists && schedule.workDays.length <= 1) return;
    const nextDays = exists
      ? schedule.workDays.filter((d) => d !== day)
      : [...schedule.workDays, day].sort((a, b) => a - b);
    onChange({ ...schedule, workDays: nextDays });
  };

  const updateStartTime = (nextH: string, nextM: string) => {
    onChange({ ...schedule, startTime: `${nextH}:${nextM}` });
  };

  const updateEndTime = (nextH: string, nextM: string) => {
    const safeMin = nextH === "24" ? "00" : nextM;
    onChange({ ...schedule, endTime: `${nextH}:${safeMin}` });
  };

  const samplePreviewMessage = useMemo(() => {
    if (!previewEvaluation.enabled) {
      return "Aviso de expediente desativado — o Fagner concluirá normalmente a triagem sem mencionar horário comercial.";
    }
    if (previewEvaluation.status === "open") {
      return "Dentro do expediente comercial — o Fagner conclui e direciona normalmente para o especialista sem mencionar encerramento.";
    }
    return buildFallbackIndustrialBusinessHoursClosing(previewEvaluation, {
      mode: "awaiting_approval",
    });
  }, [previewEvaluation]);

  const statusMeta = useMemo(() => {
    if (!liveEvaluation.enabled) {
      return {
        label: "Aviso desativado",
        sub: "Expediente humano não é avisado automaticamente",
        badgeClass: "bg-muted text-muted-foreground border-border",
        Icon: Moon,
      };
    }
    if (liveEvaluation.status === "open") {
      return {
        label: "Dentro do expediente",
        sub: `Encerramento hoje às ${liveEvaluation.endTimeLabel} BRT`,
        badgeClass: "bg-primary/10 text-primary border-primary/25",
        Icon: Sun,
      };
    }
    if (liveEvaluation.status === "closing_soon") {
      return {
        label: `Encerrando em breve (${liveEvaluation.minutesUntilClose ?? 0} min)`,
        sub: `Aviso suave ativo · próximo retorno ${liveEvaluation.nextOpen.label}`,
        badgeClass: "bg-primary/15 text-primary border-primary/35",
        Icon: Clock,
      };
    }
    const reasonText =
      liveEvaluation.closedReason === "holiday"
        ? `Feriado: ${liveEvaluation.todayHolidayDescription || "Feriado"}`
        : liveEvaluation.closedReason === "bridge"
          ? `Emenda: ${liveEvaluation.todayHolidayDescription || "Emenda de feriado"}`
          : liveEvaluation.closedReason === "suspension"
            ? `Suspensão: ${liveEvaluation.todayHolidayDescription || "Recesso"}`
            : liveEvaluation.closedReason === "weekend"
              ? "Fim de semana"
              : liveEvaluation.closedReason === "before_open"
                ? `Antes da abertura (${liveEvaluation.startTimeLabel})`
                : `Após o encerramento (${liveEvaluation.endTimeLabel})`;
    return {
      label: "Fora do expediente",
      sub: `${reasonText} · retorno humano ${liveEvaluation.nextOpen.label}`,
      badgeClass: "bg-muted text-foreground border-border",
      Icon: Moon,
    };
  }, [liveEvaluation]);

  const StatusIcon = statusMeta.Icon;

  return (
    <div className="space-y-4">
      {/* Banner de Status Ao Vivo (Tempo Real BRT) */}
      <div className="p-4 rounded-2xl border border-border bg-card flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <StatusIcon className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-extrabold text-foreground">
                Status ao vivo do expediente humano
              </span>
              <span
                className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border ${statusMeta.badgeClass}`}
              >
                {statusMeta.label}
              </span>
              <span className="text-[11px] font-semibold text-muted-foreground">
                {liveEvaluation.currentWeekdayName}, {formatDateBr(liveEvaluation.currentDateIso)} ·{" "}
                {liveEvaluation.currentTimeLabel} BRT
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">{statusMeta.sub}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <SystemTooltip content="Liga ou desliga o aviso automático de expediente humano na triagem do Fagner e o bloqueio de follow-ups fora do horário">
            <button
              type="button"
              role="switch"
              aria-checked={schedule.enabled}
              disabled={disabled}
              onClick={() => onChange({ ...schedule, enabled: !schedule.enabled })}
              className={`px-3.5 py-2 rounded-xl border text-xs font-extrabold flex items-center gap-2 transition cursor-pointer disabled:opacity-50 ${
                schedule.enabled
                  ? "bg-primary text-primary-foreground border-primary shadow-soft"
                  : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  schedule.enabled ? "bg-primary-foreground" : "bg-muted-foreground/50"
                }`}
              />
              <span>{schedule.enabled ? "Aviso de Expediente Ativo" : "Aviso Desativado"}</span>
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* Grid de Configuração + Prévia Interativa */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Coluna Esquerda: Regras de Horário e Calendário */}
        <div className="xl:col-span-7 space-y-4">
          <div className="p-4 rounded-2xl border border-border bg-card space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <h3 className="text-xs font-extrabold text-foreground">
                  Expediente único da empresa (Horário de Brasília)
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Válido para todos os setores no encaminhamento do Fagner (antes da aprovação SDR),
                  ponte Site→WhatsApp, transferência direta e pausa do SdrFollowupEngine.
                </p>
              </div>
            </div>

            {/* Dias úteis */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-foreground">
                  Dias com atendimento humano
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {parsedConfig.workDays.length} dia(s) selecionado(s)
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {DISPLAY_DAY_ORDER.map((dayIdx) => {
                  const active = schedule.workDays.includes(dayIdx);
                  return (
                    <SystemTooltip
                      key={dayIdx}
                      content={`${WEEKDAY_NAMES_PT[dayIdx]} — clique para ${active ? "desmarcar" : "ativar"}`}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleWorkDay(dayIdx)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border transition cursor-pointer disabled:opacity-50 ${
                          active
                            ? "bg-primary text-primary-foreground border-primary shadow-soft"
                            : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {WEEKDAY_SHORT_PT[dayIdx]}
                      </button>
                    </SystemTooltip>
                  );
                })}
              </div>
            </div>

            {/* Início, Fim e Transição */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-foreground block">
                  Início do expediente
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <SimpleSelect
                    value={startH}
                    disabled={disabled}
                    onValueChange={(val) => updateStartTime(val, startM)}
                    options={START_HOUR_OPTIONS}
                    placeholder="Hora"
                  />
                  <SimpleSelect
                    value={startM}
                    disabled={disabled}
                    onValueChange={(val) => updateStartTime(startH, val)}
                    options={MINUTE_OPTIONS}
                    placeholder="Min"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-foreground block">
                  Encerramento do expediente
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <SimpleSelect
                    value={endH}
                    disabled={disabled}
                    onValueChange={(val) => updateEndTime(val, endM)}
                    options={END_HOUR_OPTIONS}
                    placeholder="Hora"
                  />
                  <SimpleSelect
                    value={endH === "24" ? "00" : endM}
                    disabled={disabled || endH === "24"}
                    onValueChange={(val) => updateEndTime(endH, val)}
                    options={MINUTE_OPTIONS}
                    placeholder="Min"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-foreground block">
                  Janela de transição suave
                </label>
                <SimpleSelect
                  value={String(schedule.closingSoonMinutes)}
                  disabled={disabled}
                  onValueChange={(val) =>
                    onChange({
                      ...schedule,
                      closingSoonMinutes: Number.parseInt(val, 10) || 0,
                    })
                  }
                  options={CLOSING_SOON_OPTIONS}
                  placeholder="Transição"
                />
                <p className="text-[10px] text-muted-foreground">
                  Faixa:{" "}
                  <span className="font-semibold text-foreground">{transitionWindowLabel}</span>
                </p>
              </div>
            </div>

            {isTimeRangeInvalid && (
              <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/30 flex items-center gap-2 text-[11px] font-bold text-primary">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  O horário de encerramento ({schedule.endTime}) precisa ser posterior ao horário de
                  início ({schedule.startTime}).
                </span>
              </div>
            )}

            {/* Atalhos rápidos */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">
                Atalhos:
              </span>
              {SCHEDULE_PRESETS.map((preset) => {
                const isSelected =
                  schedule.startTime === preset.startTime && schedule.endTime === preset.endTime;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...schedule,
                        startTime: preset.startTime,
                        endTime: preset.endTime,
                      })
                    }
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer disabled:opacity-50 ${
                      isSelected
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Integração com Calendário Comercial (Feriados até 2030) */}
          <div className="p-4 rounded-2xl border border-border bg-card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-xl bg-muted text-foreground border border-border shrink-0">
                  <Calendar className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-extrabold text-foreground">
                    Integração com Feriados & Calendário Comercial
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Lê automaticamente feriados nacionais até 2030, emendas e suspensões cadastrados
                    em <span className="font-semibold text-foreground">Calendário Comercial</span>{" "}
                    para esta empresa. Dias marcados como{" "}
                    <span className="font-semibold text-foreground">extra_work</span> (sábado de
                    meta) são ignorados por segurança.
                  </p>
                </div>
              </div>

              <SystemTooltip content="Ativar ou desativar o cruzamento automático de feriados, emendas e suspensões no cálculo do próximo dia útil">
                <button
                  type="button"
                  role="switch"
                  aria-checked={schedule.respectCommercialCalendar}
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...schedule,
                      respectCommercialCalendar: !schedule.respectCommercialCalendar,
                    })
                  }
                  className={`px-3 py-1.5 rounded-xl border text-[11px] font-extrabold transition cursor-pointer shrink-0 disabled:opacity-50 ${
                    schedule.respectCommercialCalendar
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {schedule.respectCommercialCalendar ? "Integrado" : "Ignorado"}
                </button>
              </SystemTooltip>
            </div>

            {futureNonWorkingDays.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Próximas datas sem expediente (próximos 90 dias)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {futureNonWorkingDays.slice(0, 8).map((item) => (
                    <div
                      key={`${item.date}-${item.type}`}
                      className="px-3 py-2 rounded-xl border border-border bg-muted/25 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[11px] font-extrabold text-foreground truncate">
                          {item.description}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatDateBr(item.date)} · {formatWeekdayFromIso(item.date)}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-card border border-border text-muted-foreground shrink-0">
                        {calendarTypeBadgeLabel(item.type)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl border border-dashed border-border text-[11px] text-muted-foreground">
                Nenhum feriado, emenda ou suspensão nos próximos 90 dias.
              </div>
            )}
          </div>
        </div>

        {/* Coluna Direita: Prévia do Próximo Retorno & Comportamento do Fagner */}
        <div className="xl:col-span-5 space-y-4">
          <div className="p-4 rounded-2xl border border-border bg-card space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-xs font-extrabold text-foreground">
                Prévia ao vivo do aviso do Fagner (via Gemini)
              </h3>
            </div>

            {/* Simulador rápido de cenários */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: "live", label: "Agora (ao vivo)" },
                  {
                    id: "closing_soon",
                    label: `Transição (${formatHumanHourPt(parsedConfig.endHour, parsedConfig.endMinute)})`,
                  },
                  { id: "night", label: "Hoje 20:30" },
                  { id: "saturday", label: "Sábado 10:00" },
                  ...(nextHoliday
                    ? [
                        {
                          id: "next_holiday" as const,
                          label: `Feriado ${formatDateBr(nextHoliday.date).slice(0, 5)}`,
                        },
                      ]
                    : []),
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSimulation(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border transition cursor-pointer ${
                    simulation === opt.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Dados calculados do cenário */}
            <div className="p-3 rounded-xl bg-muted/35 border border-border space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground font-semibold">Cenário avaliado</span>
                <span className="font-extrabold text-foreground">
                  {previewEvaluation.currentWeekdayName},{" "}
                  {formatDateBr(previewEvaluation.currentDateIso)} ·{" "}
                  {previewEvaluation.currentTimeLabel} BRT
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground font-semibold">Próximo retorno humano</span>
                <span className="font-extrabold text-primary">
                  {previewEvaluation.nextOpen.label}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground font-semibold">Data do próximo útil</span>
                <span className="font-bold text-foreground">
                  {formatDateBr(previewEvaluation.nextOpen.dateIso)} (
                  {previewEvaluation.nextOpen.dayName})
                </span>
              </div>
              {previewEvaluation.nextOpen.skippedHolidays.length > 0 && (
                <div className="pt-1 border-t border-border/70 flex items-start gap-1.5 text-[10px] text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                  <span>
                    Cruzou feriado/emenda:{" "}
                    <strong className="text-foreground">
                      {previewEvaluation.nextOpen.skippedHolidays
                        .map((h) => `${h.description} (${formatDateBr(h.date).slice(0, 5)})`)
                        .join(", ")}
                    </strong>
                  </span>
                </div>
              )}
            </div>

            {/* Balão de referência do Fagner */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Referência de mensagem na conclusão (antes da aprovação SDR)
              </span>
              <div className="p-3.5 rounded-2xl bg-muted/50 border border-border text-xs text-foreground leading-relaxed">
                “{samplePreviewMessage}”
              </div>
              <p className="text-[10px] text-muted-foreground">
                Em produção, o Gemini (Vertex AI) adapta a redação naturalmente ao contexto do
                cliente, mantendo o horário exato de retorno acima sem usar balão fixo colado.
              </p>
            </div>
          </div>

          {/* Checklist de Cobertura */}
          <div className="p-4 rounded-2xl border border-border bg-card space-y-2.5">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground shrink-0" />
              <h3 className="text-xs font-extrabold text-foreground">
                Onde esta regra atua automaticamente
              </h3>
            </div>
            <ul className="space-y-1.5 text-[11px] text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">
                    Conclusão da triagem (antes da aprovação SDR)
                  </strong>
                  : Fagner avisa naturalmente no WhatsApp e no Site, sem esfriar o “Oi” inicial.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Dúvida durante a coleta</strong>: se o cliente
                  perguntar se há alguém online, Fagner responde o horário real e segue a triagem.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Fluxos cobertos</strong>: WhatsApp, ponte
                  Site→WhatsApp + confirmação pós-template, transferência direta nominal e aprovação
                  manual SDR fora do horário.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  <strong className="text-foreground">Exceções preservadas</strong>: não aplica em
                  Currículos (Sólides), Fornecedores/Parcerias ou desistência, nem altera a
                  Valentina (Valem).
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
