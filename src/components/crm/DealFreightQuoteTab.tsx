import React, { useState, useEffect, useMemo } from "react";
import {
  Truck,
  MapPin,
  Package,
  Calculator,
  Plus,
  Trash2,
  Copy,
  Check,
  Loader2,
  Building2,
  Clock,
  DollarSign,
  Scale,
  Box,
  Bookmark,
  RotateCcw,
  ArrowRight,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  calculateFreightVolumesTotals,
  type FreightCarrierOption,
  type FreightDestinationInput,
  type FreightQuoteVolumeInput,
  type IntelipostOriginAddress,
  type IntelipostPublicConfig,
  type SavedDealFreightQuote,
} from "@/lib/intelipost/intelipost-service";

const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const DEFAULT_BAURU_ORIGIN: IntelipostOriginAddress = {
  unitName: "Matriz / CD Tecfag — Bauru/SP",
  zipCode: "17064-857",
  street: "Rua Leo Greatti Neto",
  number: "1-130",
  district: "Distrito Industrial III",
  city: "Bauru",
  state: "SP",
  complement: "",
};

function formatCep(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length > 5) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return digits;
}

function formatBRL(value: number): string {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function createEmptyVolume(
  defaultType: "BOX" | "PALLET" | "BAG" | "TUBE" = "PALLET",
): FreightQuoteVolumeInput {
  return {
    id: `vol-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "",
    sku: "",
    quantity: 1,
    weightKg: 45,
    heightCm: 80,
    widthCm: 60,
    lengthCm: 70,
    unitPrice: 4500,
    volumeType: defaultType,
  };
}

interface DealFreightQuoteTabProps {
  dealId: string;
  deal: any;
  catalogProducts?: any[];
  onQuoteSavedToTimeline?: () => void;
  onQuotesCountChange?: (count: number) => void;
}

export function DealFreightQuoteTab({
  dealId,
  deal,
  catalogProducts = [],
  onQuoteSavedToTimeline,
  onQuotesCountChange,
}: DealFreightQuoteTabProps) {
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [savingOptionId, setSavingOptionId] = useState<string | null>(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lookingUpDestCep, setLookingUpDestCep] = useState(false);
  const [editingOrigin, setEditingOrigin] = useState(false);

  const [intelipostConfig, setIntelipostConfig] = useState<IntelipostPublicConfig | null>(null);
  const [origin, setOrigin] = useState<IntelipostOriginAddress>({ ...DEFAULT_BAURU_ORIGIN });

  const [destination, setDestination] = useState<FreightDestinationInput>({
    zipCode: "",
    street: "",
    number: "",
    district: "",
    city: "",
    state: "SP",
    recipientType: "cnpj_contributor",
    recipientDocument: "",
    recipientName: "",
  });

  const [volumes, setVolumes] = useState<FreightQuoteVolumeInput[]>(() => [
    createEmptyVolume("PALLET"),
  ]);
  const [quoteNotes, setQuoteNotes] = useState("");
  const [sortBy, setSortBy] = useState<"price" | "days">("price");

  // Resultado da última cotação executada na tela
  const [currentQuoteResult, setCurrentQuoteResult] = useState<{
    quoteId: string;
    source: "intelipost_live" | "simulation";
    options: FreightCarrierOption[];
    warningMessage?: string;
  } | null>(null);

  // Cotações salvas no card
  const [savedQuotes, setSavedQuotes] = useState<SavedDealFreightQuote[]>([]);

  // Popover de catálogo por índice de volume
  const [openCatalogVolId, setOpenCatalogVolId] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");

  // Extrai endereço da empresa/contato do card se existir
  const extractDealAccountAddress = (): Partial<FreightDestinationInput> | null => {
    const acc = deal?.account;
    const addr = (acc?.address || {}) as Record<string, any>;
    const rawZip =
      addr.zipCode || addr.cep || addr.zip || addr.postalCode || "";
    const city = addr.city || addr.cidade || addr.localidade || "";
    const state = addr.state || addr.uf || "";
    const street = addr.street || addr.logradouro || addr.address || "";
    const number = addr.number || addr.numero || "";
    const district = addr.district || addr.bairro || "";

    if (!rawZip && !city && !acc?.name) return null;

    const docDigits = String(acc?.document || "").replace(/\D/g, "");
    const isCpf = docDigits.length === 11 || acc?.type === "person";

    return {
      zipCode: formatCep(rawZip),
      street: String(street || ""),
      number: String(number || ""),
      district: String(district || ""),
      city: String(city || ""),
      state: String(state || "SP").toUpperCase().slice(0, 2),
      recipientType: isCpf ? "cpf" : "cnpj_contributor",
      recipientDocument: acc?.document || "",
      recipientName: acc?.tradeName || acc?.name || "",
    };
  };

  // Carrega cotações salvas e configuração padrão da Intelipost
  useEffect(() => {
    if (!dealId) return;
    let active = true;

    const loadData = async () => {
      setLoadingInitial(true);
      try {
        const res = await fetch(
          `/api/crm/deals/${encodeURIComponent(dealId)}/freight-quotes`,
          { credentials: "include" },
        );
        const data = await res.json().catch(() => null);
        if (!active) return;

        if (res.ok && data) {
          const list = Array.isArray(data.quotes) ? data.quotes : [];
          setSavedQuotes(list);
          onQuotesCountChange?.(list.length);

          if (data.intelipostConfig) {
            setIntelipostConfig(data.intelipostConfig);
            if (data.intelipostConfig.settings?.origin) {
              setOrigin(data.intelipostConfig.settings.origin);
            }
          }
        }
      } catch (err) {
        console.error("[DealFreightQuoteTab] Erro ao carregar cotações:", err);
      } finally {
        if (active) setLoadingInitial(false);
      }
    };

    void loadData();
    return () => {
      active = false;
    };
  }, [dealId]);

  // Auto-preenche endereço da empresa e produtos do card na primeira abertura
  useEffect(() => {
    const extracted = extractDealAccountAddress();
    if (extracted) {
      setDestination((prev) => {
        if (prev.zipCode || prev.city) return prev;
        return {
          ...prev,
          ...extracted,
        };
      });
    }

    const dealProducts = Array.isArray(deal?.products) ? deal.products : [];
    if (dealProducts.length > 0) {
      setVolumes((prev) => {
        if (prev.length === 1 && !prev[0].name) {
          return dealProducts.map((dp: any, idx: number) => ({
            id: `vol-dp-${dp.id || idx}`,
            productId: dp.productId || null,
            sku: dp.sku || "",
            name: dp.name || "Máquina / Equipamento",
            quantity: Math.max(1, Math.round(Number(dp.quantity) || 1)),
            weightKg: 55,
            heightCm: 85,
            widthCm: 65,
            lengthCm: 75,
            unitPrice: Math.max(100, Number(dp.unitPrice) || Number(dp.totalPrice) || 4500),
            volumeType: "PALLET",
          }));
        }
        return prev;
      });
    }
  }, [deal?.id]);

  const totals = useMemo(() => calculateFreightVolumesTotals(volumes), [volumes]);

  const sortedOptions = useMemo(() => {
    if (!currentQuoteResult?.options) return [];
    const copy = [...currentQuoteResult.options];
    if (sortBy === "days") {
      copy.sort(
        (a, b) =>
          a.deliveryEstimateBusinessDays - b.deliveryEstimateBusinessDays ||
          a.finalShippingCost - b.finalShippingCost,
      );
    } else {
      copy.sort(
        (a, b) =>
          a.finalShippingCost - b.finalShippingCost ||
          a.deliveryEstimateBusinessDays - b.deliveryEstimateBusinessDays,
      );
    }
    return copy;
  }, [currentQuoteResult, sortBy]);

  const cheapestOptionId = useMemo(() => {
    if (!currentQuoteResult?.options?.length) return null;
    return [...currentQuoteResult.options].sort(
      (a, b) => a.finalShippingCost - b.finalShippingCost,
    )[0]?.id;
  }, [currentQuoteResult]);

  const fastestOptionId = useMemo(() => {
    if (!currentQuoteResult?.options?.length) return null;
    return [...currentQuoteResult.options].sort(
      (a, b) =>
        a.deliveryEstimateBusinessDays - b.deliveryEstimateBusinessDays ||
        a.finalShippingCost - b.finalShippingCost,
    )[0]?.id;
  }, [currentQuoteResult]);

  const handleDestCepLookup = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setLookingUpDestCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json().catch(() => null);
      if (data && !data.erro) {
        setDestination((prev) => ({
          ...prev,
          zipCode: formatCep(digits),
          street: data.logradouro || prev.street,
          district: data.bairro || prev.district,
          city: data.localidade || prev.city,
          state: (data.uf || prev.state || "SP").toUpperCase(),
        }));
      }
    } catch {
      // Silencioso caso ViaCEP falhe
    } finally {
      setLookingUpDestCep(false);
    }
  };

  const handlePullFromDealAccount = () => {
    const extracted = extractDealAccountAddress();
    if (!extracted || (!extracted.zipCode && !extracted.city)) {
      toast.info("A empresa vinculada a este card ainda não possui CEP ou endereço cadastrado.");
      return;
    }
    setDestination((prev) => ({
      ...prev,
      ...extracted,
    }));
    if (extracted.zipCode && extracted.zipCode.replace(/\D/g, "").length === 8 && !extracted.city) {
      void handleDestCepLookup(extracted.zipCode);
    }
    toast.success("Endereço da empresa do card carregado.");
  };

  const handleImportDealProducts = () => {
    const dealProducts = Array.isArray(deal?.products) ? deal.products : [];
    if (dealProducts.length === 0) {
      toast.info("Nenhum produto vinculado na aba Produtos deste card.");
      return;
    }
    setVolumes(
      dealProducts.map((dp: any, idx: number) => ({
        id: `vol-dp-${dp.id || idx}-${Date.now()}`,
        productId: dp.productId || null,
        sku: dp.sku || "",
        name: dp.name || "Máquina / Equipamento",
        quantity: Math.max(1, Math.round(Number(dp.quantity) || 1)),
        weightKg: 55,
        heightCm: 85,
        widthCm: 65,
        lengthCm: 75,
        unitPrice: Math.max(100, Number(dp.unitPrice) || Number(dp.totalPrice) || 4500),
        volumeType: intelipostConfig?.settings?.defaultVolumeType || "PALLET",
      })),
    );
    toast.success(`${dealProducts.length} item(ns) importado(s) da aba Produtos.`);
  };

  const handleUpdateVolume = (
    volId: string,
    patch: Partial<FreightQuoteVolumeInput>,
  ) => {
    setVolumes((prev) =>
      prev.map((v) => (v.id === volId ? { ...v, ...patch } : v)),
    );
  };

  const handleRemoveVolume = (volId: string) => {
    setVolumes((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((v) => v.id !== volId);
    });
  };

  const handleExecuteQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    const destDigits = destination.zipCode.replace(/\D/g, "");
    if (destDigits.length !== 8) {
      toast.error("Informe um CEP de entrega válido com 8 dígitos.");
      return;
    }

    const unnamed = volumes.some((v) => !v.name.trim());
    if (unnamed) {
      toast.error("Informe o nome ou modelo da máquina em todos os volumes.");
      return;
    }

    setQuoting(true);
    try {
      const res = await fetch(
        `/api/crm/deals/${encodeURIComponent(dealId)}/freight-quotes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "quote",
            originOverride: origin,
            destination,
            volumes,
          }),
        },
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Não foi possível calcular o frete.");
      }

      setCurrentQuoteResult({
        quoteId: data.quoteId,
        source: data.source,
        options: Array.isArray(data.options) ? data.options : [],
        warningMessage: data.warningMessage,
      });

      toast.success(
        `${Array.isArray(data.options) ? data.options.length : 0} opções de frete calculadas.`,
      );
    } catch (err: any) {
      toast.error(err?.message || "Erro ao calcular cotação de frete.");
    } finally {
      setQuoting(false);
    }
  };

  const handleSaveOptionToDeal = async (option: FreightCarrierOption) => {
    setSavingOptionId(option.id);
    try {
      const res = await fetch(
        `/api/crm/deals/${encodeURIComponent(dealId)}/freight-quotes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "save",
            quoteId: currentQuoteResult?.quoteId || option.quoteId,
            source: currentQuoteResult?.source || option.source,
            origin,
            destination,
            volumes,
            selectedOption: option,
            allOptionsCount: currentQuoteResult?.options?.length || 1,
            notes: quoteNotes,
            recordInTimeline: true,
          }),
        },
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao salvar cotação na negociação.");
      }

      const list = Array.isArray(data.quotes) ? data.quotes : [];
      setSavedQuotes(list);
      onQuotesCountChange?.(list.length);
      onQuoteSavedToTimeline?.();
      toast.success("Cotação de frete salva no card e registrada no histórico.");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar cotação.");
    } finally {
      setSavingOptionId(null);
    }
  };

  const handleDeleteSavedQuote = async (quoteId: string) => {
    setDeletingQuoteId(quoteId);
    try {
      const res = await fetch(
        `/api/crm/deals/${encodeURIComponent(dealId)}/freight-quotes?quoteId=${encodeURIComponent(quoteId)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao remover cotação.");
      }
      const list = Array.isArray(data.quotes) ? data.quotes : [];
      setSavedQuotes(list);
      onQuotesCountChange?.(list.length);
      toast.success("Cotação removida do card.");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao remover cotação.");
    } finally {
      setDeletingQuoteId(null);
    }
  };

  const buildWhatsappSummaryText = (params: {
    option: FreightCarrierOption;
    dest: FreightDestinationInput;
    vols: FreightQuoteVolumeInput[];
  }) => {
    const itemsLines = params.vols
      .map(
        (v) =>
          `• ${v.quantity}x *${v.name}* (${v.weightKg} kg | ${v.heightCm}x${v.widthCm}x${v.lengthCm} cm)`,
      )
      .join("\n");

    const locationLabel = params.dest.city
      ? `${params.dest.city}/${params.dest.state || ""} (CEP ${params.dest.zipCode})`
      : `CEP ${params.dest.zipCode}`;

    return [
      `*COTAÇÃO DE FRETE — GRUPO TECFAG*`,
      ``,
      `*Equipamento(s):*`,
      itemsLines,
      ``,
      `*Origem:* Bauru/SP (CEP ${origin.zipCode})`,
      `*Destino:* ${locationLabel}`,
      `*Transportadora:* ${params.option.carrierName} (${params.option.serviceName})`,
      `*Valor do Frete:* *${formatBRL(params.option.finalShippingCost)}*`,
      `*Prazo Estimado:* *${params.option.deliveryEstimateBusinessDays} dia(s) útil(eis)* após expedição`,
    ].join("\n");
  };

  const handleCopySummary = async (
    idKey: string,
    params: {
      option: FreightCarrierOption;
      dest: FreightDestinationInput;
      vols: FreightQuoteVolumeInput[];
    },
  ) => {
    try {
      await navigator.clipboard.writeText(buildWhatsappSummaryText(params));
      setCopiedId(idKey);
      setTimeout(() => setCopiedId(null), 2500);
      toast.success("Resumo da cotação copiado para enviar no WhatsApp.");
    } catch {
      toast.error("Não foi possível copiar o resumo.");
    }
  };

  const handleReuseSavedQuote = (sq: SavedDealFreightQuote) => {
    if (sq.origin) setOrigin(sq.origin);
    if (sq.destination) setDestination(sq.destination);
    if (Array.isArray(sq.volumes) && sq.volumes.length > 0) {
      setVolumes(sq.volumes);
    }
    if (sq.notes) setQuoteNotes(sq.notes);
    toast.success("Dados da cotação carregados no formulário.");
  };

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    const list = Array.isArray(catalogProducts) ? catalogProducts : [];
    if (!q) return list.slice(0, 30);
    return list
      .filter(
        (p: any) =>
          String(p.name || "").toLowerCase().includes(q) ||
          String(p.sku || "").toLowerCase().includes(q) ||
          String(p.category || "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [catalogProducts, catalogSearch]);

  if (loadingInitial) {
    return (
      <div className="flex items-center justify-center py-14">
        <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Carregando módulo de cotação Intelipost...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in-50 duration-200 slide-in-from-bottom-1">
      {/* 1. BARRA SUPERIOR DE IDENTIFICAÇÃO E ORIGEM */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Truck className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs font-extrabold text-foreground">
                  Cotação de Frete Direta — Intelipost
                </h4>
                {intelipostConfig?.hasApiKey ? (
                  <SystemTooltip content="Conectado diretamente com a API Oficial da Intelipost">
                    <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                      <CheckCircle2 className="h-3 w-3" />
                      API Oficial Conectada
                    </span>
                  </SystemTooltip>
                ) : (
                  <SystemTooltip content="A chave da Intelipost pode ser inserida em Configurações > Intelipost (Frete). Enquanto isso, o cálculo opera em modo de simulação industrial.">
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      <Sliders className="h-3 w-3 text-primary" />
                      Simulação Assistida
                    </span>
                  </SystemTooltip>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                Saída de{" "}
                <span className="font-semibold text-foreground">
                  {origin.street}, {origin.number} — {origin.district}, {origin.city}/{origin.state} (CEP {origin.zipCode})
                </span>
              </p>
            </div>
          </div>

          <SystemTooltip content="Alterar pontualmente o CEP de saída para esta cotação">
            <button
              type="button"
              onClick={() => setEditingOrigin((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 hover:bg-muted px-3 py-1.5 text-[11px] font-bold text-foreground transition-colors cursor-pointer"
            >
              <MapPin className="h-3.5 w-3.5 text-primary" />
              <span>{editingOrigin ? "Ocultar Origem" : "Trocar CEP de Saída"}</span>
            </button>
          </SystemTooltip>
        </div>

        {editingOrigin && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-3 border-t border-border/60">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground">
                CEP de Saída (Origem)
              </label>
              <input
                type="text"
                value={origin.zipCode}
                onChange={(e) =>
                  setOrigin((prev) => ({ ...prev, zipCode: formatCep(e.target.value) }))
                }
                placeholder="17064-857"
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-bold text-muted-foreground">
                Endereço de Saída
              </label>
              <input
                type="text"
                value={`${origin.street}, ${origin.number}`}
                onChange={(e) =>
                  setOrigin((prev) => ({ ...prev, street: e.target.value }))
                }
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex items-end">
              <SystemTooltip content="Restaurar endereço padrão de Bauru/SP (CEP 17064-857)">
                <button
                  type="button"
                  onClick={() => setOrigin(intelipostConfig?.settings?.origin || DEFAULT_BAURU_ORIGIN)}
                  className="h-8 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted text-[11px] font-bold text-foreground cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3 text-primary" />
                  <span>Padrão Bauru/SP</span>
                </button>
              </SystemTooltip>
            </div>
          </div>
        )}
      </div>

      {/* FORMULÁRIO PRINCIPAL DE COTAÇÃO */}
      <form onSubmit={handleExecuteQuote} className="space-y-4">
        {/* 2. ENDEREÇO DE ENTREGA (DESTINO) */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary" />
              <h5 className="text-xs font-extrabold text-foreground">
                1. Endereço de Entrega do Cliente (Destino)
              </h5>
            </div>

            {deal?.account && (
              <SystemTooltip content="Preencher com o CEP e endereço cadastrados na empresa deste card">
                <button
                  type="button"
                  onClick={handlePullFromDealAccount}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 hover:bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary transition-colors cursor-pointer"
                >
                  <Building2 className="h-3 w-3" />
                  <span>Puxar da Empresa do Card</span>
                </button>
              </SystemTooltip>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            {/* CEP de Destino */}
            <div className="sm:col-span-3 space-y-1">
              <label className="text-[11px] font-bold text-foreground">
                CEP de Entrega *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={destination.zipCode}
                  onChange={(e) => {
                    const formatted = formatCep(e.target.value);
                    setDestination((prev) => ({ ...prev, zipCode: formatted }));
                    if (formatted.replace(/\D/g, "").length === 8) {
                      void handleDestCepLookup(formatted);
                    }
                  }}
                  placeholder="00000-000"
                  className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                {lookingUpDestCep && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary absolute right-2.5 top-1/2 -translate-y-1/2" />
                )}
              </div>
            </div>

            {/* Cidade */}
            <div className="sm:col-span-4 space-y-1">
              <label className="text-[11px] font-bold text-foreground">Cidade</label>
              <input
                type="text"
                value={destination.city || ""}
                onChange={(e) =>
                  setDestination((prev) => ({ ...prev, city: e.target.value }))
                }
                placeholder="Ex: Curitiba"
                className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* UF */}
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-bold text-foreground">UF</label>
              <Select
                value={destination.state || "SP"}
                onValueChange={(val) =>
                  setDestination((prev) => ({ ...prev, state: val }))
                }
              >
                <SelectTrigger className="h-9 rounded-xl border-border bg-background text-xs font-bold">
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
                <SelectContent>
                  {BRAZIL_STATES.map((uf) => (
                    <SelectItem key={uf} value={uf}>
                      {uf}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Perfil Fiscal */}
            <div className="sm:col-span-3 space-y-1">
              <label className="text-[11px] font-bold text-foreground">
                Perfil do Destinatário
              </label>
              <Select
                value={destination.recipientType}
                onValueChange={(
                  val: "cnpj_contributor" | "cnpj_exempt" | "cpf",
                ) => setDestination((prev) => ({ ...prev, recipientType: val }))}
              >
                <SelectTrigger className="h-9 rounded-xl border-border bg-background text-xs font-medium">
                  <SelectValue placeholder="Tipo de cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cnpj_contributor">
                    PJ — Contribuinte ICMS
                  </SelectItem>
                  <SelectItem value="cnpj_exempt">PJ — Isento de IE</SelectItem>
                  <SelectItem value="cpf">Pessoa Física (CPF)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Logradouro */}
            <div className="sm:col-span-6 space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground">
                Rua / Avenida / Rodovia
              </label>
              <input
                type="text"
                value={destination.street || ""}
                onChange={(e) =>
                  setDestination((prev) => ({ ...prev, street: e.target.value }))
                }
                placeholder="Preenchido automaticamente pelo CEP ou digite aqui"
                className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Número */}
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground">
                Número
              </label>
              <input
                type="text"
                value={destination.number || ""}
                onChange={(e) =>
                  setDestination((prev) => ({ ...prev, number: e.target.value }))
                }
                placeholder="S/N"
                className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Bairro */}
            <div className="sm:col-span-4 space-y-1">
              <label className="text-[11px] font-bold text-muted-foreground">
                Bairro / Distrito Industrial
              </label>
              <input
                type="text"
                value={destination.district || ""}
                onChange={(e) =>
                  setDestination((prev) => ({ ...prev, district: e.target.value }))
                }
                placeholder="Bairro"
                className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>

        {/* 3. INFORMAÇÕES DA MÁQUINA E MEDIDAS DOS VOLUMES */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <div>
                <h5 className="text-xs font-extrabold text-foreground">
                  2. Informações da Máquina, Peso e Dimensões
                </h5>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {Array.isArray(deal?.products) && deal.products.length > 0 && (
                <SystemTooltip content="Puxar máquinas já vinculadas na aba Produtos desta negociação">
                  <button
                    type="button"
                    onClick={handleImportDealProducts}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 hover:bg-muted px-2.5 py-1 text-[11px] font-bold text-foreground transition-colors cursor-pointer"
                  >
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span>Importar Produtos do Card ({deal.products.length})</span>
                  </button>
                </SystemTooltip>
              )}

              <SystemTooltip content="Adicionar mais uma máquina ou caixa/palete para cotar no mesmo embarque">
                <button
                  type="button"
                  onClick={() =>
                    setVolumes((prev) => [
                      ...prev,
                      createEmptyVolume(
                        intelipostConfig?.settings?.defaultVolumeType || "PALLET",
                      ),
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-primary/10 hover:bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar Volume</span>
                </button>
              </SystemTooltip>
            </div>
          </div>

          {/* Lista de Volumes */}
          <div className="space-y-3">
            {volumes.map((vol, index) => (
              <div
                key={vol.id}
                className="rounded-xl border border-border/80 bg-muted/20 p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-primary">
                    <Box className="h-3.5 w-3.5" />
                    Volume #{index + 1}
                  </span>

                  <div className="flex items-center gap-2">
                    {catalogProducts.length > 0 && (
                      <Popover
                        open={openCatalogVolId === vol.id}
                        onOpenChange={(open) => {
                          setOpenCatalogVolId(open ? vol.id : null);
                          if (open) setCatalogSearch("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card hover:bg-muted px-2.5 py-1 text-[11px] font-bold text-foreground transition-colors cursor-pointer"
                          >
                            <Search className="h-3 w-3 text-primary" />
                            <span>Escolher do Catálogo</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          className="w-80 p-2.5 rounded-xl border border-border bg-card shadow-lg space-y-2"
                        >
                          <input
                            type="text"
                            value={catalogSearch}
                            onChange={(e) => setCatalogSearch(e.target.value)}
                            placeholder="Buscar máquina por nome ou SKU..."
                            className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                          <div className="max-h-52 overflow-y-auto space-y-1">
                            {filteredCatalog.length === 0 ? (
                              <p className="py-4 text-center text-[11px] text-muted-foreground">
                                Nenhum produto encontrado.
                              </p>
                            ) : (
                              filteredCatalog.map((prod: any) => (
                                <button
                                  key={prod.id}
                                  type="button"
                                  onClick={() => {
                                    handleUpdateVolume(vol.id, {
                                      productId: prod.id,
                                      name: prod.name,
                                      sku: prod.sku || "",
                                      unitPrice:
                                        Number(prod.unitPrice) > 0
                                          ? Number(prod.unitPrice)
                                          : vol.unitPrice,
                                    });
                                    setOpenCatalogVolId(null);
                                  }}
                                  className="w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-muted transition-colors cursor-pointer"
                                >
                                  <p className="text-xs font-bold text-foreground truncate">
                                    {prod.name}
                                  </p>
                                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                                    <span>SKU: {prod.sku || "—"}</span>
                                    {Number(prod.unitPrice) > 0 && (
                                      <span className="font-bold text-primary">
                                        {formatBRL(Number(prod.unitPrice))}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ))
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}

                    {volumes.length > 1 && (
                      <SystemTooltip content="Remover este volume da cotação">
                        <button
                          type="button"
                          onClick={() => handleRemoveVolume(vol.id)}
                          className="p-1 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </SystemTooltip>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  {/* Nome da Máquina */}
                  <div className="sm:col-span-5 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Máquina / Equipamento *
                    </label>
                    <input
                      type="text"
                      required
                      value={vol.name}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, { name: e.target.value })
                      }
                      placeholder="Ex: Seladora Contínua Horizontal / Envasadora"
                      className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* SKU */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[11px] font-bold text-muted-foreground">
                      Código / SKU
                    </label>
                    <input
                      type="text"
                      value={vol.sku || ""}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, { sku: e.target.value })
                      }
                      placeholder="Opcional"
                      className="h-9 w-full rounded-xl border border-border bg-background px-2.5 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Valor NF / Máquina */}
                  <div className="sm:col-span-3 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Valor Unitário NF (R$) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      required
                      value={vol.unitPrice}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, {
                          unitPrice: Math.max(0, parseFloat(e.target.value || "0")),
                        })
                      }
                      className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Quantidade */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Qtd. Volumes *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      required
                      value={vol.quantity}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, {
                          quantity: Math.max(1, parseInt(e.target.value || "1", 10)),
                        })
                      }
                      className="h-9 w-full rounded-xl border border-border bg-background px-2.5 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Peso Unitário (kg) */}
                  <div className="sm:col-span-3 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Peso Unitário (kg) *
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      step="0.1"
                      required
                      value={vol.weightKg}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, {
                          weightKg: Math.max(0.1, parseFloat(e.target.value || "0.1")),
                        })
                      }
                      className="h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Altura (cm) */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Altura (cm) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      required
                      value={vol.heightCm}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, {
                          heightCm: Math.max(1, parseFloat(e.target.value || "1")),
                        })
                      }
                      className="h-9 w-full rounded-xl border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Largura (cm) */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Largura (cm) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      required
                      value={vol.widthCm}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, {
                          widthCm: Math.max(1, parseFloat(e.target.value || "1")),
                        })
                      }
                      className="h-9 w-full rounded-xl border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Comprimento (cm) */}
                  <div className="sm:col-span-2 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Comprimento (cm) *
                    </label>
                    <input
                      type="number"
                      min={1}
                      step="1"
                      required
                      value={vol.lengthCm}
                      onChange={(e) =>
                        handleUpdateVolume(vol.id, {
                          lengthCm: Math.max(1, parseFloat(e.target.value || "1")),
                        })
                      }
                      className="h-9 w-full rounded-xl border border-border bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Tipo de Embalagem */}
                  <div className="sm:col-span-3 space-y-1">
                    <label className="text-[11px] font-bold text-foreground">
                      Embalagem
                    </label>
                    <Select
                      value={vol.volumeType}
                      onValueChange={(val: "BOX" | "PALLET" | "BAG" | "TUBE") =>
                        handleUpdateVolume(vol.id, { volumeType: val })
                      }
                    >
                      <SelectTrigger className="h-9 rounded-xl border-border bg-background text-xs font-medium">
                        <SelectValue placeholder="Embalagem" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PALLET">Palete / Engradado</SelectItem>
                        <SelectItem value="BOX">Caixa Padrão</SelectItem>
                        <SelectItem value="TUBE">Rolo / Cilindro</SelectItem>
                        <SelectItem value="BAG">Fardo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Barra Executiva de Resumo de Cubagem + Botão de Cotar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 flex-1">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Volumes
                </span>
                <span className="text-xs font-extrabold text-foreground">
                  {totals.totalQuantity} vol(s)
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Peso Bruto
                </span>
                <span className="text-xs font-extrabold text-foreground">
                  {totals.totalGrossWeightKg} kg
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Cubagem
                </span>
                <span className="text-xs font-extrabold text-foreground">
                  {totals.totalCubicMeters} m³ ({totals.totalCubedWeightKg} kg)
                </span>
              </div>
              <div>
                <SystemTooltip content="As transportadoras cobram pelo maior valor entre o Peso Bruto Real e o Peso Cubado (300 kg/m³)">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary block cursor-help">
                    Peso Taxado
                  </span>
                </SystemTooltip>
                <span className="text-xs font-extrabold text-primary">
                  {totals.totalTaxedWeightKg} kg
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                  Valor Segurado (NF)
                </span>
                <span className="text-xs font-extrabold text-foreground">
                  {formatBRL(totals.totalInvoiceValue)}
                </span>
              </div>
            </div>

            <SystemTooltip content="Consultar transportadoras, prazos e valores de frete na Intelipost">
              <button
                type="submit"
                disabled={quoting}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-extrabold text-primary-foreground shadow-soft hover:opacity-90 transition-all cursor-pointer shrink-0 disabled:opacity-50"
              >
                {quoting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Calculator className="h-4 w-4" />
                )}
                <span>{quoting ? "Cotando..." : "Cotar Frete na Intelipost"}</span>
              </button>
            </SystemTooltip>
          </div>
        </div>
      </form>

      {/* 4. RESULTADO DA COTAÇÃO ATUAL (OPÇÕES DE TRANSPORTADORAS) */}
      {currentQuoteResult && (
        <div className="rounded-2xl border border-primary/30 bg-card p-4 shadow-soft space-y-4 animate-in fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h5 className="text-xs font-extrabold text-foreground">
                  Opções de Transportadoras Disponíveis ({sortedOptions.length})
                </h5>
                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-mono font-bold text-muted-foreground">
                  ID #{currentQuoteResult.quoteId}
                </span>
                {currentQuoteResult.source === "intelipost_live" ? (
                  <span className="rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                    Tabela Oficial Intelipost
                  </span>
                ) : (
                  <span className="rounded-md bg-muted border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                    Simulação Assistida
                  </span>
                )}
              </div>
              {currentQuoteResult.warningMessage && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {currentQuoteResult.warningMessage}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-muted-foreground">
                Ordenar por:
              </span>
              <Select
                value={sortBy}
                onValueChange={(v: "price" | "days") => setSortBy(v)}
              >
                <SelectTrigger className="h-8 w-40 rounded-lg border-border bg-background text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="price">Menor Valor (R$)</SelectItem>
                  <SelectItem value="days">Menor Prazo (Dias)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Campo opcional de observação ao salvar */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={quoteNotes}
              onChange={(e) => setQuoteNotes(e.target.value)}
              placeholder="Observação opcional para salvar junto com a cotação (ex: Frete CIF negociado / Cliente retira no terminal)..."
              className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-2.5">
            {sortedOptions.map((opt) => {
              const isCheapest = opt.id === cheapestOptionId;
              const isFastest = opt.id === fastestOptionId;
              const copyKey = `live-${opt.id}`;

              return (
                <div
                  key={opt.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 transition-all ${
                    isCheapest
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-background/60 hover:border-primary/30"
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-extrabold text-foreground">
                        {opt.carrierName}
                      </span>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        • {opt.serviceName}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                        {opt.deliveryMode === "aereo"
                          ? "Aéreo"
                          : opt.deliveryMode === "expresso"
                          ? "Expresso"
                          : "Rodoviário"}
                      </span>
                      {isCheapest && (
                        <span className="rounded bg-primary text-primary-foreground px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider">
                          Menor Valor
                        </span>
                      )}
                      {isFastest && (
                        <span className="rounded bg-primary/15 text-primary border border-primary/25 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wider">
                          Mais Rápido
                        </span>
                      )}
                    </div>
                    {opt.description && (
                      <p className="text-[11px] text-muted-foreground">
                        {opt.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1.5 text-sm font-extrabold text-foreground">
                        <span>{formatBRL(opt.finalShippingCost)}</span>
                      </div>
                      <div className="flex items-center justify-end gap-1 text-[11px] font-bold text-primary">
                        <Clock className="h-3 w-3" />
                        <span>
                          {opt.deliveryEstimateBusinessDays} dia(s) útil(eis)
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <SystemTooltip content="Copiar resumo desta opção formatado para colar no WhatsApp do cliente">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopySummary(copyKey, {
                              option: opt,
                              dest: destination,
                              vols: volumes,
                            })
                          }
                          className="h-8 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-xs font-bold text-foreground inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          {copiedId === copyKey ? (
                            <Check className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span>Copiar</span>
                        </button>
                      </SystemTooltip>

                      <SystemTooltip content="Salvar esta cotação no card e registrar automaticamente uma nota no Histórico da negociação">
                        <button
                          type="button"
                          disabled={savingOptionId === opt.id}
                          onClick={() => handleSaveOptionToDeal(opt)}
                          className="h-8 px-3 rounded-lg bg-primary hover:opacity-90 text-xs font-extrabold text-primary-foreground inline-flex items-center gap-1.5 transition-opacity cursor-pointer disabled:opacity-50"
                        >
                          {savingOptionId === opt.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Bookmark className="h-3.5 w-3.5" />
                          )}
                          <span>Salvar no Card</span>
                        </button>
                      </SystemTooltip>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. HISTÓRICO DE COTAÇÕES SALVAS NESTA NEGOCIAÇÃO */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-primary" />
            <h5 className="text-xs font-extrabold text-foreground">
              Cotações Salvas nesta Negociação ({savedQuotes.length})
            </h5>
          </div>
        </div>

        {savedQuotes.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground/70 italic">
            Nenhuma cotação de frete salva neste card até o momento.
          </p>
        ) : (
          <div className="space-y-2.5">
            {savedQuotes.map((sq) => {
              const copyKey = `saved-${sq.id}`;
              return (
                <div
                  key={sq.id}
                  className="rounded-xl border border-border/80 bg-muted/15 p-3.5 space-y-2 hover:border-primary/30 transition-colors"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-extrabold text-foreground">
                          {sq.selectedOption.carrierName} — {sq.selectedOption.serviceName}
                        </span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-extrabold text-primary">
                          {formatBRL(sq.selectedOption.finalShippingCost)}
                        </span>
                        <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-bold text-foreground">
                          {sq.selectedOption.deliveryEstimateBusinessDays} dia(s) útil(eis)
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          #{sq.quoteId}
                        </span>
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Destino:{" "}
                        <strong className="text-foreground">
                          CEP {sq.destination.zipCode}
                          {sq.destination.city
                            ? ` (${sq.destination.city}/${sq.destination.state || ""})`
                            : ""}
                        </strong>{" "}
                        • Peso Taxado: {sq.totals.totalTaxedWeightKg} kg • NF:{" "}
                        {formatBRL(sq.totals.totalInvoiceValue)}
                      </p>

                      <div className="text-[11px] text-muted-foreground">
                        {sq.volumes.map((v, i) => (
                          <span key={v.id || i} className="mr-3">
                            • {v.quantity}x <strong className="text-foreground">{v.name}</strong> ({v.weightKg}kg, {v.heightCm}x{v.widthCm}x{v.lengthCm}cm)
                          </span>
                        ))}
                      </div>

                      {sq.notes && (
                        <p className="text-[11px] text-foreground bg-muted/40 rounded-lg px-2.5 py-1 mt-1">
                          Obs: {sq.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <SystemTooltip content="Recarregar medidas e CEP desta cotação no formulário acima">
                        <button
                          type="button"
                          onClick={() => handleReuseSavedQuote(sq)}
                          className="h-7 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-bold text-foreground inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <RotateCcw className="h-3 w-3 text-primary" />
                          <span>Recarregar</span>
                        </button>
                      </SystemTooltip>

                      <SystemTooltip content="Copiar resumo desta cotação salva para o WhatsApp">
                        <button
                          type="button"
                          onClick={() =>
                            handleCopySummary(copyKey, {
                              option: sq.selectedOption,
                              dest: sq.destination,
                              vols: sq.volumes,
                            })
                          }
                          className="h-7 px-2.5 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-bold text-foreground inline-flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          {copiedId === copyKey ? (
                            <Check className="h-3 w-3 text-primary" />
                          ) : (
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span>Copiar</span>
                        </button>
                      </SystemTooltip>

                      <SystemTooltip content="Excluir esta cotação salva do card">
                        <button
                          type="button"
                          disabled={deletingQuoteId === sq.id}
                          onClick={() => handleDeleteSavedQuote(sq.id)}
                          className="h-7 w-7 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {deletingQuoteId === sq.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      </SystemTooltip>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1.5 border-t border-border/40 text-[10px] text-muted-foreground">
                    <span>
                      Cotado por <strong className="text-foreground">{sq.createdByOperatorName}</strong>
                    </span>
                    <span>{new Date(sq.createdAt).toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
