import { useCallback, useEffect, useState } from "react";
import type { Message } from "@/lib/mockData";

const base = import.meta.env.VITE_BACKEND_URL || "";
export type WhatsappConnection = {
  id: string;
  name: string;
  provider: "meta" | "baileys";
  corporate: boolean;
  ownerOperatorId?: string;
  phone?: string | null;
  status: string;
  enabled: boolean;
  capturePolicy?: "selected" | "all";
  error?: string | null;
  canSend?: boolean;
  canPair?: boolean;
  groupAccess?: Array<{ groupId: string; canRead: boolean; canSend: boolean }>;
};
type ConnectionState = {
  loaded: boolean;
  canUseNumberPicker: boolean;
  canSwitchDuringAttendance: boolean;
  isDedicatedBaileysUser: boolean;
  dedicatedConnectionId: string | null;
  enabled: boolean;
  canManage: boolean;
  encryptionReady: boolean;
  connections: WhatsappConnection[];
  accessGroups: Array<{ id: string; name: string }>;
};
const empty: ConnectionState = {
  loaded: false,
  canUseNumberPicker: false,
  canSwitchDuringAttendance: false,
  isDedicatedBaileysUser: false,
  dedicatedConnectionId: null,
  enabled: false,
  canManage: false,
  encryptionReady: false,
  connections: [],
  accessGroups: [],
};
const connectionsCacheByTenant = new Map<string, ConnectionState>();

export function clearWhatsappConnectionsCache() {
  connectionsCacheByTenant.clear();
}

export function useWhatsappConnections(tenantId: string) {
  const [state, setState] = useState<ConnectionState>(() =>
    tenantId ? connectionsCacheByTenant.get(tenantId) || empty : empty,
  );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!tenantId) {
        setState(empty);
        return;
      }
      const response = await fetch(`${base}/api/whatsapp/connections`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) {
        const next: ConnectionState = { ...empty, loaded: true };
        connectionsCacheByTenant.set(tenantId, next);
        if (!signal?.aborted) setState(next);
        return;
      }
      const data = await response.json();
      const next: ConnectionState = { ...empty, ...data, loaded: true };
      connectionsCacheByTenant.set(tenantId, next);
      if (!signal?.aborted) setState(next);
    },
    [tenantId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setState(tenantId ? connectionsCacheByTenant.get(tenantId) || empty : empty);
    void refresh(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [refresh, tenantId]);
  return { ...state, refresh };
}

export async function whatsappConnectionAction(body: Record<string, unknown>) {
  const response = await fetch(`${base}/api/whatsapp/connections`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível realizar a ação.");
  return data;
}

export function useContactWhatsappHistory(
  tenantId: string,
  conversationId: string | undefined,
  enabled: boolean,
) {
  const [state, setState] = useState<{
    scope: string;
    messages: Message[];
    cursor: string | null;
    error: string;
  }>({ scope: "", messages: [], cursor: null, error: "" });
  const [loading, setLoading] = useState(false);
  const scope = `${tenantId}:${conversationId}`;
  const load = useCallback(
    async (before?: string, signal?: AbortSignal) => {
      if (!enabled || !conversationId) return;
      setLoading(true);
      try {
        const query = new URLSearchParams({ conversationId });
        if (before) query.set("before", before);
        const response = await fetch(`${base}/api/whatsapp/contact-history?${query}`, {
          credentials: "include",
          signal,
        });
        if (!response.ok) throw new Error("Não foi possível atualizar o histórico autorizado.");
        const data = await response.json();
        if (signal?.aborted) return;
        setState((current) => {
          const visible = new Set<string>(data.visibleConversationIds);
          const previous =
            current.scope === scope
              ? current.messages.filter((m) => m.conversationId && visible.has(m.conversationId))
              : [];
          const byId = new Map(previous.map((m) => [m.id, m]));
          for (const message of data.messages) byId.set(message.id, message);
          return {
            scope,
            messages: [...byId.values()].sort(
              (a, b) =>
                (a.sentAtISO || "").localeCompare(b.sentAtISO || "") || a.id.localeCompare(b.id),
            ),
            cursor:
              before || current.scope !== scope || !current.cursor
                ? data.nextCursor
                : current.cursor,
            error: "",
          };
        });
      } catch (error) {
        if (!signal?.aborted)
          setState({
            scope,
            messages: [],
            cursor: null,
            error: error instanceof Error ? error.message : "Histórico indisponível.",
          });
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [enabled, conversationId, scope],
  );
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "hidden") void load(undefined, controller.signal);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("chat:reconnected", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("chat:reconnected", refresh);
    };
  }, [load, enabled]);
  return {
    messages: enabled && state.scope === scope ? state.messages : [],
    error: state.scope === scope ? state.error : "",
    hasMore: state.scope === scope && !!state.cursor,
    loading,
    loadMore: () => load(state.cursor || undefined),
  };
}
