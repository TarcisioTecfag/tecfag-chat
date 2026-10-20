import { runtimeSingleton } from "../runtime-singleton";

/**
 * Registro em memória das conexões WebSocket de visitantes do site.
 * Chave sempre composta por tenant + visitante: um visitante de outra empresa nunca
 * recebe eventos, mesmo que um ID seja reaproveitado.
 */
type SiteSend = (payload: unknown) => void;

class SiteGateway {
  private connections = new Map<string, Set<SiteSend>>();

  private key(tenantId: string, visitorId: string) {
    return `${tenantId}:${visitorId}`;
  }

  register(tenantId: string, visitorId: string, send: SiteSend) {
    const key = this.key(tenantId, visitorId);
    const set = this.connections.get(key) ?? new Set<SiteSend>();
    set.add(send);
    this.connections.set(key, set);
    return () => {
      const current = this.connections.get(key);
      if (!current) return;
      current.delete(send);
      if (!current.size) this.connections.delete(key);
    };
  }

  /** Retorna true quando ao menos uma aba conectada recebeu o evento. */
  push(tenantId: string, visitorId: string, payload: unknown): boolean {
    const set = this.connections.get(this.key(tenantId, visitorId));
    if (!set?.size) return false;
    let delivered = false;
    for (const send of set) {
      try {
        send(payload);
        delivered = true;
      } catch {
        /* conexão encerrada; o histórico persistido cobre a reconexão */
      }
    }
    return delivered;
  }

  isOnline(tenantId: string, visitorId: string) {
    return Boolean(this.connections.get(this.key(tenantId, visitorId))?.size);
  }
}

export const siteGateway = runtimeSingleton("SiteGateway", () => new SiteGateway());
