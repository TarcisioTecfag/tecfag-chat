import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { RdSyncStatus } from "@/lib/rd-marketing/sync-types";

const endpoint = "/api/settings/rd-marketing/sync";
const buttonClass =
  "rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50";
const statuses: Record<string, string> = {
  pending: "Aguardando envio",
  processing: "Enviando",
  sent: "Registrado no RD",
  blocked: "Dados ou conexão precisam de revisão",
  unknown: "Conferir resultado no RD",
  failed: "Falha",
  local: "URL criada",
  registering: "Registrando no RD",
  registered: "Conectado no RD",
  error: "Registro precisa de revisão",
};
export function RdMarketingSyncSettings() {
  const [status, setStatus] = useState<RdSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [currency, setCurrency] = useState("BRL");
  const [label, setLabel] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const pending = useRef<AbortController | null>(null);
  async function load(body?: Record<string, unknown>) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        endpoint,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: controller.signal,
            }
          : { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar a sincronização.");
      if (!controller.signal.aborted) {
        setStatus(data);
        setEnabled(data.outboundEnabled);
        setCurrency(data.currency);
        setReviewed({});
      }
      return !controller.signal.aborted;
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Falha na sincronização.");
        // Registration can succeed for one webhook and fail for the next; show the saved result.
        if (body) {
          try {
            const response = await fetch(endpoint, { signal: controller.signal });
            if (response.ok) {
              const data = await response.json();
              if (!controller.signal.aborted) setStatus(data);
            }
          } catch {
            /* Keep the last saved status. */
          }
        }
      }
      return false;
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, []);
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-semibold">Jornada e retorno comercial</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Receba novos acontecimentos do Marketing e informe oportunidades, vendas e perdas deste
            CRM.
          </p>
        </div>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void load()}>
          <RefreshCw className="inline h-3.5 w-3.5 mr-1" />
          Atualizar painel
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {busy && (
        <p className="text-xs text-muted-foreground">
          <Loader2 className="inline h-3.5 w-3.5 mr-1 animate-spin" />
          Processando configuração…
        </p>
      )}
      {status && (
        <>
          <div className="rounded-xl border border-border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Receber conversões e oportunidades</h4>
            <p className="text-xs text-muted-foreground">
              Conecta os dois avisos oficiais do RD à jornada do contato. Estes webhooks registram
              histórico; os fluxos de criação de cards continuam com suas próprias regras.
            </p>
            <button
              type="button"
              className={`${buttonClass} bg-primary text-primary-foreground`}
              disabled={busy || !status.connected}
              onClick={() => void load({ action: "register" })}
            >
              Conectar webhooks da jornada
            </button>
            {!status.connected && (
              <p className="text-xs text-muted-foreground">
                Autorize a conta RD Marketing acima para continuar.
              </p>
            )}
          </div>
          <div className="rounded-xl border border-border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Pontos dos fluxos de automação</h4>
            <p className="text-xs text-muted-foreground">
              Dê um nome ao ponto, gere a URL e configure uma ação de envio de webhook naquele
              trecho do fluxo RD. Cada aviso registra a passagem pelo ponto escolhido.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Nome do ponto da automação"
                className="min-w-48 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                placeholder="Ex.: Qualificação concluída · Máquinas"
                value={label}
                maxLength={160}
                onChange={(event) => setLabel(event.target.value)}
              />
              <button
                type="button"
                className={buttonClass}
                disabled={busy || !status.connected || !label.trim()}
                onClick={async () => {
                  if (await load({ action: "automation", label })) setLabel("");
                }}
              >
                Gerar URL do ponto
              </button>
            </div>
          </div>
          {!!status.endpoints.length && (
            <div className="space-y-3">
              {status.endpoints.map((hook) => (
                <div
                  key={hook.id}
                  className="rounded-xl border border-border bg-muted/20 p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{hook.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {!hook.currentConnection
                        ? "Conexão anterior"
                        : !hook.enabled
                          ? "Pausado"
                          : statuses[hook.registrationStatus] || hook.registrationStatus}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 break-all text-[11px]">{hook.url}</code>
                    <button
                      type="button"
                      aria-label={`Copiar URL de ${hook.label}`}
                      className={buttonClass}
                      disabled={!hook.currentConnection}
                      onClick={() =>
                        navigator.clipboard
                          .writeText(hook.url)
                          .then(() => toast.success("URL copiada."))
                          .catch(() => toast.error("Não foi possível copiar."))
                      }
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {hook.lastError && <p className="text-xs text-destructive">{hook.lastError}</p>}
                  <div className="flex flex-wrap gap-2">
                    {hook.kind !== "AUTOMATION" && hook.currentConnection && (
                      <button
                        type="button"
                        disabled={busy}
                        className={buttonClass}
                        onClick={() => void load({ action: "registerEndpoint", id: hook.id })}
                      >
                        Verificar registro no RD
                      </button>
                    )}
                    {hook.currentConnection && (
                      <button
                        type="button"
                        disabled={busy}
                        className={buttonClass}
                        onClick={() =>
                          void load({
                            action: "endpointEnabled",
                            id: hook.id,
                            enabled: !hook.enabled,
                          })
                        }
                      >
                        {hook.enabled ? "Pausar recebimento" : "Ativar recebimento"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Enviar mudanças comerciais para o RD</h4>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy || !status.connected}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enviar novas oportunidades, vendas e perdas
            </label>
            <p className="text-xs text-muted-foreground">
              Vale para acontecimentos após a ativação. Cada negociação gera seu próprio evento. O
              contato precisa existir no Marketing. Alterar uma negociação já encerrada não reenvia
              sua venda ou perda.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs">
                Moeda utilizada na conta Marketing{" "}
                <select
                  className="ml-2 rounded-lg border border-border bg-background p-2"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  <option>BRL</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </label>
              <button
                type="button"
                className={buttonClass}
                disabled={busy}
                onClick={() => void load({ action: "save", outboundEnabled: enabled, currency })}
              >
                Salvar retorno comercial
              </button>
            </div>
          </div>
          {!!status.deliveries.length && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Últimos envios comerciais</h4>
              {status.deliveries.map((item) => (
                <div key={item.id} className="rounded-xl border border-border p-3 space-y-2">
                  <div className="flex flex-wrap justify-between gap-2">
                    <a
                      className="text-sm font-semibold text-primary"
                      href={`/crm/deals/${encodeURIComponent(item.dealId)}`}
                    >
                      {item.title}
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {statuses[item.status] || item.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {item.eventType === "SALE"
                      ? "Venda"
                      : item.eventType === "OPPORTUNITY_LOST"
                        ? "Perda"
                        : "Oportunidade"}{" "}
                    · {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </p>
                  {item.lastError && (
                    <p
                      className={
                        item.status === "sent"
                          ? "text-xs text-muted-foreground"
                          : "text-xs text-destructive"
                      }
                    >
                      {item.lastError}
                    </p>
                  )}
                  {["blocked", "failed"].includes(item.status) && (
                    <button
                      className={buttonClass}
                      type="button"
                      disabled={busy}
                      onClick={() => void load({ action: "review", id: item.id, outcome: "retry" })}
                    >
                      Revisar dados e tentar novamente
                    </button>
                  )}
                  {item.status === "unknown" && (
                    <div className="space-y-2">
                      <label className="flex gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={!!reviewed[item.id]}
                          onChange={(event) =>
                            setReviewed((old) => ({ ...old, [item.id]: event.target.checked }))
                          }
                        />
                        Conferi no RD se este evento foi registrado
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={buttonClass}
                          type="button"
                          disabled={busy || !reviewed[item.id]}
                          onClick={() =>
                            void load({
                              action: "review",
                              id: item.id,
                              outcome: "confirmed",
                              reviewed: true,
                            })
                          }
                        >
                          Já registrado no RD
                        </button>
                        <button
                          className={buttonClass}
                          type="button"
                          disabled={busy || !reviewed[item.id]}
                          onClick={() =>
                            void load({
                              action: "review",
                              id: item.id,
                              outcome: "not_recorded",
                              reviewed: true,
                            })
                          }
                        >
                          Não registrado · tentar novamente
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Visitas, cliques e entrada/saída nativa de automações não fazem parte dos gatilhos
            públicos destes webhooks. Os pontos configurados passam a registrar avisos futuros.
          </p>
        </>
      )}
    </section>
  );
}
