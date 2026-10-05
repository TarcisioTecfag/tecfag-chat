import React, { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, Filter } from "lucide-react";
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
import type { CrmStatusFilter } from "./CrmToolbar";

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
  { label: "Data de criação", from: "createdAfter", to: "createdBefore" },
  { label: "Data de último contato", from: "lastContactFrom", to: "lastContactTo" },
  { label: "Data da próxima tarefa", from: "nextTaskFrom", to: "nextTaskTo" },
  { label: "Data de fechamento", from: "closedFrom", to: "closedTo" },
  { label: "Data de previsão de fechamento", from: "expectedCloseFrom", to: "expectedCloseTo" },
] as const;
const emptyFieldOptions = [
  ["value", "Valor total"],
  ["rating", "Qualificação"],
  ["company", "Empresa"],
  ["campaign", "Campanha"],
  ["source", "Fonte"],
  ["expectedClose", "Previsão de fechamento"],
  ["nextTask", "Próxima tarefa"],
  ["products", "Produto ou serviço"],
] as const;
type Option = { value: string; label: string };

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
function preset(value: number | "week" | "month" | "sixMonths") {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (value === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (value === "month") start.setDate(1);
  else if (value === "sixMonths") start.setMonth(start.getMonth() - 6);
  else start.setDate(start.getDate() - value);
  return [localDate(start), localDate(now)] as const;
}

function DateFilter({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from?: string;
  to?: string;
  onChange: (from?: string, to?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const presets: Array<[string, number | "week" | "month" | "sixMonths"]> = [
    ["Hoje", 0],
    ["Esta semana", "week"],
    ["Este mês", "month"],
    ["Últimos 7 dias", 6],
    ["Últimos 14 dias", 13],
    ["Últimos 30 dias", 29],
    ["Últimos 6 meses", "sixMonths"],
  ];
  const display =
    from || to
      ? `${from?.split("-").reverse().join("/") || "…"} até ${to?.split("-").reverse().join("/") || "…"}`
      : "Selecionar";
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Popover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setCustom(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs"
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{display}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          className="w-60 max-w-[calc(100vw-2rem)] p-1 text-xs"
        >
          {custom ? (
            <div className="space-y-2 p-2">
              <button type="button" onClick={() => setCustom(false)}>
                ‹ Voltar
              </button>
              <Label className="block text-xs">De</Label>
              <Input
                type="date"
                value={from || ""}
                max={to}
                onChange={(event) => onChange(event.target.value || undefined, to)}
                className="h-8 text-xs"
              />
              <Label className="block text-xs">Até</Label>
              <Input
                type="date"
                value={to || ""}
                min={from}
                onChange={(event) => onChange(from, event.target.value || undefined)}
                className="h-8 text-xs"
              />
              <Button type="button" size="sm" className="w-full" onClick={() => setOpen(false)}>
                Concluir
              </Button>
            </div>
          ) : (
            <>
              {presets.map(([text, value], index) => (
                <React.Fragment key={text}>
                  {(index === 3 || index === 6) && <div className="my-1 border-t border-border" />}
                  <button
                    type="button"
                    className="block w-full rounded px-3 py-2 text-left hover:bg-muted"
                    onClick={() => {
                      onChange(...preset(value));
                      setOpen(false);
                    }}
                  >
                    {text}
                  </button>
                </React.Fragment>
              ))}
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                className="flex w-full justify-between rounded px-3 py-2 text-left hover:bg-muted"
                onClick={() => setCustom(true)}
              >
                Período personalizado <span>›</span>
              </button>
              {(from || to) && (
                <button
                  type="button"
                  className="block w-full rounded px-3 py-2 text-left hover:bg-muted"
                  onClick={() => {
                    onChange();
                    setOpen(false);
                  }}
                >
                  Limpar período
                </button>
              )}
            </>
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
}: {
  label: string;
  value?: string;
  options: Option[];
  onChange: (value?: string) => void;
  emptyLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold">{label}</Label>
      <Select
        value={value || "__all__"}
        onValueChange={(next) => onChange(next === "__all__" ? undefined : next)}
      >
        <SelectTrigger className="h-9 w-full rounded-lg bg-background text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{emptyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
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
        setSources(combinedOptions(sourceData.items || [], historicalData.sources || []));
        setCampaigns(combinedOptions(campaignData.items || [], historicalData.campaigns || []));
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
    const timer = setTimeout(
      () =>
        fetch(
          `/api/crm/accounts?type=company&limit=50&search=${encodeURIComponent(companySearch)}`,
          { signal: controller.signal },
        )
          .then((res) => (res.ok ? res.json() : { accounts: [] }))
          .then((data) =>
            setCompanies(
              (data.accounts || []).map((account: { id: string; name: string }) => ({
                value: account.id,
                label: account.name,
              })),
            ),
          )
          .catch(() => {}),
      200,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, companySearch]);

  // Oculta o botão flutuante de conversas enquanto os filtros avançados estiverem abertos
  useEffect(() => {
    if (isOpen) {
      window.dispatchEvent(
        new CustomEvent("crm:set-chat-widget-suppressed", {
          detail: { suppressed: true },
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent("crm:set-chat-widget-suppressed", {
          detail: { suppressed: false },
        }),
      );
    }
    return () => {
      window.dispatchEvent(
        new CustomEvent("crm:set-chat-widget-suppressed", {
          detail: { suppressed: false },
        }),
      );
    };
  }, [isOpen]);

  const update = <K extends keyof AdvancedFiltersState>(key: K, value: AdvancedFiltersState[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleEmpty = (value: string) =>
    update(
      "emptyFields",
      draft.emptyFields?.includes(value)
        ? draft.emptyFields.filter((item) => item !== value)
        : [...(draft.emptyFields || []), value],
    );
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
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Etapas do funil</Label>
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {stages.map((stage) => (
                  <label
                    key={stage.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <Checkbox
                      checked={draft.stageIds?.includes(stage.id) || false}
                      onCheckedChange={() =>
                        update(
                          "stageIds",
                          draft.stageIds?.includes(stage.id)
                            ? draft.stageIds.filter((id) => id !== stage.id)
                            : [...(draft.stageIds || []), stage.id],
                        )
                      }
                    />
                    {stage.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-3 border-t border-border pt-4">
            <label className="flex cursor-pointer items-start gap-2">
              <Switch
                checked={!!draft.withoutTask}
                onCheckedChange={(checked) => update("withoutTask", checked)}
              />
              <span className="pt-0.5 font-semibold">Ver apenas negociações sem tarefa</span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <Switch
                checked={!!draft.coolingOnly}
                onCheckedChange={(checked) => update("coolingOnly", checked)}
              />
              <span className="pt-0.5 font-semibold">Ver apenas negociações esfriando</span>
            </label>
            {draft.coolingOnly && (
              <div className="flex items-center gap-2 pl-9">
                <span>Dias sem atividade</span>
                <Input
                  type="number"
                  min="1"
                  max="365"
                  value={draft.coolingDays ?? 10}
                  onChange={(event) => update("coolingDays", Number(event.target.value))}
                  className="h-8 w-20 text-xs"
                />
              </div>
            )}
            <label className="flex cursor-pointer items-start gap-2">
              <Switch
                checked={!!draft.rdStationOnly}
                onCheckedChange={(checked) => update("rdStationOnly", checked)}
              />
              <span className="pt-0.5 font-semibold">
                Ver apenas negociações do RD Station Marketing
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <Switch
                checked={!!draft.hasOverdueTask}
                onCheckedChange={(checked) => update("hasOverdueTask", checked)}
              />
              <span className="pt-0.5 font-semibold">
                Ver apenas negociações com tarefa vencida
              </span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Campos vazios</Label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-left text-xs"
                >
                  {draft.emptyFields?.length
                    ? `${draft.emptyFields.length} campo(s) selecionado(s)`
                    : "Selecione campos"}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 space-y-1 p-2">
                {emptyFieldOptions.map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
                  >
                    <Checkbox
                      checked={draft.emptyFields?.includes(value) || false}
                      onCheckedChange={() => toggleEmpty(value)}
                    />
                    {label}
                  </label>
                ))}
              </PopoverContent>
            </Popover>
          </div>
          <FilterSelect
            label="Status da negociação"
            emptyLabel="Todos os status"
            value={status === "all" ? undefined : status}
            onChange={(value) => setStatus((value || "all") as CrmStatusFilter)}
            options={[
              { value: "open", label: "Em andamento" },
              { value: "won", label: "Vendido" },
              { value: "lost", label: "Perdido" },
              { value: "paused", label: "Pausado" },
              { value: "not_paused", label: "Não pausado" },
            ]}
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
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="R$ 0,00"
                aria-label="Valor mínimo"
                value={draft.minValue ?? ""}
                onChange={(event) =>
                  update(
                    "minValue",
                    event.target.value === "" ? undefined : Number(event.target.value),
                  )
                }
                className="h-9 min-w-0 flex-1 text-xs"
              />
              <span>até</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="R$ 0,00"
                aria-label="Valor máximo"
                value={draft.maxValue ?? ""}
                onChange={(event) =>
                  update(
                    "maxValue",
                    event.target.value === "" ? undefined : Number(event.target.value),
                  )
                }
                className="h-9 min-w-0 flex-1 text-xs"
              />
            </div>
          </div>
          {dateFields.map(({ label, from, to }) => (
            <DateFilter
              key={label}
              label={label}
              from={draft[from]}
              to={draft[to]}
              onChange={(start, end) =>
                setDraft((current) => ({ ...current, [from]: start, [to]: end }))
              }
            />
          ))}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">Empresa</Label>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-left text-xs"
                >
                  {companies.find((company) => company.value === draft.companyId)?.label ||
                    (draft.companyId ? "Empresa selecionada" : "Selecionar")}
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-2">
                <Input
                  value={companySearch}
                  onChange={(event) => setCompanySearch(event.target.value)}
                  placeholder="Buscar empresa"
                  className="mb-2 h-8 text-xs"
                />
                <div className="max-h-48 overflow-y-auto">
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => update("companyId", undefined)}
                  >
                    Selecionar
                  </button>
                  {companies.map((company) => (
                    <button
                      key={company.value}
                      type="button"
                      className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => update("companyId", company.value)}
                    >
                      {company.label}
                    </button>
                  ))}
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
          <Button type="button" size="sm" className="text-xs font-semibold" onClick={apply}>
            Aplicar filtros
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
