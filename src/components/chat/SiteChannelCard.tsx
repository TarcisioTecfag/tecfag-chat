// Cartão de habilitação do canal Site no núcleo de triagem industrial (somente perfil industrial).
import React, { useEffect, useState } from "react";
import {
  Globe,
  Loader2,
  Save,
  ShieldCheck,
  AlertCircle,
  Check,
  HelpCircle,
  MessageSquare,
  Sparkles,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { SystemTooltip } from "@/components/ui/tooltip";

interface SiteChannelState {
  sdrConfigured: boolean;
  sdrEnabled: boolean;
  siteChannelEnabled: boolean;
  siteAllowedOrigins: string[];
  siteWhatsappNumber?: string;
}

export function SiteChannelCard({ personaName, backendUrl }: { personaName: string; backendUrl: string }) {
  const [state, setState] = useState<SiteChannelState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [originsText, setOriginsText] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${backendUrl}/api/valentina/site-channel`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data?.error || "Não foi possível carregar o canal do site.");
          return;
        }
        setState(data);
        setEnabled(Boolean(data.siteChannelEnabled));
        setOriginsText((data.siteAllowedOrigins || []).join("\n"));
        setWhatsappNumber(data.siteWhatsappNumber || "");
      } catch {
        if (!cancelled) setLoadError("Erro de comunicação com o servidor.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendUrl]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const siteAllowedOrigins = originsText
        .split(/[\n,]/)
        .map((o) => o.trim())
        .filter(Boolean);
      const res = await fetch(`${backendUrl}/api/valentina/site-channel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteChannelEnabled: enabled, siteAllowedOrigins, siteWhatsappNumber: whatsappNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Não foi possível salvar.");
        return;
      }
      setState((prev) => (prev ? { ...prev, ...data } : prev));
      setOriginsText((data.siteAllowedOrigins || []).join("\n"));
      setWhatsappNumber(data.siteWhatsappNumber || "");
      toast.success(enabled ? `Canal do site ativado para o ${personaName}.` : "Canal do site desativado.");
    } catch {
      toast.error("Erro de comunicação com o servidor.");
    } finally {
      setIsSaving(false);
    }
  };

  const configuredOriginsCount = originsText
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean).length;

  return (
    <div className="rounded-2xl bg-card border border-border p-6 shadow-soft space-y-5">
      {/* Cabeçalho com Status */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-foreground">
                Atendimento do {personaName} no Site (Widget Web)
              </h3>
              {state && (
                <SystemTooltip
                  content={
                    enabled && state.sdrEnabled
                      ? `O widget web está pronto para receber visitantes e acionar a triagem do ${personaName}.`
                      : !state.sdrEnabled
                        ? `O SDR do ${personaName} está desativado nas configurações gerais da IA.`
                        : "O recebimento de novas conversas pelo widget do site está pausado."
                  }
                >
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                      enabled && state.sdrEnabled
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/25"
                        : "bg-amber-500/10 text-amber-600 border-amber-500/25"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        enabled && state.sdrEnabled ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                    {enabled && state.sdrEnabled
                      ? "Canal Ativo"
                      : enabled
                        ? "Aguardando SDR"
                        : "Canal Desativado"}
                  </span>
                </SystemTooltip>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Conecta o widget flutuante do e-commerce diretamente à mesma fila de triagem, qualificação e rodízio de consultores do WhatsApp.
            </p>
          </div>
        </div>

        {state && (
          <div className="flex items-center gap-2">
            <SystemTooltip content="Quantidade de domínios autorizados na lista de segurança CORS/Origin.">
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-muted/60 border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                <Lock className="h-3 w-3 text-primary" />
                {configuredOriginsCount > 0
                  ? `${configuredOriginsCount} ${configuredOriginsCount === 1 ? "origem restrita" : "origens restritas"}`
                  : "Acesso público (qualquer domínio)"}
              </span>
            </SystemTooltip>
          </div>
        )}
      </div>

      {loadError ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      ) : !state ? (
        <div className="flex items-center gap-2.5 py-6 justify-center text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Carregando parâmetros do canal web...
        </div>
      ) : (
        <div className="space-y-5">
          {!state.sdrEnabled && (
            <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">Atenção: Triagem SDR do {personaName} está desativada</p>
                <p className="text-[11px] opacity-90">
                  Mesmo que você habilite o canal abaixo, o widget recusará novas conexões de visitantes até que o módulo SDR seja ativado no painel da IA.
                </p>
              </div>
            </div>
          )}

          {/* Caixa de seleção customizada — Habilitação do Canal */}
          <SystemTooltip
            content={
              !state.sdrConfigured
                ? "Configure primeiro o agente SDR antes de ativar o canal do site."
                : enabled
                  ? "Clique para pausar o recebimento de mensagens vindas do widget do site."
                  : "Clique para permitir que visitantes iniciem conversas pelo widget instalado no site."
            }
          >
            <label
              className={`group flex items-center justify-between gap-4 rounded-xl border p-4 transition-all ${
                !state.sdrConfigured
                  ? "cursor-not-allowed opacity-60 border-border bg-muted/20"
                  : enabled
                    ? "cursor-pointer border-primary/40 bg-primary/5 shadow-sm"
                    : "cursor-pointer border-border bg-muted/20 hover:border-primary/30 hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    enabled
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-muted-foreground/40 bg-background group-hover:border-primary/60"
                  }`}
                >
                  {enabled && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                </div>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only"
                  disabled={!state.sdrConfigured}
                />
                <div className="space-y-0.5">
                  <span className="block text-sm font-semibold text-foreground">
                    Aceitar conversas do widget do site
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Quando ativo, visitantes da loja virtual podem conversar em tempo real com o {personaName} e ser transferidos para consultores.
                  </span>
                </div>
              </div>

              <span
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                  enabled
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {enabled ? "Ativado" : "Inativo"}
              </span>
            </label>
          </SystemTooltip>

          {/* Grid de Configurações de Segurança e Continuidade */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Origens autorizadas */}
            <div className="rounded-xl border border-border bg-muted/15 p-4 space-y-2.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    Origens autorizadas (CORS / Domínios)
                  </label>
                  <SystemTooltip content="Lista de domínios (com https://) autorizados a abrir conexão WebSocket com o chat. Informe um domínio por linha. Se deixado em branco, qualquer site com o script poderá conectar.">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Ajuda sobre origens autorizadas"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Restringe quais domínios podem carregar o widget. Informe um endereço por linha (ex.: <code className="rounded bg-muted px-1 py-0.5 text-[10px]">https://www.sualoja.com.br</code>).
                </p>
                <textarea
                  value={originsText}
                  onChange={(e) => setOriginsText(e.target.value)}
                  rows={3}
                  placeholder={"https://www.sualoja.com.br\nhttps://homolog.sualoja.com.br"}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1 border-t border-border/50">
                <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Durante a homologação, cadastre apenas o domínio de testes.</span>
              </p>
            </div>

            {/* Ponte para WhatsApp */}
            <div className="rounded-xl border border-border bg-muted/15 p-4 space-y-2.5 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                    WhatsApp de Continuidade (Handoff Web → WhatsApp)
                  </label>
                  <SystemTooltip content="Permite que o visitante continue o atendimento do site diretamente no WhatsApp sem perder o histórico. O sistema gera um código único (válido por 30 minutos) que vincula a sessão web ao WhatsApp.">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Ajuda sobre WhatsApp de continuidade"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                  </SystemTooltip>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Número oficial (DDI + DDD + número, apenas dígitos) para onde o visitante será redirecionado ao clicar em <strong>Continuar no WhatsApp</strong>.
                </p>
                <input
                  type="text"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  placeholder="Ex: 5514999999999"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/50 leading-relaxed">
                O visitante recebe um token temporário (30 min) que transfere automaticamente histórico, resumo e consultor responsável para o WhatsApp.
              </p>
            </div>
          </div>

          {/* Rodapé de Ação */}
          <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/60">
            <span className="text-[11px] text-muted-foreground">
              Alterações entram em vigor imediatamente para novas sessões do widget.
            </span>
            <SystemTooltip content="Salva as regras de ativação, domínios permitidos e número de transição para WhatsApp.">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !state.sdrConfigured}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar canal do site
              </button>
            </SystemTooltip>
          </div>
        </div>
      )}
    </div>
  );
}

