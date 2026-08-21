import React, { useState, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { 
  Check, RefreshCw, Key, Shield, Smartphone, QrCode, AlertCircle, Save, Mail, 
  FileText, Link, ExternalLink, CheckCircle2, Loader2, PhoneCall, Clock, 
  MessageSquare, ShieldAlert, Calendar, Sparkles, Send, Bell, Globe
} from "lucide-react";
import { ConfiguracaoTab as VoiceConfigTab } from "@/components/voice/ConfiguracaoTab";
import { LiveChatSettingsTab } from "./LiveChatSettingsTab";

type SettingsTab = "whatsapp" | "voz" | "rd" | "email" | "livechat";

export function SettingsView() {
  const {
    tenant,
    metaConfig,
    setMetaConfig,
    baileysConfig,
    disconnectBaileys,
    connectBaileys,
  } = useChat();

  const [activeTab, setActiveTab] = useState<SettingsTab>("whatsapp");

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

  // Estados do Diagnóstico de Envio
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState("Teste de conexão bem-sucedido! Valem Chat funcionando de forma perfeita.");
  const [testStatus, setTestStatus] = useState<{ type: "success" | "error" | "idle" | "sending"; message: string }>({
    type: "idle",
    message: "",
  });

  const handleMetaSave = (e: React.FormEvent) => {
    e.preventDefault();
    setMetaConfig({ ...metaForm, status: "connected" });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleTestSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone) {
      setTestStatus({ type: "error", message: "Por favor, informe o número de telefone de destino." });
      return;
    }

    setTestStatus({ type: "sending", message: "Enviando mensagem de teste..." });

    try {
      const response = await fetch(`${BACKEND_URL}/api/baileys/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: "valem",
          phone: testPhone.replace(/\D/g, ""), // Limpa caracteres
          text: testMessage,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setTestStatus({
          type: "success",
          message: "Mensagem de teste enviada com sucesso! Verifique o aparelho do destinatário.",
        });
      } else {
        throw new Error(data.error || "O servidor não pôde concluir o envio.");
      }
    } catch (err: any) {
      console.error("Erro no envio de teste:", err);
      setTestStatus({
        type: "error",
        message: err.message || "Erro desconhecido. Verifique se o WhatsApp está conectado de verdade.",
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

  const tabs = [
    { id: "whatsapp", label: tenant === "tecfag" ? "WhatsApp (Meta API)" : "WhatsApp (Baileys)", icon: Smartphone },
    { id: "voz", label: "Voz & Telefonia (Valentina)", icon: PhoneCall },
    { id: "rd", label: "RD Station CRM", icon: Link },
    { id: "email", label: "E-mail & Automações", icon: Mail },
    { id: "livechat", label: "Live Chat (Site)", icon: Globe },
  ];

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
          {tabs.map((tab) => {
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
        {/* ABA 1: WHATSAPP */}
        {activeTab === "whatsapp" && (
          <div className="space-y-6">
            {tenant === "tecfag" ? (
              /* META API CONFIGURATION */
              <div className="space-y-6 max-w-4xl">
                <div className="flex items-center justify-between rounded-2xl bg-card p-5 border border-border shadow-soft">
                  <div className="flex items-center gap-4">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Shield className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Status da Integração Meta</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">API Oficial do WhatsApp Cloud</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Conectado
                  </div>
                </div>

                <form onSubmit={handleMetaSave} className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
                  <div className="flex items-center gap-2 border-b border-border pb-3 mb-2">
                    <Key className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-foreground">Credenciais da API Meta Developer</h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground/80">Meta Business Account ID</label>
                      <input
                        type="text"
                        value={metaForm.businessAccountId}
                        onChange={(e) => setMetaForm({ ...metaForm, businessAccountId: e.target.value })}
                        className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground/80">WhatsApp Phone Number ID</label>
                      <input
                        type="text"
                        value={metaForm.phoneNumberId}
                        onChange={(e) => setMetaForm({ ...metaForm, phoneNumberId: e.target.value })}
                        className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground/80">Token de Acesso Permanente (System User Token)</label>
                    <textarea
                      rows={3}
                      value={metaForm.accessToken}
                      onChange={(e) => setMetaForm({ ...metaForm, accessToken: e.target.value })}
                      className="w-full rounded-xl bg-muted p-4 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground/80">Token de Verificação do Webhook (Webhook Verify Token)</label>
                    <input
                      type="text"
                      value={metaForm.webhookVerifyToken}
                      onChange={(e) => setMetaForm({ ...metaForm, webhookVerifyToken: e.target.value })}
                      className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <AlertCircle className="h-4 w-4" />
                      Mantenha esses dados seguros. Eles controlam o envio de templates oficiais.
                    </div>
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer shadow-soft"
                    >
                      {isSaved ? (
                        <>
                          <Check className="h-4 w-4" />
                          Salvo!
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Salvar Alterações Meta
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              /* BAILEYS CONNECTION GRID */
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <div className="space-y-6">
                  {/* Status Panel */}
                  <div className="flex items-center justify-between rounded-2xl bg-card p-5 border border-border shadow-soft">
                    <div className="flex items-center gap-4">
                      <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Smartphone className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground">Conexão Baileys (WhatsApp)</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Integração baseada em pareamento de QR Code</p>
                      </div>
                    </div>
                    
                    {baileysConfig.status === "connected" && (
                      <div className="flex items-center gap-2 rounded-full bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        Conectado
                      </div>
                    )}
                    {baileysConfig.status === "qr_ready" && (
                      <div className="flex items-center gap-2 rounded-full bg-amber-500/10 px-3.5 py-1 text-xs font-bold text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                        Aguardando Leitura
                      </div>
                    )}
                    {baileysConfig.status === "connecting" && (
                      <div className="flex items-center gap-2 rounded-full bg-blue-500/10 px-3.5 py-1 text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Iniciando...
                      </div>
                    )}
                    {baileysConfig.status === "disconnected" && (
                      <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-3.5 py-1 text-xs font-bold text-red-600 dark:text-red-400 border border-red-500/20">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        Desconectado
                      </div>
                    )}
                  </div>

                  {/* QR Connection Screen */}
                  <div className="rounded-2xl bg-card p-8 border border-border shadow-soft">
                    {baileysConfig.status === "connected" ? (
                      <div className="flex flex-col items-center justify-center text-center py-6">
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500/10 text-emerald-500 mb-4">
                          <Check className="h-8 w-8" strokeWidth={2.5} />
                        </div>
                        <h4 className="text-lg font-extrabold text-foreground">Sessão Ativa com Sucesso</h4>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                          O Valem Chat está emparelhado e ativo respondendo mensagens do número:
                        </p>
                        <span className="text-base font-bold text-primary mt-2">{baileysConfig.pairedPhone}</span>

                        <div className="mt-8 pt-6 border-t border-border w-full flex justify-center">
                          <button
                            onClick={disconnectBaileys}
                            className="h-10 rounded-xl border border-red-500/20 bg-red-500/10 px-6 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-500/20 transition cursor-pointer"
                          >
                            Desconectar Dispositivo
                          </button>
                        </div>
                      </div>
                    ) : baileysConfig.status === "connecting" ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <RefreshCw className="h-12 w-12 animate-spin text-primary mb-4" />
                        <h4 className="text-sm font-bold text-foreground">Solicitando nova sessão ao servidor...</h4>
                        <p className="text-xs text-muted-foreground mt-1">Isso pode levar alguns segundos</p>
                      </div>
                    ) : baileysConfig.status === "qr_ready" ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                        <div className="flex flex-col items-center justify-center bg-muted p-6 rounded-2xl border border-border">
                          <div className="bg-white p-4 rounded-xl shadow-soft">
                            {baileysConfig.qrCodeUrl ? (
                              <img src={baileysConfig.qrCodeUrl} alt="WhatsApp Web QR Code" className="h-44 w-44 object-contain" />
                            ) : (
                              <div className="h-44 w-44 flex items-center justify-center bg-gray-100 rounded-lg">
                                <QrCode className="h-12 w-12 text-muted-foreground animate-pulse" />
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5">
                            <RefreshCw className="h-3 w-3 animate-spin" /> O código atualiza a cada 30 segundos.
                          </span>
                        </div>

                        <div className="space-y-4">
                          <h4 className="text-base font-bold text-foreground">Instruções de conexão:</h4>
                          <ol className="list-decimal list-inside space-y-2 text-xs text-muted-foreground leading-relaxed">
                            <li>Abra o <strong className="text-foreground">WhatsApp</strong> no celular.</li>
                            <li>Acesse <strong className="text-foreground">Configurações → Aparelhos Conectados</strong>.</li>
                            <li>Toque em <strong className="text-foreground">Conectar um aparelho</strong>.</li>
                            <li>Aponte a câmera para ler o QR Code ao lado.</li>
                          </ol>

                          <div className="pt-4 flex gap-3">
                            <button
                              onClick={disconnectBaileys}
                              className="h-9 rounded-xl border border-border bg-card px-5 text-xs font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center py-8">
                        <div className="grid h-16 w-16 place-items-center rounded-full bg-red-500/10 text-red-500 mb-4">
                          <AlertCircle className="h-8 w-8" />
                        </div>
                        <h4 className="text-base font-bold text-foreground">Nenhuma Sessão de WhatsApp Ativa</h4>
                        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                          Para que o Valem Chat possa enviar e receber mensagens via Baileys, conecte uma linha do WhatsApp.
                        </p>
                        <button
                          onClick={() => connectBaileys(true)}
                          className="mt-6 h-10 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground hover:opacity-90 transition cursor-pointer shadow-soft"
                        >
                          Gerar QR Code de Conexão
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Diagnóstico de Envio */}
                <div className="space-y-6">
                  <div className="rounded-2xl bg-card p-6 border border-border shadow-soft flex flex-col justify-between min-h-[360px]">
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 border-b border-border pb-3 mb-2">
                        <Send className="h-4 w-4 text-primary" />
                        <h4 className="font-bold text-foreground">Diagnóstico de Envio (Teste de Disparo)</h4>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Envie uma mensagem instantânea de teste para qualquer número de sua preferência para validar o fluxo de envio e receber logs de execução.
                      </p>

                      <form onSubmit={handleTestSend} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-foreground/80 block">Número do Celular (DDI + DDD + Número)</label>
                          <input
                            type="text"
                            placeholder="Ex: 5514981468232"
                            value={testPhone}
                            onChange={(e) => setTestPhone(e.target.value)}
                            disabled={baileysConfig.status !== "connected"}
                            className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border disabled:opacity-50"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-foreground/80 block">Conteúdo da Mensagem</label>
                          <textarea
                            rows={3}
                            value={testMessage}
                            onChange={(e) => setTestMessage(e.target.value)}
                            disabled={baileysConfig.status !== "connected"}
                            className="w-full rounded-xl bg-muted p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-border resize-none disabled:opacity-50"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={baileysConfig.status !== "connected" || testStatus.type === "sending"}
                          className="w-full inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-soft active:scale-98"
                        >
                          {testStatus.type === "sending" ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              Disparando...
                            </>
                          ) : (
                            "Disparar Mensagem de Teste"
                          )}
                        </button>
                      </form>
                    </div>

                    {testStatus.type !== "idle" && (
                      <div className="mt-4 pt-4 border-t border-border">
                        {testStatus.type === "success" && (
                          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-start gap-2">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0 animate-pulse" />
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
              </div>
            )}
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
          <div className="max-w-4xl space-y-6">
            {renderRdCrmCard()}
          </div>
        )}

        {/* ABA 4: E-MAIL & AUTOMATION (PREFERÊNCIAS DE ENVIO REDESENHADAS) */}
        {activeTab === "email" && (
          <div className="space-y-6 max-w-5xl">
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
                      ? "bg-emerald-500/5 border-emerald-500/30 dark:bg-emerald-500/10" 
                      : "bg-card border-border"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mt-0.5">
                        <Smartphone className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Diário via WhatsApp</h5>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
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
                        reportForm.reportDailyWhatsapp ? "bg-emerald-500" : "bg-muted border border-border"
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
                      ? "bg-blue-500/5 border-blue-500/30 dark:bg-blue-500/10" 
                      : "bg-card border-border"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 mt-0.5">
                        <Mail className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Diário via E-mail</h5>
                          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-bold">
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
                        reportForm.reportDailyEmail ? "bg-blue-500" : "bg-muted border border-border"
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
                      ? "bg-purple-500/5 border-purple-500/30 dark:bg-purple-500/10" 
                      : "bg-card border-border"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 mt-0.5">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Semanal via WhatsApp</h5>
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[10px] font-bold">
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
                        reportForm.reportWeeklyWhatsapp ? "bg-purple-500" : "bg-muted border border-border"
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
                      ? "bg-amber-500/5 border-amber-500/30 dark:bg-amber-500/10" 
                      : "bg-card border-border"
                  }`}>
                    <div className="flex items-start gap-3.5">
                      <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mt-0.5">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-xs font-extrabold text-foreground">Relatório Semanal via E-mail</h5>
                          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
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
                        reportForm.reportWeeklyEmail ? "bg-amber-500" : "bg-muted border border-border"
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
                    ? "bg-violet-500/5 border-violet-500/30 dark:bg-violet-500/10"
                    : "bg-card border-border"
                }`}>
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 mt-0.5">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h5 className="text-xs font-extrabold text-foreground">Exigir aprovação antes de enviar</h5>
                        <span className="px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 text-[10px] font-bold">
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
                      reportForm.reportRequiresApproval ? "bg-violet-500" : "bg-muted border border-border"
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
                      <Smartphone className="h-4 w-4 text-emerald-500" />
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
                      <Mail className="h-4 w-4 text-blue-500" />
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
                    placeholder="Ex: Valem Chat <alertas@valem.com.br>"
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
    </section>
  );
}
