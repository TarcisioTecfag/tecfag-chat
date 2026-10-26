import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { useChat } from "@/hooks/useChatState";
import { useWhatsappConnections, whatsappConnectionAction } from "@/hooks/useWhatsappConnections";

const base = import.meta.env.VITE_BACKEND_URL || "";
export function WhatsappConnectionsPanel() {
  const { tenant, operators, currentOperatorId } = useChat();
  const { enabled, canManage, encryptionReady, connections, refresh } =
    useWhatsappConnections(tenant);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [capture, setCapture] = useState("selected");
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<string | null>(null);
  const [qr, setQr] = useState("");
  const [pairError, setPairError] = useState("");
  useEffect(() => {
    setPairing(null);
    setQr("");
    setPairError("");
  }, [tenant]);
  useEffect(() => {
    if (!pairing) return;
    const controller = new AbortController();
    let working = false;
    setQr("");
    setPairError("");
    const poll = async () => {
      if (working) return;
      working = true;
      try {
        const response = await fetch(
          `${base}/api/whatsapp/connections?id=${encodeURIComponent(pairing)}`,
          { credentials: "include", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Conexão indisponível.");
        const image = data.qr ? await QRCode.toDataURL(data.qr, { width: 256, margin: 2 }) : "";
        if (controller.signal.aborted) return;
        setQr(image);
        setPairError(data.error || "");
        if (data.status === "connected") {
          setPairing(null);
          toast.success("WhatsApp conectado.");
          await refresh();
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setQr("");
          setPairError(e instanceof Error ? e.message : "Falha ao consultar QR.");
        }
      } finally {
        working = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [pairing, refresh]);
  const action = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await whatsappConnectionAction(body);
      await refresh();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na conexão.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!enabled) return null;
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold">WhatsApps dos vendedores</h3>
      <p className="text-xs text-muted-foreground">
        Cada número funciona junto com o WhatsApp da empresa. O titular conecta a própria conta pelo
        QR.
      </p>
      {connections
        .filter((c) => !c.corporate)
        .map((c) => (
          <div
            key={c.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-xs"
          >
            <div className="flex-1 min-w-36">
              <strong>{c.name}</strong>
              <p>
                {c.phone || "Número ainda não pareado"} ·{" "}
                {c.status === "connected" ? "Conectado" : "Desconectado"}
              </p>
              <p className="text-muted-foreground">
                {c.capturePolicy === "all"
                  ? "Conta integralmente integrada"
                  : "Somente contatos selecionados"}
              </p>
              {c.error && <p role="alert">{c.error}</p>}
            </div>
            <button
              className="rounded border px-3 py-2"
              disabled={busy || !c.enabled}
              onClick={async () => {
                if (await action({ action: "connect", connectionId: c.id })) setPairing(c.id);
              }}
            >
              Conectar / QR
            </button>
            <button
              className="rounded border px-3 py-2"
              disabled={busy}
              onClick={async () => {
                if (await action({ action: "disconnect", connectionId: c.id })) {
                  setPairing(null);
                  setQr("");
                }
              }}
            >
              Desconectar
            </button>
          </div>
        ))}
      {pairing && (
        <div className="rounded-lg border p-4 text-center space-y-2">
          <p className="text-xs">
            No celular, abra Aparelhos conectados e leia este QR. A integração recebe os eventos da
            conta; a política escolhida determina o que será armazenado.
          </p>
          {qr ? (
            <img
              className="mx-auto"
              src={qr}
              alt="QR de pareamento do seu WhatsApp"
              width={256}
              height={256}
            />
          ) : (
            <p className="text-sm">Gerando QR ou restaurando sessão…</p>
          )}
          {pairError && (
            <p role="alert" className="text-xs text-destructive">
              {pairError}
            </p>
          )}
          <button
            className="text-xs underline"
            onClick={() => {
              setPairing(null);
              setQr("");
            }}
          >
            Fechar QR
          </button>
        </div>
      )}
      {canManage && (
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await action({
                action: "create",
                name,
                ownerOperatorId: owner || currentOperatorId,
                capturePolicy: capture,
              })
            )
              setName("");
          }}
        >
          <p className="text-xs font-semibold">Adicionar número de vendedor</p>
          <input
            aria-label="Nome da conexão"
            required
            maxLength={80}
            className="w-full rounded border bg-background p-2 text-sm"
            placeholder="Ex.: WhatsApp do João"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            aria-label="Titular da conexão"
            className="w-full rounded border bg-background p-2 text-sm"
            value={owner || currentOperatorId}
            onChange={(e) => setOwner(e.target.value)}
          >
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Conversas armazenadas"
            className="w-full rounded border bg-background p-2 text-sm"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
          >
            <option value="selected">Somente contatos selecionados para este número</option>
            <option value="all">Integrar todas as conversas individuais da conta</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {capture === "all"
              ? "Todas as conversas individuais e o histórico disponibilizado pelo WhatsApp poderão ser armazenados e consultados por administradores autorizados."
              : "Iniciar uma conversa por este número seleciona o contato para sincronização. Outros contatos não serão armazenados."}
          </p>
          {!encryptionReady && (
            <p className="text-xs text-destructive">
              A chave de proteção das novas conexões precisa ser configurada no servidor.
            </p>
          )}
          <button
            disabled={busy || !encryptionReady}
            className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
          >
            Adicionar conexão
          </button>
        </form>
      )}
    </section>
  );
}

export function WhatsappConversationConnection({
  contactId,
  connectionId,
  showAll,
  onShowAll,
  onOpen,
}: {
  contactId?: string;
  connectionId?: string | null;
  showAll: boolean;
  onShowAll: (value: boolean) => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const { tenant } = useChat();
  const { enabled, connections } = useWhatsappConnections(tenant);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const current = connections.find((c) => c.id === (connectionId || "corporate"));
  useEffect(() => setSelected(connectionId || "corporate"), [connectionId, contactId]);
  if (!enabled) return null;
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-2 space-y-2 text-xs">
      <p>
        <strong>Respondendo por: {current?.name || "Conexão deste atendimento"}</strong>
        {current?.phone ? ` · ${current.phone}` : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
          Histórico de todos os números autorizados
        </label>
        <select
          aria-label="Conversar por outro número"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="max-w-full rounded border bg-background p-1.5"
        >
          {connections
            .filter((c) => c.enabled)
            .map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
                {c.phone ? ` · ${c.phone}` : ""}
              </option>
            ))}
        </select>
        <button
          disabled={busy || !contactId || !selected}
          className="rounded border bg-background px-2 py-1.5 disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            try {
              const data = await whatsappConnectionAction({
                action: "start",
                connectionId: selected,
                contactId,
              });
              await onOpen(data.conversationId);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Não foi possível abrir a conversa.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Abrir conversa por este número
        </button>
      </div>
      <details>
        <summary className="cursor-pointer">Conectar meu WhatsApp</summary>
        <div className="pt-2">
          <WhatsappConnectionsPanel />
        </div>
      </details>
    </div>
  );
}
