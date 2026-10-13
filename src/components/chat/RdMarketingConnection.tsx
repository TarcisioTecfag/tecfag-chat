import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RdApiStatus, RdEventPage, RdIdentifier, RdProbe } from "@/lib/rd-marketing/api-types";

const endpoint = "/api/settings/rd-marketing/connection";
const inputClass = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
const buttonClass =
  "rounded-xl border border-border px-4 py-2 text-sm font-medium disabled:opacity-50";
const json = (value: unknown) => JSON.stringify(value, null, 2);

export function RdMarketingConnection() {
  const [status, setStatus] = useState<RdApiStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [identifier, setIdentifier] = useState<RdIdentifier>("email");
  const [value, setValue] = useState("");
  const [probe, setProbe] = useState<RdProbe | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    controllers.current.add(controller);
    fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar a conexão.");
        if (!controller.signal.aborted) {
          setStatus(data);
          setClientId(data.clientId);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => controllers.current.delete(controller));
    const pending = controllers.current;
    return () => {
      mounted.current = false;
      for (const item of pending) item.abort();
      pending.clear();
    };
  }, []);

  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir a consulta.");
      return controller.signal.aborted ? null : data;
    } catch (reason) {
      if (!controller.signal.aborted && mounted.current)
        setError(
          reason instanceof Error ? reason.message : "Não foi possível concluir a consulta.",
        );
      return null;
    } finally {
      controllers.current.delete(controller);
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    const data = await action({ action: "save", clientId, clientSecret: secret });
    if (data) {
      setStatus(data);
      setSecret("");
      setProbe(null);
      toast.success("Credenciais do aplicativo salvas.");
    }
  }
  async function connect() {
    const data = await action({ action: "connect" });
    if (data?.authorizationUrl) window.location.assign(data.authorizationUrl);
  }
  async function disconnect() {
    const data = await action({ action: "disconnect" });
    if (data) {
      setStatus(data);
      setProbe(null);
      toast.success("Conexão de consulta desconectada.");
    }
  }
  async function consult() {
    setProbe(null);
    const data = await action({ action: "probe", identifier, value });
    if (data) setProbe(data);
  }
  async function next(page: RdEventPage) {
    if (!probe || !page.nextPage) return;
    const data: RdEventPage | null = await action({
      action: "events",
      uuid: probe.contact.uuid,
      eventType: page.eventType,
      page: page.nextPage,
    });
    if (data)
      setProbe((current) => (current ? { ...current, pages: [...current.pages, data] } : null));
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-5">
      <div>
        <h3 className="font-semibold">Conectar conta RD Marketing</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Autorize a conta deste tenant para consultar a jornada de um lead. Use um aplicativo do RD
          Marketing; as credenciais do RD CRM são diferentes.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {!status ? (
        <p className="text-sm text-muted-foreground">
          {error ? "Reabra esta seção para tentar carregar novamente." : "Carregando conexão…"}
        </p>
      ) : (
        <>
          <div className="rounded-xl border border-border p-4 space-y-2">
            <p className="text-sm font-medium">
              1. Cadastre o aplicativo no RD e registre esta URL de retorno
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs break-all flex-1">{status.callbackUrl}</code>
              <button
                type="button"
                className={buttonClass}
                aria-label="Copiar URL de retorno"
                onClick={() =>
                  navigator.clipboard
                    .writeText(status.callbackUrl)
                    .then(() => toast.success("URL copiada."))
                    .catch(() => toast.error("Não foi possível copiar a URL."))
                }
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <a
              href="https://developers.rdstation.com/reference/gerar-code"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary inline-flex items-center gap-1"
            >
              Documentação do RD Marketing <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          {!status.encryptionReady && (
            <p className="text-sm text-amber-700">
              A chave de criptografia precisa ser configurada no servidor antes de salvar as
              credenciais.
            </p>
          )}
          <fieldset
            disabled={busy || !status.encryptionReady}
            className="space-y-3 disabled:opacity-60"
          >
            <p className="text-sm font-medium">2. Salve as credenciais e autorize a conta</p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm space-y-1 block">
                Client ID
                <input
                  className={inputClass}
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="text-sm space-y-1 block">
                Client Secret
                <input
                  className={inputClass}
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    status.configured
                      ? "Deixe vazio para manter o segredo salvo"
                      : "Segredo do aplicativo Marketing"
                  }
                />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Ao trocar as credenciais, será necessário autorizar novamente. Na tela do RD, escolha
              a conta Marketing deste tenant.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={buttonClass} onClick={save}>
                Salvar credenciais
              </button>
              <button
                type="button"
                className={`${buttonClass} bg-primary text-primary-foreground`}
                disabled={!status.configured || clientId.trim() !== status.clientId || !!secret}
                onClick={connect}
              >
                {status.connected ? "Autorizar novamente" : "Autorizar no RD Marketing"}
              </button>
              {status.connected && (
                <button type="button" className={buttonClass} onClick={disconnect}>
                  Desconectar consulta
                </button>
              )}
              <span className="text-xs text-muted-foreground">
                {status.connected
                  ? "Conta autorizada"
                  : status.configured
                    ? "Aplicativo salvo; aguardando autorização"
                    : "Aplicativo não configurado"}
              </span>
            </div>
          </fieldset>
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-sm font-medium">3. Conferir o histórico de um lead</p>
            <p className="text-xs text-muted-foreground">
              Consulta de teste: lê conversões e oportunidades disponíveis na API. Visitas, cliques
              e atividades de automações podem não estar disponíveis nessa consulta. Os dados
              consultados não são gravados nos contatos ou cards.
            </p>
            <fieldset
              disabled={busy || !status.connected}
              className="flex flex-col sm:flex-row gap-2 disabled:opacity-60"
            >
              <Select
                value={identifier}
                onValueChange={(selection) => {
                  setIdentifier(selection as RdIdentifier);
                  setValue("");
                  setProbe(null);
                }}
                disabled={busy || !status.connected}
              >
                <SelectTrigger className="sm:w-36" aria-label="Identificar lead por">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="uuid">UUID do RD</SelectItem>
                  <SelectItem value="phone">Telefone</SelectItem>
                </SelectContent>
              </Select>
              <input
                className={inputClass}
                aria-label="Identificador do lead"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={
                  identifier === "phone"
                    ? "+5511999999999"
                    : identifier === "email"
                      ? "cliente@empresa.com.br"
                      : "UUID do contato no RD"
                }
              />
              <button
                type="button"
                className={`${buttonClass} flex items-center gap-2 whitespace-nowrap`}
                disabled={!value.trim()}
                onClick={consult}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Consultar lead
              </button>
            </fieldset>
          </div>
          {probe && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border p-4 text-sm space-y-1">
                <p className="font-medium">{probe.contact.name || "Nome não informado pelo RD"}</p>
                <p>E-mail: {probe.contact.email || "Não informado"}</p>
                <p>Telefone: {probe.contact.phone || "Não informado"}</p>
                <p className="text-xs break-all">UUID: {probe.contact.uuid}</p>
                <details>
                  <summary className="cursor-pointer text-primary">JSON do contato</summary>
                  <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap break-all mt-2">
                    {json(probe.contact.raw)}
                  </pre>
                </details>
              </div>
              {probe.pages.map((page) => (
                <div
                  key={`${page.eventType}-${page.page}`}
                  className="rounded-xl border border-border p-4 space-y-3"
                >
                  <p className="text-sm font-medium">
                    {page.eventType === "CONVERSION" ? "Conversões" : "Oportunidades"} · Página{" "}
                    {page.page}
                  </p>
                  {!page.recognized ? (
                    <p className="text-sm text-amber-700">
                      A API retornou um formato ainda não reconhecido. Confira o JSON abaixo.
                    </p>
                  ) : !page.events.length ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhum evento retornado nesta página.
                    </p>
                  ) : (
                    page.events.map((event, index) => (
                      <div
                        key={`${event.id || "event"}-${index}`}
                        className="rounded-lg bg-muted/40 p-3 text-sm space-y-1"
                      >
                        <p className="font-medium">
                          {page.eventType === "OPPORTUNITY"
                            ? "Marcado como oportunidade"
                            : event.identifier || "Evento sem identificador informado"}
                        </p>
                        {event.funnelName && (
                          <p className="text-xs">Funil no RD Marketing: {event.funnelName}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Data: {event.date || "Não informada"}
                        </p>
                        <p className="text-xs break-words">
                          Fonte: {event.source || "Não informada"} · Campanha:{" "}
                          {event.campaign || "Não informada"}
                        </p>
                        {event.medium && <p className="text-xs">Mídia: {event.medium}</p>}
                        {event.links.map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-primary break-all"
                          >
                            {url}
                          </a>
                        ))}
                        <details>
                          <summary className="cursor-pointer text-xs text-primary">
                            Detalhes recebidos
                          </summary>
                          <pre className="max-h-64 overflow-auto text-xs whitespace-pre-wrap break-all mt-2">
                            {json(event.raw)}
                          </pre>
                        </details>
                      </div>
                    ))
                  )}
                  <details>
                    <summary className="cursor-pointer text-xs text-primary">
                      JSON completo da página
                    </summary>
                    <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap break-all mt-2">
                      {json(page.raw)}
                    </pre>
                  </details>
                  {page.nextPage &&
                    !probe.pages.some(
                      (item) => item.eventType === page.eventType && item.page === page.nextPage,
                    ) && (
                      <button
                        type="button"
                        disabled={busy}
                        className={buttonClass}
                        onClick={() => next(page)}
                      >
                        Carregar próxima página
                      </button>
                    )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
