import React, { useState, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { 
  Check, RefreshCw, Key, Shield, Smartphone, QrCode, AlertCircle, Save, Mail, 
  FileText, Link, ExternalLink, CheckCircle2, Loader2, PhoneCall, Clock, 
  MessageSquare, ShieldAlert, Calendar, Sparkles, Send, Bell, Globe, Copy
} from "lucide-react";
import { ConfiguracaoTab as VoiceConfigTab } from "@/components/voice/ConfiguracaoTab";
import { LiveChatSettingsTab } from "./LiveChatSettingsTab";
import { usePermissions } from "@/hooks/usePermissions";
import { CustomFieldsSettingsModal } from "@/components/crm/CustomFieldsSettingsModal";
import { PipelineSettingsModal } from "@/components/crm/PipelineSettingsModal";
import { CrmCatalogSettingsModal } from "@/components/crm/CrmCatalogSettingsModal";
import { CrmActionHistoryModal } from "@/components/crm/CrmActionHistoryModal";
import type { CatalogKind } from "@/lib/crm/catalogs";
import { toast } from "sonner";
import { getAiPersona } from "@/lib/ai-persona";

type SettingsTab = "whatsapp" | "voz" | "rd" | "crm" | "email" | "livechat";

export function SettingsView() {
  const {
    tenant,
    sessionRole,
    metaConfig,
    setMetaConfig,
    baileysConfig,
    disconnectBaileys,
    connectBaileys,
  } = useChat();

  const aiPersona = getAiPersona(tenant || "valem");

  const [activeTab, setActiveTab] = useState<SettingsTab>("whatsapp");
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [pipelineSettingsOpen, setPipelineSettingsOpen] = useState(false);
  const [sourcesCampaignsOpen, setSourcesCampaignsOpen] = useState(false);
  const [lossReasonsOpen, setLossReasonsOpen] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [catalogKind, setCatalogKind] = useState<CatalogKind | null>(null);
  const [actionHistoryOpen, setActionHistoryOpen] = useState(false);

  const [metaForm, setMetaForm] = useState({ ...metaConfig });
  const [isSaved, setIsSaved] = useState(false);

  // Estado de integração RD Station CRM
  const [rdCrmConfigured, setRdCrmConfigured] = useState<boolean | null>(null);
  const [rdCrmConnecting, setRdCrmConnecting] = useState(false);

  // Estados de Relatórios e SMTP
  const [reportForm, setReportForm] = useState({
    reportDailyWhatsapp: false,
    reportDailyEmail: false,
    reportWeeklyWhatsapp: false,
    reportWeeklyEmail: false,
    reportWhatsappNumbers: "",
    reportEmailAddresses: "",
    smtpHost: "",
    smtpPort: "",
    smtpUser: "",
    smtpPass: "",
    smtpFrom: "",
    reportRequiresApproval: false,
  });
  const [loadingReports, setLoadingReports] = useState(false);
  const [isReportSaved, setIsReportSaved] = useState(false);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

  useEffect(() => {
    const loadReports = async () => {
      setLoadingReports(true);
      try {
        const res = await fetch(`${BACKEND_URL}/api/settings/reports?tenantId=${tenant}`);
        if (res.ok) {
          const data = await res.json();
          setReportForm({
            reportDailyWhatsapp: !!data.reportDailyWhatsapp,
            reportDailyEmail: !!data.reportDailyEmail,
            reportWeeklyWhatsapp: !!data.reportWeeklyWhatsapp,
            reportWeeklyEmail: !!data.reportWeeklyEmail,
            reportWhatsappNumbers: data.reportWhatsappNumbers || "",
            reportEmailAddresses: data.reportEmailAddresses || "",
            smtpHost: data.smtpHost || "",
            smtpPort: data.smtpPort ? String(data.smtpPort) : "",
            smtpUser: data.smtpUser || "",
            smtpPass: data.smtpPass || "",
            smtpFrom: data.smtpFrom || "",
            reportRequiresApproval: !!data.reportRequiresApproval,
          });
        }
      } catch (e) {
        console.error("Erro ao carregar configurações de relatório:", e);
      } finally {
        setLoadingReports(false);
      }
    };
    loadReports();
  }, [tenant]);

  // Verifica status de integração RD CRM
  useEffect(() => {
    fetch(`/api/settings/rd-crm?tenantId=${tenant}`)
      .then((r) => r.json())
      .then((data) => setRdCrmConfigured(data.configured ?? false))
      .catch(() => setRdCrmConfigured(false));
  }, [tenant]);

  const handleReportSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenant,
          ...reportForm,
        }),
      });
      if (res.ok) {
        setIsReportSaved(true);
        setTimeout(() => setIsReportSaved(false), 3000);
      }
    } catch (e) {
      console.error("Erro ao salvar relatórios:", e);
    }
  };

  // Estado do Canal WhatsApp Unificado (Meta / Baileys)
  const [whatsappChannel, setWhatsappChannel] = useState<{
    activeProvider: "baileys" | "meta";
    connectionStatus: string;
    connectionVersion: number;
    livePhone: string;
    metaBusinessAccountId: string;
    metaPhoneNumberId: string;
    metaVerifyToken: string;
    metaAccessToken: string;
    metaAppSecret: string;
    hasMetaAccessToken: boolean;
    hasMetaAppSecret: boolean;
    metaWebhookLastSeenAt: string | null;
  }>({
    activeProvider: "baileys",
    connectionStatus: "disconnected",
    connectionVersion: 1,
    livePhone: "",
    metaBusinessAccountId: "",
    metaPhoneNumberId: "",
    metaVerifyToken: "",
    metaAccessToken: "",
    metaAppSecret: "",
    hasMetaAccessToken: false,
    hasMetaAppSecret: false,
    metaWebhookLastSeenAt: null,
  });

  const [loadingChannel, setLoadingChannel] = useState(false);
  const [switchingProvider, setSwitchingProvider] = useState(false);
  const [showMetaConfiguration, setShowMetaConfiguration] = useState(false);
  const [testingMeta, setTestingMeta] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [savingChannel, setSavingChannel] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [metaUsage, setMetaUsage] = useState<{
    delivered: number; serviceFree: number; serviceBillable: number; serviceUnclassified: number; otherCategories: number;
  } | null>(null);

  useEffect(() => {
    if (whatsappChannel.activeProvider !== "meta") { setMetaUsage(null); return; }
    fetch(`${BACKEND_URL}/api/settings/whatsapp/usage`, { credentials: "include" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => setMetaUsage(data))
      .catch(() => setMetaUsage(null));
  }, [tenant, whatsappChannel.activeProvider]);

  // Estados do Diagnóstico de Envio
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste de conexão e entrega operacional! Sistema multitenant ativo.");
  const [testStatus, setTestStatus] = useState<{ type: "success" | "error" | "idle" | "sending"; message: string }>({
    type: "idle",
    message: "",
  });

  const loadWhatsAppConfig = async () => {
    try {
      setLoadingChannel(true);
      const res = await fetch(`${BACKEND_URL}/api/settings/whatsapp?tenantId=${tenant}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setWhatsappChannel((prev) => ({
          ...prev,
          activeProvider: data.activeProvider || "baileys",
          connectionStatus: data.connectionStatus || "disconnected",
          connectionVersion: data.connectionVersion || 1,
          livePhone: data.livePhone || data.baileysPairedPhone || "",
          metaBusinessAccountId: data.metaBusinessAccountId || "",
          metaPhoneNumberId: data.metaPhoneNumberId || "",
          metaVerifyToken: data.metaVerifyToken || "",
          hasMetaAccessToken: !!data.hasMetaAccessToken,
          hasMetaAppSecret: !!data.hasMetaAppSecret,
          metaWebhookLastSeenAt: data.metaWebhookLastSeenAt || null,
        }));
      }
    } catch (e) {
      console.error("Erro ao carregar canal do WhatsApp:", e);
    } finally {
      setLoadingChannel(false);
    }
  };

  useEffect(() => {
    loadWhatsAppConfig();
  }, [tenant]);

  const handleSwitchProvider = async (targetProvider: "baileys" | "meta") => {
    if (switchingProvider) return;
    setSwitchingProvider(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/whatsapp/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "switch_provider",
          provider: targetProvider,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWhatsappChannel((prev) => ({
          ...prev,
          activeProvider: targetProvider,
          connectionVersion: data.connectionVersion,
          connectionStatus: data.connectionStatus,
        }));
        if (targetProvider === "baileys") {
          connectBaileys(true);
        }
      } else {
        toast.error(data.error || "Falha ao alternar o provedor.");
      }
    } catch (e) {
      console.error("Erro ao alternar provedor:", e);
      toast.error("Falha de rede ao alternar o provedor.");
    } finally {
      setSwitchingProvider(false);
    }
  };

  const handleSaveMetaCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingChannel(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/whatsapp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          metaBusinessAccountId: whatsappChannel.metaBusinessAccountId,
          metaPhoneNumberId: whatsappChannel.metaPhoneNumberId,
          metaVerifyToken: whatsappChannel.metaVerifyToken,
          ...(whatsappChannel.metaAccessToken ? { metaAccessToken: whatsappChannel.metaAccessToken } : {}),
          ...(whatsappChannel.metaAppSecret ? { metaAppSecret: whatsappChannel.metaAppSecret } : {}),
        }),
      });
      if (res.ok) {
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 3000);
        await loadWhatsAppConfig();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Falha ao salvar credenciais Meta.");
      }
    } catch (e) {
      console.error("Erro ao salvar credenciais Meta:", e);
    } finally {
      setSavingChannel(false);
    }
  };

  const handleTestMetaCredentials = async () => {
    setTestingMeta(true);
    setMetaTestResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/settings/whatsapp/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "test_credentials",
          customConfig: {
            metaPhoneNumberId: whatsappChannel.metaPhoneNumberId,
            metaAccessToken: whatsappChannel.metaAccessToken || undefined,
          },
        }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setMetaTestResult({
          success: true,
          message: `Credenciais válidas para ${data.details?.phoneNumber || "o número configurado"} (${data.details?.verifiedName || "Meta Cloud"}). Confirme o recebimento do webhook antes de ativar.`,
        });
      } else {
        setMetaTestResult({
          success: false,
          message: data.message || data.error || "Falha ao validar credenciais na Meta Graph API.",
        });
      }
    } catch (e: any) {
      setMetaTestResult({ success: false, message: e.message || "Erro de rede ao validar na Meta." });
    } finally {
      setTestingMeta(false);
    }
  };

  const handleTestSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone) {
      setTestStatus({ type: "error", message: "Por favor, informe o número de telefone de destino com DDD." });
      return;
    }

    setTestStatus({ type: "sending", message: "Disparando mensagem pelo provedor ativo..." });

    try {
      const response = await fetch(`${BACKEND_URL}/api/settings/whatsapp/test-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phone: testPhone.replace(/\D/g, ""),
          text: testMessage,
          clientMessageId: `test-send-${Date.now()}`,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setTestStatus({
          type: "success",
          message: `Mensagem aceita com sucesso pelo provedor '${(data.provider || whatsappChannel.activeProvider).toUpperCase()}' (ID: ${data.messageId || "OK"}). Verifique o aparelho do destinatário!`,
        });
      } else {
        throw new Error(data.error || "O servidor não pôde concluir o envio.");
      }
    } catch (err: any) {
      console.error("Erro no envio de teste:", err);
      setTestStatus({
        type: "error",
        message: err.message || "Erro desconhecido. Verifique se o provedor está conectado.",
      });
    }
  };

  const renderRdCrmCard = () => (
    <div className="rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Link className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Integração RD Station CRM</h3>
            <p className="text-xs text-muted-foreground">Sincronize contatos, deals e tarefas do CRM automaticamente com o Valem Chat.</p>
          </div>
        </div>
        <div>
          {rdCrmConfigured === null ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted px-3 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Verificando...
            </span>
          ) : rdCrmConfigured ? (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5" /> Pendente
            </span>
          )}
        </div>
      </div>

      {!rdCrmConfigured && (
        <div className="space-y-4 pt-2">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Clique abaixo para autorizar o acesso do Valem Chat à sua conta do RD Station CRM. Você será redirecionado para o portal de login oficial da RD Station.
          </p>
          <button
            onClick={async () => {
              setRdCrmConnecting(true);
              try {
                const clientId = "1f1aaf46-1ee3-423e-97cc-9f71409b77d6";
                const redirectUri = encodeURIComponent(`${window.location.origin}/api/settings/rd-crm/callback`);
                const authUrl = `https://accounts.rdstation.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${tenant}`;
                window.location.href = authUrl;
              } catch {
                setRdCrmConnecting(false);
              }
            }}
            disabled={rdCrmConnecting}
            className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold transition hover:opacity-90 disabled:opacity-60 cursor-pointer shadow-soft"
          >
            {rdCrmConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Conectar com a RD Station CRM
          </button>
        </div>
      )}

      {rdCrmConfigured && (
        <div className="rounded-xl bg-muted/40 border border-border p-4 space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Sincronização Ativa com o RD Station CRM
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            As conversas em triagem, alocações de responsáveis e tarefas agendadas são sincronizadas em tempo real. Os tokens de acesso são renovados automaticamente.
          </p>
        </div>
      )}
    </div>
  );

  const { canAccessSettingsTab } = usePermissions();

  const allTabs = [
    { id: "whatsapp" as const, label: "WhatsApp (Meta / Baileys)", icon: Smartphone },
    { id: "voz" as const, label: `Voz & Telefonia (${aiPersona.name})`, icon: PhoneCall },
    { id: "rd" as const, label: "RD Station CRM", icon: Link },
    { id: "crm" as const, label: "Configurações do CRM", icon: FileText },
    { id: "email" as const, label: "E-mail & Automações", icon: Mail },
    { id: "livechat" as const, label: "Live Chat (Site)", icon: Globe },
  ];

  const allowedTabs = allTabs.filter(t => canAccessSettingsTab(t.id));

  useEffect(() => {
    if (!allowedTabs.some(t => t.id === activeTab)) {
      if (allowedTabs.length > 0) {
        setActiveTab(allowedTabs[0].id);
      }
    }
  }, [allowedTabs, activeTab]);

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-card border border-border shadow-soft overflow-hidden">
      {/* Header com Nome e Descrição */}
      <header className="px-8 pt-8 pb-4 shrink-0 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Configurações do Sistema
            </span>
            <h2 className="text-2xl font-extrabold text-foreground mt-1">
              Central de Integrações e Parâmetros
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Gerencie conexões de mensagens, voz IA, integrações de CRM e automações de relatórios executivos do tenant <span className="font-bold text-foreground uppercase">{tenant}</span>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-primary/10 text-primary text-xs font-bold">
              <Sparkles className="h-3.5 w-3.5" />
              Tenant {tenant === "valem" ? "Valem" : "Tecfag"}
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-6 overflow-x-auto scrollbar-none pb-1">
          {allowedTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as SettingsTab)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-soft"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-8 bg-background/50 space-y-6">
        {/* ABA 1: WHATSAPP MULTI-TENANT (META OU BAILEYS) */}
        {activeTab === "whatsapp" && (
          <div className="space-y-6 w-full">
            {/* 1. SELETOR DE PROVEDOR ATIVO */}
            <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                      Provedor WhatsApp Ativo ({tenant === "valem" ? "Valem" : "Tecfag"})
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted font-mono text-muted-foreground">
                      v{whatsappChannel.connectionVersion}
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-foreground mt-0.5">
                    {whatsappChannel.activeProvider === "meta"
                      ? "Meta WhatsApp Cloud API Oficial"
                      : "Baileys — Conexão via WhatsApp Web"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Cada empresa pode operar de forma independente com a API Oficial da Meta ou via QR Code (Baileys).
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {whatsappChannel.activeProvider === "meta" ? (
                    whatsappChannel.connectionStatus === "connected" && !!whatsappChannel.metaWebhookLastSeenAt ? (
                      <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        Meta WhatsApp API (Conectado)
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3.5 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        Configuração incompleta
                      </div>
                    )
                  ) : (
                    <div className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold border ${
                      baileysConfig.status === "connected"
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        : baileysConfig.status === "qr_ready"
                        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                        : "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
                    }`}>
                      <span className={`h-2 w-2 rounded-full ${baileysConfig.status === "connected" ? "bg-emerald-500 animate-pulse" : baileysConfig.status === "qr_ready" ? "bg-amber-500 animate-pulse" : "bg-red-500"}`} />
                      {baileysConfig.status === "connected" ? "Baileys Conectado" : baileysConfig.status === "qr_ready" ? "Aguardando QR" : "Baileys Desconectado"}
                    </div>
                  )}
                </div>
              </div>

              {/* Botões de Alternância de Provedor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => handleSwitchProvider("meta")}
                  disabled={switchingProvider || whatsappChannel.activeProvider === "meta"}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    whatsappChannel.activeProvider === "meta"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-soft"
                      : "border-border bg-muted/20 hover:bg-muted/40 hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${whatsappChannel.activeProvider === "meta" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        <Shield className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-bold text-foreground">Meta Cloud API (Oficial)</span>
                    </div>
                    {whatsappChannel.activeProvider === "meta" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-md">
                        Em Uso
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                    Graph API oficial v21.0 da Meta, templates aprovados, alta taxa de entrega e webhook HMAC SHA-256 verificado.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchProvider("baileys")}
                  disabled={switchingProvider || whatsappChannel.activeProvider === "baileys"}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    whatsappChannel.activeProvider === "baileys"
                      ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-soft"
                      : "border-border bg-muted/20 hover:bg-muted/40 hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${whatsappChannel.activeProvider === "baileys" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        <Smartphone className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-bold text-foreground">Baileys (WhatsApp Web)</span>
                    </div>
                    {whatsappChannel.activeProvider === "baileys" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary px-2 py-0.5 rounded-md">
                        Em Uso
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                    Conexão em tempo real via QR Code. Não requer verificação de empresa na Meta, sem custos por mensagem de template.
                  </p>
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowMetaConfiguration((open) => !open)}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground"
              >
                {showMetaConfiguration ? "Ocultar configuração Meta" : "Configurar Meta antes da ativação"}
              </button>
            </div>

            {/* 2. CONTEÚDO ESPECÍFICO DO PROVEDOR ATIVO */}
            {(whatsappChannel.activeProvider === "meta" || showMetaConfiguration) ? (
              /* PAINEL META OFICIAL */
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <form onSubmit={handleSaveMetaCredentials} className="lg:col-span-2 rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
                  <div className="flex items-center justify-between border-b border-border pb-3">
                    <div className="flex items-center gap-2">
                      <Key className="h-4 w-4 text-primary" />
                      <h4 className="font-bold text-foreground text-sm">Credenciais Meta Cloud API</h4>
                    </div>
                    <button
                      type="button"
                      onClick={handleTestMetaCredentials}
                      disabled={testingMeta}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 transition cursor-pointer border border-border"
                    >
                      {testingMeta ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Testar Conexão Meta
                    </button>
                  </div>

                  {metaTestResult && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      metaTestResult.success
                        ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold"
                        : "bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 font-semibold"
                    }`}>
                      {metaTestResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                      <span>{metaTestResult.message}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground/80">Meta Business Account ID</label>
                      <input
                        type="text"
                        placeholder="Ex: 104829104859201"
                        value={whatsappChannel.metaBusinessAccountId}
                        onChange={(e) => setWhatsappChannel({ ...whatsappChannel, metaBusinessAccountId: e.target.value })}
                        className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground/80">WhatsApp Phone Number ID</label>
                      <input
                        type="text"
                        placeholder="Ex: 102948571029384"
                        value={whatsappChannel.metaPhoneNumberId}
                        onChange={(e) => setWhatsappChannel({ ...whatsappChannel, metaPhoneNumberId: e.target.value })}
                        className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground/80">System User Access Token (Permanente)</label>
                      {whatsappChannel.hasMetaAccessToken && (
                        <span className="text-[10px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          <span>Token configurado</span>
                        </span>
                      )}
                    </div>
                    <textarea
                      rows={2}
                      placeholder={whatsappChannel.hasMetaAccessToken ? "Token já configurado no banco. Digite um novo valor se desejar alterar." : "EAAG..."}
                      value={whatsappChannel.metaAccessToken}
                      onChange={(e) => setWhatsappChannel({ ...whatsappChannel, metaAccessToken: e.target.value })}
                      className="w-full rounded-xl bg-muted p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-foreground/80">Meta App Secret (HMAC SHA-256)</label>
                        {whatsappChannel.hasMetaAppSecret && (
                          <span className="text-[10px] text-emerald-600 font-semibold inline-flex items-center gap-1">
                            <Check className="h-3 w-3" />
                            <span>Secret salvo</span>
                          </span>
                        )}
                      </div>
                      <input
                        type="password"
                        placeholder={whatsappChannel.hasMetaAppSecret ? "••••••••••••••••" : "App Secret"}
                        value={whatsappChannel.metaAppSecret}
                        onChange={(e) => setWhatsappChannel({ ...whatsappChannel, metaAppSecret: e.target.value })}
                        className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-foreground/80">Webhook Verify Token</label>
                      <input
                        type="text"
                        value={whatsappChannel.metaVerifyToken}
                        onChange={(e) => setWhatsappChannel({ ...whatsappChannel, metaVerifyToken: e.target.value })}
                        className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <span className="text-[11px] text-muted-foreground">
                      Tokens são armazenados de forma isolada para este inquilino ({tenant}).
                    </span>
                    <button
                      type="submit"
                      disabled={savingChannel}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer shadow-soft"
                    >
                      {savingChannel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isSaved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                      {isSaved ? "Salvo com Sucesso!" : "Salvar Configurações"}
                    </button>
                  </div>
                </form>

                {/* Box de Webhook */}
                <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
                  <div className="flex items-center gap-2">
                    <Link className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-foreground text-sm">Webhook Meta Developer</h4>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Configure este endpoint no Meta App Dashboard para receber mensagens recebidas e atualizações de entrega.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Último webhook assinado recebido: {whatsappChannel.metaWebhookLastSeenAt
                      ? new Date(whatsappChannel.metaWebhookLastSeenAt).toLocaleString("pt-BR")
                      : "nenhum confirmado"}
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-muted-foreground">URL de Callback (Webhook)</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/meta` : "/api/webhooks/meta"}
                        className="h-8 flex-1 rounded-lg bg-muted px-2.5 text-[11px] font-mono text-foreground border border-border"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== "undefined") {
                            navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/meta`);
                            setCopiedWebhook(true);
                            setTimeout(() => setCopiedWebhook(false), 2000);
                          }
                        }}
                        className="h-8 px-2.5 rounded-lg bg-muted border border-border text-xs font-semibold hover:bg-muted/80 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedWebhook ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-muted/40 p-3 space-y-2 border border-border text-xs">
                    <div className="font-semibold text-foreground text-[11px]">Campos a assinar no Webhook:</div>
                    <ul className="list-disc list-inside text-muted-foreground text-[11px] space-y-1">
                      <li><code>messages</code> (Mensagens recebidas e status)</li>
                      <li>Token de Verificação: <code className="text-primary font-bold">{whatsappChannel.metaVerifyToken}</code></li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              /* PAINEL BAILEYS */
              <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-foreground text-sm">Pareamento WhatsApp Web (Baileys)</h4>
                      <p className="text-xs text-muted-foreground">Conecte o aparelho oficial do inquilino via leitura de QR Code</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {baileysConfig.status === "connected" ? (
                      <button
                        onClick={disconnectBaileys}
                        className="h-9 px-4 rounded-xl border border-red-500/20 bg-red-500/10 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 transition cursor-pointer"
                      >
                        Desconectar Dispositivo
                      </button>
                    ) : (
                      <button
                        onClick={() => connectBaileys(true)}
                        className="h-9 px-4 rounded-xl bg-primary text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft flex items-center gap-1.5"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Gerar Novo QR Code
                      </button>
                    )}
                  </div>
                </div>

                {baileysConfig.status === "connected" ? (
                  <div className="flex flex-col items-center justify-center text-center py-6">
                    <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-500 mb-3">
                      <Check className="h-7 w-7" strokeWidth={2.5} />
                    </div>
                    <h4 className="text-base font-extrabold text-foreground">Sessão Ativa com Sucesso</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      O canal Baileys está emparelhado e ativo respondendo mensagens do número:
                    </p>
                    <span className="text-base font-bold text-primary mt-2 font-mono">{baileysConfig.pairedPhone || "WhatsApp Conectado"}</span>
                  </div>
                ) : baileysConfig.status === "connecting" ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <RefreshCw className="h-10 w-10 animate-spin text-primary mb-3" />
                    <h4 className="text-sm font-bold text-foreground">Solicitando nova sessão ao servidor...</h4>
                    <p className="text-xs text-muted-foreground mt-1">Isso pode levar alguns segundos</p>
                  </div>
                ) : baileysConfig.status === "qr_ready" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center py-2">
                    <div className="flex flex-col items-center justify-center bg-muted/40 p-6 rounded-2xl border border-border">
                      <div className="bg-white p-4 rounded-xl shadow-soft">
                        {baileysConfig.qrCodeUrl ? (
                          <img src={baileysConfig.qrCodeUrl} alt="WhatsApp Web QR Code" className="h-44 w-44 object-contain" />
                        ) : (
                          <div className="h-44 w-44 flex items-center justify-center bg-gray-100 rounded-lg">
                            <QrCode className="h-12 w-12 text-muted-foreground animate-pulse" />
                          </div>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1.5">
                        <RefreshCw className="h-3 w-3 animate-spin" /> O código atualiza a cada 30 segundos.
                      </span>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-foreground">Instruções para Conectar:</h4>
                      <ol className="list-decimal list-inside space-y-2 text-xs text-muted-foreground leading-relaxed">
                        <li>Abra o aplicativo <strong className="text-foreground">WhatsApp</strong> no celular.</li>
                        <li>Toque no menu (3 pontinhos ou Ajustes) → <strong className="text-foreground">Aparelhos Conectados</strong>.</li>
                        <li>Toque no botão <strong className="text-foreground">Conectar um aparelho</strong>.</li>
                        <li>Aponte a câmera do celular para o QR Code exibido ao lado.</li>
                      </ol>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-6">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground mb-3">
                      <Smartphone className="h-6 w-6" />
                    </div>
                    <h4 className="text-sm font-bold text-foreground">Nenhuma Sessão Ativa</h4>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                      Clique em &quot;Gerar Novo QR Code&quot; para iniciar o pareamento do WhatsApp Web neste tenant.
                    </p>
                  </div>
                )}
              </div>
            )}

            {whatsappChannel.activeProvider === "meta" && (
              <div className="rounded-2xl border border-border bg-card p-6 text-xs space-y-2">
                <h4 className="text-sm font-bold">Mensagens Meta entregues neste mês</h4>
                {metaUsage ? (
                  <div className="flex flex-wrap gap-4">
                    <span>Total: <strong>{metaUsage.delivered}</strong></span>
                    <span>Serviço gratuito informado pela Meta: <strong>{metaUsage.serviceFree}</strong></span>
                    <span>Serviço cobrável informado pela Meta: <strong>{metaUsage.serviceBillable}</strong></span>
                    <span>Sem classificação: <strong>{metaUsage.serviceUnclassified}</strong></span>
                    <span>Outras categorias: <strong>{metaUsage.otherCategories}</strong></span>
                  </div>
                ) : <p>Carregando classificação de entrega...</p>}
                <p className="text-muted-foreground">Contagem indicativa por mês UTC. Confira valores e franquia no faturamento da Meta; o aceite de envio não comprova entrega nem cobrança.</p>
              </div>
            )}

            {/* 3. DIAGNÓSTICO E DISPARO DE TESTE UNIVERSAL */}
            <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-3">
                <Send className="h-4 w-4 text-primary" />
                <h4 className="font-bold text-foreground text-sm">
                  Diagnóstico de Envio — Teste de Disparo ({whatsappChannel.activeProvider.toUpperCase()})
                </h4>
              </div>
              <p className="text-xs text-muted-foreground">
                Envie para um contato de teste que já tenha uma conversa neste tenant. O teste usa o canal ativo{whatsappChannel.activeProvider === "meta" ? " e respeita a janela de 24 horas" : ""}; confira a entrega no aparelho e no histórico.
              </p>

              <form onSubmit={handleTestSend} className="space-y-4 w-full max-w-2xl">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground/80 block">Telefone de Destino (DDI + DDD + Número)</label>
                  <input
                    type="text"
                    placeholder="Ex: 5511999990000"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="h-9 w-full rounded-xl bg-muted px-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-foreground/80 block">Mensagem de Teste</label>
                  <textarea
                    rows={2}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    className="w-full rounded-xl bg-muted p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={testStatus.type === "sending"}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-soft"
                >
                  {testStatus.type === "sending" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Disparando Mensagem...
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Disparar Mensagem de Teste
                    </>
                  )}
                </button>
              </form>

              {testStatus.type !== "idle" && (
                <div className="pt-2">
                  {testStatus.type === "success" && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>{testStatus.message}</div>
                    </div>
                  )}
                  {testStatus.type === "error" && (
                    <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs font-semibold text-red-600 dark:text-red-400 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>{testStatus.message}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA 2: VOZ / LIGAÇÕES (VALENTINA) */}
        {activeTab === "voz" && (
          <div className="space-y-6">
            <VoiceConfigTab />
          </div>
        )}

        {/* ABA 3: RD STATION CRM */}
        {activeTab === "rd" && (
          <div className="w-full space-y-6">
            {renderRdCrmCard()}
          </div>
        )}

        {activeTab === "crm" && (
          <div className="grid w-full gap-5 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Funis e etapas</h3>
                <p className="mt-2 text-xs text-muted-foreground">Organize os funis comerciais, suas etapas e regras de movimentação das negociações.</p>
              </div>
              <button
                type="button"
                onClick={() => setPipelineSettingsOpen(true)}
                className="mt-5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer self-start shadow-soft"
              >
                Gerenciar funis e etapas
              </button>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Campos de cadastro do CRM</h3>
                <p className="mt-2 text-xs text-muted-foreground">Organize os campos de negociações, empresas, contatos e produtos. Administradores podem criar, editar e arquivar campos.</p>
              </div>
              <button
                type="button"
                onClick={() => setCustomFieldsOpen(true)}
                className="mt-5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer self-start shadow-soft"
              >
                Configurar campos de cadastro
              </button>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Segmentos</h3>
                <p className="mt-2 text-xs text-muted-foreground">Organize os segmentos das empresas para filtrar e organizar sua carteira de clientes.</p>
              </div>
              <button
                type="button"
                onClick={() => setSegmentsOpen(true)}
                className="mt-5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer self-start shadow-soft"
              >
                Configurar segmentos
              </button>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Fontes e campanhas</h3>
                <p className="mt-2 text-xs text-muted-foreground">Padronize a origem e as campanhas de marketing das negociações.</p>
              </div>
              <button
                type="button"
                onClick={() => setSourcesCampaignsOpen(true)}
                className="mt-5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer self-start shadow-soft"
              >
                Configurar fontes e campanhas
              </button>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col justify-between">
              <div>
                <h3 className="text-base font-bold text-foreground">Motivos de perda</h3>
                <p className="mt-2 text-xs text-muted-foreground">Configure e padronize os motivos usados no encerramento de negociações perdidas.</p>
              </div>
              <button
                type="button"
                onClick={() => setLossReasonsOpen(true)}
                className="mt-5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer self-start shadow-soft"
              >
                Configurar motivos de perda
              </button>
            </div>
            {sessionRole === "admin" && (
              <div className="rounded-2xl border border-border bg-card p-6 shadow-soft flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground">Histórico de ações</h3>
                  <p className="mt-2 text-xs text-muted-foreground">Consulte quem excluiu registros, realizou ações em massa ou exportou relatórios.</p>
                </div>
                <button type="button" onClick={() => setActionHistoryOpen(true)} className="mt-5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer self-start shadow-soft">
                  Ver histórico
                </button>
              </div>
            )}
          </div>
        )}

        {/* ABA 4: E-MAIL & AUTOMATION (PREFERÊNCIAS DE ENVIO REDESENHADAS) */}
        {activeTab === "email" && (
          <div className="space-y-6 w-full">
            <form onSubmit={handleReportSave} className="space-y-6">
              {/* Header do Módulo de Automação */}
              <div className="rounded-2xl bg-card border border-border p-6 shadow-soft flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Automações e Relatórios Executivos
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure os disparos agendados de relatórios gerados pela Inteligência Artificial.
                  </p>
                </div>

                <button
                  type="submit"
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:opacity-90 text-primary-foreground rounded-xl text-xs font-bold shadow-soft transition cursor-pointer"
                >
                  {isReportSaved ? <Check className="h-4 w-4 text-emerald-300" /> : <Save className="h-4 w-4" />}
                  {isReportSaved ? "Salvo com sucesso!" : "Salvar Configurações"}
                </button>
              </div>

              {/* Redesign Premium das Preferências de Envio */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <Bell className="h-4 w-4 text-primary" />
                    Preferências de Envio por Canal & Frequência
                  </h4>
                  <span className="text-[11px] text-muted-foreground">Disparos automáticos às 18h00</span>
                </div>

                {/* Grid de 4 Cards Elegantes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card 1: Diário WhatsApp */}
                  <div className={`rounded-2xl border p-5 transition-all shadow-soft flex items-center justify-between ${
                    reportForm.reportDailyWhatsapp 
                      ? "bg-primary/5 border-primary/30" 
                      : "bg-card border-border hover:border-border/80"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className={`p-2.5 rounded-xl transition-colors mt-0.5 ${
                        reportForm.reportDailyWhatsapp
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/60 text-muted-foreground"
                      }`}>
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Diário via WhatsApp</h5>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                            reportForm.reportDailyWhatsapp
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground border-border/60"
                          }`}>
                            Diário • 18h
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          Resumo consolidado de KPIs do dia entregue no WhatsApp dos gestores.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setReportForm({ ...reportForm, reportDailyWhatsapp: !reportForm.reportDailyWhatsapp })}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ml-4 ${
                        reportForm.reportDailyWhatsapp ? "bg-primary" : "bg-muted border border-border"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${
                        reportForm.reportDailyWhatsapp ? "translate-x-6" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  {/* Card 2: Diário E-mail */}
                  <div className={`rounded-2xl border p-5 transition-all shadow-soft flex items-center justify-between ${
                    reportForm.reportDailyEmail 
                      ? "bg-primary/5 border-primary/30" 
                      : "bg-card border-border hover:border-border/80"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className={`p-2.5 rounded-xl transition-colors mt-0.5 ${
                        reportForm.reportDailyEmail
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/60 text-muted-foreground"
                      }`}>
                        <Mail className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Diário via E-mail</h5>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                            reportForm.reportDailyEmail
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground border-border/60"
                          }`}>
                            Diário • 18h
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          Relatório HTML executivo completo enviado ao final de cada expediente.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setReportForm({ ...reportForm, reportDailyEmail: !reportForm.reportDailyEmail })}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ml-4 ${
                        reportForm.reportDailyEmail ? "bg-primary" : "bg-muted border border-border"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${
                        reportForm.reportDailyEmail ? "translate-x-6" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  {/* Card 3: Semanal WhatsApp */}
                  <div className={`rounded-2xl border p-5 transition-all shadow-soft flex items-center justify-between ${
                    reportForm.reportWeeklyWhatsapp 
                      ? "bg-primary/5 border-primary/30" 
                      : "bg-card border-border hover:border-border/80"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className={`p-2.5 rounded-xl transition-colors mt-0.5 ${
                        reportForm.reportWeeklyWhatsapp
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/60 text-muted-foreground"
                      }`}>
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Semanal via WhatsApp</h5>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                            reportForm.reportWeeklyWhatsapp
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground border-border/60"
                          }`}>
                            Sexta • 18h
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          Análise comparativa da semana com métricas de equipe e SLA.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setReportForm({ ...reportForm, reportWeeklyWhatsapp: !reportForm.reportWeeklyWhatsapp })}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ml-4 ${
                        reportForm.reportWeeklyWhatsapp ? "bg-primary" : "bg-muted border border-border"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${
                        reportForm.reportWeeklyWhatsapp ? "translate-x-6" : "translate-x-0"
                      }`} />
                    </button>
                  </div>

                  {/* Card 4: Semanal E-mail */}
                  <div className={`rounded-2xl border p-5 transition-all shadow-soft flex items-center justify-between ${
                    reportForm.reportWeeklyEmail 
                      ? "bg-primary/5 border-primary/30" 
                      : "bg-card border-border hover:border-border/80"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className={`p-2.5 rounded-xl transition-colors mt-0.5 ${
                        reportForm.reportWeeklyEmail
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/60 text-muted-foreground"
                      }`}>
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Semanal via E-mail</h5>
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                            reportForm.reportWeeklyEmail
                              ? "bg-primary/10 text-primary border-primary/20"
                              : "bg-muted text-muted-foreground border-border/60"
                          }`}>
                            Sexta • 18h
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                          Consolidado semanal completo com gráficos e recomendações da IA.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setReportForm({ ...reportForm, reportWeeklyEmail: !reportForm.reportWeeklyEmail })}
                      className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ml-4 ${
                        reportForm.reportWeeklyEmail ? "bg-primary" : "bg-muted border border-border"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${
                        reportForm.reportWeeklyEmail ? "translate-x-6" : "translate-x-0"
                      }`} />
                    </button>
                  </div>
                </div>

                {/* Card 5: Gate de Aprovação Obrigatória */}
                <div className={`rounded-2xl border p-5 transition-all shadow-soft flex items-center justify-between col-span-full mt-2 ${
                  reportForm.reportRequiresApproval
                    ? "bg-primary/5 border-primary/30"
                    : "bg-card border-border hover:border-border/80"
                }`}>
                  <div className="flex items-start gap-3.5">
                    <div className={`p-2.5 rounded-xl transition-colors mt-0.5 ${
                      reportForm.reportRequiresApproval
                        ? "bg-primary/10 text-primary"
                        : "bg-muted/60 text-muted-foreground"
                    }`}>
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="text-xs font-extrabold text-foreground">Exigir aprovação antes de enviar</h5>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                          reportForm.reportRequiresApproval
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "bg-muted text-muted-foreground border-border/60"
                        }`}>
                          Aprovação Humana
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed max-w-xl">
                        Quando ativo, o cron das 18h apenas gera o rascunho — <strong>não envia automaticamente</strong>.
                        O relatório fica aguardando aprovação no painel antes do disparo para WhatsApp e E-mail.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setReportForm({ ...reportForm, reportRequiresApproval: !reportForm.reportRequiresApproval })}
                    className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ml-4 ${
                      reportForm.reportRequiresApproval ? "bg-primary" : "bg-muted border border-border"
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform duration-200 ease-in-out ${
                      reportForm.reportRequiresApproval ? "translate-x-6" : "translate-x-0"
                    }`} />
                  </button>
                </div>
              </div>


              {/* Destinatários Configurados */}
              <div className="rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
                  Destinatários dos Relatórios Executivos
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      Números de WhatsApp (DDI + DDD + Número)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 5514981468232, 5581999998888"
                      value={reportForm.reportWhatsappNumbers}
                      onChange={(e) => setReportForm({ ...reportForm, reportWhatsappNumbers: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Separe múltiplos números por vírgula.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      Endereços de E-mail de Destino
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: gestao@valem.com.br, diretoria@valem.com.br"
                      value={reportForm.reportEmailAddresses}
                      onChange={(e) => setReportForm({ ...reportForm, reportEmailAddresses: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                    <p className="text-[10px] text-muted-foreground">Separe múltiplos e-mails por vírgula.</p>
                  </div>
                </div>
              </div>

              {/* Servidor SMTP */}
              <div className="rounded-2xl bg-card border border-border p-6 shadow-soft space-y-4">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                  <Mail className="h-4 w-4 text-primary" />
                  Configuração de Servidor SMTP (E-mail)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Servidor SMTP Host</label>
                    <input
                      type="text"
                      placeholder="Ex: smtp.sendgrid.net"
                      value={reportForm.smtpHost}
                      onChange={(e) => setReportForm({ ...reportForm, smtpHost: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Porta</label>
                    <input
                      type="text"
                      placeholder="Ex: 587"
                      value={reportForm.smtpPort}
                      onChange={(e) => setReportForm({ ...reportForm, smtpPort: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Usuário SMTP</label>
                    <input
                      type="text"
                      placeholder="Ex: apikey ou contato@valem.com.br"
                      value={reportForm.smtpUser}
                      onChange={(e) => setReportForm({ ...reportForm, smtpUser: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Senha SMTP</label>
                    <input
                      type="password"
                      placeholder="••••••••••••••••"
                      value={reportForm.smtpPass}
                      onChange={(e) => setReportForm({ ...reportForm, smtpPass: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Remetente (From Address)</label>
                  <input
                    type="text"
                    placeholder={`Ex: ${tenant === "tecfag" ? "Tecfag" : "Valem"} Chat <alertas@${tenant === "tecfag" ? "tecfag.com.br" : "valem.com.br"}>`}
                    value={reportForm.smtpFrom}
                    onChange={(e) => setReportForm({ ...reportForm, smtpFrom: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted/40 border border-border px-4 text-xs text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              {/* Botão de Salvar Rodapé */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  Configurações salvas são aplicadas automaticamente aos próximos disparos agendados.
                </div>

                <button
                  type="submit"
                  className="flex items-center gap-2 px-6 py-2.5 bg-primary hover:opacity-90 text-primary-foreground rounded-xl text-xs font-bold shadow-soft transition cursor-pointer"
                >
                  {isReportSaved ? <Check className="h-4 w-4 text-emerald-300" /> : <Save className="h-4 w-4" />}
                  {isReportSaved ? "Salvo com sucesso!" : "Salvar Todas as Automações"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ABA 5: LIVE CHAT */}
        {activeTab === "livechat" && <LiveChatSettingsTab />}
      </div>
      <CustomFieldsSettingsModal isOpen={customFieldsOpen} onClose={() => setCustomFieldsOpen(false)} />
      <CrmActionHistoryModal isOpen={actionHistoryOpen} onClose={() => setActionHistoryOpen(false)} />
      <PipelineSettingsModal isOpen={pipelineSettingsOpen} onClose={() => setPipelineSettingsOpen(false)} />
      <CrmCatalogSettingsModal
        isOpen={sourcesCampaignsOpen}
        scope="sources_campaigns"
        onClose={() => setSourcesCampaignsOpen(false)}
      />
      <CrmCatalogSettingsModal
        isOpen={lossReasonsOpen}
        scope="loss_reasons"
        onClose={() => setLossReasonsOpen(false)}
      />
      <CrmCatalogSettingsModal
        isOpen={segmentsOpen}
        scope="segments"
        onClose={() => setSegmentsOpen(false)}
      />
      {catalogKind && (
        <CrmCatalogSettingsModal
          isOpen
          initialKind={catalogKind}
          onClose={() => setCatalogKind(null)}
        />
      )}
    </section>
  );
}
