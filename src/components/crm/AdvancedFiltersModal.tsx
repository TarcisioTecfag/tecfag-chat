import React, { useEffect, useState } from "react";
import { Building2, CalendarDays, Check, ChevronDown, ChevronUp, Filter, Loader2, Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SystemTooltip } from "@/components/ui/tooltip";
import { CrmDatePicker } from "./CrmDatePicker";
import {
  CRM_STATUS_FILTER_MAP,
  CRM_STATUS_FILTER_OPTIONS,
  type CrmStatusFilter,
} from "./deal-status-config";
import type { LucideIcon } from "lucide-react";

export interface AdvancedFiltersState {
  stageIds?: string[];
  minValue?: number;
  maxValue?: number;
  createdAfter?: string;
  createdBefore?: string;
  hasOverdueTask?: boolean;
  coolingOnly?: boolean;
  coolingDays?: number;
  withoutTask?: boolean;
  rdStationOnly?: boolean;
  emptyFields?: string[];
  title?: string;
  rating?: number;
  companyId?: string;
  campaign?: string;
  source?: string;
  productId?: string;
  lastContactFrom?: string;
  lastContactTo?: string;
  nextTaskFrom?: string;
  nextTaskTo?: string;
  closedFrom?: string;
  closedTo?: string;
  expectedCloseFrom?: string;
  expectedCloseTo?: string;
}

const dateFields = [
  { label: "Data de criação", from: "createdAfter", to: "createdBefore", allowFuture: false },
  { label: "Data de último contato", from: "lastContactFrom", to: "lastContactTo", allowFuture: false },
  { label: "Data da próxima tarefa", from: "nextTaskFrom", to: "nextTaskTo", allowFuture: true },
  { label: "Data de fechamento", from: "closedFrom", to: "closedTo", allowFuture: false },
  { label: "Data de previsão de fechamento", from: "expectedCloseFrom", to: "expectedCloseTo", allowFuture: true },
] as const;

const emptyFieldOptions = [
  ["value", "Valor total"],
  ["rating", "Qualificação"],
  ["company", "Empresa"],
  ["campaign", "Campanha"],
  ["source", "Fonte"],
  ["expectedClose", "Previsão de fechamento"],
  ["lastContact", "Último contato"],
  ["nextTask", "Próxima tarefa"],
  ["products", "Produto ou serviço"],
] as const;

type Option = {
  value: string;
  label: string;
  icon?: LucideIcon;
  iconColor?: string;
};
type PresetKey =
  | number
  | "yesterday"
  | "tomorrow"
  | "week"
  | "month"
  | "sixMonths"
  | "next7"
  | "next14"
  | "next30";

export function countActiveAdvancedFilters(filters: AdvancedFiltersState): number {
  return (
    dateFields.filter(({ from, to }) => filters[from] || filters[to]).length +
    [
      filters.stageIds?.length,
      filters.minValue !== undefined,
      filters.maxValue !== undefined,
      filters.hasOverdueTask,
      filters.coolingOnly,
      filters.withoutTask,
      filters.rdStationOnly,
      filters.emptyFields?.length,
      filters.title,
      filters.rating !== undefined,
      filters.companyId,
      filters.campaign,
      filters.source,
      filters.productId,
    ].filter(Boolean).length
  );
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function preset(value: PresetKey): readonly [string, string] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today);
  const end = new Date(today);

  if (value === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (value === "tomorrow") {
    start.setDate(start.getDate() + 1);
    end.setDate(end.getDate() + 1);
  } else if (value === "week") {
    const dayOffset = (start.getDay() + 6) % 7; // Segunda-feira = 0
    start.setDate(start.getDate() - dayOffset);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6); // Domingo da mesma semana
  } else if (value === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0); // Último dia do mês atual
  } else if (value === "sixMonths") {
    start.setMonth(start.getMonth() - 6);
  } else if (value === "next7") {
    end.setDate(end.getDate() + 6);
  } else if (value === "next14") {
    end.setDate(end.getDate() + 13);
  } else if (value === "next30") {
    end.setDate(end.getDate() + 29);
  } else {
    start.setDate(start.getDate() - value);
  }

  return [localDate(start), localDate(end)] as const;
}

function formatShortDate(iso?: string) {
  if (!iso) return "…";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function DateFilter({
  label,
  from,
  to,
  allowFuture = false,
  onChange,
}: {
  label: string;
  from?: string;
  to?: string;
  allowFuture?: boolean;
  onChange: (from?: string, to?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);

  const presets: Array<[string, PresetKey]> = allowFuture
    ? [
        ["Hoje", 0],
        ["Amanhã", "tomorrow"],
        ["Esta semana", "week"],
        ["Este mês", "month"],
        ["Próximos 7 dias", "next7"],
        ["Próximos 14 dias", "next14"],
        ["Próximos 30 dias", "next30"],
        ["Últimos 7 dias", 6],
        ["Últimos 30 dias", 29],
      ]
    : [
        ["Hoje", 0],
        ["Ontem", "yesterday"],
        ["Esta semana", "week"],
        ["Este mês", "month"],
        ["Últimos 7 dias", 6],
        ["Últimos 14 dias", 13],
        ["Últimos 30 dias", 29],
        ["Últimos 6 meses", "sixMonths"],
      ];

  const hasValue = Boolean(from || to);
  const display = hasValue
    ? from && to && from === to
      ? formatShortDate(from)
      : `${formatShortDate(from)} até ${formatShortDate(to)}`
    : "Selecionar";

  return (
    <div data-tour={label === "Data de criação" ? "crm.filter-dates" : undefined} className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setCustom(false);
        }}
      >
        <SystemTooltip content={`Filtrar por ${label.toLowerCase()}`}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={`flex h-9 w-full items-center gap-2 rounded-lg border px-3 text-left text-xs transition-colors cursor-pointer ${
                hasValue
                  ? "border-primary/50 bg-primary/5 text-foreground font-medium"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <CalendarDays className={`h-4 w-4 shrink-0 ${hasValue ? "text-primary" : "text-muted-foreground"}`} />
              <span className="min-w-0 flex-1 truncate">{display}</span>
              {hasValue ? (
                <SystemTooltip content={`Limpar ${label.toLowerCase()}`}>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Limpar ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(undefined, undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onChange(undefined, undefined);
                      }
                    }}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </span>
                </SystemTooltip>
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
              )}
            </button>
          </PopoverTrigger>
        </SystemTooltip>
        <PopoverContent
          align="start"
          side="bottom"
          className="z-[200] w-72 max-w-[calc(100vw-2rem)] p-1.5 text-xs shadow-2xl"
        >
          {custom ? (
            <div className="space-y-2.5 p-2">
              <button
                type="button"
                onClick={() => setCustom(false)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ‹ Voltar para atalhos
              </button>
              <div className="space-y-1">
                <Label className="block text-[11px] text-muted-foreground">De (data inicial)</Label>
                <CrmDatePicker
                  value={from || null}
                  onChange={(val) => onChange(val || undefined, to)}
                  placeholder="Selecionar data inicial"
                  tooltipText="Selecionar data inicial do período"
                />
              </div>
              <div className="space-y-1">
                <Label className="block text-[11px] text-muted-foreground">Até (data final)</Label>
                <CrmDatePicker
                  value={to || null}
                  onChange={(val) => onChange(from, val || undefined)}
                  placeholder="Selecionar data final"
                  tooltipText="Selecionar data final do período"
                />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                {hasValue && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 flex-1 text-xs"
                    onClick={() => {
                      onChange(undefined, undefined);
                      setOpen(false);
                    }}
                  >
                    Limpar
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  className="h-8 flex-1 text-xs font-semibold"
                  onClick={() => setOpen(false)}
                >
                  Concluir
                </Button>
              </div>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {presets.map(([text, value], index) => {
                const [pFrom, pTo] = preset(value);
                const isSelected = from === pFrom && to === pTo;
                return (
                  <React.Fragment key={text}>
                    {(index === 4 || index === 7) && <div className="my-1 border-t border-border" />}
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-primary/15 text-primary font-semibold"
                          : "hover:bg-muted text-foreground"
                      }`}
                      onClick={() => {
                        onChange(pFrom, pTo);
                        setOpen(false);
                      }}
                    >
                      <span>{text}</span>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                  </React.Fragment>
                );
              })}
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left font-medium hover:bg-muted cursor-pointer"
                onClick={() => setCustom(true)}
              >
                <span>Período personalizado</span>
                <span>›</span>
              </button>
              {hasValue && (
                <button
                  type="button"
                  className="mt-0.5 block w-full rounded-md px-3 py-1.5 text-left text-rose-500 hover:bg-rose-500/10 cursor-pointer font-medium"
                  onClick={() => {
                    onChange(undefined, undefined);
                    setOpen(false);
                  }}
                >
                  Limpar período
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  emptyLabel = "Selecionar",
  emptyIcon: EmptyIcon,
  emptyIconColor = "text-muted-foreground",
}: {
  label: string;
  value?: string;
  options: Option[];
  onChange: (value?: string) => void;
  emptyLabel?: string;
  emptyIcon?: LucideIcon;
  emptyIconColor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Select
        value={value || "__all__"}
        onValueChange={(next) => onChange(next === "__all__" ? undefined : next)}
      >
        <SystemTooltip content={`Filtrar por ${label.toLowerCase()}`}>
          <SelectTrigger className="h-9 w-full rounded-lg bg-background text-xs">
            <SelectValue />
          </SelectTrigger>
        </SystemTooltip>
        <SelectContent>
          <SelectItem value="__all__">
            {EmptyIcon ? (
              <span className="inline-flex items-center gap-2">
                <EmptyIcon className={`h-3.5 w-3.5 shrink-0 ${emptyIconColor}`} />
                <span>{emptyLabel}</span>
              </span>
            ) : (
              emptyLabel
            )}
          </SelectItem>
          {options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <SelectItem key={option.value} value={option.value}>
                {OptionIcon ? (
                  <span className="inline-flex items-center gap-2">
                    <OptionIcon className={`h-3.5 w-3.5 shrink-0 ${option.iconColor || "text-muted-foreground"}`} />
                    <span>{option.label}</span>
                  </span>
                ) : (
                  option.label
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  stages: Array<{ id: string; name: string }>;
  filters: AdvancedFiltersState;
  statusFilter: CrmStatusFilter;
  onApply: (filters: AdvancedFiltersState, status: CrmStatusFilter) => void;
}

export function AdvancedFiltersModal({
  isOpen,
  onClose,
  stages,
  filters,
  statusFilter,
  onApply,
}: Props) {
  const [draft, setDraft] = useState<AdvancedFiltersState>(filters);
  const [status, setStatus] = useState<CrmStatusFilter>(statusFilter);
  const [sources, setSources] = useState<Option[]>([]);
  const [campaigns, setCampaigns] = useState<Option[]>([]);
  const [products, setProducts] = useState<Option[]>([]);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [companyPopoverOpen, setCompanyPopoverOpen] = useState(false);
  const [emptyFieldsPopoverOpen, setEmptyFieldsPopoverOpen] = useState(false);
  const [selectedCompanyCache, setSelectedCompanyCache] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setDraft(filters);
      setStatus(statusFilter);
    }
  }, [isOpen, filters, statusFilter]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    Promise.all([
      fetch("/api/crm/catalogs?kind=source"),
      fetch("/api/crm/catalogs?kind=campaign"),
      fetch("/api/crm/products"),
      fetch("/api/crm/deal-filter-options"),
    ])
      .then(async ([sourceRes, campaignRes, productRes, historicalRes]) => {
        const [sourceData, campaignData, productData, historicalData] = await Promise.all([
          sourceRes.ok ? sourceRes.json() : { items: [] },
          campaignRes.ok ? campaignRes.json() : { items: [] },
          productRes.ok ? productRes.json() : { products: [] },
          historicalRes.ok ? historicalRes.json() : { sources: [], campaigns: [] },
        ]);
        if (!active) return;
        const combinedOptions = (catalog: Array<{ name: string }>, historical: string[]) =>
          [...new Set([...catalog.map((item) => item.name), ...historical])]
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, "pt-BR"))
            .map((name) => ({ value: name, label: name }));
        setSources(combinedOptions(sourceData.options || sourceData.items || [], historicalData.sources || []));
        setCampaigns(combinedOptions(campaignData.options || campaignData.items || [], historicalData.campaigns || []));
        setProducts(
          (productData.products || []).map((item: { id: string; name: string }) => ({
            value: item.id,
            label: item.name,
          })),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setLoadingCompanies(true);
    const timer = setTimeout(
      () =>
        fetch(
          `/api/crm/accounts?limit=50&search=${encodeURIComponent(companySearch)}`,
          { signal: controller.signal },
        )
          .then((res) => (res.ok ? res.json() : { accounts: [] }))
          .then((data) => {
            const list: Option[] = (data.accounts || []).map(
              (account: { id: string; name: string; tradeName?: string | null }) => ({
                value: account.id,
                label: account.name || account.tradeName || "Empresa sem nome",
              }),
            );
            setCompanies(list);
            setSelectedCompanyCache((prev) => {
              const next = { ...prev };
              for (const item of list) {
                next[item.value] = item.label;
              }
              return next;
            });
          })
          .catch(() => {})
          .finally(() => setLoadingCompanies(false)),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, companySearch]);

  const update = <K extends keyof AdvancedFiltersState>(key: K, value: AdvancedFiltersState[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleEmpty = (value: string) =>
    update(
      "emptyFields",
      draft.emptyFields?.includes(value)
        ? draft.emptyFields.filter((item) => item !== value)
        : [...(draft.emptyFields || []), value],
    );

  const selectedEmptyLabels = (draft.emptyFields || [])
    .map((val) => emptyFieldOptions.find(([k]) => k === val)?.[1])
    .filter(Boolean) as string[];

  const emptyFieldsDisplay =
    selectedEmptyLabels.length === 0
      ? "Selecione campos"
      : selectedEmptyLabels.length <= 2
        ? selectedEmptyLabels.join(", ")
        : `${selectedEmptyLabels.length} campo(s) selecionado(s)`;

  const selectedCompanyLabel = draft.companyId
    ? companies.find((company) => company.value === draft.companyId)?.label ||
      selectedCompanyCache[draft.companyId] ||
      "Empresa selecionada"
    : undefined;

  const apply = () => {
    const clean = Object.fromEntries(
      Object.entries(draft).filter(
        ([, value]) =>
          value !== undefined &&
          value !== "" &&
          value !== false &&
          (!Array.isArray(value) || value.length),
      ),
    ) as AdvancedFiltersState;
    onApply(clean, status);
    onClose();
  };
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        data-tour="crm.filters-dialog"
        side="right"
        className="grid w-full max-w-[420px] sm:max-w-[460px] md:max-w-[480px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-card p-0 shadow-2xl z-[120]"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-sm font-bold">
            <Filter className="h-4 w-4 text-primary" />
            Filtros{" "}
            <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
              {countActiveAdvancedFilters(draft) + Number(status !== "all")}
            </span>
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-xs">
          {stages.length > 0 && (
            <div data-tour="crm.filter-stages" className="space-y-1.5">
              <Label className="text-xs font-semibold">Etapas do funil</Label>
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {stages.map((stage) => {
                  const isChecked = draft.stageIds?.includes(stage.id) || false;
                  return (
                    <SystemTooltip
                      key={stage.id}
                      content={isChecked ? `Remover etapa "${stage.name}"` : `Filtrar pela etapa "${stage.name}"`}
                    >
                      <label
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() =>
                            update(
                              "stageIds",
                              isChecked
                                ? draft.stageIds?.filter((id) => id !== stage.id)
                                : [...(draft.stageIds || []), stage.id],
                            )
                          }
                        />
                        {stage.name}
                      </label>
                    </SystemTooltip>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-3 border-t border-border pt-4">
            <SystemTooltip content="Exibir apenas negociações que não possuem nenhuma tarefa pendente">
              <label className="flex cursor-pointer items-start gap-2">
                <Switch
                  data-tour="crm.filter-work"
                  checked={!!draft.withoutTask}
                  onCheckedChange={(checked) => update("withoutTask", checked)}
                />
                <span className="pt-0.5 font-semibold">Ver apenas negociações sem tarefa</span>
              </label>
            </SystemTooltip>
            <SystemTooltip content="Exibir apenas negociações sem interação há vários dias">
              <label className="flex cursor-pointer items-start gap-2">
                <Switch
                  checked={!!draft.coolingOnly}
                  onCheckedChange={(checked) => update("coolingOnly", checked)}
                />
                <span className="pt-0.5 font-semibold">Ver apenas negociações esfriando</span>
              </label>
            </SystemTooltip>
            {draft.coolingOnly && (
              <div className="flex items-center gap-2 pl-9">
                <span>Dias sem atividade</span>
                <div className="relative flex items-center w-28">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={draft.coolingDays ?? 10}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, "");
                      update("coolingDays", digits ? Math.min(365, Math.max(1, Number(digits))) : 1);
                    }}
                    className="h-8 pr-14 text-xs"
                  />
                  <div className="absolute right-1 flex items-center gap-0.5">
                    <SystemTooltip content="Diminuir dias (-1)">
                      <button
                        type="button"
                        onClick={() => update("coolingDays", Math.max(1, (draft.coolingDays ?? 10) - 1))}
                        className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </SystemTooltip>
                    <SystemTooltip content="Aumentar dias (+1)">
                      <button
                        type="button"
                        onClick={() => update("coolingDays", Math.min(365, (draft.coolingDays ?? 10) + 1))}
                        className="flex h-6 w-6 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                    </SystemTooltip>
                  </div>
                </div>
              </div>
            )}
            <SystemTooltip content="Exibir apenas negociações originadas do RD Station Marketing">
              <label className="flex cursor-pointer items-start gap-2">
                <Switch
                  checked={!!draft.rdStationOnly}
                  onCheckedChange={(checked) => update("rdStationOnly", checked)}
                />
                <span className="pt-0.5 font-semibold">
                  Ver apenas negociações do RD Station Marketing
                </span>
              </label>
            </SystemTooltip>
            <SystemTooltip content="Exibir apenas negociações com tarefas vencidas (atrasadas)">
              <label className="flex cursor-pointer items-start gap-2">
                <Switch
                  checked={!!draft.hasOverdueTask}
                  onCheckedChange={(checked) => update("hasOverdueTask", checked)}
                />
                <span className="pt-0.5 font-semibold">
                  Ver apenas negociações com tarefa vencida
                </span>
              </label>
            </SystemTooltip>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Campos vazios</Label>
            <Popover open={emptyFieldsPopoverOpen} onOpenChange={setEmptyFieldsPopoverOpen}>
              <SystemTooltip content="Filtrar negociações que possuem determinados campos sem preenchimento">
                <PopoverTrigger asChild>
                  <button
                    data-tour="crm.filter-fields"
                    type="button"
                    className={`flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-xs transition-colors cursor-pointer ${
                      draft.emptyFields?.length
                        ? "border-primary/50 bg-primary/5 text-foreground font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{emptyFieldsDisplay}</span>
                    {draft.emptyFields?.length ? (
                      <SystemTooltip content="Limpar filtro de campos vazios">
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Limpar campos vazios"
                          onClick={(e) => {
                            e.stopPropagation();
                            update("emptyFields", []);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              update("emptyFields", []);
                            }
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </span>
                      </SystemTooltip>
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    )}
                  </button>
                </PopoverTrigger>
              </SystemTooltip>
              <PopoverContent align="start" className="z-[200] w-72 space-y-1 p-2 shadow-2xl">
                <div className="max-h-60 space-y-0.5 overflow-y-auto">
                  {emptyFieldOptions.map(([value, label]) => {
                    const isChecked = draft.emptyFields?.includes(value) || false;
                    return (
                      <SystemTooltip
                        key={value}
                        content={isChecked ? `Desmarcar "${label}"` : `Filtrar quando "${label}" estiver vazio`}
                      >
                        <label
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
                        >
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={() => toggleEmpty(value)}
                          />
                          <span className="flex-1">{label}</span>
                        </label>
                      </SystemTooltip>
                    );
                  })}
                </div>
                {Boolean(draft.emptyFields?.length) && (
                  <div className="border-t border-border pt-1.5">
                    <button
                      type="button"
                      onClick={() => update("emptyFields", [])}
                      className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    >
                      Limpar seleção
                    </button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <FilterSelect
            label="Status da negociação"
            emptyLabel={CRM_STATUS_FILTER_MAP.all.label}
            emptyIcon={CRM_STATUS_FILTER_MAP.all.icon}
            emptyIconColor={CRM_STATUS_FILTER_MAP.all.iconColor}
            value={status === "all" ? undefined : status}
            onChange={(value) => setStatus((value || "all") as CrmStatusFilter)}
            options={CRM_STATUS_FILTER_OPTIONS.filter((opt) => opt.value !== "all").map((opt) => ({
              value: opt.value,
              label: opt.label,
              icon: opt.icon,
              iconColor: opt.iconColor,
            }))}
          />
          <div className="space-y-1.5">
            <Label htmlFor="crm-filter-title" className="text-xs font-semibold">
              Nome da Negociação
            </Label>
            <Input
              id="crm-filter-title"
              value={draft.title || ""}
              onChange={(event) => update("title", event.target.value)}
              className="h-9 text-xs"
            />
          </div>
          <FilterSelect
            label="Qualificação"
            value={draft.rating === undefined ? undefined : String(draft.rating)}
            onChange={(value) => update("rating", value === undefined ? undefined : Number(value))}
            options={Array.from({ length: 6 }, (_, rating) => ({
              value: String(rating),
              label:
                rating === 0
                  ? "Sem qualificação"
                  : `${rating} ${rating === 1 ? "estrela" : "estrelas"}`,
            }))}
          />
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Valor total</Label>
            <div className="flex items-center gap-2">
              <div className="relative flex min-w-0 flex-1 items-center">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  aria-label="Valor mínimo"
                  value={draft.minValue ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9.]/g, "");
                    update("minValue", raw === "" ? undefined : Number(raw));
                  }}
                  className="h-9 pr-13 text-xs"
                />
                <div className="absolute right-1 flex items-center gap-0.5">
                  <SystemTooltip content="Diminuir valor mínimo (-100)">
                    <button
                      type="button"
                      onClick={() => update("minValue", Math.max(0, (draft.minValue ?? 0) - 100))}
                      className="flex h-6 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </SystemTooltip>
                  <SystemTooltip content="Aumentar valor mínimo (+100)">
                    <button
                      type="button"
                      onClick={() => update("minValue", (draft.minValue ?? 0) + 100)}
                      className="flex h-6 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                  </SystemTooltip>
                </div>
              </div>
              <span>até</span>
              <div className="relative flex min-w-0 flex-1 items-center">
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  aria-label="Valor máximo"
                  value={draft.maxValue ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value.replace(/[^0-9.]/g, "");
                    update("maxValue", raw === "" ? undefined : Number(raw));
                  }}
                  className="h-9 pr-13 text-xs"
                />
                <div className="absolute right-1 flex items-center gap-0.5">
                  <SystemTooltip content="Diminuir valor máximo (-100)">
                    <button
                      type="button"
                      onClick={() => update("maxValue", Math.max(0, (draft.maxValue ?? 0) - 100))}
                      className="flex h-6 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </SystemTooltip>
                  <SystemTooltip content="Aumentar valor máximo (+100)">
                    <button
                      type="button"
                      onClick={() => update("maxValue", (draft.maxValue ?? 0) + 100)}
                      className="flex h-6 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                  </SystemTooltip>
                </div>
              </div>
            </div>
          </div>
          {dateFields.map(({ label, from, to, allowFuture }) => (
            <DateFilter
              key={label}
              label={label}
              from={draft[from]}
              to={draft[to]}
              allowFuture={allowFuture}
              onChange={(start, end) =>
                setDraft((current) => ({ ...current, [from]: start, [to]: end }))
              }
            />
          ))}
          <div data-tour="crm.filter-relations" className="space-y-1.5">
            <Label className="text-xs font-semibold">Empresa</Label>
            <Popover open={companyPopoverOpen} onOpenChange={setCompanyPopoverOpen}>
              <SystemTooltip content="Filtrar negociações por empresa vinculada">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={`flex h-9 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-xs transition-colors cursor-pointer ${
                      draft.companyId
                        ? "border-primary/50 bg-primary/5 text-foreground font-medium"
                        : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Building2
                        className={`h-3.5 w-3.5 shrink-0 ${
                          draft.companyId ? "text-primary" : "text-muted-foreground"
                        }`}
                      />
                      <span className="truncate">{selectedCompanyLabel || "Selecionar"}</span>
                    </div>
                    {draft.companyId ? (
                      <SystemTooltip content="Limpar filtro de empresa">
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label="Limpar empresa"
                          onClick={(e) => {
                            e.stopPropagation();
                            update("companyId", undefined);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              update("companyId", undefined);
                            }
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </span>
                      </SystemTooltip>
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    )}
                  </button>
                </PopoverTrigger>
              </SystemTooltip>
              <PopoverContent
                align="start"
                className="z-[200] w-80 max-w-[calc(100vw-2rem)] p-2 shadow-2xl"
              >
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={companySearch}
                    onChange={(event) => setCompanySearch(event.target.value)}
                    placeholder="Buscar empresa por nome ou CNPJ..."
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <div className="max-h-52 space-y-0.5 overflow-y-auto">
                  <button
                    type="button"
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                      !draft.companyId
                        ? "bg-primary/15 text-primary font-semibold"
                        : "hover:bg-muted text-muted-foreground"
                    }`}
                    onClick={() => {
                      update("companyId", undefined);
                      setCompanyPopoverOpen(false);
                    }}
                  >
                    <span>Todas as empresas (Selecionar)</span>
                    {!draft.companyId && <Check className="h-3.5 w-3.5 text-primary" />}
                  </button>
                  {loadingCompanies ? (
                    <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Buscando empresas...</span>
                    </div>
                  ) : companies.length === 0 ? (
                    <div className="py-3 text-center text-xs text-muted-foreground">
                      Nenhuma empresa encontrada.
                    </div>
                  ) : (
                    companies.map((company) => {
                      const isSelected = draft.companyId === company.value;
                      return (
                        <button
                          key={company.value}
                          type="button"
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-primary/15 text-primary font-semibold"
                              : "hover:bg-muted text-foreground"
                          }`}
                          onClick={() => {
                            setSelectedCompanyCache((prev) => ({
                              ...prev,
                              [company.value]: company.label,
                            }));
                            update("companyId", company.value);
                            setCompanyPopoverOpen(false);
                          }}
                        >
                          <span className="truncate">{company.label}</span>
                          {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <FilterSelect
            label="Campanha"
            value={draft.campaign}
            options={campaigns}
            onChange={(value) => update("campaign", value)}
          />
          <FilterSelect
            label="Fonte"
            value={draft.source}
            options={sources}
            onChange={(value) => update("source", value)}
          />
          <FilterSelect
            label="Produto ou serviço"
            value={draft.productId}
            options={products}
            onChange={(value) => update("productId", value)}
          />
        </div>
        <SheetFooter className="flex-row items-center justify-between gap-2 border-t border-border px-5 py-4">
          <SystemTooltip content="Restaurar todos os filtros para o padrão">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="text-xs"
              onClick={() => {
                setDraft({});
                setStatus("all");
              }}
            >
              Limpar filtros
            </Button>
          </SystemTooltip>
          <SystemTooltip content="Aplicar filtros selecionados ao CRM">
            <Button type="button" size="sm" className="text-xs font-semibold" onClick={apply}>
              Aplicar filtros
            </Button>
          </SystemTooltip>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
