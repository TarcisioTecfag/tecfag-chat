import React, { useState, useEffect } from "react";
import { useChat } from "@/hooks/useChatState";
import { Check, RefreshCw, Key, Shield, Smartphone, QrCode, AlertCircle, Save, Mail, FileText, Link, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";

export function SettingsView() {
  const {
    tenant,
    metaConfig,
    setMetaConfig,
    baileysConfig,
    disconnectBaileys,
    connectBaileys,
  } = useChat();

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
    <div className="rounded-2xl bg-card border border-border p-6 shadow-soft">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: "var(--primary-soft)" }}>
          <Link className="h-5 w-5" style={{ color: "var(--primary)" }} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-foreground truncate">Integração RD Station CRM</h3>
          <p className="text-[11px] text-muted-foreground truncate">Sincronize tarefas do CRM com o calendário.</p>
        </div>
        <div className="shrink-0">
          {rdCrmConfigured === null ? (
            <span className="inline-flex items-center gap-1 rounded-xl bg-card border border-border px-2.5 py-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Verificando...
            </span>
          ) : rdCrmConfigured ? (
            <span className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-[10px] font-semibold text-white" style={{ background: "var(--primary)" }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2.5 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" /> Pendente
            </span>
          )}
        </div>
      </div>

      {!rdCrmConfigured && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Clique abaixo para conectar ao RD Station CRM. Você será redirecionado para o painel de autorização oficial.
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
            className="w-full inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
            style={{ background: "var(--primary)" }}
          >
            {rdCrmConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            Conectar ao RD CRM
          </button>
        </div>
      )}

      {rdCrmConfigured && (
        <div className="rounded-xl bg-background/60 border border-border p-3">
          <p className="text-xs text-foreground font-semibold">✅ Sincronização Ativa</p>
          <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">As tarefas estão no menu "Tarefas". Os tokens de acesso são mantidos atualizados.</p>
        </div>
      )}
    </div>
  );

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel p-8 shadow-soft overflow-y-auto scrollbar-thin">
      <div className={tenant === "tecfag" ? "max-w-3xl" : "w-full"}>
        <header className="mb-8">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Configurações
          </span>
          <h2 className="text-2xl font-bold text-foreground mt-1">
            {tenant === "tecfag" ? "Tec Chat — Integração Meta API" : "Valem Chat — Conexão Baileys"}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            Configure as credenciais e parâmetros de comunicação para a sua conta de atendimento comercial.
          </p>
        </header>

        {tenant === "tecfag" ? (
          /* META API CONFIGURATION */
          <div className="space-y-6">
            {/* Status Panel */}
            <div className="flex items-center justify-between rounded-2xl bg-card p-5 border border-border shadow-soft">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Shield className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Status da Integração</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">API Oficial do WhatsApp Cloud</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 border border-emerald-100">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Conectado
              </div>
            </div>

            {/* Config Form */}
            <form onSubmit={handleMetaSave} className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-5">
              <div className="flex items-center gap-2 border-b border-line pb-3 mb-2">
                <Key className="h-4 w-4 text-primary" />
                <h4 className="font-semibold text-foreground">Credenciais da API Meta Developer</h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground/80">Meta Business Account ID</label>
                  <input
                    type="text"
                    value={metaForm.businessAccountId}
                    onChange={(e) => setMetaForm({ ...metaForm, businessAccountId: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-4 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground/80">WhatsApp Phone Number ID</label>
                  <input
                    type="text"
                    value={metaForm.phoneNumberId}
                    onChange={(e) => setMetaForm({ ...metaForm, phoneNumberId: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-4 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">Token de Acesso Permanente (System User Token)</label>
                <textarea
                  rows={3}
                  value={metaForm.accessToken}
                  onChange={(e) => setMetaForm({ ...metaForm, accessToken: e.target.value })}
                  className="w-full rounded-xl bg-muted p-4 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80">Token de Verificação do Webhook (Webhook Verify Token)</label>
                <input
                  type="text"
                  value={metaForm.webhookVerifyToken}
                  onChange={(e) => setMetaForm({ ...metaForm, webhookVerifyToken: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-4 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                />
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-line">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  Mantenha esses dados seguros. Eles controlam o envio de templates oficiais.
                </div>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 cursor-pointer"
                >
                  {isSaved ? (
                    <>
                      <Check className="h-4 w-4" />
                      Salvo!
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Salvar Alterações
                    </>
                  )}
                </button>
              </div>
            </form>
            {renderRdCrmCard()}
          </div>
        ) : (
          /* BAILEYS CONNECTION GRID */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Bloco Esquerdo: Conexão e Status */}
            <div className="space-y-6">
              {/* Status Panel */}
              <div className="flex items-center justify-between rounded-2xl bg-card p-5 border border-border shadow-soft">
                <div className="flex items-center gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary-soft text-primary">
                    <Smartphone className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Conexão Baileys</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Integração baseada em pareamento de QR Code</p>
                  </div>
                </div>
                
                {baileysConfig.status === "connected" && (
                  <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 border border-emerald-100">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Conectado
                  </div>
                )}
                {baileysConfig.status === "qr_ready" && (
                  <div className="flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-600 border border-amber-100">
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                    Aguardando Leitura
                  </div>
                )}
                {baileysConfig.status === "connecting" && (
                  <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 border border-blue-100">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    Iniciando...
                  </div>
                )}
                {baileysConfig.status === "disconnected" && (
                  <div className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600 border border-red-100">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    Desconectado
                  </div>
                )}
              </div>

              {/* QR Connection Screen */}
              <div className="rounded-2xl bg-card p-8 border border-border shadow-soft">
                {baileysConfig.status === "connected" ? (
                  <div className="flex flex-col items-center justify-center text-center py-6">
                    <div className="grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600 mb-4">
                      <Check className="h-8 w-8" strokeWidth={2.5} />
                    </div>
                    <h4 className="text-lg font-bold text-foreground">Sessão Ativa com Sucesso</h4>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                      O Valem Chat está emparelhado e ativo respondendo mensagens do número:
                    </p>
                    <span className="text-base font-semibold text-primary mt-2">{baileysConfig.pairedPhone}</span>

                    <div className="mt-8 pt-6 border-t border-line w-full flex justify-center">
                      <button
                        onClick={disconnectBaileys}
                        className="h-10 rounded-xl border border-red-200 bg-red-50 px-6 text-sm font-semibold text-red-600 hover:bg-red-100/70 transition cursor-pointer"
                      >
                        Desconectar Dispositivo
                      </button>
                    </div>
                  </div>
                ) : baileysConfig.status === "connecting" ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="h-12 w-12 animate-spin text-primary mb-4" />
                    <h4 className="text-base font-semibold text-foreground">Solicitando nova sessão ao servidor...</h4>
                    <p className="text-xs text-muted-foreground mt-1">Isso pode levar alguns segundos</p>
                  </div>
                ) : baileysConfig.status === "qr_ready" ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    <div className="flex flex-col items-center justify-center bg-muted p-6 rounded-2xl border border-line">
                      <div className="bg-white p-4 rounded-xl shadow-soft">
                        {baileysConfig.qrCodeUrl ? (
                          <img src={baileysConfig.qrCodeUrl} alt="WhatsApp Web QR Code" className="h-44 w-44 object-contain" />
                        ) : (
                          <div className="h-44 w-44 flex items-center justify-center bg-gray-100 rounded-lg">
                            <QrCode className="h-12 w-12 text-muted-foreground animate-pulse" />
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground mt-4 flex items-center gap-1.5">
                        <RefreshCw className="h-3 w-3 animate-spin" /> O código atualiza a cada 30 segundos.
                      </span>
                    </div>

                    <div className="space-y-4">
                      <h4 className="text-lg font-bold text-foreground">Siga as instruções para conectar:</h4>
                      <ol className="list-decimal list-inside space-y-3 text-sm text-foreground/80">
                        <li>Abra o **WhatsApp** no seu celular.</li>
                        <li>Toque nos **Três Pontos** (Android) ou **Ajustes** (iOS).</li>
                        <li>Selecione **Aparelhos Conectados** e depois **Conectar um aparelho**.</li>
                        <li>Aponte a câmera do seu celular para esta tela para capturar o código QR.</li>
                      </ol>

                      <div className="pt-4 flex gap-3">
                        <button
                          onClick={disconnectBaileys}
                          className="h-10 rounded-xl border border-border bg-card px-6 text-sm font-semibold text-muted-foreground hover:bg-muted transition cursor-pointer"
                        >
                          Cancelar Conexão
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-8">
                    <div className="grid h-16 w-16 place-items-center rounded-full bg-red-50 text-red-500 mb-4">
                      <AlertCircle className="h-8 w-8" />
                    </div>
                    <h4 className="text-lg font-bold text-foreground">Nenhuma Sessão de WhatsApp Ativa</h4>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                      Para que o Valem Chat possa enviar e receber mensagens usando o Baileys, você precisa estabelecer a conexão.
                    </p>
                    <button
                      onClick={connectBaileys}
                      className="mt-6 h-10 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground hover:opacity-90 transition cursor-pointer"
                    >
                      Gerar Código QR de Conexão
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Bloco Direito: Diagnóstico de Envio (Teste) + RD Station CRM */}
            <div className="space-y-6">
              <div className="rounded-2xl bg-card p-6 border border-border shadow-soft flex flex-col justify-between min-h-[360px]">
                <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-line pb-3 mb-2">
                    <RefreshCw className="h-4 w-4 text-primary" />
                    <h4 className="font-bold text-foreground">Diagnóstico de Envio (Teste de Disparo)</h4>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Envie uma mensagem instantânea de teste para qualquer número de sua preferência para validar o fluxo de envio e receber logs detalhados de sucesso ou erro.
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
                        className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent disabled:opacity-50"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-foreground/80 block">Conteúdo da Mensagem</label>
                      <textarea
                        rows={3}
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        disabled={baileysConfig.status !== "connected"}
                        className="w-full rounded-xl bg-muted p-3 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent resize-none disabled:opacity-50"
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
                  <div className="mt-4 pt-4 border-t border-line">
                    {testStatus.type === "success" && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-xs font-semibold text-emerald-600 flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 mt-1 shrink-0 animate-pulse" />
                        <div>{testStatus.message}</div>
                      </div>
                    )}
                    {testStatus.type === "error" && (
                      <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-xs font-semibold text-red-600 flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                        <AlertCircle className="h-4.5 w-4.5 shrink-0 text-red-500 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="font-extrabold uppercase text-[9px] tracking-wider text-red-500 mb-0.5">Erro no Disparo:</div>
                          <div className="break-words font-mono text-[11px] leading-relaxed text-red-700 bg-red-100/50 p-1.5 rounded-lg border border-red-200 mt-1">
                            {testStatus.message}
                          </div>
                        </div>
                      </div>
                    )}
                    {testStatus.type === "sending" && (
                      <div className="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs font-semibold text-blue-600 flex items-center gap-2 animate-pulse">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
                        <div>{testStatus.message}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {renderRdCrmCard()}
            </div>
          </div>
        )}
        {/* Bloco Comum: Automação e Relatórios Executivos */}
        <div className="mt-8 pt-8 border-t border-line">
          <header className="mb-6">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Automação e Relatórios Executivos
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Configure o envio automático de relatórios analíticos diários e semanais consolidados por WhatsApp e E-mail.
            </p>
          </header>

          <form onSubmit={handleReportSave} className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Lado Esquerdo: Preferências de Frequência e Destinatários */}
            <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-2">Preferências de Envio</h4>
              
              <div className="space-y-3">
                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reportForm.reportDailyWhatsapp}
                    onChange={(e) => setReportForm({ ...reportForm, reportDailyWhatsapp: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Enviar relatório diário por WhatsApp</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reportForm.reportDailyEmail}
                    onChange={(e) => setReportForm({ ...reportForm, reportDailyEmail: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Enviar relatório diário por E-mail</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reportForm.reportWeeklyWhatsapp}
                    onChange={(e) => setReportForm({ ...reportForm, reportWeeklyWhatsapp: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Enviar relatório semanal por WhatsApp</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reportForm.reportWeeklyEmail}
                    onChange={(e) => setReportForm({ ...reportForm, reportWeeklyEmail: e.target.checked })}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Enviar relatório semanal por E-mail</span>
                </label>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="text-xs font-semibold text-foreground/80 block">Números de Celular de Destino (DDI+DDD+Número, separados por vírgula)</label>
                <input
                  type="text"
                  placeholder="Ex: 5514981468232, 5581999998888"
                  value={reportForm.reportWhatsappNumbers}
                  onChange={(e) => setReportForm({ ...reportForm, reportWhatsappNumbers: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80 block">Endereços de E-mail de Destino (separados por vírgula)</label>
                <input
                  type="text"
                  placeholder="Ex: gestao@valem.com.br, diretoria@valem.com.br"
                  value={reportForm.reportEmailAddresses}
                  onChange={(e) => setReportForm({ ...reportForm, reportEmailAddresses: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                />
              </div>
            </div>

            {/* Lado Direito: Servidor SMTP */}
            <div className="rounded-2xl bg-card p-6 border border-border shadow-soft space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Configuração de Servidor SMTP (E-mail)
              </h4>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-foreground/80 block">Servidor SMTP Host</label>
                  <input
                    type="text"
                    placeholder="Ex: smtp.sendgrid.net"
                    value={reportForm.smtpHost}
                    onChange={(e) => setReportForm({ ...reportForm, smtpHost: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground/80 block">Porta</label>
                  <input
                    type="text"
                    placeholder="Ex: 587"
                    value={reportForm.smtpPort}
                    onChange={(e) => setReportForm({ ...reportForm, smtpPort: e.target.value })}
                    className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80 block">Usuário SMTP</label>
                <input
                  type="text"
                  placeholder="Ex: apikey ou contato@valem.com.br"
                  value={reportForm.smtpUser}
                  onChange={(e) => setReportForm({ ...reportForm, smtpUser: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80 block">Senha SMTP</label>
                <input
                  type="password"
                  placeholder="••••••••••••••••"
                  value={reportForm.smtpPass}
                  onChange={(e) => setReportForm({ ...reportForm, smtpPass: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/80 block">Remetente (From Address)</label>
                <input
                  type="text"
                  placeholder="Ex: Valem Chat <alertas@valem.com.br>"
                  value={reportForm.smtpFrom}
                  onChange={(e) => setReportForm({ ...reportForm, smtpFrom: e.target.value })}
                  className="h-10 w-full rounded-xl bg-muted px-4 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary border border-transparent focus:border-transparent"
                />
              </div>
            </div>

            {/* Botão de Salvar Geral */}
            <div className="lg:col-span-2 flex items-center justify-between pt-4 border-t border-line">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                Os relatórios diários são processados e enviados às 18h e os semanais às sextas-feiras às 18h.
              </div>
              <button
                type="submit"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-xs font-bold text-primary-foreground transition hover:opacity-90 cursor-pointer shadow-soft active:scale-98"
              >
                {isReportSaved ? (
                  <>
                    <Check className="h-4 w-4" />
                    Salvo!
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Salvar Automação de Relatórios
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
