import { useEffect, useState } from "react";
import { useChat } from "@/hooks/useChatState";
import {
  defaultVtexSettings,
  type VtexSettings,
  type VtexResult,
  type VtexChannel,
} from "@/lib/vtex/contract";
import { formatVtexAnswer } from "@/lib/vtex/turn";

const inputClass = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const buttonClass =
  "rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50";
type State = {
  revision: number;
  settings: VtexSettings;
  hasCredentials: boolean;
  encryptionReady: boolean;
};
export function VtexStoreCard({ backendUrl }: { backendUrl: string }) {
  const { sessionRole, tenant } = useChat();
  const [state, setState] = useState<State | null>(null);
  const [settings, setSettings] = useState(defaultVtexSettings);
  const [appKey, setAppKey] = useState(""),
    [appToken, setAppToken] = useState("");
  const [clearCredentials, setClearCredentials] = useState(false);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"sku" | "url" | "term">("sku"),
    [value, setValue] = useState("");
  const [channel, setChannel] = useState<VtexChannel>("livechat");
  const [intent, setIntent] = useState<"details" | "price" | "shipping">("details");
  const [postalCode, setPostalCode] = useState(""),
    [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<VtexResult | null>(null);
  useEffect(() => {
    if (sessionRole !== "admin") return;
    const controller = new AbortController();
    setState(null);
    setMessage("");
    setAppKey("");
    setAppToken("");
    setResult(null);
    void fetch(`${backendUrl}/api/livechat/vtex-config`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar a integração.");
        if (!controller.signal.aborted) {
          setState(data);
          setSettings(data.settings);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [backendUrl, tenant, sessionRole]);
  if (sessionRole !== "admin") return null;
  const policyLabels = {
    catalog: "Especificações",
    price: "Preço público",
    availability: "Disponibilidade",
    shipping: "Frete público",
  };
  async function submit(action: "save" | "test") {
    if (!state || busy) return;
    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const body =
        action === "save"
          ? {
              action,
              expectedRevision: state.revision,
              settings,
              ...(appKey ? { appKey } : {}),
              ...(appToken ? { appToken } : {}),
              clearCredentials,
            }
          : {
              action,
              settings,
              channel,
              intent,
              query: { kind, value, quantity, ...(postalCode ? { postalCode } : {}) },
            };
      const response = await fetch(`${backendUrl}/api/livechat/vtex-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
      if (action === "save") {
        setState(data);
        setSettings(data.settings);
        setAppKey("");
        setAppToken("");
        setClearCredentials(false);
        setMessage("Integração salva. A habilitação do SDR e do site continua independente.");
      } else {
        setResult(data.result);
        setMessage("Consulta de teste concluída sem salvar configurações ou criar pedidos.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Erro de comunicação.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-2xl border border-border bg-card p-6 space-y-4"
      aria-label="Integração VTEX"
    >
      <div>
        <h3 className="text-base font-bold">Loja VTEX</h3>
        <p className="text-xs text-muted-foreground">
          Catálogo oficial, preço e simulação pública de frete. Configuração por empresa.
        </p>
      </div>
      {message && (
        <p role="status" className="text-sm whitespace-pre-wrap rounded-lg border p-3">
          {message}
        </p>
      )}
      {!state ? (
        <p className="text-sm">
          {message ? "Reabra a aba para tentar carregar novamente." : "Carregando configuração…"}
        </p>
      ) : (
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs">
              Conta VTEX
              <input
                aria-label="Conta VTEX"
                className={inputClass}
                value={settings.account}
                onChange={(event) => setSettings({ ...settings, account: event.target.value })}
                placeholder="nome-da-conta"
              />
            </label>
            <label className="text-xs">
              Domínio da loja
              <input
                aria-label="Domínio da loja VTEX"
                className={inputClass}
                value={settings.storefrontOrigin}
                onChange={(event) =>
                  setSettings({ ...settings, storefrontOrigin: event.target.value })
                }
                placeholder="https://www.sualoja.com.br"
              />
            </label>
            <label className="text-xs">
              Canal de venda
              <input
                aria-label="Canal de venda VTEX"
                className={inputClass}
                value={settings.salesChannel}
                onChange={(event) => setSettings({ ...settings, salesChannel: event.target.value })}
              />
            </label>
            <label className="text-xs">
              Vendedor
              <input
                aria-label="Vendedor VTEX"
                className={inputClass}
                value={settings.sellerId}
                onChange={(event) => setSettings({ ...settings, sellerId: event.target.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
            />
            Usar consultas VTEX no atendimento
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            {(["livechat", "whatsapp"] as const).map((key) => (
              <fieldset className="rounded-lg border p-3 space-y-2" key={key}>
                <legend className="text-sm font-semibold">
                  {key === "livechat" ? "Site" : "WhatsApp"}
                </legend>
                {(Object.keys(policyLabels) as (keyof typeof policyLabels)[]).map((field) => (
                  <label className="flex items-center gap-2 text-xs" key={field}>
                    <input
                      type="checkbox"
                      checked={settings.channels[key][field]}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          channels: {
                            ...settings.channels,
                            [key]: { ...settings.channels[key], [field]: event.target.checked },
                          },
                        })
                      }
                    />
                    {policyLabels[field]}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <details className="rounded-lg border p-3 space-y-3">
            <summary className="text-sm font-semibold cursor-pointer">
              Credenciais opcionais
            </summary>
            <p className="text-xs text-muted-foreground">
              Consultas públicas não exigem AppKey/AppToken. Quando informados, os valores são
              criptografados no servidor e não são devolvidos ao navegador. Simulações de frete são
              anônimas.
            </p>
            <p className="text-xs">
              {state.hasCredentials ? "Credenciais armazenadas." : "Sem credenciais armazenadas."}{" "}
              {state.encryptionReady
                ? "Criptografia disponível."
                : "Criptografia ainda não configurada no servidor; consultas públicas continuam disponíveis."}
            </p>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={settings.useCredentials}
                onChange={(event) =>
                  setSettings({ ...settings, useCredentials: event.target.checked })
                }
              />
              Usar credenciais no catálogo
            </label>
            <label className="block text-xs">
              AppKey
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={appKey}
                onChange={(event) => setAppKey(event.target.value)}
                placeholder="Vazio mantém a credencial atual"
              />
            </label>
            <label className="block text-xs">
              AppToken
              <input
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={appToken}
                onChange={(event) => setAppToken(event.target.value)}
                placeholder="Vazio mantém a credencial atual"
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={clearCredentials}
                onChange={(event) => setClearCredentials(event.target.checked)}
              />
              Remover credenciais armazenadas ao salvar
            </label>
          </details>
          <button
            className={`${buttonClass} bg-primary text-primary-foreground`}
            type="button"
            onClick={() => void submit("save")}
          >
            Salvar integração VTEX
          </button>
          <div className="border-t pt-4 space-y-3">
            <h4 className="text-sm font-semibold">Testar consulta sem salvar</h4>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs">
                Buscar por
                <select
                  className={inputClass}
                  value={kind}
                  onChange={(event) => setKind(event.target.value as typeof kind)}
                >
                  <option value="sku">SKU</option>
                  <option value="url">URL do produto</option>
                  <option value="term">Nome ou termo</option>
                </select>
              </label>
              <label className="text-xs md:col-span-2">
                Consulta
                <input
                  aria-label="Consulta VTEX"
                  className={inputClass}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
              <label className="text-xs">
                Canal
                <select
                  className={inputClass}
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as VtexChannel)}
                >
                  <option value="livechat">Site</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </label>
              <label className="text-xs">
                Informação
                <select
                  className={inputClass}
                  value={intent}
                  onChange={(event) => setIntent(event.target.value as typeof intent)}
                >
                  <option value="details">Especificações</option>
                  <option value="price">Preço</option>
                  <option value="shipping">Frete</option>
                </select>
              </label>
              <label className="text-xs">
                Quantidade
                <input
                  type="number"
                  min="1"
                  max="100"
                  className={inputClass}
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              </label>
              <label className="text-xs">
                CEP de teste
                <input
                  className={inputClass}
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  placeholder="Somente para simular entrega"
                />
              </label>
            </div>
            <button className={buttonClass} type="button" onClick={() => void submit("test")}>
              Testar consulta VTEX
            </button>
            {result && (
              <div
                className="rounded-lg border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words"
                aria-label="Resultado da consulta VTEX"
              >
                {formatVtexAnswer(result, intent).join("\n\n")}
              </div>
            )}
          </div>
        </fieldset>
      )}
    </section>
  );
}
