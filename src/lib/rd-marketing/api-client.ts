import { CrmError } from "../crm/crm-service";
import type { RdEventPage, RdEventType, RdIdentifier, RdProbe } from "./api-types";
import { conversionAttribution } from "./attribution";
import { RD_ACTIVITY_EVENTS } from "./activity-events";

export type RdFetch = typeof fetch;
export const RD_API = "https://api.rd.services";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (...values: unknown[]): string | null => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value;
  return null;
};

// The proof exposes lead data to the tenant administrator, never provider credentials.
export function sanitizeRdResponse(value: unknown, depth = 0): unknown {
  if (depth > 30) return "[limite de profundidade]";
  if (Array.isArray(value)) return value.map((item) => sanitizeRdResponse(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /^(access_token|refresh_token|client_secret|authorization|password|api_key)$/i.test(key)
          ? "[oculto]"
          : sanitizeRdResponse(item, depth + 1),
      ]),
    );
  return value;
}

export async function rdRequest(
  path: string,
  init: RequestInit,
  fetchImpl: RdFetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${RD_API}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: { Accept: "application/json", ...init.headers },
    });
  } catch {
    throw new CrmError("O RD não respondeu. Tente novamente.", "RD_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    const fieldValidation =
      path === "/platform/contacts/fields" && [400, 422].includes(response.status)
        ? await rdFieldValidation(response)
        : "";
    if (!fieldValidation) await response.body?.cancel().catch(() => {});
    const messages: Record<number, string> = {
      400: "O RD recusou os dados da consulta ou autorização.",
      401: "A autorização do RD expirou ou foi revogada. Reconecte a conta.",
      403: "O aplicativo não tem permissão para esta consulta no RD.",
      404: "Lead não encontrado no RD Marketing.",
      422: "O RD recusou os campos enviados. Revise os dados do evento.",
      429: "Limite de consultas do RD atingido. Aguarde e tente novamente.",
    };
    const error = new CrmError(
      `${messages[response.status] || "Não foi possível concluir a operação no RD."} (HTTP ${response.status})`,
      `RD_HTTP_${response.status}`,
      response.status >= 500 ? 503 : response.status,
    );
    if (fieldValidation) Object.assign(error, { rdFieldValidation: fieldValidation });
    throw error;
  }
  const reader = response.body?.getReader();
  if (!reader) throw new CrmError("Resposta vazia do RD.", "RD_RESPONSE_INVALID", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new CrmError(
          "Resposta do RD excedeu o limite da consulta.",
          "RD_RESPONSE_TOO_LARGE",
          502,
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof CrmError) throw error;
    throw new CrmError("Formato de resposta do RD inválido.", "RD_RESPONSE_INVALID", 502);
  } finally {
    reader.releaseLock();
  }
}

// Field setup errors may include arbitrary provider messages/values. Expose only
// documented validation codes and schema paths, never the raw response or messages.
async function rdFieldValidation(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        return "";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const errors = object(JSON.parse(new TextDecoder().decode(bytes))).errors;
    const paths = new Set([
      "name",
      "label",
      "pt-BR",
      "default",
      "api_identifier",
      "data_type",
      "presentation_type",
      "validation_rules",
      "valid_options",
    ]);
    const codes = new Set([
      "CANNOT_BE_BLANK",
      "TAKEN",
      "EXCLUSION",
      "INVALID",
      "TOO_LONG",
      "TOO_SHORT",
    ]);
    const found = new Set<string>();
    const walk = (value: unknown, path: string[], depth: number) => {
      if (depth > 5) return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, path, depth + 1);
        return;
      }
      const node = object(value);
      if (path.length && typeof node.error_type === "string" && codes.has(node.error_type))
        found.add(`${path.join(".")}: ${node.error_type}`);
      for (const [key, item] of Object.entries(node))
        if (paths.has(key)) walk(item, [...path, key], depth + 1);
    };
    walk(errors, [], 0);
    return [...found].join("; ");
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

export function rdContactPath(identifier: RdIdentifier, value: string): string {
  value = value.trim();
  if (
    identifier === "uuid" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new CrmError("Informe um UUID válido do lead no RD.", "BAD_REQUEST");
  if (identifier === "email" && (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))
    throw new CrmError("Informe um e-mail válido.", "BAD_REQUEST");
  if (identifier === "phone") {
    value = value.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(value))
      throw new CrmError(
        "Informe o telefone com código do país, como +5511999999999.",
        "BAD_REQUEST",
      );
  }
  if (!["uuid", "email", "phone"].includes(identifier))
    throw new CrmError("Identificador inválido.", "BAD_REQUEST");
  return `/platform/contacts/${identifier}:${encodeURIComponent(value)}`;
}

export function parseRdContact(raw: unknown): RdProbe["contact"] {
  const root = object(raw);
  const contact = typeof root.uuid === "string" ? root : object(root.contact ?? root.data);
  const uuid = string(contact.uuid);
  if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid))
    throw new CrmError(
      "O RD não retornou o UUID do contato. Confira a resposta e as permissões do aplicativo.",
      "RD_CONTACT_INVALID",
      502,
    );
  return {
    uuid,
    name: string(contact.name),
    email: string(contact.email),
    phone: string(contact.mobile_phone, contact.personal_phone, contact.phone),
    raw: sanitizeRdResponse(raw),
  };
}

export function rdEventsPath(uuid: string, eventType: RdEventType, page: number): string {
  rdContactPath("uuid", uuid);
  if (
    !["CONVERSION", "OPPORTUNITY"].includes(eventType) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 1000
  )
    throw new CrmError("Página ou tipo de evento inválido.", "BAD_REQUEST");
  return `/platform/contacts/${encodeURIComponent(uuid)}/events?event_type=${eventType}&order=created_at:desc&page=${page}`;
}

export function parseRdEventPage(raw: unknown, eventType: RdEventType, page: number): RdEventPage {
  const root = object(raw);
  const list: unknown[] | null = Array.isArray(raw)
    ? raw
    : Array.isArray(root.events)
      ? root.events
      : Array.isArray(root.data)
        ? root.data
        : null;
  return {
    eventType,
    page,
    recognized: list !== null,
    nextPage: list && list.length >= 10 && page < 1000 ? page + 1 : null,
    events: (list || []).map((item) => {
      const event = object(item),
        payload = object(event.payload),
        attribution = conversionAttribution(event);
      const activity = Object.values(RD_ACTIVITY_EVENTS).find(
        (e) => e.identifier === (payload.conversion_identifier || event.event_identifier),
      );
      const links = [
        payload.url,
        payload.page_url,
        payload.deal_url,
        payload.opportunity_url,
        activity ? payload.cf_tecfag_chat_registro_url : null,
        event.url,
      ].filter((url): url is string => {
        if (typeof url !== "string") return false;
        try {
          const parsed = new URL(url);
          return (
            ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password
          );
        } catch {
          return false;
        }
      });
      return {
        label: activity ? `${activity.label} · Tecfag Chat` : undefined,
        details: activity ? string(payload.cf_tecfag_chat_detalhes) : null,
        id: string(event.event_uuid, event.uuid, event.id),
        identifier: string(
          payload.conversion_identifier,
          event.conversion_identifier,
          event.event_identifier,
          event.event_type,
        ),
        date: string(
          event.event_timestamp,
          event.occurred_at,
          payload.event_timestamp,
          event.created_at,
          payload.created_at,
        ),
        source: attribution.source,
        campaign: attribution.campaign,
        medium: attribution.medium,
        funnelName: string(payload.funnel_name),
        links: [...new Set(links)],
        raw: sanitizeRdResponse(item),
      };
    }),
    raw: sanitizeRdResponse(raw),
  };
}
