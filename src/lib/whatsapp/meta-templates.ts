import { and, asc, eq } from "drizzle-orm";
import { client, db } from "../../db";
import { channelConfigs, metaMessageTemplates, metaTemplateGroups } from "../../db/schema";
import { bodyVariableIndexes, stripTemplateAccents, type TemplateBinding, type TemplateBindings } from "./meta-template-common";

const GRAPH_BASE = "https://graph.facebook.com/v21.0";

let schemaEnsured = false;
export async function ensureMetaTemplateGroupsSchema(): Promise<void> {
  if (schemaEnsured) return;
  try {
    await client.unsafe(`
      ALTER TABLE meta_message_templates
        ADD COLUMN IF NOT EXISTS custom_groups jsonb NOT NULL DEFAULT '[]'::jsonb;

      CREATE TABLE IF NOT EXISTS meta_template_groups (
        id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_meta_template_groups_tenant
        ON meta_template_groups(tenant_id);

      CREATE UNIQUE INDEX IF NOT EXISTS meta_template_groups_tenant_name_lower_unique
        ON meta_template_groups(tenant_id, lower(name));
    `);
    schemaEnsured = true;
  } catch {
    // Ignora falha caso banco esteja em modo somente leitura ou em mock de teste
  }
}

export function normalizeCustomGroups(value: unknown): string[] {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) raw = parsed;
    } catch {
      raw = [];
    }
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const trimmed = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    if (trimmed.length > 60) throw new Error("O nome de cada grupo deve ter no máximo 60 caracteres.");
    const key = stripTemplateAccents(trimmed);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

export interface MetaTemplateGroupItem {
  id: string;
  name: string;
  createdAt: Date;
}

export interface MetaTemplateButtonInput {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phoneNumber?: string;
}

export interface MetaTemplateHeaderInput {
  type: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  exampleUrl?: string;
}

export interface MetaTemplateInput {
  name: string;
  language: string;
  category: "UTILITY" | "MARKETING";
  bodyText: string;
  examples: string[];
  bindings: TemplateBindings;
  customGroups?: string[];
  header?: MetaTemplateHeaderInput;
  footerText?: string;
  buttons?: MetaTemplateButtonInput[];
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

  let header: MetaTemplateHeaderInput | undefined;
  if (input.header && input.header.type && input.header.type !== "NONE") {
    const validHeaderTypes = ["TEXT", "IMAGE", "VIDEO", "DOCUMENT"];
    if (!validHeaderTypes.includes(input.header.type)) throw new Error("Tipo de cabeçalho inválido.");
    const headerText = typeof input.header.text === "string" ? input.header.text.trim() : "";
    if (input.header.type === "TEXT") {
      if (!headerText || headerText.length > 60) throw new Error("Texto do cabeçalho deve ter entre 1 e 60 caracteres.");
    }
    header = {
      type: input.header.type,
      text: headerText || undefined,
      exampleUrl: typeof input.header.exampleUrl === "string" ? input.header.exampleUrl.trim() : undefined,
    };
  }

  const footerText = typeof input.footerText === "string" ? input.footerText.trim() : undefined;
  if (footerText && footerText.length > 60) throw new Error("Rodapé deve ter no máximo 60 caracteres.");

  let buttons: MetaTemplateButtonInput[] | undefined;
  if (Array.isArray(input.buttons) && input.buttons.length > 0) {
    if (input.buttons.length > 3) throw new Error("Máximo de 3 botões permitidos pela Meta.");
    buttons = input.buttons.map((b, idx) => {
      const bText = typeof b.text === "string" ? b.text.trim() : "";
      if (!bText || bText.length > 25) throw new Error(`Texto do botão ${idx + 1} deve ter de 1 a 25 caracteres.`);
      if (b.type === "URL") {
        const url = typeof b.url === "string" ? b.url.trim() : "";
        if (!url || !url.startsWith("http")) throw new Error(`URL inválida no botão ${idx + 1}.`);
        return { type: "URL" as const, text: bText, url };
      }
      if (b.type === "PHONE_NUMBER") {
        const phoneNumber = typeof b.phoneNumber === "string" ? b.phoneNumber.trim() : "";
        if (!phoneNumber) throw new Error(`Telefone inválido no botão ${idx + 1}.`);
        return { type: "PHONE_NUMBER" as const, text: bText, phoneNumber };
      }
      return { type: "QUICK_REPLY" as const, text: bText };
    });
  }

  const customGroups = input.customGroups !== undefined ? normalizeCustomGroups(input.customGroups) : undefined;

  return { name, language, category: input.category, bodyText, examples, bindings, customGroups, header, footerText, buttons };
}

function componentsFor(input: MetaTemplateInput) {
  const components: any[] = [];

  if (input.header && input.header.type !== "NONE") {
    if (input.header.type === "TEXT") {
      components.push({
        type: "HEADER",
        format: "TEXT",
        text: input.header.text,
      });
    } else {
      components.push({
        type: "HEADER",
        format: input.header.type,
      });
    }
  }

  components.push({
    type: "BODY",
    text: input.bodyText,
    ...(input.examples.length ? { example: { body_text: [input.examples] } } : {}),
  });

  if (input.footerText) {
    components.push({
      type: "FOOTER",
      text: input.footerText,
    });
  }

  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: input.buttons.map((b) => {
        if (b.type === "URL") return { type: "URL", text: b.text, url: b.url };
        if (b.type === "PHONE_NUMBER") return { type: "PHONE_NUMBER", text: b.text, phone_number: b.phoneNumber };
        return { type: "QUICK_REPLY", text: b.text };
      }),
    });
  }

  return components;
}

async function ensureGroupsCatalogEntries(tenantId: string, groupNames: string[]) {
  await ensureMetaTemplateGroupsSchema();
  const normalized = normalizeCustomGroups(groupNames);
  if (normalized.length === 0) return;
  const existing = await db
    .select()
    .from(metaTemplateGroups)
    .where(eq(metaTemplateGroups.tenantId, tenantId));
  const existingLower = new Set(existing.map((g) => g.name.toLowerCase()));
  for (const name of normalized) {
    if (!existingLower.has(name.toLowerCase())) {
      const id = `mtg_${tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await db
        .insert(metaTemplateGroups)
        .values({ id, tenantId, name, createdAt: new Date() })
        .onConflictDoNothing();
      existingLower.add(name.toLowerCase());
    }
  }
}

export async function listMetaTemplateGroups(tenantId: string): Promise<MetaTemplateGroupItem[]> {
  await ensureMetaTemplateGroupsSchema();
  const groups = await db
    .select()
    .from(metaTemplateGroups)
    .where(eq(metaTemplateGroups.tenantId, tenantId))
    .orderBy(asc(metaTemplateGroups.name));

  const templates = await db
    .select({ customGroups: metaMessageTemplates.customGroups })
    .from(metaMessageTemplates)
    .where(eq(metaMessageTemplates.tenantId, tenantId));

  const knownLower = new Set(groups.map((g) => g.name.toLowerCase()));
  const missingNames: string[] = [];
  for (const t of templates) {
    for (const gName of normalizeCustomGroups(t.customGroups)) {
      if (!knownLower.has(gName.toLowerCase())) {
        knownLower.add(gName.toLowerCase());
        missingNames.push(gName);
      }
    }
  }

  if (missingNames.length > 0) {
    await ensureGroupsCatalogEntries(tenantId, missingNames);
    return db
      .select()
      .from(metaTemplateGroups)
      .where(eq(metaTemplateGroups.tenantId, tenantId))
      .orderBy(asc(metaTemplateGroups.name));
  }

  return groups;
}

async function saveSnapshot(
  tenantId: string,
  item: any,
  bindings?: TemplateBindings,
  customGroups?: string[],
) {
  if (!item?.id || !item?.name || !item?.language) return;
  await ensureMetaTemplateGroupsSchema();
  const components = Array.isArray(item.components) ? item.components : [];
  const bodyText = String(components.find((part: any) => part.type === "BODY")?.text || "");
  const id = `${tenantId}:${item.id}`;
  const [existing] = await db
    .select({
      bindings: metaMessageTemplates.bindings,
      customGroups: metaMessageTemplates.customGroups,
    })
    .from(metaMessageTemplates)
    .where(and(eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, String(item.id))));

  const rawReason = String(item.rejected_reason || "").trim();
  const isRejected = String(item.status || "").toUpperCase() === "REJECTED";
  const rejectedReason = isRejected && rawReason && rawReason.toUpperCase() !== "NONE" ? rawReason : null;
  const resolvedGroups =
    customGroups !== undefined
      ? normalizeCustomGroups(customGroups)
      : normalizeCustomGroups(existing?.customGroups);

  if (resolvedGroups.length > 0) {
    await ensureGroupsCatalogEntries(tenantId, resolvedGroups);
  }

  await db.insert(metaMessageTemplates).values({
    id, tenantId, metaTemplateId: String(item.id), name: item.name,
    language: item.language, category: item.category || "", status: item.status || "PENDING",
    bodyText, components, bindings: bindings || existing?.bindings || {},
    customGroups: resolvedGroups,
    rejectedReason, lastSyncedAt: new Date(),
  }).onConflictDoUpdate({ target: metaMessageTemplates.id, set: {
    name: item.name, language: item.language, category: item.category || "",
    status: item.status || "PENDING", bodyText, components,
    bindings: bindings || existing?.bindings || {},
    customGroups: resolvedGroups,
    rejectedReason,
    lastSyncedAt: new Date(),
  } });
}

export async function syncMetaTemplates(tenantId: string) {
  await ensureMetaTemplateGroupsSchema();
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
  const rows = await db.select().from(metaMessageTemplates).where(eq(metaMessageTemplates.tenantId, tenantId));
  return rows.map((row) => ({
    ...row,
    customGroups: normalizeCustomGroups(row.customGroups),
  }));
}

export async function createMetaTemplate(tenantId: string, value: unknown) {
  await ensureMetaTemplateGroupsSchema();
  const input = validateMetaTemplateInput(value);
  const { wabaId, token } = await credentials(tenantId);
  const data = await graphRequest(`${GRAPH_BASE}/${encodeURIComponent(wabaId)}/message_templates`, token, {
    method: "POST", body: JSON.stringify({ name: input.name, language: input.language, category: input.category, components: componentsFor(input) }),
  });
  if (!data.id) throw new Error("A Meta não retornou o ID do template.");
  await saveSnapshot(
    tenantId,
    { ...input, id: data.id, status: data.status || "PENDING", components: componentsFor(input), category: data.category || input.category },
    input.bindings,
    input.customGroups,
  );
  return data;
}

export async function updateMetaTemplate(tenantId: string, metaTemplateId: string, value: unknown) {
  await ensureMetaTemplateGroupsSchema();
  const input = validateMetaTemplateInput(value);
  const [existing] = await db.select().from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  if (!existing || existing.status === "DELETED") throw new Error("Template não encontrado neste tenant.");
  const allowedComponentTypes = new Set(["HEADER", "BODY", "FOOTER", "BUTTONS"]);
  if (!Array.isArray(existing.components) || existing.components.length === 0 || existing.components.some((component: any) => !allowedComponentTypes.has(String(component?.type || "")))) {
    throw new Error("A edição deste formato deve ser feita no Gerenciador da Meta.");
  }
  if (existing.name !== input.name || existing.language !== input.language) throw new Error("Nome e idioma não podem ser alterados nesta edição.");
  const { token } = await credentials(tenantId);
  await graphRequest(`${GRAPH_BASE}/${encodeURIComponent(metaTemplateId)}`, token, {
    method: "POST", body: JSON.stringify({ components: componentsFor(input), category: input.category }),
  });
  const nextCustomGroups =
    input.customGroups !== undefined
      ? normalizeCustomGroups(input.customGroups)
      : normalizeCustomGroups(existing.customGroups);
  if (nextCustomGroups.length > 0) {
    await ensureGroupsCatalogEntries(tenantId, nextCustomGroups);
  }
  await db.update(metaMessageTemplates).set({
    status: "PENDING",
    category: input.category,
    bodyText: input.bodyText,
    components: componentsFor(input),
    bindings: input.bindings,
    customGroups: nextCustomGroups,
    rejectedReason: null,
    lastSyncedAt: new Date(),
  }).where(and(eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)));
  return { success: true };
}

export async function deleteMetaTemplate(tenantId: string, metaTemplateId: string) {
  await ensureMetaTemplateGroupsSchema();
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

export async function setMetaTemplateBindings(
  tenantId: string,
  metaTemplateId: string,
  value: unknown,
  customGroupsInput?: unknown,
) {
  await ensureMetaTemplateGroupsSchema();
  const [existing] = await db.select().from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  if (!existing || existing.status === "DELETED") throw new Error("Template não encontrado neste tenant.");

  const updateFields: Partial<typeof metaMessageTemplates.$inferInsert> = {};

  if (value !== undefined) {
    const indexes = bodyVariableIndexes(existing.bodyText);
    const bindings: TemplateBindings = {};
    for (const index of indexes) {
      const binding = (value as Record<string, unknown>)?.[String(index)] || "manual";
      if (!(["customer_name", "operator_name", "manual"] as unknown[]).includes(binding)) throw new Error("Vínculo inválido.");
      bindings[String(index)] = binding as TemplateBinding;
    }
    updateFields.bindings = bindings;
  }

  if (customGroupsInput !== undefined) {
    const normalizedGroups = normalizeCustomGroups(customGroupsInput);
    if (normalizedGroups.length > 0) {
      await ensureGroupsCatalogEntries(tenantId, normalizedGroups);
    }
    updateFields.customGroups = normalizedGroups;
  }

  if (Object.keys(updateFields).length > 0) {
    await db.update(metaMessageTemplates).set(updateFields).where(and(
      eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
    ));
  }
  return { success: true };
}

export async function setMetaTemplateCustomGroups(
  tenantId: string,
  metaTemplateId: string,
  customGroupsInput: unknown,
) {
  return setMetaTemplateBindings(tenantId, metaTemplateId, undefined, customGroupsInput);
}

export async function saveMetaTemplateGroupWithLinks(
  tenantId: string,
  payload: {
    groupId?: string;
    name: string;
    templateIds?: string[];
  },
) {
  await ensureMetaTemplateGroupsSchema();
  const cleanName = String(payload.name || "").trim().replace(/\s+/g, " ");
  if (!cleanName) throw new Error("Informe o nome do grupo.");
  if (cleanName.length > 60) throw new Error("O nome do grupo deve ter no máximo 60 caracteres.");

  const existingGroups = await db
    .select()
    .from(metaTemplateGroups)
    .where(eq(metaTemplateGroups.tenantId, tenantId));

  let targetGroup = payload.groupId
    ? existingGroups.find((g) => g.id === payload.groupId)
    : existingGroups.find((g) => g.name.toLowerCase() === cleanName.toLowerCase());

  const duplicateName = existingGroups.find(
    (g) => g.name.toLowerCase() === cleanName.toLowerCase() && (!targetGroup || g.id !== targetGroup.id),
  );
  if (duplicateName) {
    throw new Error(`Já existe um grupo chamado "${duplicateName.name}".`);
  }

  const previousName = targetGroup?.name;

  if (targetGroup) {
    if (targetGroup.name !== cleanName) {
      await db
        .update(metaTemplateGroups)
        .set({ name: cleanName })
        .where(and(eq(metaTemplateGroups.id, targetGroup.id), eq(metaTemplateGroups.tenantId, tenantId)));
    }
  } else {
    const id = `mtg_${tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(metaTemplateGroups).values({
      id,
      tenantId,
      name: cleanName,
      createdAt: new Date(),
    });
    targetGroup = { id, tenantId, name: cleanName, createdAt: new Date() };
  }

  // Atualiza os vínculos nos templates do tenant (renomeação e/ou seleção de templates)
  if (Array.isArray(payload.templateIds) || (previousName && previousName !== cleanName)) {
    const selectedSet = Array.isArray(payload.templateIds)
      ? new Set(payload.templateIds.map((id) => String(id)))
      : null;

    const allTemplates = await db
      .select({
        id: metaMessageTemplates.id,
        metaTemplateId: metaMessageTemplates.metaTemplateId,
        customGroups: metaMessageTemplates.customGroups,
      })
      .from(metaMessageTemplates)
      .where(eq(metaMessageTemplates.tenantId, tenantId));

    for (const tpl of allTemplates) {
      const currentGroups = normalizeCustomGroups(tpl.customGroups);
      const filtered = currentGroups.filter((g) => {
        const lower = g.toLowerCase();
        if (lower === cleanName.toLowerCase()) return false;
        if (previousName && lower === previousName.toLowerCase()) return false;
        return true;
      });

      const shouldInclude = selectedSet
        ? selectedSet.has(tpl.metaTemplateId)
        : currentGroups.some(
            (g) =>
              g.toLowerCase() === cleanName.toLowerCase() ||
              (previousName && g.toLowerCase() === previousName.toLowerCase()),
          );

      const nextGroups = shouldInclude ? [...filtered, cleanName] : filtered;
      const changed =
        nextGroups.length !== currentGroups.length ||
        nextGroups.some((g, idx) => g !== currentGroups[idx]);

      if (changed) {
        await db
          .update(metaMessageTemplates)
          .set({ customGroups: nextGroups })
          .where(and(eq(metaMessageTemplates.id, tpl.id), eq(metaMessageTemplates.tenantId, tenantId)));
      }
    }
  }

  const groups = await listMetaTemplateGroups(tenantId);
  const templates = (await db.select().from(metaMessageTemplates).where(eq(metaMessageTemplates.tenantId, tenantId))).map(
    (row) => ({ ...row, customGroups: normalizeCustomGroups(row.customGroups) }),
  );
  return { group: targetGroup, groups, templates };
}

export async function deleteMetaTemplateGroup(
  tenantId: string,
  payload: { groupId?: string; name?: string },
) {
  await ensureMetaTemplateGroupsSchema();
  const existingGroups = await db
    .select()
    .from(metaTemplateGroups)
    .where(eq(metaTemplateGroups.tenantId, tenantId));

  const target = payload.groupId
    ? existingGroups.find((g) => g.id === payload.groupId)
    : payload.name
    ? existingGroups.find((g) => g.name.toLowerCase() === String(payload.name).trim().toLowerCase())
    : undefined;

  const targetNameLower = (target?.name || String(payload.name || "").trim()).toLowerCase();
  if (!target && !targetNameLower) {
    throw new Error("Grupo não encontrado.");
  }

  if (target) {
    await db
      .delete(metaTemplateGroups)
      .where(and(eq(metaTemplateGroups.id, target.id), eq(metaTemplateGroups.tenantId, tenantId)));
  }

  if (targetNameLower) {
    const allTemplates = await db
      .select({
        id: metaMessageTemplates.id,
        customGroups: metaMessageTemplates.customGroups,
      })
      .from(metaMessageTemplates)
      .where(eq(metaMessageTemplates.tenantId, tenantId));

    for (const tpl of allTemplates) {
      const currentGroups = normalizeCustomGroups(tpl.customGroups);
      const nextGroups = currentGroups.filter((g) => g.toLowerCase() !== targetNameLower);
      if (nextGroups.length !== currentGroups.length) {
        await db
          .update(metaMessageTemplates)
          .set({ customGroups: nextGroups })
          .where(and(eq(metaMessageTemplates.id, tpl.id), eq(metaMessageTemplates.tenantId, tenantId)));
      }
    }
  }

  const groups = await listMetaTemplateGroups(tenantId);
  const templates = (await db.select().from(metaMessageTemplates).where(eq(metaMessageTemplates.tenantId, tenantId))).map(
    (row) => ({ ...row, customGroups: normalizeCustomGroups(row.customGroups) }),
  );
  return { success: true, groups, templates };
}

export async function getMetaTemplateBindings(tenantId: string, metaTemplateId: string): Promise<TemplateBindings> {
  await ensureMetaTemplateGroupsSchema();
  const [existing] = await db.select({ bindings: metaMessageTemplates.bindings }).from(metaMessageTemplates).where(and(
    eq(metaMessageTemplates.tenantId, tenantId), eq(metaMessageTemplates.metaTemplateId, metaTemplateId)
  ));
  return existing?.bindings || {};
}

export async function getMetaTemplateLocalMetadataMap(
  tenantId: string,
): Promise<Map<string, { bindings: TemplateBindings; customGroups: string[] }>> {
  await ensureMetaTemplateGroupsSchema();
  const rows = await db
    .select({
      metaTemplateId: metaMessageTemplates.metaTemplateId,
      name: metaMessageTemplates.name,
      language: metaMessageTemplates.language,
      bindings: metaMessageTemplates.bindings,
      customGroups: metaMessageTemplates.customGroups,
    })
    .from(metaMessageTemplates)
    .where(eq(metaMessageTemplates.tenantId, tenantId));

  const map = new Map<string, { bindings: TemplateBindings; customGroups: string[] }>();
  for (const row of rows) {
    const entry = {
      bindings: row.bindings || {},
      customGroups: normalizeCustomGroups(row.customGroups),
    };
    map.set(String(row.metaTemplateId), entry);
    map.set(`${row.name}:${row.language}`, entry);
  }
  return map;
}

