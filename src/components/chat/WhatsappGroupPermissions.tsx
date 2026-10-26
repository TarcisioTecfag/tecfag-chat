import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Smartphone, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useChat } from "@/hooks/useChatState";
import { usePermissions } from "@/hooks/usePermissions";

const endpoint = `${import.meta.env.VITE_BACKEND_URL || ""}/api/groups/whatsapp-connections`;
type ConnectionAccess = {
  id: string;
  name: string;
  phone: string | null;
  enabled: boolean;
  canRead: boolean;
  canSend: boolean;
  revision: string;
};

export function WhatsappGroupPermissions({ groupId, search }: { groupId: string; search: string }) {
  const { tenant, sessionRole } = useChat();
  const { canManageAccessGroups, canAccessView } = usePermissions();
  const allowed = sessionRole === "admin" && canManageAccessGroups && canAccessView("groups");
  const [connections, setConnections] = useState<ConnectionAccess[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!allowed || !tenant || !groupId) return;
      setLoading(true);
      try {
        const response = await fetch(`${endpoint}?groupId=${encodeURIComponent(groupId)}`, {
          credentials: "include",
          signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Não foi possível consultar os números.");
        if (signal?.aborted) return;
        setEnabled(data.enabled === true);
        setConnections(data.connections || []);
        setError("");
      } catch (cause) {
        if (!signal?.aborted) {
          setConnections([]);
          setError(cause instanceof Error ? cause.message : "Falha ao consultar permissões.");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [allowed, tenant, groupId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const save = async (connection: ConnectionAccess, canRead: boolean, canSend: boolean) => {
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          connectionId: connection.id,
          canRead,
          canSend,
          expectedRevision: connection.revision,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        await load();
        throw Error(data.error || "Não foi possível salvar.");
      }
      setConnections((current) =>
        current.map((row) => (row.id === connection.id ? { ...row, ...data.access } : row)),
      );
      toast.success("Permissão do número atualizada.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };
  if (!allowed) return null;
  const term = search.trim().toLowerCase();
  const matchesSection =
    !term ||
    [
      "whatsapp",
      "números",
      "numeros",
      "histórico",
      "historico",
      "visualizar",
      "enviar",
      "mensagens",
    ].some((word) => word.includes(term));
  const visible = matchesSection
    ? connections
    : connections.filter((row) => `${row.name} ${row.phone || ""}`.toLowerCase().includes(term));
  if (term && !matchesSection && !visible.length) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 bg-muted/20 px-4 py-3">
        <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide">
          <Smartphone className="h-4 w-4 text-primary" />
          Acesso aos números de WhatsApp
        </h4>
        <button
          type="button"
          aria-label="Atualizar permissões dos números"
          className="rounded-lg p-2 hover:bg-muted"
          disabled={loading || saving}
          onClick={() => void load()}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          Escolha quais números este grupo pode consultar e usar para enviar mensagens. O titular e
          os administradores autorizados mantêm acesso. As regras de filas e atendimento continuam
          valendo; isso não permite parear ou desconectar aparelhos.
        </p>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : loading ? (
          <p className="text-xs text-muted-foreground">Carregando números…</p>
        ) : !enabled ? (
          <p className="text-xs text-muted-foreground">
            Conexões adicionais não estão habilitadas nesta empresa.
          </p>
        ) : !connections.length ? (
          <p className="text-xs text-muted-foreground">
            Nenhum número adicional cadastrado. Cadastre os aparelhos em Ajustes → WhatsApp.
          </p>
        ) : (
          visible.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <div className="min-w-0 text-xs">
                <p className="font-bold">{connection.name}</p>
                <p className="text-muted-foreground">
                  {connection.phone || "Número ainda não pareado"}
                  {!connection.enabled ? " · Desativado" : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    aria-label={`Visualizar histórico: ${connection.name}`}
                    checked={connection.canRead}
                    disabled={saving || loading}
                    onCheckedChange={(checked) =>
                      void save(
                        connection,
                        checked === true,
                        checked === true && connection.canSend,
                      )
                    }
                  />
                  Visualizar histórico
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    aria-label={`Enviar mensagens: ${connection.name}`}
                    checked={connection.canSend}
                    disabled={saving || loading}
                    onCheckedChange={(checked) =>
                      void save(
                        connection,
                        checked === true || connection.canRead,
                        checked === true,
                      )
                    }
                  />
                  Enviar mensagens
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
