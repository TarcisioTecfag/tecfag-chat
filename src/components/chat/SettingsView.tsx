import React, { useState } from "react";
import { useChat } from "@/hooks/useChatState";
import { Check, RefreshCw, Key, Shield, Smartphone, QrCode, AlertCircle, Save } from "lucide-react";

export function SettingsView() {
  const {
    tenant,
    metaConfig,
    setMetaConfig,
    baileysConfig,
    setBaileysConfig,
    disconnectBaileys,
    connectBaileys,
  } = useChat();

  const [metaForm, setMetaForm] = useState({ ...metaConfig });
  const [isSaved, setIsSaved] = useState(false);

  const handleMetaSave = (e: React.FormEvent) => {
    e.preventDefault();
    setMetaConfig({ ...metaForm, status: "connected" });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col rounded-3xl bg-chat-panel p-8 shadow-soft overflow-y-auto">
      <div className="max-w-3xl">
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
          </div>
        ) : (
          /* BAILEYS CONNECTION */
          <div className="space-y-6">
            {/* Status Panel */}
            <div className="flex items-center justify-between rounded-2xl bg-card p-5 border border-border shadow-soft">
              <div className="flex items-center gap-4">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Smartphone className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Conexão Baileys (WhatsApp Web)</h3>
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
        )}
      </div>
    </section>
  );
}
