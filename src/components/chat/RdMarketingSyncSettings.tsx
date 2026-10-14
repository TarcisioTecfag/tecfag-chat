import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { RdOutboundScope, RdSyncStatus } from "@/lib/rd-marketing/sync-types";
import { rdTestContactUuidError } from "@/lib/rd-marketing/outbound-scope";

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
  const [commercialError, setCommercialError] = useState("");
  const [commercialSuccess, setCommercialSuccess] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [uuidTouched, setUuidTouched] = useState(false);
  const uuidInput = useRef<HTMLInputElement | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [outboundScope, setOutboundScope] = useState<RdOutboundScope>("test");
  const [testContactUuid, setTestContactUuid] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [label, setLabel] = useState("");
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const pending = useRef<AbortController | null>(null);
  const uuidError =
    outboundScope === "test" ? rdTestContactUuidError(testContactUuid, enabled) : null;
  const commercialDirty =
    !!status &&
    (enabled !== status.outboundEnabled ||
      currency !== status.currency ||
      outboundScope !== status.outboundScope ||
      (outboundScope === "test" &&
        testContactUuid.trim().toLowerCase() !== (status.testContact?.uuid || "")));
  const changedCommercial = useCallback(() => {
    setCommercialError("");
    setCommercialSuccess("");
  }, []);
  function saveCommercial() {
    changedCommercial();
    setUuidTouched(true);
    if (uuidError) {
      toast.error(uuidError);
      uuidInput.current?.focus();
      return;
    }
    void load({
      action: "save",
      outboundEnabled: enabled,
      currency,
      outboundScope,
      testContactUuid,
    });
  }
  const load = useCallback(
    async (body?: Record<string, unknown>) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setBusy(true);
      const isCommercialSave = body?.action === "save";
      setPendingAction(typeof body?.action === "string" ? body.action : null);
      setError("");
      if (isCommercialSave || !body) changedCommercial();
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
        if (!response.ok)
          throw new Error(data.error || "Não foi possível carregar a sincronização.");
        if (!controller.signal.aborted) {
          setStatus(data);
          if (!body || isCommercialSave) {
            setEnabled(data.outboundEnabled);
            setOutboundScope(data.outboundScope);
            setTestContactUuid(data.testContact?.uuid || "");
            setCurrency(data.currency);
            setUuidTouched(false);
          }
          if (isCommercialSave) {
            setCommercialSuccess("Configuração salva com sucesso no sistema.");
            toast.success("Retorno comercial salvo com sucesso.");
          }
          setReviewed({});
        }
        return !controller.signal.aborted;
      } catch (reason) {
        if (!controller.signal.aborted) {
          const message = reason instanceof Error ? reason.message : "Falha na sincronização.";
          if (isCommercialSave) {
            setCommercialError(message);
            toast.error(message);
          } else setError(message);
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
    },
    [changedCommercial],
  );
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, [load]);
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
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs font-medium">
              No sistema:{" "}
              {!status.outboundEnabled
                ? "envios desativados"
                : status.outboundScope === "test"
                  ? `teste isolado · ${status.testContact?.name || status.testContact?.uuid || "contato não configurado"}`
                  : "envio para todos os contatos"}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy || !status.connected}
                onChange={(event) => {
                  changedCommercial();
                  setEnabled(event.target.checked);
                }}
              />
              Enviar novas oportunidades, vendas e perdas
            </label>
            <p className="text-xs text-muted-foreground">
              Vale para acontecimentos após a ativação. Cada negociação gera seu próprio evento. O
              contato precisa existir no Marketing. Alterar uma negociação já encerrada não reenvia
              sua venda ou perda.
            </p>
            <label className="block text-sm">
              Destino dos envios
              <select
                aria-label="Destino dos envios comerciais"
                className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
                value={outboundScope}
                disabled={busy}
                onChange={(event) => {
                  changedCommercial();
                  setOutboundScope(event.target.value as RdOutboundScope);
                }}
              >
                <option value="test">Teste isolado · apenas um contato</option>
                <option value="all">Todos os contatos</option>
              </select>
            </label>
            {outboundScope === "test" && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                <label className="block text-sm">
                  UUID do contato de teste no RD Marketing
                  <input
                    ref={uuidInput}
                    aria-label="UUID do contato de teste"
                    aria-invalid={uuidTouched && !!uuidError}
                    aria-describedby="rd-commercial-uuid-help"
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                    placeholder="Cole o UUID exibido na consulta do lead"
                    value={testContactUuid}
                    maxLength={36}
                    disabled={busy}
                    onBlur={() => setUuidTouched(true)}
                    onChange={(event) => {
                      changedCommercial();
                      setTestContactUuid(event.target.value);
                    }}
                  />
                </label>
                <p id="rd-commercial-uuid-help" className="text-xs text-muted-foreground">
                  Use o campo “UUID” da consulta do lead, e não o ID numérico. Formato:
                  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.
                </p>
                {uuidTouched && uuidError && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {uuidError}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  O sistema confere este cadastro ao salvar. Somente negociações desse contato
                  enviam oportunidades, vendas e perdas. O recebimento do RD para nossos cards
                  continua livre para todos os contatos.
                </p>
                {status.testContact?.uuid === testContactUuid.trim().toLowerCase() && (
                  <p className="text-xs font-medium">
                    Contato conferido: {status.testContact.name || "Sem nome"}
                    {status.testContact.email ? ` · ${status.testContact.email}` : ""}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Os eventos enviados são reais e aparecerão no RD para este contato de teste.
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs">
                Moeda utilizada na conta Marketing{" "}
                <select
                  className="ml-2 rounded-lg border border-border bg-background p-2"
                  value={currency}
                  disabled={busy}
                  onChange={(event) => {
                    changedCommercial();
                    setCurrency(event.target.value);
                  }}
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
                onClick={saveCommercial}
              >
                {busy && pendingAction === "save"
                  ? "Salvando retorno comercial…"
                  : "Salvar retorno comercial"}
              </button>
            </div>
            {commercialDirty && (
              <p className="text-xs text-muted-foreground">
                Há alterações ainda não salvas. Clique em “Salvar retorno comercial” para
                aplicá-las.
              </p>
            )}
            {busy && pendingAction === "save" && (
              <p role="status" className="text-xs text-muted-foreground">
                Conferindo o contato no RD e salvando a configuração…
              </p>
            )}
            {commercialError && (
              <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                Não foi possível salvar. {commercialError}
              </p>
            )}
            {commercialSuccess && (
              <p
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
              >
                {commercialSuccess}
              </p>
            )}
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
