import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Key,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Trash2,
  Users,
  Activity,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { getAiPersona } from "@/lib/ai-persona";
import { SystemTooltip } from "@/components/ui/tooltip";

interface McpNamedKey {
  id: string;
  label: string;
  token: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  usageCount: number;
  active: boolean;
}

interface McpToolItem {
  name: string;
  description: string;
}

interface McpSettingsResponse {
  ok: boolean;
  tenantId: "tecfag" | "valem";
  enabled: boolean;
  primaryToken: string;
  primaryTokenUpdatedAt: string | null;
  isDefaultPrimaryToken: boolean;
  namedKeys: McpNamedKey[];
  tools: McpToolItem[];
}

const PRODUCTION_BASE_URL = "https://tecfagchat.up.railway.app";

export function McpSettingsTab() {
  const { tenant, sessionRole } = useChat();
  const activeTenant: "tecfag" | "valem" = tenant === "valem" ? "valem" : "tecfag";
  const aiPersona = getAiPersona(activeTenant);
  const companyLabel = activeTenant === "valem" ? "Valem" : "Tecfag";

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [primaryToken, setPrimaryToken] = useState(
    activeTenant === "valem"
      ? "mcp_vl_3c7a1f8b4e2d0c5a3f6e7b1d9c2a4e8f"
      : "mcp_tf_8f4e2a9c1d7b6e3f5a0c2d4e8b1f7a3c",
  );
  const [primaryTokenUpdatedAt, setPrimaryTokenUpdatedAt] = useState<string | null>(null);
  const [isDefaultPrimaryToken, setIsDefaultPrimaryToken] = useState(true);
  const [namedKeys, setNamedKeys] = useState<McpNamedKey[]>([]);
  const [tools, setTools] = useState<McpToolItem[]>([]);

  const [showPrimaryToken, setShowPrimaryToken] = useState(true);
  const [useProductionDomain, setUseProductionDomain] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [rotatingPrimary, setRotatingPrimary] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    toolsCount?: number;
    protocolVersion?: string;
    sampleOverview?: Record<string, unknown> | null;
    error?: string;
  } | null>(null);

  const isLocalhost = useMemo(() => {
    if (typeof window === "undefined") return false;
    return (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    );
  }, []);

  const effectiveBaseUrl = useMemo(() => {
    if (typeof window === "undefined") return PRODUCTION_BASE_URL;
    if (isLocalhost && useProductionDomain) {
      return PRODUCTION_BASE_URL;
    }
    return window.location.origin;
  }, [isLocalhost, useProductionDomain]);

  const buildConnectorUrl = (token: string) =>
    `${effectiveBaseUrl}/api/mcp?token=${encodeURIComponent(token)}`;

  const primaryConnectorUrl = useMemo(
    () => buildConnectorUrl(primaryToken),
    [effectiveBaseUrl, primaryToken],
  );

  const buildWhatsappInstructions = (url: string, personLabel?: string) => {
    const header = personLabel
      ? `*Conector IA (${companyLabel} Chat & CRM) — ${personLabel}*`
      : `*Conector IA (${companyLabel} Chat & CRM — ${aiPersona.name})*`;
    return [
      header,
      "",
      "Para conectar o seu Claude diretamente ao nosso sistema (Conversas, Triagens, CRM e Métricas de Vendas):",
      "",
      "1. Abra o *Claude* (em claude.ai ou no app Claude Desktop).",
      "2. Vá em *Settings (Configurações)* -> *Integrations / Connectors* -> clique em *Add Custom Connector*.",
      `3. Em Nome, coloque: *${companyLabel} Chat & CRM*`,
      "4. Em URL do Servidor MCP, cole exatamente este link:",
      url,
      "",
      `Pronto! Depois é só perguntar em português (ex: _"Como está o faturamento fechado deste mês, o pacing da meta e o panorama da triagem do ${aiPersona.name}?"_).`,
    ].join("\n");
  };

  const loadMcpSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/mcp", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as McpSettingsResponse;
        setEnabled(data.enabled);
        setPrimaryToken(data.primaryToken);
        setPrimaryTokenUpdatedAt(data.primaryTokenUpdatedAt);
        setIsDefaultPrimaryToken(data.isDefaultPrimaryToken);
        setNamedKeys(Array.isArray(data.namedKeys) ? data.namedKeys : []);
        setTools(Array.isArray(data.tools) ? data.tools : []);
      }
    } catch (err) {
      console.error("Erro ao carregar configurações do MCP:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTestResult(null);
    void loadMcpSettings();
  }, [activeTenant]);

  const copyToClipboard = async (text: string, id: string, successLabel: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast.success(successLabel);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 2500);
    } catch {
      toast.error("Não foi possível copiar para a área de transferência.");
    }
  };

  const handleToggleEnabled = async () => {
    if (togglingEnabled) return;
    setTogglingEnabled(true);
    try {
      const nextState = !enabled;
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "toggle_enabled", enabled: nextState }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEnabled(nextState);
        toast.success(
          nextState
            ? `Conector MCP remoto ativado para ${companyLabel}.`
            : `Conector MCP remoto pausado para ${companyLabel}.`,
        );
      } else {
        toast.error(data.error || "Erro ao alterar status do conector MCP.");
      }
    } catch {
      toast.error("Erro de comunicação ao alterar status do MCP.");
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleRotatePrimaryToken = async () => {
    if (rotatingPrimary) return;
    setRotatingPrimary(true);
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "rotate_primary_token" }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.settings) {
        setPrimaryToken(data.settings.primaryToken);
        setPrimaryTokenUpdatedAt(data.settings.primaryTokenUpdatedAt);
        setIsDefaultPrimaryToken(false);
        toast.success("Novo Link Principal gerado com sucesso!");
      } else {
        toast.error(data.error || "Não foi possível rotacionar o link principal.");
      }
    } catch {
      toast.error("Erro ao gerar novo token principal.");
    } finally {
      setRotatingPrimary(false);
    }
  };

  const handleRestoreDefaultToken = async () => {
    if (rotatingPrimary) return;
    setRotatingPrimary(true);
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "restore_default_token" }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.settings) {
        setPrimaryToken(data.settings.primaryToken);
        setPrimaryTokenUpdatedAt(data.settings.primaryTokenUpdatedAt);
        setIsDefaultPrimaryToken(true);
        toast.success("Token padrão original restaurado com sucesso!");
      } else {
        toast.error(data.error || "Não foi possível restaurar o token padrão.");
      }
    } catch {
      toast.error("Erro ao restaurar o token padrão.");
    } finally {
      setRotatingPrimary(false);
    }
  };

  const handleCreateNamedKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLabel = newKeyLabel.trim();
    if (!cleanLabel || creatingKey) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "create_named_key", label: cleanLabel }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.settings) {
        setNamedKeys(data.settings.namedKeys || []);
        setNewKeyLabel("");
        if (data.createdKey?.token) {
          const url = buildConnectorUrl(data.createdKey.token);
          await navigator.clipboard.writeText(url).catch(() => {});
          toast.success(`Link criado para "${cleanLabel}" e já copiado para a área de transferência!`);
        } else {
          toast.success(`Link individual criado para "${cleanLabel}".`);
        }
      } else {
        toast.error(data.error || "Erro ao criar link individual.");
      }
    } catch {
      toast.error("Erro ao criar link individual.");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleToggleNamedKey = async (keyId: string, currentActive: boolean) => {
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "toggle_named_key",
          keyId,
          active: !currentActive,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.settings) {
        setNamedKeys(data.settings.namedKeys || []);
        toast.success(!currentActive ? "Link individual ativado." : "Link individual pausado.");
      }
    } catch {
      toast.error("Erro ao atualizar status do link.");
    }
  };

  const handleDeleteNamedKey = async (keyId: string, label: string) => {
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "delete_named_key", keyId }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.settings) {
        setNamedKeys(data.settings.namedKeys || []);
        toast.success(`Link de "${label}" revogado permanentemente.`);
      }
    } catch {
      toast.error("Erro ao revogar link.");
    }
  };

  const handleTestConnection = async () => {
    if (testingConnection) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "test_connection" }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          latencyMs: data.latencyMs,
          toolsCount: data.toolsCount,
          protocolVersion: data.protocolVersion,
          sampleOverview: data.sampleOverview,
        });
        toast.success(`Conector MCP validado em ${data.latencyMs}ms!`);
      } else {
        setTestResult({
          ok: false,
          error: data.error || "Falha ao validar conector MCP.",
        });
      }
    } catch {
      setTestResult({
        ok: false,
        error: "Erro de rede ao testar o endpoint /api/mcp.",
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const samplePrompts = [
    `Como está o faturamento fechado deste mês na ${companyLabel}, o pacing da meta e o ranking por consultor?`,
    `Me mostre o panorama da triagem do ${aiPersona.name} nos últimos 7 dias e se há algum alerta de handoff.`,
    `Busque as últimas negociações ganhas na ${companyLabel} e me traga os detalhes e valores.`,
    `Qual o status atual da escala do rodízio e quais operadores estão online agora?`,
  ];

  const maskedPrimaryUrl = useMemo(() => {
    if (showPrimaryToken) return primaryConnectorUrl;
    const prefix = primaryToken.slice(0, 11);
    const suffix = primaryToken.slice(-4);
    return `${effectiveBaseUrl}/api/mcp?token=${prefix}••••••••••••••••••••${suffix}`;
  }, [effectiveBaseUrl, primaryConnectorUrl, primaryToken, showPrimaryToken]);

  return (
    <div className="space-y-6 w-full">
      {/* 1. CABEÇALHO E STATUS DO CONECTOR MCP */}
      <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-primary">
                Model Context Protocol (MCP) · {companyLabel}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-foreground border border-border">
                <Shield className="h-3 w-3 text-primary" />
                Somente Leitura (Read-Only)
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-mono text-muted-foreground border border-border">
                tenant: {activeTenant}
              </span>
            </div>
            <h3 className="text-lg font-extrabold text-foreground">
              Conector Remoto por Link Único (Claude, Antigravity & IA)
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
              Compartilhe um único link seguro com membros da sua operação para conectarem o{" "}
              <strong className="text-foreground">Claude</strong> ou{" "}
              <strong className="text-foreground">Antigravity</strong> diretamente às conversas,
              triagens do <strong className="text-foreground">{aiPersona.name}</strong>, CRM e
              métricas comerciais da <strong className="text-foreground">{companyLabel}</strong> —
              sem instalar nada e sem expor credenciais do banco.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <SystemTooltip content="Executar diagnóstico real de inicialização e leitura das 10 ferramentas MCP">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConnection || loading}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-bold border border-border transition cursor-pointer active:scale-[0.98] disabled:opacity-60"
              >
                {testingConnection ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <Activity className="h-3.5 w-3.5 text-primary" />
                )}
                Testar Conector Agora
              </button>
            </SystemTooltip>

            <SystemTooltip
              content={
                enabled
                  ? "Conector MCP ativo para este tenant. Clique para pausar todos os acessos externos."
                  : "Conector MCP pausado. Clique para reativar os links deste tenant."
              }
            >
              <button
                type="button"
                onClick={handleToggleEnabled}
                disabled={togglingEnabled || sessionRole !== "admin"}
                className={`inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                  enabled
                    ? "bg-primary/10 text-primary border-primary/25"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    enabled ? "bg-primary animate-pulse" : "bg-muted-foreground"
                  }`}
                />
                {enabled ? "Conector Ativo" : "Conector Pausado"}
              </button>
            </SystemTooltip>
          </div>
        </div>

        {/* Resultado do Diagnóstico ao Vivo */}
        {testResult && (
          <div
            className={`rounded-xl p-4 border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              testResult.ok
                ? "bg-muted/50 border-primary/30 text-foreground"
                : "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400"
            }`}
          >
            <div className="flex items-start sm:items-center gap-2.5">
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5 sm:mt-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 sm:mt-0" />
              )}
              <div>
                {testResult.ok ? (
                  <div className="font-bold">
                    Handshake JSON-RPC 2.0 concluído com sucesso ({testResult.latencyMs}ms) ·{" "}
                    <span className="text-primary">
                      {testResult.toolsCount} ferramentas prontas
                    </span>{" "}
                    (Protocolo {testResult.protocolVersion})
                  </div>
                ) : (
                  <div className="font-bold">{testResult.error}</div>
                )}
                {testResult.ok && testResult.sampleOverview && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Leitura verificada no tenant{" "}
                    <strong className="text-foreground uppercase">{activeTenant}</strong>:{" "}
                    {Number(testResult.sampleOverview.totalConversations ?? 0)} conversas
                    analisadas nos últimos 7 dias (
                    {Number(testResult.sampleOverview.inAutomationNow ?? 0)} em automação,{" "}
                    {Number(testResult.sampleOverview.transferredCount ?? 0)} transferidas).
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. CAIXA DO LINK ÚNICO PRINCIPAL */}
        <div className="rounded-2xl bg-muted/30 border border-border p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                Link Único Principal — {companyLabel}
              </h4>
              {isDefaultPrimaryToken && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-muted text-muted-foreground border border-border">
                  Token Oficial Padrão
                </span>
              )}
            </div>

            {isLocalhost && (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">Domínio do link:</span>
                <button
                  type="button"
                  onClick={() => setUseProductionDomain(true)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    useProductionDomain
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Produção (Railway)
                </button>
                <button
                  type="button"
                  onClick={() => setUseProductionDomain(false)}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                    !useProductionDomain
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Localhost
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
            <div className="relative flex-1 flex items-center rounded-xl bg-card border border-border px-3.5 py-2.5">
              <input
                type="text"
                readOnly
                value={maskedPrimaryUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="w-full bg-transparent text-xs font-mono text-foreground focus:outline-none select-all pr-8"
              />
              <SystemTooltip
                content={showPrimaryToken ? "Ocultar token na tela" : "Mostrar token completo"}
              >
                <button
                  type="button"
                  onClick={() => setShowPrimaryToken((v) => !v)}
                  className="absolute right-2.5 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition cursor-pointer"
                >
                  {showPrimaryToken ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </SystemTooltip>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <SystemTooltip content="Copiar a URL completa para colar direto no Claude (Add Custom Connector)">
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      primaryConnectorUrl,
                      "primary-url",
                      `Link Único da ${companyLabel} copiado!`,
                    )
                  }
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold shadow-soft hover:opacity-90 transition cursor-pointer active:scale-[0.98]"
                >
                  {copiedId === "primary-url" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedId === "primary-url" ? "Link Copiado!" : "Copiar Link Único"}
                </button>
              </SystemTooltip>

              <SystemTooltip content="Copiar mensagem pronta com o link e o passo a passo para enviar no WhatsApp de quem vai testar">
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      buildWhatsappInstructions(primaryConnectorUrl),
                      "primary-wa",
                      "Instruções + Link copiados para enviar no WhatsApp!",
                    )
                  }
                  className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-card hover:bg-muted text-foreground text-xs font-bold border border-border transition cursor-pointer active:scale-[0.98]"
                >
                  {copiedId === "primary-wa" ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : (
                    <MessageSquare className="h-4 w-4 text-primary" />
                  )}
                  Copiar Passo a Passo (WhatsApp)
                </button>
              </SystemTooltip>

              {sessionRole === "admin" && (
                <SystemTooltip content="Gerar um novo código de token principal (invalida o token anterior)">
                  <button
                    type="button"
                    onClick={handleRotatePrimaryToken}
                    disabled={rotatingPrimary}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-card hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold border border-border transition cursor-pointer"
                  >
                    {rotatingPrimary ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Gerar Novo
                  </button>
                </SystemTooltip>
              )}

              {sessionRole === "admin" && !isDefaultPrimaryToken && (
                <SystemTooltip content="Restaurar o token padrão original deste tenant">
                  <button
                    type="button"
                    onClick={handleRestoreDefaultToken}
                    disabled={rotatingPrimary}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-card hover:bg-muted text-muted-foreground hover:text-foreground text-xs font-semibold border border-border transition cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restaurar Padrão
                  </button>
                </SystemTooltip>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              Este link trava automaticamente todas as consultas no tenant{" "}
              <strong className="text-foreground uppercase">{activeTenant}</strong> (zero risco de
              misturar dados entre empresas).
            </span>
            {primaryTokenUpdatedAt && (
              <span>
                Última rotação:{" "}
                {new Date(primaryTokenUpdatedAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. GERADOR DE LINKS INDIVIDUAIS POR PESSOA DA OPERAÇÃO */}
      <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-extrabold text-foreground">
                Links Individuais por Pessoa / Equipe ({companyLabel})
              </h4>
            </div>
            <p className="text-xs text-muted-foreground">
              Vai liberar o teste para alguém da operação? Gere um link identificado com o nome da
              pessoa. Assim você acompanha quando ela usou e pode desativar o acesso dela a
              qualquer momento com 1 clique.
            </p>
          </div>
        </div>

        {/* Formulário para Gerar Novo Link Nomeado */}
        <form onSubmit={handleCreateNamedKey} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="Nome da pessoa ou setor (ex: João - Comercial, Diretoria, Analista Teste)..."
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            className="flex-1 h-10 rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={!newKeyLabel.trim() || creatingKey || sessionRole !== "admin"}
            className="inline-flex h-10 items-center justify-center gap-2 px-5 rounded-xl bg-primary text-primary-foreground text-xs font-extrabold shadow-soft hover:opacity-90 transition cursor-pointer active:scale-[0.98] disabled:opacity-50 shrink-0"
          >
            {creatingKey ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Gerar Link Individual
          </button>
        </form>

        {/* Lista de Links Individuais Criados */}
        {namedKeys.length === 0 ? (
          <div className="rounded-xl bg-muted/20 border border-dashed border-border p-6 text-center space-y-1">
            <p className="text-xs font-bold text-foreground">
              Nenhum link individual separado foi criado ainda
            </p>
            <p className="text-[11px] text-muted-foreground">
              Você pode usar o <strong>Link Único Principal</strong> acima ou digitar o nome de um
              colaborador no campo acima para gerar um link exclusivo e revogável para ele.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {namedKeys.map((item) => {
              const itemUrl = buildConnectorUrl(item.token);
              return (
                <div
                  key={item.id}
                  className={`rounded-xl border p-4 transition-all ${
                    item.active
                      ? "bg-muted/20 border-border"
                      : "bg-muted/10 border-border/50 opacity-65"
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-extrabold text-foreground">
                          {item.label}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            item.active
                              ? "bg-primary/10 text-primary border-primary/25"
                              : "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {item.active ? "Ativo" : "Pausado"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          Criado por {item.createdBy} em{" "}
                          {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                        <span className="text-[11px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
                          {item.usageCount || 0} acessos
                          {item.lastUsedAt
                            ? ` · último em ${new Date(item.lastUsedAt).toLocaleString("pt-BR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}`
                            : " · ainda não utilizado"}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-muted-foreground truncate">
                        {itemUrl}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            itemUrl,
                            `key-url-${item.id}`,
                            `Link de "${item.label}" copiado!`,
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition cursor-pointer"
                      >
                        {copiedId === `key-url-${item.id}` ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copiar Link
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            buildWhatsappInstructions(itemUrl, item.label),
                            `key-wa-${item.id}`,
                            `Convite de WhatsApp para "${item.label}" copiado!`,
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-muted text-foreground text-xs font-semibold border border-border transition cursor-pointer"
                      >
                        {copiedId === `key-wa-${item.id}` ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <MessageSquare className="h-3.5 w-3.5 text-primary" />
                        )}
                        WhatsApp
                      </button>

                      {sessionRole === "admin" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleToggleNamedKey(item.id, item.active)}
                            className="px-2.5 py-1.5 rounded-lg bg-card hover:bg-muted text-xs font-semibold text-muted-foreground hover:text-foreground border border-border transition cursor-pointer"
                          >
                            {item.active ? "Pausar" : "Ativar"}
                          </button>

                          <SystemTooltip content="Revogar e excluir este link permanentemente">
                            <button
                              type="button"
                              onClick={() => handleDeleteNamedKey(item.id, item.label)}
                              className="p-1.5 rounded-lg bg-card hover:bg-red-500/10 text-muted-foreground hover:text-red-500 border border-border transition cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </SystemTooltip>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. COMO USAR NO CLAUDE (PASSO A PASSO) + EXemplos DE PERGUNTAS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Passo a passo Claude */}
        <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-extrabold text-foreground">
                Como Conectar no Claude (Por Link Único)
              </h4>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-primary/10 text-primary">
              Recomendado p/ Equipe
            </span>
          </div>

          <ol className="space-y-3 text-xs text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <span className="h-5 w-5 rounded-full bg-primary/15 text-primary font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <div>
                Abra o <strong className="text-foreground">Claude</strong> no navegador (
                <code className="text-foreground font-mono">claude.ai</code>) ou no aplicativo{" "}
                <strong className="text-foreground">Claude Desktop</strong>.
              </div>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="h-5 w-5 rounded-full bg-primary/15 text-primary font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <div>
                Acesse <strong className="text-foreground">Settings (Configurações)</strong>{" "}
                $\rightarrow$ <strong className="text-foreground">Integrations / Connectors</strong>{" "}
                e clique no botão{" "}
                <strong className="text-foreground">Add Custom Connector</strong>.
              </div>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="h-5 w-5 rounded-full bg-primary/15 text-primary font-extrabold text-[11px] flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <div>
                Informe o nome <strong className="text-foreground">{companyLabel} Chat & CRM</strong>{" "}
                e cole o <strong className="text-foreground">Link Único</strong> copiado acima.
              </div>
            </li>
          </ol>

          <div className="pt-2 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Exemplos prontos para testar no Claude (clique para copiar):
            </div>
            <div className="space-y-1.5">
              {samplePrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() =>
                    copyToClipboard(prompt, `prompt-${idx}`, "Pergunta de exemplo copiada!")
                  }
                  className="w-full text-left p-2.5 rounded-xl bg-muted/30 hover:bg-muted/60 border border-border text-xs text-foreground flex items-center justify-between gap-2 transition cursor-pointer group"
                >
                  <span className="truncate">&ldquo;{prompt}&rdquo;</span>
                  {copiedId === `prompt-${idx}` ? (
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Catálogo das 10 Ferramentas Habilitadas */}
        <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              <h4 className="text-sm font-extrabold text-foreground">
                10 Ferramentas Habilitadas no Conector
              </h4>
            </div>
            <span className="text-[11px] font-mono text-muted-foreground">
              100% Read-Only
            </span>
          </div>

          <div className="space-y-2 max-h-[310px] overflow-y-auto pr-1">
            {(tools.length > 0
              ? tools
              : [
                  {
                    name: "search_conversations",
                    description: "Busca e filtra conversas de atendimento por nome, telefone, CNPJ, fila ou vendedor.",
                  },
                  {
                    name: "get_conversation_messages",
                    description: "Lê o histórico cronológico completo de mensagens e notas de uma conversa.",
                  },
                  {
                    name: "get_fagner_triage_overview",
                    description: `Panorama em tempo real da triagem automática do ${aiPersona.name} e diagnósticos de handoff.`,
                  },
                  {
                    name: "get_fagner_triage_history",
                    description: "Histórico de ciclos de triagem, briefing consolidado e notas progressivas.",
                  },
                  {
                    name: "search_crm_deals",
                    description: "Pesquisa negociações do CRM por cliente, funil, etapa, consultor ou status.",
                  },
                  {
                    name: "get_crm_deal_details",
                    description: "Ficha 360º da negociação com empresa, Receita Federal, produtos, propostas e atividades.",
                  },
                  {
                    name: "search_crm_accounts",
                    description: "Busca empresas (crm_accounts) com dados completos da Receita Federal, QSA e CNAE.",
                  },
                  {
                    name: "search_contacts",
                    description: "Busca contatos individuais e carteira de clientes.",
                  },
                  {
                    name: "get_sales_and_commercial_metrics",
                    description: "Métricas de vendas fechadas no mês, meta, pacing de dias úteis, ranking e motivos de perda.",
                  },
                  {
                    name: "get_rodizio_and_operators_status",
                    description: "Status dos operadores, setores e escala local da aba Fluxos.",
                  },
                ]
            ).map((tool) => (
              <div
                key={tool.name}
                className="rounded-xl bg-muted/25 border border-border p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-mono font-bold text-primary">
                    {tool.name}
                  </code>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    GET / Read
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {tool.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
