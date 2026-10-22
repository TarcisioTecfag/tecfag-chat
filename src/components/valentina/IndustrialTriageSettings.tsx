import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Package,
  Compass,
  Ban,
  Search,
  Plus,
  Edit3,
  Trash2,
  Save,
  X,
  Check,
  Copy,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Upload,
  Download,
  RotateCcw,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Gem,
  Wrench,
  CircleDollarSign,
  ShieldAlert,
  Calendar,
  Clock,
  ArrowRight,
  SlidersHorizontal,
  Eye,
  EyeOff,
  FileJson,
  Building2,
  GitBranch,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { SystemTooltip } from "@/components/ui/tooltip";
import { SimpleSelect } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DESTINATION_KEYS,
  INDUSTRIAL_DESTINATIONS,
  resolveIndustrialDestination,
  setIndustrialDestination,
  convertLegacyMachineCatalog,
  emptyIndustrialSettings,
  findCatalogConflicts,
  machineSchema,
  type IndustrialDestinationKey,
  type IndustrialMachine,
  type IndustrialSettings,
} from "@/lib/triage/industrial-settings";
import {
  getDefaultIndustrialCatalog,
  inferMachineCategory,
  MACHINE_CATEGORY_OPTIONS,
  DESTINATION_DETAILS,
  autoMatchIndustrialDestinations,
  type IndustrialChoices,
} from "@/lib/triage/tecfag-default-catalog";

const draftId = () =>
  globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const blankMachine = (): IndustrialMachine => ({
  id: draftId(),
  name: "",
  sku: "",
  code: "",
  line: "SEMI-INDUSTRIAL",
  production: "",
  description: "",
  aliases: [],
  active: true,
});

function normalizeSearch(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function getDestinationIcon(key: IndustrialDestinationKey) {
  switch (key) {
    case "MAQUINAS":
      return Package;
    case "PERSONNALITE":
      return Gem;
    case "PECAS":
      return Layers;
    case "FINANCEIRO":
      return CircleDollarSign;
    case "3_AT":
      return Wrench;
    case "POS_VENDA":
      return CheckCircle2;
    case "REVIEW":
    default:
      return ShieldAlert;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SELETOR CUSTOMIZADO DE DATA E HORA (SEM DEPENDÊNCIA DE INPUT NATIVO)
// ══════════════════════════════════════════════════════════════════════════════

function CustomDateTimePicker({
  value,
  onChange,
  revision,
}: {
  value: Date;
  onChange: (next: Date) => void;
  revision: number;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewMonth, setViewMonth] = useState<Date>(() => new Date(value));

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutside);
    }
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(d);
    return cells;
  }, [viewMonth]);

  const formattedDate = value.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const formattedTime = value.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const currentHour = String(value.getHours()).padStart(2, "0");
  const currentMinute = String(Math.floor(value.getMinutes() / 5) * 5).padStart(2, "0");

  const hourOptions = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => {
        const val = String(h).padStart(2, "0");
        return { value: val, label: `${val}h` };
      }),
    [],
  );

  const minuteOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) => {
        const val = String(m * 5).padStart(2, "0");
        return { value: val, label: `${val} min` };
      }),
    [],
  );

  return (
    <div className="relative" ref={containerRef}>
      <SystemTooltip content="Data e hora de referência/vigência da revisão do catálogo e destinos (Horário de Brasília)">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="px-3 py-1.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 text-[11px] font-bold text-foreground flex items-center gap-2 transition cursor-pointer shadow-2xs"
        >
          <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{formattedDate}</span>
          <span className="text-muted-foreground">•</span>
          <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>{formattedTime}</span>
          <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-extrabold">
            Rev. #{revision}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </SystemTooltip>

      {open && (
        <div className="absolute right-0 mt-2 z-50 w-80 rounded-2xl border border-border bg-card text-foreground shadow-2xl p-4 space-y-3 animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div>
              <p className="text-xs font-extrabold text-foreground">Data e Hora de Vigência</p>
              <p className="text-[10px] text-muted-foreground">
                Referência operacional da configuração (BRT)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Navegação do Mês */}
          <div className="p-2.5 rounded-xl bg-muted/25 border border-border space-y-2">
            <div className="flex items-center justify-between text-xs font-extrabold px-1">
              <SystemTooltip content="Mês anterior">
                <button
                  type="button"
                  onClick={() => {
                    const prev = new Date(viewMonth);
                    prev.setMonth(prev.getMonth() - 1);
                    setViewMonth(prev);
                  }}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
              <span>
                {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </span>
              <SystemTooltip content="Próximo mês">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(viewMonth);
                    next.setMonth(next.getMonth() + 1);
                    setViewMonth(next);
                  }}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </SystemTooltip>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px]">
              {["D", "S", "T", "Q", "Q", "S", "S"].map((d, i) => (
                <span key={i} className="text-muted-foreground font-extrabold py-0.5">
                  {d}
                </span>
              ))}
              {calendarDays.map((day, idx) => {
                if (!day) return <div key={`empty-${idx}`} />;
                const isSelected =
                  value.getDate() === day &&
                  value.getMonth() === viewMonth.getMonth() &&
                  value.getFullYear() === viewMonth.getFullYear();

                return (
                  <button
                    type="button"
                    key={`day-${day}`}
                    onClick={() => {
                      const next = new Date(value);
                      next.setFullYear(viewMonth.getFullYear());
                      next.setMonth(viewMonth.getMonth());
                      next.setDate(day);
                      onChange(next);
                    }}
                    className={`py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-xs font-extrabold"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Seletor Customizado de Hora e Minuto */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-primary" />
              Horário de Referência
            </span>
            <div className="grid grid-cols-2 gap-2">
              <SimpleSelect
                value={currentHour}
                onValueChange={(h) => {
                  const next = new Date(value);
                  next.setHours(Number(h));
                  onChange(next);
                }}
                options={hourOptions}
                placeholder="Hora"
              />
              <SimpleSelect
                value={currentMinute}
                onValueChange={(m) => {
                  const next = new Date(value);
                  next.setMinutes(Number(m));
                  onChange(next);
                }}
                options={minuteOptions}
                placeholder="Minuto"
              />
            </div>
          </div>

          {/* Atalhos Rápidos */}
          <div className="flex items-center justify-between gap-1.5 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                onChange(now);
                setViewMonth(now);
              }}
              className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-[10px] font-extrabold transition cursor-pointer"
            >
              Agora
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date(value);
                d.setHours(8, 0, 0, 0);
                onChange(d);
              }}
              className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-[10px] font-bold transition cursor-pointer"
            >
              08:00 (Início)
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date(value);
                d.setHours(18, 0, 0, 0);
                onChange(d);
              }}
              className="px-2.5 py-1 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-[10px] font-bold transition cursor-pointer"
            >
              18:00 (Fecho)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: INDUSTRIAL TRIAGE SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

type ActiveSectionTab = "catalog" | "destinations" | "blocked";

export function IndustrialTriageSettings() {
  const { tenant, sessionRole } = useChat();
  const [settings, setSettings] = useState<IndustrialSettings>(() => ({
    ...emptyIndustrialSettings(),
    catalog: getDefaultIndustrialCatalog(),
  }));
  const [revision, setRevision] = useState(0);
  const [choices, setChoices] = useState<IndustrialChoices>({
    sectors: [],
    pipelines: [],
    stages: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error">("info");

  // Layout & Navegação
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveSectionTab>("catalog");
  const [referenceDateTime, setReferenceDateTime] = useState<Date>(() => new Date());

  // Filtros do Catálogo
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState<"ALL" | "SEMI-INDUSTRIAL" | "PERSONNALITE">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE" | "CONFLICT">(
    "ALL",
  );
  const [pageSize, setPageSize] = useState<string>("100");
  const [currentPage, setCurrentPage] = useState(1);
  const [expandAllDescriptions, setExpandAllDescriptions] = useState(false);
  const [onlyWithProduction, setOnlyWithProduction] = useState(false);
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const [selectedMachineIds, setSelectedMachineIds] = useState<Set<string>>(new Set());
  const [copiedBadge, setCopiedBadge] = useState<string | null>(null);

  // Modal de Criar / Editar Máquina
  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [editingMachineMode, setEditingMachineMode] = useState<"create" | "edit">("create");
  const [machineDraft, setMachineDraft] = useState<IndustrialMachine>(blankMachine);
  const [aliasInput, setAliasInput] = useState("");
  const [machineToDelete, setMachineToDelete] = useState<IndustrialMachine | null>(null);

  // Famílias bloqueadas
  const [blockedName, setBlockedName] = useState("");
  const [blockedTerms, setBlockedTerms] = useState("");
  const [blockedReason, setBlockedReason] = useState("Equipamento fora da linha comercial Tecfag");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backend = import.meta.env.VITE_BACKEND_URL || "";

  // Carregamento inicial + Hidratação automática das 1.037 máquinas se banco estiver vazio
  useEffect(() => {
    if (sessionRole !== "admin") return;
    const controller = new AbortController();

    void fetch(`${backend}/api/valentina/industrial-settings`, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar");

        const loadedChoices: IndustrialChoices = data.choices || {
          sectors: [],
          pipelines: [],
          stages: [],
        };
        setChoices(loadedChoices);
        setRevision(data.revision || 0);

        let nextSettings: IndustrialSettings = data.settings || emptyIndustrialSettings();
        let autoHydrated = false;

        // Se o banco ainda está com 0 máquinas, carrega automaticamente as 1.037 máquinas da Tecfag!
        if (!nextSettings.catalog || nextSettings.catalog.length === 0) {
          nextSettings = {
            ...nextSettings,
            catalog: getDefaultIndustrialCatalog(),
          };
          autoHydrated = true;
        }

        // Se nenhum destino foi configurado ainda e há setores/funis disponíveis, sugere os vínculos
        if (
          Object.keys(nextSettings.destinations || {}).length === 0 &&
          loadedChoices.sectors.length > 0
        ) {
          nextSettings = autoMatchIndustrialDestinations(loadedChoices, nextSettings, false);
          autoHydrated = true;
        }

        setSettings(nextSettings);
        setLoaded(true);

        if (autoHydrated) {
          setDirty(true);
          // Persiste silenciosamente se a revisão inicial for 0 para já deixar o catálogo ativo no banco
          if ((data.revision || 0) === 0) {
            try {
              const saveRes = await fetch(`${backend}/api/valentina/industrial-settings`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expectedRevision: 0, settings: nextSettings }),
                signal: controller.signal,
              });
              if (saveRes.ok) {
                const savedData = await saveRes.json();
                setSettings(savedData.settings);
                setRevision(savedData.revision);
                setDirty(false);
                setReferenceDateTime(new Date());
              }
            } catch {
              // Mantém no rascunho pronto para salvar com 1 clique
            }
          }
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMessage(error.message);
          setMessageType("error");
          setLoaded(true);
        }
      });

    return () => controller.abort();
  }, [tenant, sessionRole, backend]);

  if (sessionRole !== "admin") return null;

  const update = (next: IndustrialSettings) => {
    setSettings(next);
    setDirty(true);
    setMessage("");
  };

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${backend}/api/valentina/industrial-settings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision, settings }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          data.issues
            ?.map((issue: { path: string; message: string }) => `${issue.path}: ${issue.message}`)
            .join("; ") ||
            data.error ||
            "Falha ao salvar configuração",
        );
      }
      setSettings(data.settings);
      setRevision(data.revision);
      setDirty(false);
      setReferenceDateTime(new Date());
      setMessageType("success");
      setMessage(
        "Catálogo e destinos salvos com sucesso! O Decisor IA já está operando com esta revisão.",
      );
      toast.success("Catálogo e destinos da triagem salvos com sucesso!");
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Falha ao salvar";
      setMessageType("error");
      setMessage(errMsg);
      toast.error(errMsg);
    } finally {
      setBusy(false);
    }
  };

  // ── Estatísticas & Conflitos ───────────────────────────────────────────────
  const conflicts = useMemo(() => findCatalogConflicts(settings.catalog), [settings.catalog]);
  const conflictMachineIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of conflicts) {
      for (const id of c.machineIds) set.add(id);
    }
    return set;
  }, [conflicts]);

  const destinationConflicts = useMemo(
    () => DESTINATION_KEYS.filter((key) => resolveIndustrialDestination(settings, key).conflict),
    [settings],
  );

  const configuredDestinationsCount = useMemo(
    () =>
      DESTINATION_KEYS.filter((key) => {
        const res = resolveIndustrialDestination(settings, key);
        return Boolean(res.destination?.sectorId) && !res.conflict;
      }).length,
    [settings],
  );

  const catalogStats = useMemo(() => {
    const total = settings.catalog.length;
    let semi = 0;
    let personnalite = 0;
    let active = 0;
    let inactive = 0;
    const byCategory: Record<string, number> = {};

    for (const m of settings.catalog) {
      if (m.line === "SEMI-INDUSTRIAL") semi++;
      else if (m.line === "PERSONNALITE") personnalite++;

      if (m.active) active++;
      else inactive++;

      const cat = inferMachineCategory(m);
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    return { total, semi, personnalite, active, inactive, byCategory };
  }, [settings.catalog]);

  // ── Filtragem Completa do Catálogo ─────────────────────────────────────────
  const filteredCatalog = useMemo(() => {
    const q = normalizeSearch(search);
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];

    return settings.catalog.filter((entry) => {
      if (lineFilter !== "ALL" && entry.line !== lineFilter) return false;
      if (statusFilter === "ACTIVE" && !entry.active) return false;
      if (statusFilter === "INACTIVE" && entry.active) return false;
      if (statusFilter === "CONFLICT" && !conflictMachineIds.has(entry.id)) return false;
      if (onlyWithProduction && !entry.production?.trim()) return false;
      if (categoryFilter !== "ALL" && inferMachineCategory(entry) !== categoryFilter) {
        return false;
      }

      if (terms.length > 0) {
        const haystack = normalizeSearch(
          `${entry.name} ${entry.code} ${entry.sku} ${entry.production} ${entry.description} ${(entry.aliases || []).join(" ")}`,
        );
        return terms.every((t) => haystack.includes(t));
      }

      return true;
    });
  }, [
    settings.catalog,
    search,
    lineFilter,
    statusFilter,
    onlyWithProduction,
    categoryFilter,
    conflictMachineIds,
  ]);

  // Resetar página ao mudar filtros
  useEffect(() => {
    setCurrentPage(1);
  }, [search, lineFilter, categoryFilter, statusFilter, onlyWithProduction, pageSize]);

  const numericPageSize =
    pageSize === "ALL" ? Math.max(filteredCatalog.length, 1) : Number(pageSize) || 100;
  const totalPages = Math.max(1, Math.ceil(filteredCatalog.length / numericPageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const visibleMachines = useMemo(() => {
    if (pageSize === "ALL") return filteredCatalog;
    const start = (safeCurrentPage - 1) * numericPageSize;
    return filteredCatalog.slice(start, start + numericPageSize);
  }, [filteredCatalog, pageSize, safeCurrentPage, numericPageSize]);

  // ── Funções Auxiliares de Ação no Catálogo ─────────────────────────────────
  const handleCopyCode = (text: string, badgeId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedBadge(badgeId);
    toast.success(`Código "${text}" copiado!`);
    setTimeout(() => setCopiedBadge(null), 1800);
  };

  const openCreateModal = () => {
    setEditingMachineMode("create");
    setMachineDraft(blankMachine());
    setAliasInput("");
    setIsMachineModalOpen(true);
  };

  const openEditModal = (entry: IndustrialMachine) => {
    setEditingMachineMode("edit");
    setMachineDraft({
      ...entry,
      aliases: [...(entry.aliases || [])],
    });
    setAliasInput("");
    setIsMachineModalOpen(true);
  };

  const handleSaveMachineModal = () => {
    const cleanedAliases = machineDraft.aliases.map((a) => a.trim()).filter((a) => a.length >= 3);
    const pendingAlias = aliasInput.trim();
    if (pendingAlias.length >= 3 && !cleanedAliases.includes(pendingAlias)) {
      cleanedAliases.push(pendingAlias);
    }

    const parsed = machineSchema.safeParse({
      ...machineDraft,
      name: machineDraft.name.trim(),
      code: machineDraft.code.trim().toUpperCase(),
      sku: machineDraft.sku.trim(),
      production: machineDraft.production.trim(),
      description: machineDraft.description.trim(),
      aliases: cleanedAliases,
    });

    if (!parsed.success) {
      toast.error(
        "Verifique os dados: o nome do equipamento deve ter no mínimo 3 caracteres e os nomes alternativos 3+ caracteres.",
      );
      return;
    }

    const exists = settings.catalog.some((item) => item.id === parsed.data.id);
    const nextCatalog = exists
      ? settings.catalog.map((item) => (item.id === parsed.data.id ? parsed.data : item))
      : [parsed.data, ...settings.catalog];

    update({
      ...settings,
      catalog: nextCatalog,
    });

    setIsMachineModalOpen(false);
    toast.success(
      exists
        ? `Equipamento "${parsed.data.name}" atualizado no rascunho!`
        : `Equipamento "${parsed.data.name}" adicionado ao catálogo!`,
    );
  };

  const handleToggleMachineActive = (id: string) => {
    const target = settings.catalog.find((m) => m.id === id);
    if (!target) return;
    const nextActive = !target.active;
    update({
      ...settings,
      catalog: settings.catalog.map((m) => (m.id === id ? { ...m, active: nextActive } : m)),
    });
    toast.info(
      nextActive
        ? `"${target.name}" ativado para triagem.`
        : `"${target.name}" marcado como inativo.`,
    );
  };

  const handleToggleMachineLine = (id: string) => {
    const target = settings.catalog.find((m) => m.id === id);
    if (!target) return;
    const nextLine: IndustrialMachine["line"] =
      target.line === "SEMI-INDUSTRIAL" ? "PERSONNALITE" : "SEMI-INDUSTRIAL";
    update({
      ...settings,
      catalog: settings.catalog.map((m) => (m.id === id ? { ...m, line: nextLine } : m)),
    });
    toast.info(
      `Linha de "${target.name}" alterada para ${nextLine === "PERSONNALITE" ? "Personnalité" : "Semi-Industrial"}.`,
    );
  };

  const handleConfirmDeleteMachine = (entry: IndustrialMachine) => {
    update({
      ...settings,
      catalog: settings.catalog.filter((item) => item.id !== entry.id),
    });
    setSelectedMachineIds((prev) => {
      const next = new Set(prev);
      next.delete(entry.id);
      return next;
    });
    setMachineToDelete(null);
    toast.success(`Equipamento "${entry.name}" removido do rascunho.`);
  };

  // Ações em lote
  const allVisibleSelected =
    visibleMachines.length > 0 && visibleMachines.every((m) => selectedMachineIds.has(m.id));

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedMachineIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const m of visibleMachines) next.add(m.id);
      } else {
        for (const m of visibleMachines) next.delete(m.id);
      }
      return next;
    });
  };

  const handleBulkAction = (
    action: "activate" | "deactivate" | "set_semi" | "set_personnalite" | "delete",
  ) => {
    if (selectedMachineIds.size === 0) return;
    const count = selectedMachineIds.size;

    if (action === "delete") {
      update({
        ...settings,
        catalog: settings.catalog.filter((m) => !selectedMachineIds.has(m.id)),
      });
      setSelectedMachineIds(new Set());
      toast.success(`${count} equipamento(s) removido(s) do rascunho.`);
      return;
    }

    update({
      ...settings,
      catalog: settings.catalog.map((m) => {
        if (!selectedMachineIds.has(m.id)) return m;
        if (action === "activate") return { ...m, active: true };
        if (action === "deactivate") return { ...m, active: false };
        if (action === "set_semi") return { ...m, line: "SEMI-INDUSTRIAL" };
        if (action === "set_personnalite") return { ...m, line: "PERSONNALITE" };
        return m;
      }),
    });
    setSelectedMachineIds(new Set());
    toast.success(`Ação em lote aplicada em ${count} equipamento(s)!`);
  };

  const handleExportJson = () => {
    const payload = {
      format: "industrial-catalog-export-v1",
      exportedAt: referenceDateTime.toISOString(),
      revision,
      total: settings.catalog.length,
      catalog: settings.catalog,
      blockedFamilies: settings.blockedFamilies,
      destinations: settings.destinations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `catalogo-triagem-tecfag-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Catálogo exportado em JSON com sucesso!");
  };

  const handleRestoreDefaultCatalog = () => {
    const restored = getDefaultIndustrialCatalog();
    update({
      ...settings,
      catalog: restored,
    });
    toast.success(
      `Catálogo base Tecfag restaurado com ${restored.length} máquinas (367 Semi-Industrial + 670 Personnalité)!`,
    );
  };

  const categorySelectOptions = useMemo(
    () =>
      MACHINE_CATEGORY_OPTIONS.map((opt) => ({
        value: opt.value,
        label:
          opt.value === "ALL"
            ? `Todas as Categorias (${settings.catalog.length})`
            : `${opt.label} (${catalogStats.byCategory[opt.value] || 0})`,
      })),
    [settings.catalog.length, catalogStats.byCategory],
  );

  return (
    <div className="rounded-3xl border border-border bg-card shadow-xs overflow-hidden transition-all">
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CABEÇALHO SUPERIOR EXECUTIVO                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="px-5 py-4 border-b border-line flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-muted/15">
        <div
          onClick={() => setIsExpanded((v) => !v)}
          className="flex items-start md:items-center gap-3 cursor-pointer select-none flex-1 min-w-0"
        >
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <Package className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-extrabold text-foreground">
                Catálogo de Máquinas & Destinos da Triagem (Decisor IA)
              </h2>

              <SystemTooltip content="Total de máquinas carregadas no motor de classificação do Fagner">
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-primary/10 text-primary border border-primary/25">
                  {catalogStats.total} máquinas ({catalogStats.semi} Semi •{" "}
                  {catalogStats.personnalite} Personnalité)
                </span>
              </SystemTooltip>

              <SystemTooltip content="Quantidade de destinos de atendimento vinculados a setores e funis do CRM">
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border ${
                    configuredDestinationsCount === DESTINATION_KEYS.length
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                  }`}
                >
                  {configuredDestinationsCount}/{DESTINATION_KEYS.length} destinos ativos
                </span>
              </SystemTooltip>

              {dirty && (
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 animate-pulse">
                  Alterações não salvas
                </span>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground mt-0.5">
              Gerencie todas as máquinas Semi-Industrial e Personnalité consultadas pelo Fagner na
              triagem, famílias bloqueadas e o roteamento automático para Setores e Funis do CRM.
            </p>
          </div>
        </div>

        {/* Controles de Data/Hora Customizados + Salvar + Expandir */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <CustomDateTimePicker
            value={referenceDateTime}
            onChange={setReferenceDateTime}
            revision={revision}
          />

          <SystemTooltip
            content={
              dirty
                ? "Salvar todas as alterações do catálogo, famílias bloqueadas e destinos no banco de dados"
                : "Todas as configurações já estão salvas na revisão atual"
            }
          >
            <button
              type="button"
              disabled={busy || !dirty || conflicts.length > 0 || destinationConflicts.length > 0}
              onClick={() => void save()}
              className="px-3.5 py-1.5 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold flex items-center gap-1.5 shadow-soft transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{busy ? "Salvando..." : "Salvar Alterações"}</span>
            </button>
          </SystemTooltip>

          <SystemTooltip content={isExpanded ? "Recolher painel" : "Expandir painel"}>
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              className="p-1.5 rounded-xl border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition cursor-pointer"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </SystemTooltip>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* CORPO EXPANSÍVEL                                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {isExpanded && (
        <div className="p-5 space-y-5">
          {/* Barra de Sub-Abas Internas */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              <SystemTooltip content="Visualizar, filtrar, adicionar, editar ou remover equipamentos das linhas Semi-Industrial e Personnalité">
                <button
                  type="button"
                  onClick={() => setActiveTab("catalog")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 cursor-pointer border ${
                    activeTab === "catalog"
                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground border-border"
                  }`}
                >
                  <Package className="h-3.5 w-3.5" />
                  <span>Catálogo de Máquinas</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-black ${
                      activeTab === "catalog"
                        ? "bg-white/20 text-white"
                        : "bg-card text-foreground border border-border"
                    }`}
                  >
                    {catalogStats.total}
                  </span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Configurar para qual Setor do Chat e qual Funil/Etapa do CRM cada tipo de atendimento é enviado após a triagem">
                <button
                  type="button"
                  onClick={() => setActiveTab("destinations")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 cursor-pointer border ${
                    activeTab === "destinations"
                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground border-border"
                  }`}
                >
                  <Compass className="h-3.5 w-3.5" />
                  <span>Destinos do Atendimento (Roteamento CRM)</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-black ${
                      activeTab === "destinations"
                        ? "bg-white/20 text-white"
                        : "bg-card text-foreground border border-border"
                    }`}
                  >
                    {configuredDestinationsCount}/{DESTINATION_KEYS.length}
                  </span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Cadastrar famílias de máquinas que a Tecfag não comercializa para encaminhamento imediato ao especialista">
                <button
                  type="button"
                  onClick={() => setActiveTab("blocked")}
                  className={`px-3.5 py-2 rounded-xl text-xs font-extrabold transition flex items-center gap-2 cursor-pointer border ${
                    activeTab === "blocked"
                      ? "bg-primary text-primary-foreground border-primary shadow-soft"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground border-border"
                  }`}
                >
                  <Ban className="h-3.5 w-3.5" />
                  <span>Famílias Não Comercializadas</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-md text-[10px] font-black ${
                      activeTab === "blocked"
                        ? "bg-white/20 text-white"
                        : "bg-card text-foreground border border-border"
                    }`}
                  >
                    {settings.blockedFamilies.length}
                  </span>
                </button>
              </SystemTooltip>
            </div>

            {/* Ações Globais de Importação/Exportação */}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                disabled={busy}
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    if (file.size > 8_000_000) throw new Error("Arquivo excede o limite de 8 MB");
                    const raw = JSON.parse(await file.text());
                    const catalog = convertLegacyMachineCatalog(
                      Array.isArray(raw) ? raw : raw.catalog || raw.machines,
                    );
                    update({ ...settings, catalog });
                    setMessageType("info");
                    setMessage(
                      `${catalog.length} equipamentos importados para o rascunho. Clique em "Salvar Alterações" para persistir.`,
                    );
                    toast.success(`${catalog.length} equipamentos importados!`);
                  } catch (error) {
                    const errMsg = error instanceof Error ? error.message : "Catálogo JSON inválido";
                    setMessageType("error");
                    setMessage(errMsg);
                    toast.error(errMsg);
                  }
                  event.target.value = "";
                }}
              />

              <SystemTooltip content="Importar arquivo JSON de catálogo (substitui a lista em rascunho)">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-foreground flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Importar JSON</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Baixar cópia completa do catálogo e destinos em formato JSON">
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="px-2.5 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-foreground flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Exportar JSON</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content="Restaurar as 1.037 máquinas oficiais do catálogo padrão Tecfag (367 Semi-Industrial e 670 Personnalité)">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRestoreDefaultCatalog}
                  className="px-2.5 py-1.5 rounded-xl border border-border bg-card hover:bg-muted text-xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Restaurar Base (1.037)</span>
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Alerta de Mensagem / Status */}
          {message && (
            <div
              role="status"
              className={`rounded-2xl border p-3.5 text-xs font-semibold flex items-center justify-between gap-3 ${
                messageType === "error"
                  ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
                  : messageType === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-primary/30 bg-primary/10 text-primary"
              }`}
            >
              <span>{message}</span>
              <button
                type="button"
                onClick={() => setMessage("")}
                className="p-1 rounded-lg hover:bg-black/10 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Alerta de Conflito de SKU / Código */}
          {conflicts.length > 0 && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-3.5 text-xs space-y-2"
            >
              <div className="flex items-center gap-2 font-extrabold text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Atenção: Existem códigos/SKUs ativos duplicados que precisam ser ajustados antes de
                  salvar:
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {conflicts.map((conflict) => (
                  <SystemTooltip
                    key={`${conflict.field}-${conflict.code}`}
                    content="Clique para filtrar imediatamente os equipamentos com este código repetido"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("catalog");
                        setSearch(conflict.code);
                        setStatusFilter("CONFLICT");
                      }}
                      className="px-3 py-1.5 rounded-xl bg-card border border-amber-500/40 text-amber-600 dark:text-amber-400 font-extrabold hover:bg-amber-500/15 transition cursor-pointer"
                    >
                      {conflict.field.toUpperCase()} {conflict.code} ({conflict.machineIds.length}{" "}
                      máquinas) — Localizar
                    </button>
                  </SystemTooltip>
                ))}
              </div>
            </div>
          )}

          {!loaded ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              Carregando catálogo e destinos da triagem...
            </div>
          ) : (
            <>
              {/* ════════════════════════════════════════════════════════════════ */}
              {/* ABA 1: CATÁLOGO DE MÁQUINAS (1.037 EQUIPAMENTOS)                 */}
              {/* ════════════════════════════════════════════════════════════════ */}
              {activeTab === "catalog" && (
                <div className="space-y-4">
                  {/* 4 Cards KPI Clicáveis para Filtro Rápido */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <SystemTooltip content="Clique para exibir todas as máquinas do catálogo (Semi-Industrial + Personnalité)">
                      <button
                        type="button"
                        onClick={() => {
                          setLineFilter("ALL");
                          setStatusFilter("ALL");
                        }}
                        className={`p-3.5 rounded-2xl border text-left transition flex items-center justify-between cursor-pointer ${
                          lineFilter === "ALL" && statusFilter === "ALL"
                            ? "bg-primary/10 border-primary shadow-xs"
                            : "bg-card border-border hover:bg-muted/30"
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                            Total Exposto no Catálogo
                          </p>
                          <p className="text-xl font-black text-foreground mt-0.5">
                            {catalogStats.total}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            100% da base consultável pela IA
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-muted/60 text-foreground">
                          <Package className="h-4 w-4" />
                        </div>
                      </button>
                    </SystemTooltip>

                    <SystemTooltip content="Clique para filtrar apenas equipamentos da Linha Máquinas (Semi-Industrial)">
                      <button
                        type="button"
                        onClick={() =>
                          setLineFilter((prev) =>
                            prev === "SEMI-INDUSTRIAL" ? "ALL" : "SEMI-INDUSTRIAL",
                          )
                        }
                        className={`p-3.5 rounded-2xl border text-left transition flex items-center justify-between cursor-pointer ${
                          lineFilter === "SEMI-INDUSTRIAL"
                            ? "bg-sky-500/15 border-sky-500 shadow-xs"
                            : "bg-card border-sky-500/25 hover:bg-sky-500/5"
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                            Linha Máquinas (Semi-Industrial)
                          </p>
                          <p className="text-xl font-black text-sky-600 dark:text-sky-400 mt-0.5">
                            {catalogStats.semi}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Confirmadas direto p/ Funil Máquinas
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
                          <Wrench className="h-4 w-4" />
                        </div>
                      </button>
                    </SystemTooltip>

                    <SystemTooltip content="Clique para filtrar apenas equipamentos da Linha Personnalité (Projetos Industriais)">
                      <button
                        type="button"
                        onClick={() =>
                          setLineFilter((prev) =>
                            prev === "PERSONNALITE" ? "ALL" : "PERSONNALITE",
                          )
                        }
                        className={`p-3.5 rounded-2xl border text-left transition flex items-center justify-between cursor-pointer ${
                          lineFilter === "PERSONNALITE"
                            ? "bg-purple-500/15 border-purple-500 shadow-xs"
                            : "bg-card border-purple-500/25 hover:bg-purple-500/5"
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                            Linha Personnalité (Industrial)
                          </p>
                          <p className="text-xl font-black text-purple-600 dark:text-purple-400 mt-0.5">
                            {catalogStats.personnalite}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Projetos e alta capacidade c/ revisão
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                          <Gem className="h-4 w-4" />
                        </div>
                      </button>
                    </SystemTooltip>

                    <SystemTooltip content="Clique para alternar entre equipamentos Ativos e Inativos">
                      <button
                        type="button"
                        onClick={() =>
                          setStatusFilter((prev) =>
                            prev === "INACTIVE"
                              ? "ALL"
                              : prev === "ACTIVE"
                                ? "INACTIVE"
                                : "ACTIVE",
                          )
                        }
                        className={`p-3.5 rounded-2xl border text-left transition flex items-center justify-between cursor-pointer ${
                          statusFilter !== "ALL"
                            ? "bg-emerald-500/15 border-emerald-500 shadow-xs"
                            : "bg-card border-emerald-500/25 hover:bg-emerald-500/5"
                        }`}
                      >
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Status de Ativação
                          </p>
                          <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                            {catalogStats.active}{" "}
                            <span className="text-xs font-bold text-muted-foreground">
                              ativas / {catalogStats.inactive} inativas
                            </span>
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {statusFilter === "ALL"
                              ? "Exibindo ativos e inativos"
                              : statusFilter === "ACTIVE"
                                ? "Filtro: Apenas ativos"
                                : "Filtro: Apenas inativos"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                      </button>
                    </SystemTooltip>
                  </div>

                  {/* Barra de Pesquisa, Menus Suspensos Customizados e Caixas de Check */}
                  <div className="p-3.5 rounded-2xl bg-muted/20 border border-border space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
                      {/* Busca textual */}
                      <div className="md:col-span-4 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          aria-label="Buscar no catálogo"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Buscar por nome, código PAMQ, SKU ou modelo..."
                          className="w-full h-9 pl-9 pr-8 rounded-xl bg-card border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        {search && (
                          <SystemTooltip content="Limpar pesquisa">
                            <button
                              type="button"
                              onClick={() => setSearch("")}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                        )}
                      </div>

                      {/* Filtro Rápido de Linha (Menu Suspenso Customizado) */}
                      <div className="md:col-span-3">
                        <SystemTooltip content="Filtrar equipamentos por Linha Comercial (Semi-Industrial vs Personnalité)">
                          <div>
                            <SimpleSelect
                              value={lineFilter}
                              onValueChange={(val) =>
                                setLineFilter(
                                  (val as "ALL" | "SEMI-INDUSTRIAL" | "PERSONNALITE") || "ALL",
                                )
                              }
                              options={[
                                {
                                  value: "ALL",
                                  label: `Todas as Linhas (${catalogStats.total})`,
                                },
                                {
                                  value: "SEMI-INDUSTRIAL",
                                  label: `Máquinas • Semi-Industrial (${catalogStats.semi})`,
                                },
                                {
                                  value: "PERSONNALITE",
                                  label: `Personnalité • Industrial (${catalogStats.personnalite})`,
                                },
                              ]}
                            />
                          </div>
                        </SystemTooltip>
                      </div>

                      {/* Filtro por Categoria/Família (Menu Suspenso Customizado) */}
                      <div className="md:col-span-3">
                        <SystemTooltip content="Filtrar por família de máquina (Seladoras, Envasadoras, Flow Pack, Datadores, etc.)">
                          <div>
                            <SimpleSelect
                              value={categoryFilter}
                              onValueChange={(val) => setCategoryFilter(val || "ALL")}
                              options={categorySelectOptions}
                            />
                          </div>
                        </SystemTooltip>
                      </div>

                      {/* Botão + Nova Máquina */}
                      <div className="md:col-span-2 flex justify-end">
                        <SystemTooltip content="Cadastrar um novo equipamento no catálogo da triagem">
                          <button
                            type="button"
                            onClick={openCreateModal}
                            className="w-full h-9 px-3.5 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-soft transition cursor-pointer"
                          >
                            <Plus className="h-4 w-4" />
                            <span>Nova Máquina</span>
                          </button>
                        </SystemTooltip>
                      </div>
                    </div>

                    {/* Segunda linha da barra: Checkboxes Customizados + Quantidade Exibida */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-border/60">
                      <div className="flex items-center gap-4 flex-wrap">
                        <SystemTooltip content="Quando marcado, exibe a descrição técnica completa e os modelos alternativos abaixo do nome de todas as máquinas">
                          <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none">
                            <Checkbox
                              checked={expandAllDescriptions}
                              onCheckedChange={(checked) =>
                                setExpandAllDescriptions(Boolean(checked))
                              }
                            />
                            <span>Expandir descrições técnicas na lista</span>
                          </label>
                        </SystemTooltip>

                        <SystemTooltip content="Quando marcado, exibe apenas equipamentos que possuem capacidade/produtividade preenchida">
                          <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none">
                            <Checkbox
                              checked={onlyWithProduction}
                              onCheckedChange={(checked) => setOnlyWithProduction(Boolean(checked))}
                            />
                            <span>Apenas com capacidade/produtividade</span>
                          </label>
                        </SystemTooltip>

                        {(search ||
                          lineFilter !== "ALL" ||
                          categoryFilter !== "ALL" ||
                          statusFilter !== "ALL" ||
                          onlyWithProduction) && (
                          <SystemTooltip content="Limpar todos os filtros ativos e voltar a ver todas as máquinas">
                            <button
                              type="button"
                              onClick={() => {
                                setSearch("");
                                setLineFilter("ALL");
                                setCategoryFilter("ALL");
                                setStatusFilter("ALL");
                                setOnlyWithProduction(false);
                              }}
                              className="text-[11px] font-extrabold text-primary hover:underline cursor-pointer flex items-center gap-1"
                            >
                              <X className="h-3 w-3" />
                              Limpar filtros
                            </button>
                          </SystemTooltip>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground font-semibold">
                          Exibindo{" "}
                          <strong className="text-foreground">{visibleMachines.length}</strong> de{" "}
                          <strong className="text-foreground">{filteredCatalog.length}</strong>{" "}
                          máquinas
                        </span>

                        <div className="w-44">
                          <SystemTooltip content="Escolha quantos equipamentos exibir por página ou visualize a lista completa de uma só vez">
                            <div>
                              <SimpleSelect
                                value={pageSize}
                                onValueChange={(val) => setPageSize(val || "100")}
                                options={[
                                  { value: "50", label: "50 por página" },
                                  { value: "100", label: "100 por página" },
                                  { value: "250", label: "250 por página" },
                                  {
                                    value: "ALL",
                                    label: `Lista Total (${filteredCatalog.length})`,
                                  },
                                ]}
                              />
                            </div>
                          </SystemTooltip>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Barra de Ações em Lote quando há máquinas selecionadas */}
                  {selectedMachineIds.size > 0 && (
                    <div className="p-3 rounded-2xl bg-primary/10 border border-primary/30 flex flex-wrap items-center justify-between gap-2 animate-in fade-in-0">
                      <div className="flex items-center gap-2 text-xs font-extrabold text-primary">
                        <ListChecks className="h-4 w-4" />
                        <span>{selectedMachineIds.size} equipamento(s) selecionado(s)</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <SystemTooltip content="Ativar todos os equipamentos selecionados">
                          <button
                            type="button"
                            onClick={() => handleBulkAction("activate")}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-extrabold hover:bg-emerald-700 transition cursor-pointer"
                          >
                            Ativar Selecionados
                          </button>
                        </SystemTooltip>
                        <SystemTooltip content="Inativar todos os equipamentos selecionados">
                          <button
                            type="button"
                            onClick={() => handleBulkAction("deactivate")}
                            className="px-2.5 py-1 rounded-lg bg-card border border-border text-foreground text-[11px] font-bold hover:bg-muted transition cursor-pointer"
                          >
                            Inativar
                          </button>
                        </SystemTooltip>
                        <SystemTooltip content="Mover equipamentos selecionados para a linha Semi-Industrial">
                          <button
                            type="button"
                            onClick={() => handleBulkAction("set_semi")}
                            className="px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-400 text-[11px] font-extrabold hover:bg-sky-500/25 transition cursor-pointer"
                          >
                            Mudar p/ Semi-Industrial
                          </button>
                        </SystemTooltip>
                        <SystemTooltip content="Mover equipamentos selecionados para a linha Personnalité">
                          <button
                            type="button"
                            onClick={() => handleBulkAction("set_personnalite")}
                            className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-600 dark:text-purple-400 text-[11px] font-extrabold hover:bg-purple-500/25 transition cursor-pointer"
                          >
                            Mudar p/ Personnalité
                          </button>
                        </SystemTooltip>
                        <SystemTooltip content="Remover do catálogo todos os equipamentos selecionados">
                          <button
                            type="button"
                            onClick={() => handleBulkAction("delete")}
                            className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-extrabold hover:bg-red-700 transition cursor-pointer"
                          >
                            Remover ({selectedMachineIds.size})
                          </button>
                        </SystemTooltip>
                        <button
                          type="button"
                          onClick={() => setSelectedMachineIds(new Set())}
                          className="px-2 py-1 text-[11px] font-bold text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Limpar seleção
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Tabela Completa de Equipamentos */}
                  <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="max-h-[560px] overflow-y-auto scrollbar-thin">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 z-10 bg-muted/85 backdrop-blur-xs border-b border-border text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="py-2.5 px-3 w-9">
                              <SystemTooltip content="Selecionar/desmarcar todos os equipamentos visíveis nesta página">
                                <div className="flex items-center">
                                  <Checkbox
                                    checked={allVisibleSelected}
                                    onCheckedChange={(checked) =>
                                      toggleSelectAllVisible(Boolean(checked))
                                    }
                                  />
                                </div>
                              </SystemTooltip>
                            </th>
                            <th className="py-2.5 px-3 w-36">Linha</th>
                            <th className="py-2.5 px-3 w-44">Código NEXT / SKU</th>
                            <th className="py-2.5 px-3">Equipamento & Detalhes</th>
                            <th className="py-2.5 px-3 w-40">Capacidade</th>
                            <th className="py-2.5 px-3 w-28 text-center">Ativo na IA</th>
                            <th className="py-2.5 px-3 w-24 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border text-xs">
                          {visibleMachines.length === 0 ? (
                            <tr>
                              <td
                                colSpan={7}
                                className="py-10 text-center text-muted-foreground space-y-2"
                              >
                                <Package className="h-7 w-7 mx-auto opacity-30" />
                                <p className="font-bold text-foreground">
                                  Nenhum equipamento encontrado com os filtros atuais.
                                </p>
                                <p className="text-[11px]">
                                  Ajuste o termo de busca, troque a linha ou clique em &ldquo;Nova
                                  Máquina&rdquo; para cadastrar.
                                </p>
                              </td>
                            </tr>
                          ) : (
                            visibleMachines.map((entry) => {
                              const isSelected = selectedMachineIds.has(entry.id);
                              const isExpandedDesc =
                                expandAllDescriptions || expandedRowIds.has(entry.id);
                              const category = inferMachineCategory(entry);
                              const hasConflict = conflictMachineIds.has(entry.id);

                              return (
                                <tr
                                  key={entry.id}
                                  className={`transition-colors ${
                                    isSelected
                                      ? "bg-primary/5"
                                      : !entry.active
                                        ? "bg-muted/20 opacity-65"
                                        : hasConflict
                                          ? "bg-amber-500/5"
                                          : "hover:bg-muted/25"
                                  }`}
                                >
                                  {/* Checkbox de Seleção */}
                                  <td className="py-2.5 px-3 align-top">
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={(checked) => {
                                        setSelectedMachineIds((prev) => {
                                          const next = new Set(prev);
                                          if (checked) next.add(entry.id);
                                          else next.delete(entry.id);
                                          return next;
                                        });
                                      }}
                                    />
                                  </td>

                                  {/* Badge de Linha Clicável */}
                                  <td className="py-2.5 px-3 align-top">
                                    <SystemTooltip content="Clique para alternar rapidamente entre Semi-Industrial (Máquinas) e Personnalité">
                                      <button
                                        type="button"
                                        onClick={() => handleToggleMachineLine(entry.id)}
                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-extrabold border inline-flex items-center gap-1.5 transition cursor-pointer ${
                                          entry.line === "PERSONNALITE"
                                            ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/20"
                                            : "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30 hover:bg-sky-500/20"
                                        }`}
                                      >
                                        {entry.line === "PERSONNALITE" ? (
                                          <>
                                            <Gem className="h-3 w-3 shrink-0" />
                                            <span>Personnalité</span>
                                          </>
                                        ) : (
                                          <>
                                            <Wrench className="h-3 w-3 shrink-0" />
                                            <span>Semi-Industrial</span>
                                          </>
                                        )}
                                      </button>
                                    </SystemTooltip>
                                  </td>

                                  {/* Código NEXT e SKU VTEX */}
                                  <td className="py-2.5 px-3 align-top">
                                    <div className="flex flex-col gap-1">
                                      {entry.code ? (
                                        <SystemTooltip content="Código NEXT do equipamento (clique para copiar)">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleCopyCode(entry.code, `code-${entry.id}`)
                                            }
                                            className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-foreground hover:text-primary cursor-pointer w-fit"
                                          >
                                            <span>{entry.code}</span>
                                            {copiedBadge === `code-${entry.id}` ? (
                                              <Check className="h-3 w-3 text-emerald-500" />
                                            ) : (
                                              <Copy className="h-2.5 w-2.5 opacity-50" />
                                            )}
                                          </button>
                                        </SystemTooltip>
                                      ) : (
                                        <span className="text-[10px] text-muted-foreground">
                                          Sem cód. NEXT
                                        </span>
                                      )}

                                      {entry.sku && (
                                        <SystemTooltip content="SKU VTEX / Identificador secundário (clique para copiar)">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleCopyCode(entry.sku, `sku-${entry.id}`)
                                            }
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground hover:text-foreground cursor-pointer w-fit"
                                          >
                                            <span>SKU: {entry.sku}</span>
                                            {copiedBadge === `sku-${entry.id}` && (
                                              <Check className="h-2.5 w-2.5 text-emerald-500" />
                                            )}
                                          </button>
                                        </SystemTooltip>
                                      )}
                                    </div>
                                  </td>

                                  {/* Nome, Categoria, Aliases e Descrição */}
                                  <td className="py-2.5 px-3 align-top">
                                    <div className="space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-foreground">
                                          {entry.name}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded bg-muted/60 text-[10px] font-semibold text-muted-foreground">
                                          {category}
                                        </span>
                                        {hasConflict && (
                                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-extrabold">
                                            Código repetido
                                          </span>
                                        )}
                                      </div>

                                      {entry.aliases && entry.aliases.length > 0 && (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          <span className="text-[10px] text-muted-foreground">
                                            Sinônimos/Modelos:
                                          </span>
                                          {entry.aliases.map((al, i) => (
                                            <span
                                              key={i}
                                              className="px-1.5 py-0.2 rounded bg-primary/10 text-primary text-[10px] font-semibold"
                                            >
                                              {al}
                                            </span>
                                          ))}
                                        </div>
                                      )}

                                      {entry.description && (
                                        <div>
                                          {!expandAllDescriptions && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setExpandedRowIds((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(entry.id)) next.delete(entry.id);
                                                  else next.add(entry.id);
                                                  return next;
                                                });
                                              }}
                                              className="text-[10px] font-bold text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
                                            >
                                              {isExpandedDesc ? (
                                                <>
                                                  <EyeOff className="h-3 w-3" />
                                                  <span>Ocultar ficha técnica</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Eye className="h-3 w-3" />
                                                  <span>Ver ficha técnica</span>
                                                </>
                                              )}
                                            </button>
                                          )}
                                          {isExpandedDesc && (
                                            <p className="mt-1 p-2 rounded-xl bg-muted/40 border border-border text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                              {entry.description}
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </td>

                                  {/* Capacidade / Produtividade */}
                                  <td className="py-2.5 px-3 align-top">
                                    {entry.production ? (
                                      <span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[11px] font-bold inline-block">
                                        {entry.production}
                                      </span>
                                    ) : (
                                      <span className="text-[11px] text-muted-foreground">—</span>
                                    )}
                                  </td>

                                  {/* Status Ativo / Inativo com Checkbox Customizado */}
                                  <td className="py-2.5 px-3 align-top text-center">
                                    <SystemTooltip
                                      content={
                                        entry.active
                                          ? "Equipamento ATIVO (clique para inativar na triagem)"
                                          : "Equipamento INATIVO (clique para ativar na triagem)"
                                      }
                                    >
                                      <label className="inline-flex items-center justify-center gap-1.5 cursor-pointer select-none">
                                        <Checkbox
                                          checked={entry.active}
                                          onCheckedChange={() =>
                                            handleToggleMachineActive(entry.id)
                                          }
                                        />
                                        <span
                                          className={`text-[10px] font-extrabold ${
                                            entry.active
                                              ? "text-emerald-600 dark:text-emerald-400"
                                              : "text-muted-foreground"
                                          }`}
                                        >
                                          {entry.active ? "Ativo" : "Inativo"}
                                        </span>
                                      </label>
                                    </SystemTooltip>
                                  </td>

                                  {/* Ações (Editar / Remover) */}
                                  <td className="py-2.5 px-3 align-top text-right">
                                    <div className="inline-flex items-center gap-1">
                                      <SystemTooltip content="Editar nome, linha, códigos, produtividade ou descrição desta máquina">
                                        <button
                                          type="button"
                                          onClick={() => openEditModal(entry)}
                                          className="p-1.5 rounded-lg border border-border hover:bg-primary/10 hover:border-primary/30 text-muted-foreground hover:text-primary transition cursor-pointer"
                                        >
                                          <Edit3 className="h-3.5 w-3.5" />
                                        </button>
                                      </SystemTooltip>

                                      <SystemTooltip content="Remover este equipamento do catálogo">
                                        <button
                                          type="button"
                                          onClick={() => setMachineToDelete(entry)}
                                          className="p-1.5 rounded-lg border border-border hover:bg-red-500/10 hover:border-red-500/30 text-muted-foreground hover:text-red-500 transition cursor-pointer"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </SystemTooltip>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Rodapé de Paginação da Tabela */}
                    {pageSize !== "ALL" && totalPages > 1 && (
                      <div className="px-4 py-3 border-t border-border bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <span className="text-muted-foreground">
                          Página <strong className="text-foreground">{safeCurrentPage}</strong> de{" "}
                          <strong className="text-foreground">{totalPages}</strong> (
                          {filteredCatalog.length} máquinas filtradas)
                        </span>

                        <div className="flex items-center gap-1.5">
                          <SystemTooltip content="Primeira página">
                            <button
                              type="button"
                              disabled={safeCurrentPage <= 1}
                              onClick={() => setCurrentPage(1)}
                              className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 font-bold cursor-pointer"
                            >
                              « Primeira
                            </button>
                          </SystemTooltip>
                          <SystemTooltip content="Página anterior">
                            <button
                              type="button"
                              disabled={safeCurrentPage <= 1}
                              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                              className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 font-bold cursor-pointer"
                            >
                              ‹ Anterior
                            </button>
                          </SystemTooltip>
                          <SystemTooltip content="Próxima página">
                            <button
                              type="button"
                              disabled={safeCurrentPage >= totalPages}
                              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                              className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 font-bold cursor-pointer"
                            >
                              Próxima ›
                            </button>
                          </SystemTooltip>
                          <SystemTooltip content="Última página">
                            <button
                              type="button"
                              disabled={safeCurrentPage >= totalPages}
                              onClick={() => setCurrentPage(totalPages)}
                              className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted disabled:opacity-40 font-bold cursor-pointer"
                            >
                              Última »
                            </button>
                          </SystemTooltip>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════ */}
              {/* ABA 2: DESTINOS DO ATENDIMENTO (ROTEAMENTO AUTOMÁTICO CRM)       */}
              {/* ════════════════════════════════════════════════════════════════ */}
              {activeTab === "destinations" && (
                <div className="space-y-4">
                  {/* Card Explicativo Didático: Por que Destinos do Atendimento existe? */}
                  <div className="p-4 rounded-2xl border border-primary/25 bg-primary/5 space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <HelpCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                        <div>
                          <h3 className="text-xs font-extrabold text-foreground">
                            Por que existe &ldquo;Destinos do Atendimento&rdquo; e qual a diferença
                            para a Escala de Operadores abaixo?
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                            Na versão antiga do Fagner, os nomes dos funis e setores ficavam fixos
                            no código-fonte. Agora, enquanto a seção{" "}
                            <strong className="text-foreground">Operadores na Escala Local</strong>{" "}
                            define <strong>QUEM</strong> recebe os atendimentos no rodízio, esta
                            seção define <strong>ONDE</strong> o sistema deve alocar a conversa no
                            Chat e <strong>EM QUAL FUNIL + ETAPA DO CRM</strong> o card de negócio
                            será criado automaticamente ao finalizar a triagem:
                          </p>
                        </div>
                      </div>

                      <SystemTooltip content="Preenche automaticamente todos os 7 destinos vinculando cada área ao Setor, Funil CRM e Etapa de Entrada correspondentes">
                        <button
                          type="button"
                          onClick={() => {
                            const matched = autoMatchIndustrialDestinations(
                              choices,
                              settings,
                              true,
                            );
                            update(matched);
                            toast.success(
                              "Vínculos de Setor, Funil e Etapa preenchidos automaticamente!",
                            );
                          }}
                          className="px-3.5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold flex items-center gap-1.5 shadow-soft transition cursor-pointer shrink-0"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Preencher Vínculos Automaticamente</span>
                        </button>
                      </SystemTooltip>
                    </div>

                    {/* Fluxo Visual em 3 Passos */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
                      <div className="p-2.5 rounded-xl bg-card border border-border flex items-center gap-2.5">
                        <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                          1
                        </div>
                        <div className="text-[11px]">
                          <p className="font-extrabold text-foreground">Triagem & Decisor IA</p>
                          <p className="text-muted-foreground text-[10px]">
                            Fagner coleta dados e classifica a demanda em uma das 7 categorias.
                          </p>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-card border border-border flex items-center gap-2.5">
                        <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                          2
                        </div>
                        <div className="text-[11px]">
                          <p className="font-extrabold text-foreground">
                            Setor do Chat + Operador
                          </p>
                          <p className="text-muted-foreground text-[10px]">
                            Transfere o chat para a <strong>Equipe/Setor</strong> e sorteia o
                            vendedor da escala.
                          </p>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-card border border-border flex items-center gap-2.5">
                        <div className="h-6 w-6 rounded-lg bg-primary/10 text-primary font-black text-xs flex items-center justify-center shrink-0">
                          3
                        </div>
                        <div className="text-[11px]">
                          <p className="font-extrabold text-foreground">
                            Criação do Card no CRM
                          </p>
                          <p className="text-muted-foreground text-[10px]">
                            Abre o negócio automaticamente no <strong>Funil CRM</strong> e{" "}
                            <strong>Etapa de Entrada</strong>.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Grade de Cards dos 7 Destinos */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
                    {DESTINATION_KEYS.map((key) => {
                      const policy = INDUSTRIAL_DESTINATIONS[key];
                      const meta = DESTINATION_DETAILS[key];
                      const resolved = resolveIndustrialDestination(settings, key);
                      const destination =
                        resolved.destination ||
                        (resolved.configured ? { sectorId: "" } : undefined);
                      const DestIcon = getDestinationIcon(key);

                      const isFullyConfigured =
                        Boolean(destination?.sectorId) &&
                        (!policy.createsDeal ||
                          (Boolean(destination?.pipelineId) && Boolean(destination?.stageId))) &&
                        !resolved.conflict;

                      const patch = (value: Partial<NonNullable<typeof destination>>) =>
                        update(
                          setIndustrialDestination(settings, key, {
                            ...destination,
                            sectorId: destination?.sectorId || "",
                            ...value,
                          }),
                        );

                      const sectorOptions = [
                        { value: "", label: "Selecione a equipe / setor..." },
                        ...(destination?.sectorId &&
                        !choices.sectors.some((s) => s.id === destination.sectorId)
                          ? [
                              {
                                value: destination.sectorId,
                                label: "⚠️ Setor removido — selecione outro",
                              },
                            ]
                          : []),
                        ...choices.sectors.map((s) => ({ value: s.id, label: s.name })),
                      ];

                      const pipelineOptions = [
                        { value: "", label: "Selecione o funil do CRM..." },
                        ...(destination?.pipelineId &&
                        !choices.pipelines.some((p) => p.id === destination.pipelineId)
                          ? [
                              {
                                value: destination.pipelineId,
                                label: "⚠️ Funil removido — selecione outro",
                              },
                            ]
                          : []),
                        ...choices.pipelines.map((p) => ({ value: p.id, label: p.name })),
                      ];

                      const stageOptions = [
                        { value: "", label: "Selecione a etapa de entrada..." },
                        ...(destination?.stageId &&
                        !choices.stages.some(
                          (st) =>
                            st.id === destination.stageId &&
                            st.pipelineId === destination.pipelineId,
                        )
                          ? [
                              {
                                value: destination.stageId,
                                label: "⚠️ Etapa indisponível — selecione outra",
                              },
                            ]
                          : []),
                        ...choices.stages
                          .filter((st) => st.pipelineId === destination?.pipelineId)
                          .map((st) => ({ value: st.id, label: st.name })),
                      ];

                      return (
                        <div
                          key={key}
                          className={`rounded-2xl border p-4 space-y-3 transition-all ${
                            resolved.conflict
                              ? "border-amber-500/40 bg-amber-500/5"
                              : isFullyConfigured
                                ? "border-border bg-card shadow-2xs"
                                : "border-dashed border-border bg-muted/15"
                          }`}
                        >
                          {/* Cabeçalho do Card de Destino */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5">
                              <SystemTooltip
                                content={
                                  destination
                                    ? `Desmarcar para desativar o encaminhamento automático de ${policy.label}`
                                    : `Marcar para habilitar e configurar o destino de ${policy.label}`
                                }
                              >
                                <div className="pt-0.5">
                                  <Checkbox
                                    checked={Boolean(destination)}
                                    disabled={busy}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        // Tenta pré-preencher automaticamente ao habilitar
                                        const singleAuto = autoMatchIndustrialDestinations(
                                          choices,
                                          setIndustrialDestination(settings, key, { sectorId: "" }),
                                          true,
                                        );
                                        const autoDest = resolveIndustrialDestination(
                                          singleAuto,
                                          key,
                                        ).destination;
                                        update(
                                          setIndustrialDestination(
                                            settings,
                                            key,
                                            autoDest || { sectorId: "" },
                                          ),
                                        );
                                      } else {
                                        update(setIndustrialDestination(settings, key, undefined));
                                      }
                                    }}
                                  />
                                </div>
                              </SystemTooltip>

                              <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
                                <DestIcon className="h-4 w-4" />
                              </div>

                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-extrabold text-foreground">
                                    {meta.title}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                                    {meta.flowBadge}
                                  </span>
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {meta.subtitle}
                                </p>
                              </div>
                            </div>

                            {/* Badge de Status do Destino */}
                            <SystemTooltip content={meta.whenTriggered}>
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[10px] font-extrabold border shrink-0 cursor-help ${
                                  resolved.conflict
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                                    : isFullyConfigured
                                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                                      : destination
                                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
                                        : "bg-muted text-muted-foreground border-border"
                                }`}
                              >
                                {resolved.conflict
                                  ? "Conflito"
                                  : isFullyConfigured
                                    ? "Vinculado"
                                    : destination
                                      ? "Incompleto"
                                      : "Desativado"}
                              </span>
                            </SystemTooltip>
                          </div>

                          {/* Explicação de Gatilho */}
                          <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-xl px-3 py-2 border border-border/60">
                            <strong className="text-foreground">Quando é acionado:</strong>{" "}
                            {meta.whenTriggered}
                          </p>

                          {resolved.conflict && (
                            <p
                              role="alert"
                              className="text-xs text-amber-600 dark:text-amber-400 font-semibold"
                            >
                              Os vínculos antigos divergiam. Selecione a equipe, o funil e a etapa
                              abaixo para unificar este destino.
                            </p>
                          )}

                          {/* Seletores Customizados (Menus Suspensos) */}
                          {destination && (
                            <div
                              className={`grid gap-2.5 pt-1 ${
                                policy.createsDeal ? "md:grid-cols-3" : "md:grid-cols-1"
                              }`}
                            >
                              <div className="space-y-1">
                                <SystemTooltip content="Setor do Chat para onde a conversa será transferida e de onde o operador será sorteado">
                                  <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1 cursor-help">
                                    <Building2 className="h-3 w-3 text-primary" />
                                    <span>1. Equipe / Setor do Chat</span>
                                  </label>
                                </SystemTooltip>
                                <SimpleSelect
                                  value={destination.sectorId}
                                  disabled={busy}
                                  onValueChange={(val) => patch({ sectorId: val })}
                                  options={sectorOptions}
                                  placeholder="Selecione o setor..."
                                />
                              </div>

                              {policy.createsDeal && (
                                <>
                                  <div className="space-y-1">
                                    <SystemTooltip content="Funil do CRM onde o card da oportunidade será aberto automaticamente no handoff">
                                      <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1 cursor-help">
                                        <GitBranch className="h-3 w-3 text-primary" />
                                        <span>2. Funil CRM</span>
                                      </label>
                                    </SystemTooltip>
                                    <SimpleSelect
                                      value={destination.pipelineId || ""}
                                      disabled={busy}
                                      onValueChange={(val) => {
                                        const firstStage = choices.stages.find(
                                          (st) => st.pipelineId === val,
                                        );
                                        patch({
                                          pipelineId: val || undefined,
                                          stageId: firstStage?.id || undefined,
                                        });
                                      }}
                                      options={pipelineOptions}
                                      placeholder="Selecione o funil..."
                                    />
                                  </div>

                                  <div className="space-y-1">
                                    <SystemTooltip content="Coluna/etapa inicial onde o novo card será posicionado ao entrar no Funil CRM">
                                      <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-1 cursor-help">
                                        <ArrowRight className="h-3 w-3 text-primary" />
                                        <span>3. Etapa de Entrada</span>
                                      </label>
                                    </SystemTooltip>
                                    <SimpleSelect
                                      value={destination.stageId || ""}
                                      disabled={busy || !destination.pipelineId}
                                      onValueChange={(val) => patch({ stageId: val || undefined })}
                                      options={stageOptions}
                                      placeholder="Selecione a etapa..."
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════ */}
              {/* ABA 3: FAMÍLIAS NÃO COMERCIALIZADAS                              */}
              {/* ════════════════════════════════════════════════════════════════ */}
              {activeTab === "blocked" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl border border-amber-500/25 bg-amber-500/5 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-amber-600 dark:text-amber-400">
                      <Ban className="h-4 w-4 shrink-0" />
                      <span>Camada 0 do Decisor — Famílias que a Tecfag Não Comercializa</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Quando o cliente solicita explicitamente um equipamento listado aqui (ex:
                      fornos industriais, abatedouros, etc.), o Fagner interrompe o questionário
                      longo de produtividade e encaminha imediatamente para{" "}
                      <strong className="text-foreground">Revisão do Especialista</strong> sem custo
                      adicional de IA.
                    </p>
                  </div>

                  {/* Formulário para Adicionar Família Bloqueada */}
                  <div className="p-4 rounded-2xl border border-border bg-muted/20 space-y-3">
                    <h4 className="text-xs font-extrabold text-foreground flex items-center gap-1.5">
                      <Plus className="h-3.5 w-3.5 text-primary" />
                      <span>Adicionar Família Não Comercializada</span>
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <SystemTooltip content="Nome descritivo da família de máquinas que a Tecfag não trabalha">
                          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground cursor-help">
                            Nome da Família *
                          </label>
                        </SystemTooltip>
                        <input
                          type="text"
                          aria-label="Nome da família"
                          value={blockedName}
                          onChange={(e) => setBlockedName(e.target.value)}
                          placeholder="Ex: Fornos e Panificação"
                          className="w-full h-9 px-3 rounded-xl bg-card border border-border text-xs text-foreground"
                        />
                      </div>

                      <div className="space-y-1">
                        <SystemTooltip content="Palavras-chave exatas separadas por vírgula que identificam esta família na fala do cliente">
                          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground cursor-help">
                            Termos Gatilho (separados por vírgula) *
                          </label>
                        </SystemTooltip>
                        <input
                          type="text"
                          aria-label="Termos da família"
                          value={blockedTerms}
                          onChange={(e) => setBlockedTerms(e.target.value)}
                          placeholder="Ex: forno, masseira, cilindro de pão"
                          className="w-full h-9 px-3 rounded-xl bg-card border border-border text-xs text-foreground"
                        />
                      </div>

                      <div className="space-y-1">
                        <SystemTooltip content="Observação ou justificativa interna para auditoria da triagem">
                          <label className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground cursor-help">
                            Motivo Interno
                          </label>
                        </SystemTooltip>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={blockedReason}
                            onChange={(e) => setBlockedReason(e.target.value)}
                            placeholder="Motivo interno"
                            className="flex-1 h-9 px-3 rounded-xl bg-card border border-border text-xs text-foreground"
                          />
                          <SystemTooltip content="Adicionar esta família à lista de bloqueio">
                            <button
                              type="button"
                              disabled={
                                busy ||
                                blockedName.trim().length < 3 ||
                                blockedTerms
                                  .split(",")
                                  .map((t) => t.trim())
                                  .filter((t) => t.length >= 3).length === 0
                              }
                              onClick={() => {
                                const terms = blockedTerms
                                  .split(",")
                                  .map((term) => term.trim())
                                  .filter((term) => term.length >= 3);
                                update({
                                  ...settings,
                                  blockedFamilies: [
                                    ...settings.blockedFamilies,
                                    {
                                      id: draftId(),
                                      name: blockedName.trim(),
                                      terms,
                                      reason: blockedReason.trim() || "Cadastro administrativo",
                                    },
                                  ],
                                });
                                setBlockedName("");
                                setBlockedTerms("");
                                toast.success("Família bloqueada adicionada ao rascunho!");
                              }}
                              className="h-9 px-3.5 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-45"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>Adicionar</span>
                            </button>
                          </SystemTooltip>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Lista de Famílias Bloqueadas */}
                  {settings.blockedFamilies.length === 0 ? (
                    <div className="p-8 rounded-2xl border border-dashed border-border text-center text-xs text-muted-foreground">
                      Nenhuma família bloqueada cadastrada no momento.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {settings.blockedFamilies.map((family) => (
                        <div
                          key={family.id}
                          className="p-3.5 rounded-2xl border border-border bg-card flex items-start justify-between gap-3"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-extrabold text-foreground">
                                {family.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                • {family.reason}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {family.terms.map((t, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-[10px] font-bold"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>

                          <SystemTooltip content="Remover esta família da lista de bloqueio">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                update({
                                  ...settings,
                                  blockedFamilies: settings.blockedFamilies.filter(
                                    (entry) => entry.id !== family.id,
                                  ),
                                });
                                toast.info(`Família "${family.name}" removida do rascunho.`);
                              }}
                              className="p-1.5 rounded-lg border border-border hover:bg-red-500/10 hover:border-red-500/30 text-muted-foreground hover:text-red-500 transition cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Barra Inferior de Salvamento quando houver alterações pendentes */}
          {dirty && (
            <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Você possui alterações em rascunho no catálogo ou nos destinos. Salve para aplicar
                  na operação do Fagner.
                </span>
              </div>
              <button
                type="button"
                disabled={
                  busy || !dirty || conflicts.length > 0 || destinationConflicts.length > 0
                }
                onClick={() => void save()}
                className="px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold flex items-center gap-1.5 shadow-soft transition cursor-pointer disabled:opacity-50 shrink-0"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{busy ? "Salvando…" : "Salvar catálogo e destinos"}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL DE ADICIONAR / EDITAR EQUIPAMENTO NO CATÁLOGO                    */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {isMachineModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-card border border-border rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto scrollbar-thin shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
                  {editingMachineMode === "create" ? (
                    <Plus className="h-5 w-5" />
                  ) : (
                    <Edit3 className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-foreground">
                    {editingMachineMode === "create"
                      ? "Cadastrar Nova Máquina no Catálogo"
                      : "Editar Equipamento do Catálogo"}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Configure os identificadores, linha comercial e capacidade técnica para o
                    Decisor IA.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMachineModalOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {/* Nome da Máquina */}
              <div className="md:col-span-2 space-y-1">
                <SystemTooltip content="Nome oficial da máquina como deve ser reconhecido pela IA e exibido no briefing">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>Nome do Equipamento *</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>
                <input
                  type="text"
                  value={machineDraft.name}
                  onChange={(e) => setMachineDraft({ ...machineDraft, name: e.target.value })}
                  placeholder="Ex: Seladora Contínua Horizontal FR900 Inox"
                  className="w-full h-9 px-3 rounded-xl bg-background border border-border text-xs text-foreground"
                />
              </div>

              {/* Linha Comercial (Menu Suspenso Customizado) */}
              <div className="space-y-1">
                <SystemTooltip content="Semi-Industrial vai direto para o Funil Máquinas quando confirmado; Personnalité passa por revisão humana especializada">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>Linha Comercial *</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>
                <SimpleSelect
                  value={machineDraft.line}
                  onValueChange={(val) =>
                    setMachineDraft({
                      ...machineDraft,
                      line: (val as IndustrialMachine["line"]) || "SEMI-INDUSTRIAL",
                    })
                  }
                  options={[
                    { value: "SEMI-INDUSTRIAL", label: "Máquinas • Semi-Industrial" },
                    { value: "PERSONNALITE", label: "Personnalité • Projetos Industriais" },
                  ]}
                />
              </div>

              {/* Capacidade / Produtividade */}
              <div className="space-y-1">
                <SystemTooltip content="Capacidade máxima (ex: 500 un/h, 30 emb/min). Se o cliente pedir produção acima deste limite, a IA envia para revisão técnica">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>Capacidade / Produtividade</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>
                <input
                  type="text"
                  value={machineDraft.production}
                  onChange={(e) =>
                    setMachineDraft({ ...machineDraft, production: e.target.value })
                  }
                  placeholder="Ex: 30-50 emb/min ou 1200 un/h"
                  className="w-full h-9 px-3 rounded-xl bg-background border border-border text-xs text-foreground"
                />
              </div>

              {/* Código NEXT */}
              <div className="space-y-1">
                <SystemTooltip content="Código interno NEXT (ex: PAMQSLAU001). Deve ser único entre máquinas ativas">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>Código NEXT</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>
                <input
                  type="text"
                  value={machineDraft.code}
                  onChange={(e) => setMachineDraft({ ...machineDraft, code: e.target.value })}
                  placeholder="Ex: PAMQSLAU001"
                  className="w-full h-9 px-3 rounded-xl bg-background border border-border text-xs font-mono text-foreground"
                />
              </div>

              {/* SKU VTEX */}
              <div className="space-y-1">
                <SystemTooltip content="SKU do e-commerce VTEX (opcional). Quando preenchido, deve ser único entre máquinas ativas">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>SKU VTEX</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>
                <input
                  type="text"
                  value={machineDraft.sku}
                  onChange={(e) => setMachineDraft({ ...machineDraft, sku: e.target.value })}
                  placeholder="Ex: 965"
                  className="w-full h-9 px-3 rounded-xl bg-background border border-border text-xs font-mono text-foreground"
                />
              </div>

              {/* Modelos / Nomes Alternativos (Aliases em Chips) */}
              <div className="md:col-span-2 space-y-1.5">
                <SystemTooltip content="Siglas ou variações de modelo pelas quais os clientes costumam pedir esta máquina (ex: FR 900, FR-900)">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>Modelos / Nomes Alternativos (Sinônimos)</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const term = aliasInput.trim().replace(/,$/, "");
                        if (term.length >= 3 && !machineDraft.aliases.includes(term)) {
                          setMachineDraft({
                            ...machineDraft,
                            aliases: [...machineDraft.aliases, term],
                          });
                          setAliasInput("");
                        }
                      }
                    }}
                    placeholder="Digite um modelo alternativo (mín. 3 letras) e pressione Enter..."
                    className="flex-1 h-9 px-3 rounded-xl bg-background border border-border text-xs text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const terms = aliasInput
                        .split(",")
                        .map((t) => t.trim())
                        .filter((t) => t.length >= 3 && !machineDraft.aliases.includes(t));
                      if (terms.length > 0) {
                        setMachineDraft({
                          ...machineDraft,
                          aliases: [...machineDraft.aliases, ...terms],
                        });
                        setAliasInput("");
                      }
                    }}
                    className="px-3 h-9 rounded-xl border border-border hover:bg-muted text-xs font-bold cursor-pointer"
                  >
                    Adicionar
                  </button>
                </div>

                {machineDraft.aliases.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {machineDraft.aliases.map((alias, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        <span>{alias}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setMachineDraft({
                              ...machineDraft,
                              aliases: machineDraft.aliases.filter((_, i) => i !== idx),
                            })
                          }
                          className="hover:text-red-500 cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Descrição Técnica */}
              <div className="md:col-span-2 space-y-1">
                <SystemTooltip content="Resumo técnico sobre o funcionamento e aplicações recomendadas desta máquina">
                  <label className="text-[11px] font-extrabold text-foreground flex items-center gap-1 cursor-help">
                    <span>Descrição Técnica / Aplicação</span>
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </label>
                </SystemTooltip>
                <textarea
                  rows={3}
                  value={machineDraft.description}
                  onChange={(e) =>
                    setMachineDraft({ ...machineDraft, description: e.target.value })
                  }
                  placeholder="Descreva aplicações, tipo de embalagem, faixa de peso/volume e diferenciais..."
                  className="w-full p-3 rounded-xl bg-background border border-border text-xs text-foreground"
                />
              </div>

              {/* Checkbox Equipamento Ativo */}
              <div className="md:col-span-2 pt-1">
                <label className="inline-flex items-center gap-2.5 text-xs font-extrabold text-foreground cursor-pointer select-none">
                  <Checkbox
                    checked={machineDraft.active}
                    onCheckedChange={(checked) =>
                      setMachineDraft({ ...machineDraft, active: Boolean(checked) })
                    }
                  />
                  <span>Equipamento ativo e disponível para classificação pelo Fagner IA</span>
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line">
              <button
                type="button"
                onClick={() => setIsMachineModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveMachineModal}
                className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-extrabold shadow-soft transition cursor-pointer flex items-center gap-1.5"
              >
                <Check className="h-4 w-4" />
                <span>
                  {editingMachineMode === "create"
                    ? "Adicionar ao Catálogo"
                    : "Atualizar Equipamento"}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL DE CONFIRMAÇÃO DE REMOÇÃO DE EQUIPAMENTO                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {machineToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-card border border-border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <div className="p-2.5 rounded-2xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-foreground">
                  Remover Equipamento do Catálogo
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  {machineToDelete.code || machineToDelete.sku || "Sem código"} •{" "}
                  {machineToDelete.line}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Deseja remover <strong className="text-foreground">{machineToDelete.name}</strong> do
              catálogo de triagem? Você também pode apenas desmarcar a caixa{" "}
              <strong className="text-foreground">Ativo</strong> se quiser preservá-lo inativo.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setMachineToDelete(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDeleteMachine(machineToDelete)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold shadow-soft transition cursor-pointer"
              >
                Confirmar Remoção
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
