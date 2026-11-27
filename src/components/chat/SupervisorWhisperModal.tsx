import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Briefcase,
  Check,
  ChevronDown,
  EyeOff,
  Loader2,
  Megaphone,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { resolveWhisperOpenTransition } from "@/lib/valentina/whisper-modal-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SystemTooltip } from "@/components/ui/tooltip";

type TargetMode = "single" | "multiple" | "sector";
type WhisperPriority = "normal" | "alta" | "urgente";
type WhisperTone = "consultivo" | "direto" | "urgente";

export interface SupervisorWhisperDealRef {
  id: string;
  title: string;
  stageName?: string | null;
  operatorId?: string | null;
}

export interface SupervisorWhisperModalProps {
  open: boolean;
  onClose: () => void;
  source: "ui_monitor" | "ui_crm";
  defaultOperatorId?: string | null;
  defaultDeal?: SupervisorWhisperDealRef | null;
  defaultConversationId?: string | null;
  onSent?: (result: any) => void;
}

const QUICK_SUGGESTIONS = [
  "Consegue dar um retorno para esse cliente ainda hoje?",
  "Atualize o card do CRM com o próximo passo e previsão de fechamento.",
  "Qual o status atual da proposta? Precisamos retomar o contato.",
];

export function SupervisorWhisperModal({
  open,
  onClose,
  source,
  defaultOperatorId = null,
  defaultDeal = null,
  defaultConversationId = null,
  onSent,
}: SupervisorWhisperModalProps) {
  const { tenant, operators, sectors } = useChat();
  const persona = getAiPersona(tenant || "valem");

  const humanOperators = useMemo(
    () =>
      (operators || [])
        .filter((op) => !op.id.startsWith("bot-") && !op.name.toLowerCase().includes("robô"))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [operators],
  );

  const [targetMode, setTargetMode] = useState<TargetMode>("single");
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>(
    defaultOperatorId || defaultDeal?.operatorId || "",
  );
  const [selectedOperatorIds, setSelectedOperatorIds] = useState<string[]>([]);
  const [selectedSectorId, setSelectedSectorId] = useState<string>("");

  const [selectedDeal, setSelectedDeal] = useState<SupervisorWhisperDealRef | null>(defaultDeal);
  const [conversationId, setConversationId] = useState<string>(defaultConversationId || "");

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<WhisperPriority>("normal");
  const [asAiOnly, setAsAiOnly] = useState(false);
  const [rewriteWithAi, setRewriteWithAi] = useState(false);
  const [tone, setTone] = useState<WhisperTone>("consultivo");
  const [mirrorInConversation, setMirrorInConversation] = useState(true);

  const [opPopoverOpen, setOpPopoverOpen] = useState(false);
  const [opSearch, setOpSearch] = useState("");
  const [sectorPopoverOpen, setSectorPopoverOpen] = useState(false);

  const [dealPopoverOpen, setDealPopoverOpen] = useState(false);
  const [dealQuery, setDealQuery] = useState("");
  const [dealResults, setDealResults] = useState<SupervisorWhisperDealRef[]>([]);
  const [searchingDeals, setSearchingDeals] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const wasOpenRef = useRef(false);

  // Inicializa/reseta o formulário apenas na transição fechado -> aberto,
  // evitando limpar o rascunho em re-renders do componente pai (SSE/polling/props inline).
  useEffect(() => {
    const transition = resolveWhisperOpenTransition(wasOpenRef.current, open);
    wasOpenRef.current = transition.nextWasOpen;
    if (!transition.shouldResetForm) return;

    setTargetMode("single");
    setSelectedOperatorId(defaultOperatorId || defaultDeal?.operatorId || "");
    setSelectedOperatorIds([]);
    setSelectedSectorId("");
    setSelectedDeal(defaultDeal || null);
    setConversationId(defaultConversationId || "");
    setTitle("");
    setMessage("");
    setPriority("normal");
    setAsAiOnly(false);
    setRewriteWithAi(false);
    setTone("consultivo");
    setMirrorInConversation(true);
    setOpPopoverOpen(false);
    setSectorPopoverOpen(false);
    setDealPopoverOpen(false);
    setOpSearch("");
    setDealQuery("");
  }, [open, defaultOperatorId, defaultDeal, defaultConversationId]);

  useEffect(() => {
    if (!open || !dealPopoverOpen) return;
    let cancelled = false;
    const trimmed = dealQuery.trim();
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSearchingDeals(true);
      try {
        const params = new URLSearchParams({
          limit: "8",
          includeTotal: "false",
          previewOnly: "true",
        });
        if (trimmed) params.set("search", trimmed);
        const res = await fetch(`/api/crm/deals?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const rawList = Array.isArray(data) ? data : Array.isArray(data.deals) ? data.deals : [];
        setDealResults(
          rawList.slice(0, 8).map((d: any) => ({
            id: String(d.id),
            title: String(d.title || "Negociação"),
            stageName: d.stageName || d.stage?.name || null,
            operatorId: d.operatorId || null,
          })),
        );
      } catch {
        // Silencioso no autocomplete
      } finally {
        if (!cancelled) setSearchingDeals(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, dealPopoverOpen, dealQuery]);

  const filteredOperators = useMemo(() => {
    const q = opSearch.trim().toLowerCase();
    if (!q) return humanOperators;
    return humanOperators.filter(
      (op) => op.name.toLowerCase().includes(q) || op.email.toLowerCase().includes(q),
    );
  }, [humanOperators, opSearch]);

  const selectedOperatorObj = useMemo(
    () => humanOperators.find((o) => o.id === selectedOperatorId) || null,
    [humanOperators, selectedOperatorId],
  );

  const selectedSectorObj = useMemo(
    () => (sectors || []).find((s) => s.id === selectedSectorId) || null,
    [sectors, selectedSectorId],
  );

  if (!open || typeof document === "undefined") return null;

  const toggleMultiOperator = (id: string) => {
    setSelectedOperatorIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      toast.error("Escreva a orientação ou cobrança antes de enviar.");
      return;
    }

    if (targetMode === "single" && !selectedOperatorId && !selectedDeal?.id && !conversationId) {
      toast.error("Selecione o vendedor destinatário.");
      return;
    }
    if (targetMode === "multiple" && selectedOperatorIds.length === 0) {
      toast.error("Selecione pelo menos um vendedor.");
      return;
    }
    if (targetMode === "sector" && !selectedSectorId) {
      toast.error("Selecione o setor destinatário.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        message: trimmedMessage,
        title: title.trim() || null,
        priority,
        asAiOnly,
        rewriteWithAi,
        tone,
        source,
      };

      if (targetMode === "single") {
        if (selectedOperatorId) payload.operatorId = selectedOperatorId;
        if (selectedDeal?.id) payload.dealId = selectedDeal.id;
        if (conversationId.trim()) payload.conversationId = conversationId.trim();
        payload.mirrorInConversation = mirrorInConversation;
      } else if (targetMode === "multiple") {
        payload.operatorIds = selectedOperatorIds;
        if (selectedDeal?.id) payload.dealId = selectedDeal.id;
        payload.mirrorInConversation = false;
      } else if (targetMode === "sector") {
        payload.sectorId = selectedSectorId;
        payload.mirrorInConversation = false;
      }

      const res = await fetch("/api/gestao/whispers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível enviar o sussurro.");
      }

      const deliveredCount = Number(data.deliveredCount || 1);
      const firstDelivery = Array.isArray(data.deliveries) ? data.deliveries[0] : null;
      const mirrorNote = firstDelivery?.conversationMessageId
        ? " + espelhado na conversa"
        : "";
      toast.success(
        deliveredCount === 1 && firstDelivery?.operatorName
          ? `Sussurro enviado via ${persona.name} para ${firstDelivery.operatorName}${mirrorNote}.`
          : `Sussurro enviado via ${persona.name} para ${deliveredCount} vendedores.`,
      );
      onSent?.(data);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao enviar sussurro.");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-3xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border bg-muted/25">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary/15 border border-primary/30 text-primary">
              <Megaphone className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-extrabold text-foreground truncate">
                Sussurrar / Cobrar via {persona.name}
              </h2>
              <p className="text-[11px] text-muted-foreground truncate">
                Entrega no chat interno da IA com toast, alerta sonoro e botão &ldquo;Ciente&rdquo;
              </p>
            </div>
          </div>

          <SystemTooltip content="Fechar modal">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-8 w-8 grid place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </SystemTooltip>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* Modo de destinatário */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Destinatário
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-muted/60 border border-border/70">
              {(
                [
                  { id: "single", label: "1 Vendedor", icon: User },
                  { id: "multiple", label: "Vários", icon: Users },
                  { id: "sector", label: "Setor", icon: Users },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = targetMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTargetMode(tab.id)}
                    className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                      active
                        ? "bg-card text-foreground shadow-2xs border border-border/80"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Seletor: 1 Vendedor */}
            {targetMode === "single" && (
              <Popover open={opPopoverOpen} onOpenChange={setOpPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full h-10 px-3 rounded-xl border border-border bg-background hover:bg-muted/30 text-xs font-semibold text-foreground flex items-center justify-between gap-2 transition cursor-pointer"
                  >
                    <span className="truncate">
                      {selectedOperatorObj
                        ? `${selectedOperatorObj.name} (${selectedOperatorObj.email})`
                        : "Selecionar vendedor..."}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-2 z-[120]"
                >
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/50 border border-border/70 mb-1.5">
                    <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="text"
                      value={opSearch}
                      onChange={(e) => setOpSearch(e.target.value)}
                      placeholder="Buscar vendedor..."
                      className="w-full bg-transparent text-xs text-foreground outline-none"
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    {filteredOperators.map((op) => {
                      const active = op.id === selectedOperatorId;
                      return (
                        <button
                          key={op.id}
                          type="button"
                          onClick={() => {
                            setSelectedOperatorId(op.id);
                            setOpPopoverOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition cursor-pointer ${
                            active
                              ? "bg-primary/12 text-primary font-bold"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{op.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{op.email}</p>
                          </div>
                          {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                    {filteredOperators.length === 0 && (
                      <p className="text-[11px] text-muted-foreground text-center py-4">
                        Nenhum vendedor encontrado.
                      </p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Seletor: Múltiplos Vendedores */}
            {targetMode === "multiple" && (
              <div className="space-y-2">
                <Popover open={opPopoverOpen} onOpenChange={setOpPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full h-10 px-3 rounded-xl border border-border bg-background hover:bg-muted/30 text-xs font-semibold text-foreground flex items-center justify-between gap-2 transition cursor-pointer"
                    >
                      <span className="truncate">
                        {selectedOperatorIds.length > 0
                          ? `${selectedOperatorIds.length} vendedor(es) selecionado(s)`
                          : "Escolher vendedores..."}
                      </span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-2 z-[120]"
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/50 border border-border/70 mb-1.5">
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={opSearch}
                        onChange={(e) => setOpSearch(e.target.value)}
                        placeholder="Buscar vendedor..."
                        className="w-full bg-transparent text-xs text-foreground outline-none"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto space-y-0.5">
                      {filteredOperators.map((op) => {
                        const checked = selectedOperatorIds.includes(op.id);
                        return (
                          <button
                            key={op.id}
                            type="button"
                            onClick={() => toggleMultiOperator(op.id)}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition cursor-pointer ${
                              checked
                                ? "bg-primary/12 text-primary font-bold"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <span className="truncate">{op.name}</span>
                            {checked && <Check className="h-3.5 w-3.5 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                {selectedOperatorIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedOperatorIds.map((id) => {
                      const op = humanOperators.find((o) => o.id === id);
                      if (!op) return null;
                      return (
                        <span
                          key={id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/25 text-[11px] font-semibold"
                        >
                          {op.name}
                          <button
                            type="button"
                            onClick={() => toggleMultiOperator(id)}
                            className="hover:text-foreground cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Seletor: Setor */}
            {targetMode === "sector" && (
              <Popover open={sectorPopoverOpen} onOpenChange={setSectorPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="w-full h-10 px-3 rounded-xl border border-border bg-background hover:bg-muted/30 text-xs font-semibold text-foreground flex items-center justify-between gap-2 transition cursor-pointer"
                  >
                    <span className="truncate">
                      {selectedSectorObj
                        ? `${selectedSectorObj.name} (${selectedSectorObj.operatorIds?.length || 0} membros)`
                        : "Selecionar setor..."}
                    </span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-[var(--radix-popover-trigger-width)] p-1.5 z-[120]"
                >
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    {(sectors || []).map((sec) => {
                      const active = sec.id === selectedSectorId;
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          onClick={() => {
                            setSelectedSectorId(sec.id);
                            setSectorPopoverOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition cursor-pointer ${
                            active
                              ? "bg-primary/12 text-primary font-bold"
                              : "hover:bg-muted text-foreground"
                          }`}
                        >
                          <span className="truncate">{sec.name}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {sec.operatorIds?.length || 0} op.
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Vínculo opcional com Lead/Negociação (modo 1 vendedor) */}
          {targetMode !== "sector" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Negociação / Lead (opcional)
              </label>
              {selectedDeal ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/25 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="font-bold text-foreground truncate">{selectedDeal.title}</span>
                    {selectedDeal.stageName && (
                      <span className="px-1.5 py-0.5 rounded bg-card text-[10px] font-semibold text-muted-foreground border border-border/70 shrink-0">
                        {selectedDeal.stageName}
                      </span>
                    )}
                  </div>
                  <SystemTooltip content="Remover vínculo com este lead">
                    <button
                      type="button"
                      onClick={() => setSelectedDeal(null)}
                      className="h-6 w-6 grid place-items-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
              ) : (
                <Popover open={dealPopoverOpen} onOpenChange={setDealPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-full h-9 px-3 rounded-xl border border-dashed border-border bg-background hover:bg-muted/30 text-xs text-muted-foreground flex items-center justify-between gap-2 transition cursor-pointer"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Briefcase className="h-3.5 w-3.5 shrink-0" />
                        Vincular um lead do CRM (opcional)...
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-2 z-[120]"
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/50 border border-border/70 mb-1.5">
                      <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={dealQuery}
                        onChange={(e) => setDealQuery(e.target.value)}
                        placeholder="Buscar por nome da empresa ou lead..."
                        className="w-full bg-transparent text-xs text-foreground outline-none"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {searchingDeals ? (
                        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Buscando leads...
                        </div>
                      ) : dealResults.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground text-center py-4">
                          Nenhum lead encontrado.
                        </p>
                      ) : (
                        dealResults.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setSelectedDeal(d);
                              if (targetMode === "single" && !selectedOperatorId && d.operatorId) {
                                setSelectedOperatorId(d.operatorId);
                              }
                              setDealPopoverOpen(false);
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs hover:bg-muted text-foreground transition cursor-pointer"
                          >
                            <span className="truncate font-semibold">{d.title}</span>
                            {d.stageName && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                {d.stageName}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}

          {/* Prioridade + Título opcional */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Prioridade
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: "normal", label: "Normal", activeCls: "bg-primary/15 text-primary border-primary/40" },
                    { id: "alta", label: "Alta", activeCls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40" },
                    { id: "urgente", label: "Urgente", activeCls: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40" },
                  ] as const
                ).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPriority(p.id)}
                    className={`py-1.5 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                      priority === p.id
                        ? p.activeCls
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Título curto (opcional)
              </label>
              <input
                type="text"
                maxLength={140}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Retorno proposta hoje"
                className="w-full h-9 px-3 rounded-xl border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Mensagem + chips rápidos */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {rewriteWithAi ? `Instrução para ${persona.name} redigir` : "Mensagem do sussurro"}
              </label>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {message.length}/4000
              </span>
            </div>
            <textarea
              rows={4}
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                rewriteWithAi
                  ? `Ex: Cobra retorno do cliente sobre a seladora que está parada faz 3 dias...`
                  : "Escreva a orientação ou cobrança para o vendedor..."
              }
              className="w-full rounded-2xl border border-border bg-background px-3.5 py-2.5 text-xs text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {QUICK_SUGGESTIONS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setMessage(chip)}
                  className="px-2.5 py-1 rounded-lg bg-muted/60 hover:bg-muted text-[10.5px] text-muted-foreground hover:text-foreground border border-border/60 transition cursor-pointer"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Opções inteligentes */}
          <div className="rounded-2xl border border-border/80 bg-muted/25 p-3 space-y-2.5">
            <div className="flex flex-wrap gap-2">
              <SystemTooltip content={`Usar Vertex AI para ${persona.name} formular o texto de cobrança mantendo os fatos informados`}>
                <button
                  type="button"
                  onClick={() => setRewriteWithAi((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                    rewriteWithAi
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-card text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Redigir com {persona.name}</span>
                </button>
              </SystemTooltip>

              <SystemTooltip content={`O vendedor verá o lembrete como vindo apenas de ${persona.name}, sem exibir seu nome (fica registrado na auditoria)`}>
                <button
                  type="button"
                  onClick={() => setAsAiOnly((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                    asAiOnly
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-card text-muted-foreground border-border hover:text-foreground"
                  }`}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>Modo discreto ({persona.name})</span>
                </button>
              </SystemTooltip>

              {targetMode === "single" && (selectedDeal || conversationId) && (
                <SystemTooltip content="Se houver conversa vinculada, também registra nota interna invisível ao cliente dentro do atendimento">
                  <button
                    type="button"
                    onClick={() => setMirrorInConversation((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition cursor-pointer ${
                      mirrorInConversation
                        ? "bg-primary/15 text-primary border-primary/40"
                        : "bg-card text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Espelhar na conversa</span>
                  </button>
                </SystemTooltip>
              )}
            </div>

            {rewriteWithAi && (
              <div className="flex items-center gap-2 pt-1 border-t border-border/60 flex-wrap">
                <span className="text-[10.5px] font-semibold text-muted-foreground">
                  Tom da IA:
                </span>
                {(["consultivo", "direto", "urgente"] as const).map((tOpt) => (
                  <button
                    key={tOpt}
                    type="button"
                    onClick={() => setTone(tOpt)}
                    className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold capitalize border transition cursor-pointer ${
                      tone === tOpt
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {tOpt}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/70">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="h-9 px-4 rounded-xl border border-border bg-card text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !message.trim()}
              className="h-9 px-4 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-extrabold inline-flex items-center gap-1.5 shadow-soft transition cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>{submitting ? "Enviando..." : "Enviar Sussurro"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
