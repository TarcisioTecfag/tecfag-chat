import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { channelConfigs, metaMessageTemplates } from "../../db/schema";
import { bodyVariableIndexes, type TemplateBinding, type TemplateBindings } from "./meta-template-common";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export interface MetaTemplateInput {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  bodyText: string;
  examples: string[];
  bindings: TemplateBindings;
}

async function credentials(tenantId: string) {
  const [config] = await db.select({
    wabaId: channelConfigs.metaBusinessAccountId,
    token: channelConfigs.metaAccessToken,
  }).from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId));
  if (!config?.wabaId || !config.token) throw new Error("Conta WhatsApp Business ou token da Meta não configurado neste tenant.");
  return { wabaId: config.wabaId, token: config.token };
}

async function graphRequest(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw new Error(data?.error?.message || `Meta retornou HTTP ${response.status}.`);
  return data;
}

export function validateMetaTemplateInput(value: unknown): MetaTemplateInput {
  const input = (value || {}) as Partial<MetaTemplateInput>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const language = typeof input.language === "string" ? input.language.trim() : "";
  const bodyText = typeof input.bodyText === "string" ? input.bodyText.trim() : "";
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new Error("Nome: use apenas letras minúsculas, números e _. ");
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(language)) throw new Error("Idioma inválido. Exemplo: pt_BR.");
  if (input.category !== "UTILITY" && input.category !== "MARKETING") throw new Error("Categoria inválida.");
  if (!bodyText || bodyText.length > 1024) throw new Error("O corpo deve conter de 1 a 1024 caracteres.");
  const indexes = bodyVariableIndexes(bodyText);
  if ([...bodyText.matchAll(/\{\{([^{}]+)\}\}/g)].length !== [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].length) {
    throw new Error("Use variáveis numéricas como {{1}}; os atalhos @nome são configurados abaixo.");
  }
  if (indexes.some((index, offset) => index !== offset + 1)) throw new Error("As variáveis devem seguir {{1}}, {{2}}... sem saltos.");
  const examples = Array.isArray(input.examples) ? input.examples.map((item) => String(item || "").trim()) : [];
  if (examples.length !== indexes.length || examples.some((item) => !item)) throw new Error("Informe um exemplo para cada variável.");
  const bindings: TemplateBindings = {};
  for (const index of indexes) {
    const binding = input.bindings?.[String(index)] || "manual";
    if (!(["customer_name", "operator_name", "manual"] as string[]).includes(binding)) throw new Error("Vínculo de variável inválido.");
    bindings[String(index)] = binding;
  }
  return { name, language, category: input.category, bodyText, examples, bindings };
}

function componentsFor(input: MetaTemplateInput) {
  return [{
    type: "BODY",
    text: input.bodyText,
    ...(input.examples.length ? { example: { body_text: [input.examples] } } : {}),
  }];
}

async function saveSnapshot(tenantId: string, item: any, bindings?: TemplateBindings) {
  if (!item?.id || !item?.name || !item?.language) return;
  const components = Array.isArray(item.components) ? item.components : [];
  const bodyText = String(components.find((part: any) => part.type === "BODY")?.text || "");
  const id = `${tenantId}:${item.id}`;
  const [existing] = await db.select({ bindings: metaMessageTemplates.bindings }).from(metaMessageTemplates)
    .where(and(eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, String(item.id))));
  await db.insert(metaMessageTemplates).values({
    id, tenantId, metaTemplateId: String(item.id), name: item.name,
    language: item.language, category: item.category || "", status: item.status || "PENDING",
    bodyText, components, bindings: bindings || existing?.bindings || {},
    rejectedReason: item.rejected_reason || null, lastSyncedAt: new Date(),
  }).onConflictDoUpdate({ target: metaMessageTemplates.id, set: {
    name: item.name, language: item.language, category: item.category || "",
    status: item.status || "PENDING", bodyText, components,
    bindings: bindings || existing?.bindings || {}, rejectedReason: item.rejected_reason || null,
    lastSyncedAt: new Date(),
  } });
}

export async function syncMetaTemplates(tenantId: string) {
  const { wabaId, token } = await credentials(tenantId);
  const base = `${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates`;
  let url: string | null = `${base}?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
  const seen = new Set<string>();
  for (let page = 0; url; page++) {
    if (page >= 50) throw new Error("A lista da Meta excedeu o limite de páginas permitido.");
    const data = await graphRequest(url, token);
    for (const item of data.data || []) {
      seen.add(String(item.id));
      await saveSnapshot(tenantId, item);
    }
    const next = data.paging?.next;
    if (!next) { url = null; continue; }
    const parsed = new URL(next);
    if (parsed.origin !== "https://graph.facebook.com" || parsed.pathname !== new URL(base).pathname) throw new Error("Paginação inesperada da Meta.");
    url = parsed.toString();
  }
  const local = await db.select().from(metaMessageTemplates).where(eq(metaMessageTemplates.tenantId, tenantId));
  for (const item of local) {
    if (!seen.has(item.metaTemplateId) && item.status !== "DELETED") {
      await db.update(metaMessageTemplates).set({ status: "DELETED", lastSyncedAt: new Date() })
        .where(and(eq(metaMessageTemplates.id, item.id), eq(metaMessageTemplates.tenantId, tenantId)));
    }
  }
  return db.select().from(metaMessageTemplates).where(eq(metaMessageTemplates.tenantId, tenantId));
}

export async function createMetaTemplate(tenantId: string, value: unknown) {
  const input = validateMetaTemplateInput(value);
  const { wabaId, token } = await credentials(tenantId);
  const data = await graphRequest(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates`, token, {
    method: "POST", body: JSON.stringify({ name: input.name, language: input.language, category: input.category, components: componentsFor(input) }),
  });
  if (!data.id) throw new Error("A Meta não retornou o ID do template.");
  await saveSnapshot(tenantId, { ...input, id: data.id, status: data.status || "PENDING", components: componentsFor(input), category: data.category || input.category }, input.bindings);
  return data;
}

export async function updateMetaTemplate(tenantId: string, metaTemplateId: string, value: unknown) {
  const input = validateMetaTemplateInput(value);
  const [existing] = await db.select().from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  if (!existing || existing.status === "DELETED") throw new Error("Template não encontrado neste tenant.");
  if (!Array.isArray(existing.components) || existing.components.length === 0 || existing.components.some((component: any) => component?.type !== "BODY")) {
    throw new Error("A edição deste formato deve ser feita no Gerenciador da Meta.");
  }
  if (existing.name !== input.name || existing.language !== input.language) throw new Error("Nome e idioma não podem ser alterados nesta edição.");
  const { token } = await credentials(tenantId);
  await graphRequest(`${GRAPH_BASE}/${encodeURIComponent(metaTemplateId)}`, token, {
    method: "POST", body: JSON.stringify({ components: componentsFor(input), category: input.category }),
  });
  await db.update(metaMessageTemplates).set({ status: "PENDING", category: input.category, bodyText: input.bodyText,
    components: componentsFor(input), bindings: input.bindings, rejectedReason: null, lastSyncedAt: new Date() })
    .where(and(eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)));
  return { success: true };
}

export async function deleteMetaTemplate(tenantId: string, metaTemplateId: string) {
  const [existing] = await db.select().from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  if (!existing || existing.status === "DELETED") throw new Error("Template não encontrado neste tenant.");
  const { wabaId, token } = await credentials(tenantId);
  const params = new URLSearchParams({ hsm_id: metaTemplateId, name: existing.name });
  await graphRequest(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates?${params}`, token, { method: "DELETE" });
  await db.update(metaMessageTemplates).set({ status: "DELETED", lastSyncedAt: new Date() }).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  return { success: true };
}

export async function setMetaTemplateBindings(tenantId: string, metaTemplateId: string, value: unknown) {
  const [existing] = await db.select().from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  if (!existing || existing.status === "DELETED") throw new Error("Template não encontrado neste tenant.");
  const indexes = bodyVariableIndexes(existing.bodyText);
  const bindings: TemplateBindings = {};
  for (const index of indexes) {
    const binding = (value as Record<string, unknown>)?.[String(index)] || "manual";
    if (!(["customer_name", "operator_name", "manual"] as unknown[]).includes(binding)) throw new Error("Vínculo inválido.");
    bindings[String(index)] = binding as TemplateBinding;
  }
  await db.update(metaMessageTemplates).set({ bindings }).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  return { success: true };
}

export async function getMetaTemplateBindings(tenantId: string, metaTemplateId: string): Promise<TemplateBindings> {
  const [existing] = await db.select({ bindings: metaMessageTemplates.bindings }).from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  return existing?.bindings || {};
}
