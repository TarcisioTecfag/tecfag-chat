import React, { useState, useEffect } from "react";
import {
  Truck,
  Key,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  RefreshCw,
  Sliders,
  ShieldCheck,
  Box,
  Building2,
  RotateCcw,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  IntelipostPublicConfig,
  IntelipostTenantSettings,
} from "@/lib/intelipost/intelipost-service";

const DEFAULT_BAURU_ORIGIN = {
  unitName: "Matriz / CD Tecfag — Bauru/SP",
  zipCode: "17064-857",
  street: "Rua Leo Greatti Neto",
  number: "1-130",
  district: "Distrito Industrial III",
  city: "Bauru",
  state: "SP",
  complement: "",
};

const BRAZIL_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

function formatCepInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length > 5) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return digits;
}

export function IntelipostSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [lookingUpCep, setLookingUpCep] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [hasApiKey, setHasApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);
  const [lastTestStatus, setLastTestStatus] = useState<"ok" | "error" | null>(null);
  const [lastTestMessage, setLastTestMessage] = useState<string | null>(null);

  const [settings, setSettings] = useState<IntelipostTenantSettings>({
    enabled: true,
    mode: "auto",
    apiBaseUrl: "https://api.intelipost.com.br/api/v1/",
    platformName: "Tecfag CRM",
    origin: { ...DEFAULT_BAURU_ORIGIN },
    defaultVolumeType: "PALLET",
    extraHandlingDays: 0,
    extraMarginPercent: 0,
    defaultSalesChannel: "Comercial B2B Máquinas",
  });

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/intelipost", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as
        | (IntelipostPublicConfig & { ok?: boolean; error?: string })
        | null;
      if (res.ok && data?.settings) {
        setSettings(data.settings);
        setHasApiKey(Boolean(data.hasApiKey));
        setMaskedApiKey(data.maskedApiKey || null);
        setLastTestedAt(data.lastTestedAt || null);
        setLastTestStatus(data.lastTestStatus || null);
        setLastTestMessage(data.lastTestMessage || null);
      } else if (data?.error) {
        toast.error(data.error);
      }
    } catch {
      toast.error("Não foi possível carregar as configurações da Intelipost.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleOriginCepLookup = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setLookingUpCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json().catch(() => null);
      if (data && !data.erro) {
        setSettings((prev) => ({
          ...prev,
          origin: {
            ...prev.origin,
            zipCode: formatCepInput(digits),
            street: data.logradouro || prev.origin.street,
            district: data.bairro || prev.origin.district,
            city: data.localidade || prev.origin.city,
            state: (data.uf || prev.origin.state).toUpperCase(),
          },
        }));
        toast.success("Endereço de origem preenchido pelo CEP.");
      }
    } catch {
      // Silencioso caso ViaCEP esteja indisponível
    } finally {
      setLookingUpCep(false);
    }
  };

  const handleSave = async (e?: React.FormEvent, clearKey = false) => {
    if (e) e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/intelipost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "save",
          settings,
          apiKey: apiKeyDraft.trim() ? apiKeyDraft.trim() : undefined,
          clearApiKey: clearKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Falha ao salvar configurações.");
      }
      setSettings(data.settings || settings);
      setHasApiKey(Boolean(data.hasApiKey));
      setMaskedApiKey(data.maskedApiKey || null);
      setApiKeyDraft("");
      toast.success(
        clearKey
          ? "Chave de API removida. Sistema em modo de simulação assistida."
          : "Configurações da Intelipost salvas com sucesso.",
      );
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar configurações.");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/settings/intelipost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "test",
          settings,
          apiKey: apiKeyDraft.trim() ? apiKeyDraft.trim() : undefined,
          apiBaseUrl: settings.apiBaseUrl,
          platformName: settings.platformName,
          originZipCode: settings.origin.zipCode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.settings) setSettings(data.settings);
      if (typeof data.hasApiKey === "boolean") setHasApiKey(data.hasApiKey);
      if (data.maskedApiKey !== undefined) setMaskedApiKey(data.maskedApiKey);
      if (data.testedAt) setLastTestedAt(data.testedAt);
      setLastTestStatus(data.ok ? "ok" : "error");
      setLastTestMessage(data.message || null);
      setApiKeyDraft("");

      if (data.ok) {
        toast.success(data.message || "Conexão com a Intelipost validada.");
      } else {
        toast.info(data.message || "Chave ainda não configurada.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao testar conexão com a Intelipost.");
    } finally {
      setTesting(false);
    }
  };

  const handleRestoreBauruOrigin = () => {
    setSettings((prev) => ({
      ...prev,
      origin: { ...DEFAULT_BAURU_ORIGIN },
    }));
    toast.success("Endereço padrão da matriz de Bauru/SP restaurado.");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2.5 text-xs font-bold text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Carregando parâmetros da integração Intelipost...</span>
        </div>
      </div>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      onSubmit={(e) => handleSave(e, false)}
      className="space-y-6 w-full"
    >
      {/* 1. CABEÇALHO E STATUS DA INTEGRAÇÃO */}
      <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shrink-0 border border-primary/20">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">
                  TMS & Logística B2B
                </span>
                <span className="rounded-lg bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground border border-border">
                  API REST v1
                </span>
              </div>
              <h3 className="text-lg font-extrabold text-foreground mt-0.5">
                Intelipost — Motor de Cotação de Frete nos Cards do CRM
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                Permite que os consultores realizem cotações de frete de máquinas e volumes diretamente na aba{" "}
                <span className="font-bold text-foreground">Cotação de Frete</span> ao lado da aba Negociações dentro de cada card.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {hasApiKey ? (
              <SystemTooltip content="A chave api-key da Intelipost está salva e pronta para cotações em tempo real">
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 border border-primary/25 px-3.5 py-1.5 text-xs font-bold text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  Chave API Configurada
                </span>
              </SystemTooltip>
            ) : (
              <SystemTooltip content="Enquanto a api-key oficial não for inserida, os vendedores podem cotar usando a Simulação Assistida com tabelas industriais de contingência">
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted border border-border px-3.5 py-1.5 text-xs font-bold text-foreground">
                  <Sliders className="h-4 w-4 text-primary" />
                  Simulação Assistida Ativa (Aguardando API Key)
                </span>
              </SystemTooltip>
            )}

            <SystemTooltip
              content={
                settings.enabled
                  ? "A aba Cotação de Frete está visível dentro dos cards do CRM"
                  : "A aba Cotação de Frete está oculta nos cards do CRM"
              }
            >
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
                }
                className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-bold border transition-all cursor-pointer ${
                  settings.enabled
                    ? "bg-primary text-primary-foreground border-primary shadow-2xs"
                    : "bg-muted/50 text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    settings.enabled ? "bg-primary-foreground" : "bg-muted-foreground"
                  }`}
                />
                {settings.enabled ? "Aba Ativa nos Cards" : "Aba Desativada"}
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Resumo Rápido de Origem Configurada */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border/60">
          <div className="rounded-xl bg-muted/30 border border-border/70 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              <span>CEP Padrão de Saída (Origem)</span>
            </div>
            <p className="text-sm font-extrabold text-foreground mt-1 font-mono">
              {settings.origin.zipCode} — {settings.origin.city}/{settings.origin.state}
            </p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              {settings.origin.street}, {settings.origin.number} • {settings.origin.district}
            </p>
          </div>

          <div className="rounded-xl bg-muted/30 border border-border/70 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span>Modo de Operação Atual</span>
            </div>
            <p className="text-sm font-extrabold text-foreground mt-1">
              {settings.mode === "live"
                ? "Somente API Oficial (Tempo Real)"
                : settings.mode === "simulation"
                ? "Simulação Assistida (Tabelas Internas)"
                : hasApiKey
                ? "Automático (API Oficial Ativa)"
                : "Automático (Simulação até inserir Chave)"}
            </p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              Canal: {settings.defaultSalesChannel}
            </p>
          </div>

          <div className="rounded-xl bg-muted/30 border border-border/70 p-3.5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <Box className="h-3.5 w-3.5 text-primary" />
              <span>Regras de Expedição</span>
            </div>
            <p className="text-sm font-extrabold text-foreground mt-1">
              +{settings.extraHandlingDays} dia(s) úteis • +{settings.extraMarginPercent}% margem
            </p>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">
              Volume padrão:{" "}
              {settings.defaultVolumeType === "PALLET"
                ? "Palete / Engradado Industrial"
                : settings.defaultVolumeType === "BOX"
                ? "Caixa / Embalagem Padrão"
                : settings.defaultVolumeType === "TUBE"
                ? "Rolo / Cilindro"
                : "Fardo / Saco"}
            </p>
          </div>
        </div>
      </div>

      {/* 2. CREDENCIAIS DA API INTELIPOST & CONEXÃO */}
      <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Key className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-foreground">
                Credenciais da API Intelipost
              </h4>
              <p className="text-xs text-muted-foreground">
                Configure a <span className="font-mono text-foreground">api-key</span> da conta da Tecfag na Intelipost quando estiver disponível.
              </p>
            </div>
          </div>

          <SystemTooltip content="Executar chamada de diagnóstico para validar a api-key e o CEP de saída">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/40 hover:bg-muted px-3.5 py-2 text-xs font-bold text-foreground transition-colors cursor-pointer disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 text-primary" />
              )}
              <span>Testar Conexão</span>
            </button>
          </SystemTooltip>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Chave da API */}
          <div className="space-y-1.5 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">
                Chave de API Intelipost (<span className="font-mono">api-key</span>)
              </label>
              {hasApiKey && maskedApiKey && (
                <span className="text-[11px] font-mono text-muted-foreground">
                  Chave atual: <strong className="text-foreground">{maskedApiKey}</strong>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  placeholder={
                    hasApiKey
                      ? "Chave já cadastrada — digite apenas se desejar substituir a chave atual"
                      : "Cole aqui a api-key fornecida no painel da Intelipost (pode ser preenchida depois)"
                  }
                  className="h-10 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono"
                />
                <SystemTooltip
                  content={showApiKey ? "Ocultar chave digitada" : "Mostrar chave digitada"}
                >
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </SystemTooltip>
              </div>

              {hasApiKey && (
                <SystemTooltip content="Remover chave de API salva e voltar para o modo de simulação">
                  <button
                    type="button"
                    onClick={() => handleSave(undefined, true)}
                    disabled={saving}
                    className="h-10 px-3 rounded-xl border border-border bg-muted/40 hover:bg-muted text-xs font-bold text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Limpar Chave</span>
                  </button>
                </SystemTooltip>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Enquanto nenhuma chave for cadastrada, a aba de cotação no card funciona normalmente em{" "}
              <strong className="text-foreground">Modo de Simulação Assistida</strong> para testes e operação imediata.
            </p>
          </div>

          {/* Modo de Operação */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              Modo de Operação do Motor de Frete
            </label>
            <Select
              value={settings.mode}
              onValueChange={(val: "auto" | "live" | "simulation") =>
                setSettings((prev) => ({ ...prev, mode: val }))
              }
            >
              <SelectTrigger className="h-10 rounded-xl border-border bg-background text-xs font-medium">
                <SelectValue placeholder="Selecione o modo de operação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  Automático (API Oficial se houver chave / Simulação se sem chave)
                </SelectItem>
                <SelectItem value="live">
                  Estrito API Oficial Intelipost (Exige api-key ativa)
                </SelectItem>
                <SelectItem value="simulation">
                  Forçar Modo de Simulação Assistida (Homologação)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Canal de Vendas */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              Canal de Vendas / Identificação na Intelipost
            </label>
            <input
              type="text"
              value={settings.defaultSalesChannel}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, defaultSalesChannel: e.target.value }))
              }
              placeholder="Ex: Comercial B2B Máquinas"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Endpoint Base */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              URL Base da API Intelipost
            </label>
            <input
              type="text"
              value={settings.apiBaseUrl}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, apiBaseUrl: e.target.value }))
              }
              placeholder="https://api.intelipost.com.br/api/v1/"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Nome da Plataforma */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              Header <span className="font-mono">platform</span> (Identificador de Origem)
            </label>
            <input
              type="text"
              value={settings.platformName}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, platformName: e.target.value }))
              }
              placeholder="Tecfag CRM"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Status do Último Teste */}
        {lastTestMessage && (
          <div
            className={`rounded-xl border p-3.5 flex items-start gap-2.5 text-xs ${
              lastTestStatus === "ok"
                ? "border-primary/30 bg-primary/5 text-foreground"
                : "border-border bg-muted/40 text-muted-foreground"
            }`}
          >
            {lastTestStatus === "ok" ? (
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <p className="font-bold text-foreground">{lastTestMessage}</p>
              {lastTestedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Verificado em {new Date(lastTestedAt).toLocaleString("pt-BR")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 3. ENDEREÇO PADRÃO DE SAÍDA (ORIGEM TECFAG — BAURU/SP) */}
      <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-foreground">
                Endereço Padrão de Saída (CD / Expedição da Empresa)
              </h4>
              <p className="text-xs text-muted-foreground">
                Este endereço já vem preenchido automaticamente como origem em todas as cotações realizadas pelos vendedores.
              </p>
            </div>
          </div>

          <SystemTooltip content="Restaurar endereço oficial da Tecfag em Bauru/SP (CEP 17064-857)">
            <button
              type="button"
              onClick={handleRestoreBauruOrigin}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 hover:bg-muted px-3 py-2 text-xs font-bold text-foreground transition-colors cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5 text-primary" />
              <span>Restaurar Matriz Bauru/SP</span>
            </button>
          </SystemTooltip>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
          <div className="space-y-1.5 md:col-span-3">
            <label className="text-xs font-bold text-foreground">
              Identificação da Unidade / Centro de Distribuição
            </label>
            <input
              type="text"
              value={settings.origin.unitName}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  origin: { ...prev.origin, unitName: e.target.value },
                }))
              }
              placeholder="Matriz / CD Tecfag — Bauru/SP"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1.5 md:col-span-3">
            <label className="text-xs font-bold text-foreground">
              CEP de Saída (Origem Padrão)
            </label>
            <div className="relative">
              <input
                type="text"
                value={settings.origin.zipCode}
                onChange={(e) => {
                  const formatted = formatCepInput(e.target.value);
                  setSettings((prev) => ({
                    ...prev,
                    origin: { ...prev.origin, zipCode: formatted },
                  }));
                  if (formatted.replace(/\D/g, "").length === 8) {
                    void handleOriginCepLookup(formatted);
                  }
                }}
                placeholder="17064-857"
                className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs font-mono font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {lookingUpCep && (
                <Loader2 className="h-4 w-4 animate-spin text-primary absolute right-3 top-1/2 -translate-y-1/2" />
              )}
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-4">
            <label className="text-xs font-bold text-foreground">Logradouro / Rua</label>
            <input
              type="text"
              value={settings.origin.street}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  origin: { ...prev.origin, street: e.target.value },
                }))
              }
              placeholder="Rua Leo Greatti Neto"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-bold text-foreground">Número / Quadra</label>
            <input
              type="text"
              value={settings.origin.number}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  origin: { ...prev.origin, number: e.target.value },
                }))
              }
              placeholder="1-130"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-bold text-foreground">Bairro / Distrito</label>
            <input
              type="text"
              value={settings.origin.district}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  origin: { ...prev.origin, district: e.target.value },
                }))
              }
              placeholder="Distrito Industrial III"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1.5 md:col-span-3">
            <label className="text-xs font-bold text-foreground">Cidade</label>
            <input
              type="text"
              value={settings.origin.city}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  origin: { ...prev.origin, city: e.target.value },
                }))
              }
              placeholder="Bauru"
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1.5 md:col-span-1">
            <label className="text-xs font-bold text-foreground">UF</label>
            <Select
              value={settings.origin.state}
              onValueChange={(val) =>
                setSettings((prev) => ({
                  ...prev,
                  origin: { ...prev.origin, state: val },
                }))
              }
            >
              <SelectTrigger className="h-10 rounded-xl border-border bg-background text-xs font-bold">
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
        </div>

        {/* Parâmetros Operacionais de Cálculo */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-border/60">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              Tipo de Embalagem / Volume Padrão
            </label>
            <Select
              value={settings.defaultVolumeType}
              onValueChange={(val: "BOX" | "PALLET" | "BAG" | "TUBE") =>
                setSettings((prev) => ({ ...prev, defaultVolumeType: val }))
              }
            >
              <SelectTrigger className="h-10 rounded-xl border-border bg-background text-xs font-medium">
                <SelectValue placeholder="Tipo de volume" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PALLET">Palete / Engradado Industrial</SelectItem>
                <SelectItem value="BOX">Caixa / Embalagem Padrão</SelectItem>
                <SelectItem value="TUBE">Cilindro / Rolo / Bobina</SelectItem>
                <SelectItem value="BAG">Fardo / Embalagem Flexível</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              Prazo Adicional de Expedição (Dias Úteis)
            </label>
            <input
              type="number"
              min={0}
              max={60}
              value={settings.extraHandlingDays}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  extraHandlingDays: Math.max(0, parseInt(e.target.value || "0", 10)),
                }))
              }
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">
              Margem Adicional de Segurança no Frete (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={settings.extraMarginPercent}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  extraMarginPercent: Math.max(0, parseFloat(e.target.value || "0")),
                }))
              }
              className="h-10 w-full rounded-xl border border-border bg-background px-3.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Rodapé de Ação */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border/60">
          <SystemTooltip content="Salvar todas as configurações da integração Intelipost e endereço padrão de saída">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-xs font-extrabold text-primary-foreground shadow-soft hover:opacity-90 transition-all cursor-pointer disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>Salvar Configurações Intelipost</span>
            </button>
          </SystemTooltip>
        </div>
      </div>
    </motion.form>
  );
}
