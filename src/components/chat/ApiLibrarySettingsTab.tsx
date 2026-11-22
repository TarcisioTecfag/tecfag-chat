import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileText,
  Globe,
  Info,
  Key,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Terminal,
  Webhook,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { SystemTooltip } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  buildCurlSnippet,
  buildEnvSnippet,
  buildNodeSnippet,
  buildPythonSnippet,
  getApiLibraryCatalog,
  maskApiToken,
  type ApiCatalogEntry,
  type ApiEntryKind,
  type ApiHttpMethod,
} from "@/lib/marketing/api-library-catalog";
import { MARKETING_SECTOR_LABELS } from "@/lib/marketing/crm-attribution";

interface NamedApiKeyItem {
  id: string;
  label: string;
  token: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
  active: boolean;
}

type CategoryFilter = "all" | ApiEntryKind;
type DetailSubTab = "docs" | "snippets" | "playground" | "guide";
type SnippetLanguage = "python" | "curl" | "node" | "env";

const PRODUCTION_FALLBACK_URL = "https://tecfagchat.up.railway.app";

function resolveDefaultBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return PRODUCTION_FALLBACK_URL;
}

function methodBadgeStyle(method: ApiHttpMethod): string {
  switch (method) {
    case "GET":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "POST":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "MCP":
      return "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30";
    case "WS":
      return "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

export function ApiLibrarySettingsTab() {
  const { tenant, sessionRole } = useChat();
  const activeTenant: "tecfag" | "valem" = tenant === "valem" ? "valem" : "tecfag";
  const aiPersona = getAiPersona(activeTenant);
  const companyLabel = activeTenant === "valem" ? "Valem" : "Tecfag";
  const isAdmin = sessionRole === "admin";

  const catalog = useMemo(() => getApiLibraryCatalog(activeTenant), [activeTenant]);

  const [baseUrl] = useState<string>(resolveDefaultBaseUrl);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [connectorEnabled, setConnectorEnabled] = useState(true);
  const [primaryToken, setPrimaryToken] = useState<string>("");
  const [namedKeys, setNamedKeys] = useState<NamedApiKeyItem[]>([]);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("primary");
  const [revealToken, setRevealToken] = useState(false);

  // Popovers de seleção e criação rápida de chave
  const [keyPickerOpen, setKeyPickerOpen] = useState(false);
  const [newKeyPopoverOpen, setNewKeyPopoverOpen] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [showArchitectureGuide, setShowArchitectureGuide] = useState(false);

  // Navegação do catálogo
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [selectedEntryId, setSelectedEntryId] = useState<string>(() => catalog[1]?.id || catalog[0]?.id || "");
  const [detailTab, setDetailTab] = useState<DetailSubTab>("docs");
  const [snippetLang, setSnippetLang] = useState<SnippetLanguage>("python");
  const [pythonUseEnv, setPythonUseEnv] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // Documentação completa (Markdown para leitura na aba Guia + download binário PDF)
  const [docsContent, setDocsContent] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDocsContent(null);
    fetch("/api/settings/mcp-docs/export?format=md", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setDocsContent(text);
      })
      .catch(() => {
        if (!cancelled) setDocsContent("Não foi possível carregar a documentação completa.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeTenant]);

  const handleDownloadCompleteLibrary = useCallback(
    async (format: "pdf" | "md" = "pdf") => {
      if (downloadingPdf) return;
      setDownloadingPdf(true);
      try {
        const endpoint =
          format === "pdf"
            ? "/api/settings/mcp-docs/export?format=pdf"
            : "/api/settings/mcp-docs/export?format=md&download=1";
        const res = await fetch(endpoint, { credentials: "include" });
        if (!res.ok) {
          throw new Error(`Erro HTTP ${res.status} ao gerar documentação.`);
        }

        const contentType = (res.headers.get("content-type") || "").toLowerCase();
        if (format === "pdf" && !contentType.includes("application/pdf")) {
          throw new Error("O servidor não retornou um arquivo PDF válido.");
        }

        const blob = await res.blob();
        const fallbackName =
          format === "pdf"
            ? `biblioteca-api-${activeTenant}.pdf`
            : `biblioteca-api-${activeTenant}.md`;
        const disposition = res.headers.get("content-disposition") || "";
        const match = disposition.match(/filename="?([^"]+)"?/i);
        const filename = match?.[1] || fallbackName;

        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);

        toast.success(
          format === "pdf"
            ? `PDF completo baixado (${filename}) com todas as APIs REST, MCP e Webhooks!`
            : `Documentação Markdown baixada (${filename})!`,
        );
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Falha ao baixar a documentação completa da Biblioteca de API.",
        );
      } finally {
        setDownloadingPdf(false);
      }
    },
    [activeTenant, downloadingPdf],
  );

  // Estado do Playground Interativo
  const [playgroundValues, setPlaygroundValues] = useState<Record<string, string>>({});
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundResult, setPlaygroundResult] = useState<{
    status: number;
    ok: boolean;
    latencyMs: number;
    sizeBytes: number;
    urlCalled: string;
    bodyText: string;
  } | null>(null);

  const loadTenantKeys = useCallback(async () => {
    setLoadingKeys(true);
    try {
      const res = await fetch("/api/settings/mcp", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setConnectorEnabled(data.enabled !== false);
      if (typeof data.primaryToken === "string") {
        setPrimaryToken(data.primaryToken);
      }
      if (Array.isArray(data.namedKeys)) {
        setNamedKeys(data.namedKeys);
      }
    } catch {
      // Mantém estado padrão silenciosamente
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    loadTenantKeys();
  }, [loadTenantKeys, activeTenant]);

  const allKeyOptions = useMemo(() => {
    const baseOption = {
      id: "primary",
      label: `Chave Principal (${companyLabel})`,
      token: primaryToken,
      active: connectorEnabled,
      usageCount: 0,
      isPrimary: true,
    };
    const extras = namedKeys.map((k) => ({
      id: k.id,
      label: k.label,
      token: k.token,
      active: k.active && connectorEnabled,
      usageCount: k.usageCount,
      isPrimary: false,
    }));
    return [baseOption, ...extras];
  }, [companyLabel, primaryToken, connectorEnabled, namedKeys]);

  const selectedKeyObj = useMemo(
    () => allKeyOptions.find((k) => k.id === selectedKeyId) || allKeyOptions[0],
    [allKeyOptions, selectedKeyId],
  );

  const rawActiveToken = selectedKeyObj?.token || "<SEU_API_TOKEN>";
  const visualToken = revealToken ? rawActiveToken : maskApiToken(rawActiveToken);

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalog.filter((entry) => {
      if (categoryFilter !== "all" && entry.kind !== categoryFilter) return false;
      if (!q) return true;
      const haystack = [
        entry.title,
        entry.pathOrTool,
        entry.shortSummary,
        entry.detailedExplanation,
        ...entry.useCases,
        ...entry.params.map((p) => `${p.name} ${p.description}`),
        ...entry.responseFields.map((f) => `${f.name} ${f.description}`),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [catalog, categoryFilter, searchQuery]);

  const selectedEntry: ApiCatalogEntry = useMemo(() => {
    const found = catalog.find((e) => e.id === selectedEntryId);
    if (found) return found;
    return filteredCatalog[0] || catalog[0];
  }, [catalog, filteredCatalog, selectedEntryId]);

  // Reinicia os parâmetros do Playground ao trocar de rota
  useEffect(() => {
    const defaults: Record<string, string> = {};
    for (const p of selectedEntry.playgroundParams || []) {
      defaults[p.key] = p.defaultValue;
    }
    setPlaygroundValues(defaults);
    setPlaygroundResult(null);
    if (detailTab === "playground" && !selectedEntry.supportsLivePlayground) {
      setDetailTab("docs");
    }
  }, [selectedEntry.id]);

  const copyText = useCallback(async (text: string, badgeKey: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(badgeKey);
      toast.success(`${label} copiado para a área de transferência!`);
      setTimeout(() => {
        setCopiedId((prev) => (prev === badgeKey ? null : prev));
      }, 2000);
    } catch {
      toast.error("Não foi possível copiar automaticamente.");
    }
  }, []);

  const handleCreateNamedKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newKeyLabel.trim();
    if (!trimmed) {
      toast.error("Informe um nome para identificar a chave (ex: Marketing - Python 09h).");
      return;
    }
    setCreatingKey(true);
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "create_named_key", label: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Não foi possível criar a chave.");
        return;
      }
      const updatedNamed: NamedApiKeyItem[] = data.settings?.namedKeys || [];
      setNamedKeys(updatedNamed);
      if (updatedNamed[0]?.id) {
        setSelectedKeyId(updatedNamed[0].id);
      }
      setNewKeyLabel("");
      setNewKeyPopoverOpen(false);
      toast.success(`Chave "${trimmed}" criada e selecionada!`);
    } catch {
      toast.error("Erro de conexão ao criar chave.");
    } finally {
      setCreatingKey(false);
    }
  };

  // Constrói a query string atual do Playground
  const liveQueryString = useMemo(() => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(playgroundValues)) {
      if (v !== undefined && v.trim() !== "") {
        sp.set(k, v.trim());
      }
    }
    return sp.toString();
  }, [playgroundValues]);

  const handleRunPlayground = async () => {
    if (!selectedEntry.supportsLivePlayground) return;
    if (!rawActiveToken || rawActiveToken === "<SEU_API_TOKEN>") {
      toast.error("Nenhuma chave ativa disponível para autenticar o teste.");
      return;
    }

    if (selectedEntry.id === "mcp-deal-details" && !playgroundValues.dealId?.trim()) {
      toast.error("Informe um dealId válido para testar get_crm_deal_details.");
      return;
    }

    setPlaygroundLoading(true);
    const started = performance.now();
    try {
      let res: Response;
      let calledDisplay = "";

      if (selectedEntry.kind === "rest") {
        const qs = liveQueryString ? `?${liveQueryString}` : "";
        const targetUrl = `${selectedEntry.pathOrTool}${qs}`;
        calledDisplay = `GET ${baseUrl}${targetUrl}`;
        res = await fetch(targetUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${rawActiveToken}`,
            Accept: "application/json",
          },
        });
      } else {
        const argsObj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(playgroundValues)) {
          const clean = v.trim();
          if (!clean) continue;
          if (clean === "true") argsObj[k] = true;
          else if (clean === "false") argsObj[k] = false;
          else if (
            (k === "limit" ||
              k === "limitPerBucket" ||
              k === "messagesPerConversation" ||
              k === "offset" ||
              k === "maxChars" ||
              k === "slaMinutes" ||
              k === "durationMinutes" ||
              k === "dealValue") &&
            !Number.isNaN(Number(clean))
          ) {
            argsObj[k] = Number(clean);
          } else {
            argsObj[k] = clean;
          }
        }
        calledDisplay = `POST ${baseUrl}/api/mcp -> tools/call (${selectedEntry.mcpToolName || selectedEntry.pathOrTool})`;
        res = await fetch("/api/mcp", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${rawActiveToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: {
              name: selectedEntry.mcpToolName || selectedEntry.pathOrTool,
              arguments: argsObj,
            },
          }),
        });
      }

      const latencyMs = Math.round(performance.now() - started);
      const rawText = await res.text();
      const sizeBytes = new TextEncoder().encode(rawText).length;

      let prettyBody = rawText;
      try {
        const parsed = JSON.parse(rawText);
        // Se for envelope MCP tools/call com JSON interno em content[0].text, formata de forma legível
        if (parsed?.result?.content?.[0]?.text) {
          try {
            const inner = JSON.parse(parsed.result.content[0].text);
            prettyBody = JSON.stringify(
              {
                jsonrpc: parsed.jsonrpc,
                id: parsed.id,
                mcp_tool_output: inner,
              },
              null,
              2,
            );
          } catch {
            prettyBody = JSON.stringify(parsed, null, 2);
          }
        } else {
          prettyBody = JSON.stringify(parsed, null, 2);
        }
      } catch {
        // Mantém texto bruto se não for JSON
      }

      setPlaygroundResult({
        status: res.status,
        ok: res.ok,
        latencyMs,
        sizeBytes,
        urlCalled: calledDisplay,
        bodyText: prettyBody,
      });
    } catch (err: any) {
      setPlaygroundResult({
        status: 0,
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        sizeBytes: 0,
        urlCalled: selectedEntry.pathOrTool,
        bodyText: JSON.stringify({ error: err?.message || "Falha de rede na chamada." }, null, 2),
      });
    } finally {
      setPlaygroundLoading(false);
    }
  };

  // Snippets gerados (versão visual mascarada/revelada vs. versão real para copiar)
  const buildSnippetForToken = useCallback(
    (tokenToInject: string): string => {
      switch (snippetLang) {
        case "python":
          return buildPythonSnippet({
            entry: selectedEntry,
            tenantId: activeTenant,
            baseUrl,
            token: tokenToInject,
            useEnvVars: pythonUseEnv,
          });
        case "curl":
          return buildCurlSnippet({
            entry: selectedEntry,
            baseUrl,
            token: tokenToInject,
            queryString: liveQueryString,
          });
        case "node":
          return buildNodeSnippet({
            entry: selectedEntry,
            tenantId: activeTenant,
            baseUrl,
            token: tokenToInject,
          });
        case "env":
          return buildEnvSnippet({
            tenantId: activeTenant,
            baseUrl,
            token: tokenToInject,
          });
      }
    },
    [activeTenant, baseUrl, liveQueryString, pythonUseEnv, selectedEntry, snippetLang],
  );

  const displayedCodeSnippet = useMemo(
    () => buildSnippetForToken(visualToken),
    [buildSnippetForToken, visualToken],
  );

  const realCodeSnippet = useMemo(
    () => buildSnippetForToken(rawActiveToken),
    [buildSnippetForToken, rawActiveToken],
  );

  const counts = useMemo(
    () => ({
      all: catalog.length,
      rest: catalog.filter((e) => e.kind === "rest").length,
      mcp: catalog.filter((e) => e.kind === "mcp").length,
      webhook: catalog.filter((e) => e.kind === "webhook").length,
    }),
    [catalog],
  );

  return (
    <div className="space-y-5 pb-8">
      {/* 1. CABEÇALHO DO DEVELOPER PORTAL & COFRE DE CHAVES */}
      <div className="rounded-2xl border border-border bg-card p-4 md:p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                <BookOpen className="h-3.5 w-3.5" />
                Developer Portal · Biblioteca Oficial
              </span>
              <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <Shield className="h-3 w-3" />
                Silo Multi-Tenant Isolado ({companyLabel})
              </span>
            </div>
            <h3 className="text-base md:text-lg font-extrabold text-foreground">
              Biblioteca de API REST, Conector MCP ({aiPersona.name}) & Webhooks
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Referência técnica interativa de todas as rotas de extração em massa, ferramentas de IA e webhooks em tempo real da operação{" "}
              <strong className="text-foreground">{companyLabel}</strong>. As rotas REST e o MCP compartilham o mesmo motor canônico de dados para garantir 100% de paridade numérica.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SystemTooltip content="Baixar PDF completo com TODAS as rotas API REST, ferramentas MCP, Webhooks, regras de negócio e exemplos">
              <Button
                type="button"
                size="sm"
                onClick={() => handleDownloadCompleteLibrary("pdf")}
                disabled={downloadingPdf}
                className="text-xs font-bold gap-1.5 cursor-pointer"
              >
                {downloadingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {downloadingPdf ? "Gerando PDF..." : "Baixar PDF Completo"}
              </Button>
            </SystemTooltip>
            <SystemTooltip content="Alternar guia rápido de autenticação, paginação por cursor e dicionário de setores">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowArchitectureGuide((v) => !v)}
                className="text-xs gap-1.5"
              >
                <Info className="h-3.5 w-3.5 text-primary" />
                {showArchitectureGuide ? "Ocultar Guia Rápido" : "Regras Globais & Setores"}
              </Button>
            </SystemTooltip>
            <SystemTooltip content="Recarregar chaves ativas do servidor">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadTenantKeys}
                disabled={loadingKeys}
                className="text-xs gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingKeys ? "animate-spin" : ""}`} />
                Sincronizar Chaves
              </Button>
            </SystemTooltip>
          </div>
        </div>

        {/* Barra de Base URL + Seletor de Chave Ativa + Criação Rápida */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-1">
          {/* Base URL */}
          <div className="lg:col-span-5 rounded-xl border border-border bg-muted/30 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Base URL do Servidor
              </span>
              <code className="block truncate text-xs font-mono font-semibold text-foreground mt-0.5">
                {baseUrl}
              </code>
            </div>
            <SystemTooltip content="Copiar Base URL">
              <button
                type="button"
                onClick={() => copyText(baseUrl, "base-url", "Base URL")}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-pointer"
              >
                {copiedId === "base-url" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                Copiar
              </button>
            </SystemTooltip>
          </div>

          {/* Seletor Customizado de Chave de Autenticação */}
          <div className="lg:col-span-7 rounded-xl border border-border bg-muted/30 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Chave Injetada nos Exemplos & Playground (`Authorization: Bearer`)
              </span>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Popover open={keyPickerOpen} onOpenChange={setKeyPickerOpen}>
                  <SystemTooltip content="Selecionar qual chave do tenant usar nos exemplos de código e no Playground">
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-foreground hover:border-primary/50 transition-colors cursor-pointer max-w-full"
                      >
                        <Key className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate max-w-[200px]">
                          {selectedKeyObj?.label || "Selecionar chave"}
                        </span>
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            selectedKeyObj?.active ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                        />
                        <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
                      </button>
                    </PopoverTrigger>
                  </SystemTooltip>
                  <PopoverContent align="start" className="w-80 p-2 space-y-1 z-50">
                    <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Chaves de API / MCP ({companyLabel})
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-0.5">
                      {allKeyOptions.map((item) => {
                        const isSelected = item.id === selectedKeyObj?.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSelectedKeyId(item.id);
                              setKeyPickerOpen(false);
                            }}
                            className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-primary/15 text-primary font-bold"
                                : "hover:bg-muted text-foreground"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{item.label}</div>
                              <div className="text-[10px] font-mono text-muted-foreground truncate">
                                {maskApiToken(item.token)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  item.active
                                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                    : "bg-rose-500/15 text-rose-600"
                                }`}
                              >
                                {item.active ? "Ativa" : "Pausada"}
                              </span>
                              {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>

                <code className="text-[11px] font-mono text-muted-foreground truncate">
                  {visualToken}
                </code>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <SystemTooltip content={revealToken ? "Ocultar token na tela" : "Revelar token completo na tela"}>
                <button
                  type="button"
                  onClick={() => setRevealToken((v) => !v)}
                  className="inline-flex items-center justify-center rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer"
                >
                  {revealToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </SystemTooltip>

              <SystemTooltip content="Copiar arquivo .env pronto com URL + Token real">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      buildEnvSnippet({ tenantId: activeTenant, baseUrl, token: rawActiveToken }),
                      "copy-env",
                      "Bloco .env",
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-pointer"
                >
                  {copiedId === "copy-env" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  .env
                </button>
              </SystemTooltip>

              {isAdmin && (
                <Popover open={newKeyPopoverOpen} onOpenChange={setNewKeyPopoverOpen}>
                  <SystemTooltip content="Criar uma nova chave nomeada exclusiva para um script, BI ou parceiro">
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Nova Chave
                      </button>
                    </PopoverTrigger>
                  </SystemTooltip>
                  <PopoverContent align="end" className="w-80 p-3 space-y-3 z-50">
                    <div>
                      <h4 className="text-xs font-bold text-foreground">
                        Criar Nova Chave de Integração ({companyLabel})
                      </h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Cada chave fica isolada neste tenant e pode ser pausada ou auditada individualmente na aba Conector MCP.
                      </p>
                    </div>
                    <form onSubmit={handleCreateNamedKey} className="space-y-2.5">
                      <Input
                        value={newKeyLabel}
                        onChange={(e) => setNewKeyLabel(e.target.value)}
                        placeholder="Ex: Marketing - Python 09h"
                        className="h-8 text-xs"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setNewKeyPopoverOpen(false)}
                          className="h-7 text-xs"
                        >
                          Cancelar
                        </Button>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={creatingKey}
                          className="h-7 text-xs font-bold gap-1"
                        >
                          {creatingKey && <Loader2 className="h-3 w-3 animate-spin" />}
                          Gerar Chave
                        </Button>
                      </div>
                    </form>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>

        {/* Painel Expansível: Arquitetura & Tabela Oficial de Setores */}
        {showArchitectureGuide && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="space-y-1">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-primary" />
                1. Autenticação & Isolamento
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Envie <code className="font-mono text-foreground">Authorization: Bearer &lt;TOKEN&gt;</code> (ou{" "}
                <code className="font-mono text-foreground">x-api-key</code>). O token trava automaticamente o{" "}
                <code className="font-mono text-foreground">tenant_id</code> no servidor — tentativas de consultar outro tenant retornam <code className="font-mono text-rose-500">403 Forbidden</code>.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                2. Paginação Determinística & Incremental
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Todas as rotas em massa suportam até <code className="font-mono text-foreground">limit=1000</code> por página, ordenadas por <code className="font-mono text-foreground">(updated_at, id)</code>. Enquanto <code className="font-mono text-foreground">pagination.has_more</code> for <code className="font-mono text-foreground">true</code>, envie <code className="font-mono text-foreground">cursor=next_cursor</code>.
              </p>
            </div>
            <div className="space-y-1">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-primary" />
                3. Lista Fechada de Setores (`sector_origin` / `sector_current`)
              </div>
              <div className="flex flex-wrap gap-1 pt-0.5">
                {Object.entries(MARKETING_SECTOR_LABELS).map(([code, label]) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px]"
                  >
                    <code className="font-mono font-bold text-primary">{code}</code>
                    <span className="text-muted-foreground">({label})</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. CORPO DIVIDIDO: NAVEGAÇÃO DE ROTAS (ESQUERDA) + DOCUMENTAÇÃO & PLAYGROUND (DIREITA) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* COLUNA ESQUERDA: CATÁLOGO FILTRÁVEL */}
        <aside className="lg:col-span-4 rounded-2xl border border-border bg-card p-3.5 shadow-sm space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar rota, ferramenta, campo..."
              className="h-9 pl-8 text-xs"
            />
          </div>

          {/* Pílulas de Categoria */}
          <div className="flex flex-wrap gap-1 items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["all", `Todas (${counts.all})`],
                  ["rest", `API REST (${counts.rest})`],
                  ["mcp", `MCP IA (${counts.mcp})`],
                  ["webhook", `Webhooks (${counts.webhook})`],
                ] as const
              ).map(([key, label]) => {
                const active = categoryFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCategoryFilter(key)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            
            {/* BOTÃO EXPORTAR PDF COMPLETO */}
            <SystemTooltip content="Baixar biblioteca completa em PDF (todas as APIs REST, MCP e Webhooks)">
              <button
                type="button"
                onClick={() => handleDownloadCompleteLibrary("pdf")}
                disabled={downloadingPdf}
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] font-bold text-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-pointer disabled:opacity-60"
              >
                {downloadingPdf ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <FileText className="h-3 w-3 text-primary" />
                )}
                PDF
              </button>
            </SystemTooltip>
          </div>

          {/* Lista Agrupada */}
          <div className="space-y-4 max-h-[680px] overflow-y-auto pr-1">
            {(["rest", "mcp", "webhook"] as const).map((groupKind) => {
              const items = filteredCatalog.filter((e) => e.kind === groupKind);
              if (items.length === 0) return null;

              const groupTitle =
                groupKind === "rest"
                  ? "API REST · Dados & Relatórios"
                  : groupKind === "mcp"
                    ? "Conector MCP · Ferramentas IA"
                    : "Webhooks · Entrada em Tempo Real";

              const GroupIcon =
                groupKind === "rest" ? Globe : groupKind === "mcp" ? Sparkles : Webhook;

              return (
                <div key={groupKind} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    <GroupIcon className="h-3 w-3 text-primary" />
                    {groupTitle}
                  </div>
                  {items.map((entry) => {
                    const isSelected = entry.id === selectedEntry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedEntryId(entry.id)}
                        className={`w-full rounded-xl border p-2.5 text-left transition-all cursor-pointer ${
                          isSelected
                            ? "border-primary/50 bg-primary/10 shadow-xs"
                            : "border-transparent hover:border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-mono font-extrabold ${methodBadgeStyle(
                              entry.method,
                            )}`}
                          >
                            {entry.method}
                          </span>
                          <div className="flex items-center gap-1">
                            {entry.supportsLivePlayground && (
                              <SystemTooltip content="Suporta teste interativo ao vivo">
                                <span className="inline-flex items-center text-emerald-500">
                                  <Play className="h-3 w-3 fill-current" />
                                </span>
                              </SystemTooltip>
                            )}
                            <ChevronRight
                              className={`h-3.5 w-3.5 transition-transform ${
                                isSelected ? "text-primary translate-x-0.5" : "text-muted-foreground/50"
                              }`}
                            />
                          </div>
                        </div>
                        <div className="mt-1.5 text-xs font-bold text-foreground line-clamp-1">
                          {entry.title}
                        </div>
                        <code className="mt-0.5 block truncate text-[11px] font-mono text-muted-foreground">
                          {entry.pathOrTool}
                        </code>
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {filteredCatalog.length === 0 && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                Nenhuma rota ou ferramenta encontrada para &ldquo;{searchQuery}&rdquo;.
              </div>
            )}
          </div>
        </aside>

        {/* COLUNA DIREITA: DETALHE DA ROTA + EXEMPLOS + PLAYGROUND */}
        <div className="lg:col-span-8 rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          {/* Topo da Rota Selecionada */}
          <div className="border-b border-border p-4 md:p-6 space-y-3 bg-muted/20">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                {selectedEntry.categoryLabel}
              </span>
              <SystemTooltip content="Copiar endereço completo / identificador">
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      selectedEntry.kind === "mcp"
                        ? selectedEntry.pathOrTool
                        : `${baseUrl}${selectedEntry.pathOrTool}`,
                      `path-${selectedEntry.id}`,
                      "Endereço",
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-mono font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-pointer"
                >
                  <span
                    className={`rounded border px-1.5 py-0.2 text-[10px] font-extrabold ${methodBadgeStyle(
                      selectedEntry.method,
                    )}`}
                  >
                    {selectedEntry.method}
                  </span>
                  <span className="truncate max-w-[280px] sm:max-w-[420px]">
                    {selectedEntry.kind === "mcp"
                      ? `/api/mcp · ${selectedEntry.pathOrTool}`
                      : selectedEntry.pathOrTool}
                  </span>
                  {copiedId === `path-${selectedEntry.id}` ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 opacity-70 shrink-0" />
                  )}
                </button>
              </SystemTooltip>
            </div>

            <div>
              <h4 className="text-base md:text-xl font-extrabold text-foreground">
                {selectedEntry.title}
              </h4>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {selectedEntry.shortSummary}
              </p>
            </div>

            {/* Sub-abas da rota */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setDetailTab("docs")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  detailTab === "docs"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Explicação & Campos ({selectedEntry.responseFields.length})
              </button>

              <button
                type="button"
                onClick={() => setDetailTab("snippets")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  detailTab === "snippets"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                <Code2 className="h-3.5 w-3.5" />
                Como Chamar & Payloads
              </button>

              {selectedEntry.supportsLivePlayground && (
                <button
                  type="button"
                  onClick={() => setDetailTab("playground")}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                    detailTab === "playground"
                      ? "bg-emerald-600 text-white"
                      : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                  }`}
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Testar ao Vivo
                </button>
              )}

              <button
                type="button"
                onClick={() => setDetailTab("guide")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer ${
                  detailTab === "guide"
                    ? "bg-violet-600 text-white"
                    : "bg-violet-500/10 border border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20"
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                Guia & Boas Práticas
              </button>
            </div>
          </div>

          {/* CONTEÚDO DA SUB-ABA 1: DOCUMENTAÇÃO & CAMPOS */}
          {detailTab === "docs" && (
            <div className="p-4 md:p-6 space-y-6">
              <div className="space-y-2">
                <h5 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  Como Funciona
                </h5>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {selectedEntry.detailedExplanation}
                </p>
              </div>

              {/* Casos de Uso */}
              <div className="space-y-2">
                <h5 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  Quando Usar (Casos de Uso)
                </h5>
                <ul className="space-y-1.5">
                  {selectedEntry.useCases.map((uc, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-foreground"
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{uc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Regras de Negócio */}
              {selectedEntry.businessRules && selectedEntry.businessRules.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-2">
                  <div className="text-xs font-extrabold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5" />
                    Regras de Negócio Aplicadas Automaticamente
                  </div>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {selectedEntry.businessRules.map((rule, idx) => (
                      <li key={idx} className="leading-relaxed">
                        • {rule}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tabela de Parâmetros de Entrada */}
              <div className="space-y-2">
                <h5 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  Parâmetros / Argumentos Aceitos ({selectedEntry.params.length})
                </h5>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border text-[11px] font-bold text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Parâmetro</th>
                        <th className="px-3 py-2">Onde</th>
                        <th className="px-3 py-2">Tipo / Padrão</th>
                        <th className="px-3 py-2">Descrição</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedEntry.params.map((p) => (
                        <tr key={p.name} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono font-bold text-primary whitespace-nowrap">
                            {p.name}
                            {p.required && (
                              <span className="ml-1.5 rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-sans font-bold text-rose-500">
                                obrigatório
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono">
                              {p.location}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                            {p.type}
                            {p.defaultValue ? ` = ${p.defaultValue}` : ""}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground leading-relaxed">
                            {p.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Dicionário de Campos da Resposta */}
              <div className="space-y-2">
                <h5 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                  Principais Campos de Retorno ({selectedEntry.responseFields.length})
                </h5>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 border-b border-border text-[11px] font-bold text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Campo JSON</th>
                        <th className="px-3 py-2">Tipo</th>
                        <th className="px-3 py-2">Significado & Uso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedEntry.responseFields.map((f) => (
                        <tr key={f.name} className="hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono font-bold text-foreground whitespace-nowrap">
                            {f.name}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-primary whitespace-nowrap">
                            {f.type}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground leading-relaxed">
                            {f.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* CONTEÚDO DA SUB-ABA: GUIA */}
          {detailTab === "guide" && (
            <div className="p-4 md:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">
                  Manual completo da operação <strong className="text-foreground">{companyLabel}</strong> contendo todas as rotas REST, ferramentas MCP, Webhooks, regras canônicas e exemplos.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SystemTooltip content="Baixar documentação completa em PDF formatado">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleDownloadCompleteLibrary("pdf")}
                      disabled={downloadingPdf}
                      className="h-7 text-xs font-bold gap-1.5 cursor-pointer"
                    >
                      {downloadingPdf ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      Baixar PDF
                    </Button>
                  </SystemTooltip>
                  <SystemTooltip content="Baixar documentação completa em Markdown (.md)">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadCompleteLibrary("md")}
                      disabled={downloadingPdf}
                      className="h-7 text-xs gap-1.5 cursor-pointer"
                    >
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      .md
                    </Button>
                  </SystemTooltip>
                </div>
              </div>
              <pre className="rounded-xl border border-border bg-muted/20 p-4 text-xs font-mono text-foreground leading-relaxed whitespace-pre-wrap overflow-x-auto max-h-[560px]">
                {docsContent ?? "Carregando documentação completa..."}
              </pre>
            </div>
          )}

          {/* CONTEÚDO DA SUB-ABA 2: SNIPPETS & PAYLOADS */}
          {detailTab === "snippets" && (
            <div className="p-4 md:p-6 space-y-6">
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        ["python", "Python (requests)"],
                        ["curl", "cURL"],
                        ["node", "Node.js / TS"],
                        ["env", "Arquivo .env"],
                      ] as const
                    ).map(([lang, label]) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setSnippetLang(lang)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors cursor-pointer ${
                          snippetLang === lang
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {snippetLang === "python" && selectedEntry.kind !== "webhook" && (
                      <SystemTooltip content="Alternar entre ler token do .env (recomendado) ou colar direto no script">
                        <button
                          type="button"
                          onClick={() => setPythonUseEnv((v) => !v)}
                          className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          {pythonUseEnv ? "Modo: os.environ (.env)" : "Modo: Token direto"}
                        </button>
                      </SystemTooltip>
                    )}

                    <SystemTooltip content="Copia o código já com a chave real selecionada no topo">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          copyText(realCodeSnippet, `snippet-${selectedEntry.id}`, "Código com token")
                        }
                        className="h-7 text-xs font-bold gap-1.5"
                      >
                        {copiedId === `snippet-${selectedEntry.id}` ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copiar Código Pronto
                      </Button>
                    </SystemTooltip>
                  </div>
                </div>

                <pre className="rounded-xl border border-border bg-zinc-950 text-zinc-100 p-4 text-xs font-mono overflow-x-auto leading-relaxed">
                  <code>{displayedCodeSnippet}</code>
                </pre>
              </div>

              {/* Payload de Envio (quando aplicável: Webhooks) */}
              {selectedEntry.sampleRequestPayload && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                      <Terminal className="h-3.5 w-3.5 text-amber-500" />
                      Exemplo de Payload Recebido pelo Webhook (Request Body JSON)
                    </h5>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          JSON.stringify(selectedEntry.sampleRequestPayload, null, 2),
                          `req-${selectedEntry.id}`,
                          "Payload de envio",
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      Copiar JSON
                    </button>
                  </div>
                  <pre className="rounded-xl border border-border bg-zinc-950 text-zinc-100 p-4 text-xs font-mono overflow-x-auto max-h-72 leading-relaxed">
                    <code>{JSON.stringify(selectedEntry.sampleRequestPayload, null, 2)}</code>
                  </pre>
                </div>
              )}

              {/* Payload de Resposta 200 OK */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-extrabold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <FileJson className="h-3.5 w-3.5 text-emerald-500" />
                    Exemplo de Payload de Resposta (`200 OK` JSON)
                  </h5>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        JSON.stringify(selectedEntry.sampleResponsePayload, null, 2),
                        `res-${selectedEntry.id}`,
                        "Payload de exemplo",
                      )
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                    Copiar JSON
                  </button>
                </div>
                <pre className="rounded-xl border border-border bg-zinc-950 text-emerald-300 p-4 text-xs font-mono overflow-x-auto max-h-80 leading-relaxed">
                  <code>{JSON.stringify(selectedEntry.sampleResponsePayload, null, 2)}</code>
                </pre>
              </div>
            </div>
          )}

          {/* CONTEÚDO DA SUB-ABA 3: PLAYGROUND INTERATIVO ("TRY IT OUT") */}
          {detailTab === "playground" && selectedEntry.supportsLivePlayground && (
            <div className="p-4 md:p-6 space-y-5">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Console de Teste Real (Somente Leitura Segura · Tenant {companyLabel})
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Executa a chamada real no banco de produção usando a chave <strong>{selectedKeyObj?.label}</strong> selecionada acima.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleRunPlayground}
                  disabled={playgroundLoading || !selectedKeyObj?.active}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 cursor-pointer"
                >
                  {playgroundLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current" />
                  )}
                  {playgroundLoading ? "Consultando..." : "Executar Chamada Agora"}
                </Button>
              </div>

              {/* Inputs dos parâmetros */}
              {selectedEntry.playgroundParams && selectedEntry.playgroundParams.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {selectedEntry.playgroundParams.map((param) => (
                    <div key={param.key} className="space-y-1">
                      <label className="block text-[11px] font-bold text-foreground font-mono">
                        {param.label}
                      </label>
                      <Input
                        value={playgroundValues[param.key] ?? ""}
                        onChange={(e) =>
                          setPlaygroundValues((prev) => ({
                            ...prev,
                            [param.key]: e.target.value,
                          }))
                        }
                        placeholder={param.placeholder}
                        className="h-8 text-xs font-mono"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Preview da URL real */}
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] font-mono text-muted-foreground truncate">
                {selectedEntry.kind === "rest"
                  ? `GET ${baseUrl}${selectedEntry.pathOrTool}${liveQueryString ? `?${liveQueryString}` : ""}`
                  : `POST ${baseUrl}/api/mcp -> tools/call("${selectedEntry.mcpToolName || selectedEntry.pathOrTool}")`}
              </div>

              {/* Resultado ao vivo */}
              {playgroundResult && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-md px-2 py-0.5 font-mono font-extrabold ${
                          playgroundResult.ok
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-rose-500/15 text-rose-500"
                        }`}
                      >
                        HTTP {playgroundResult.status || "ERR"}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {playgroundResult.latencyMs} ms
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {formatBytes(playgroundResult.sizeBytes)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        copyText(playgroundResult.bodyText, "live-response", "JSON retornado")
                      }
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer"
                    >
                      {copiedId === "live-response" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      Copiar Resposta Real
                    </button>
                  </div>

                  <pre className="rounded-xl border border-border bg-zinc-950 text-zinc-100 p-4 text-xs font-mono overflow-x-auto max-h-[460px] leading-relaxed">
                    <code>{playgroundResult.bodyText}</code>
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
