import {
  listCustomFields,
  parseJsonArray,
  type CustomFieldDefinition,
  type CustomFieldEntity,
} from "../crm/custom-fields";

export interface AccountCustomFieldOption {
  id: string;
  label: string;
}

export interface NormalizedCustomFieldDef {
  id: string;
  entityType: string;
  name: string;
  fieldType: string;
  options: AccountCustomFieldOption[];
  required: boolean;
  allPipelines: boolean;
  pipelineIds: string[];
  visibleOnCreate: boolean;
  isUnique: boolean;
  requiredRule: string;
  requiredFromStageId: string | null;
  sortOrder: number;
  archivedAt: string | Date | null;
}

export interface FilledCustomFieldItem {
  fieldId: string;
  name: string;
  fieldType: string | null;
  value: unknown;
  displayValue: string;
}

export interface FormattedAccountCustomFields {
  customFields: Record<string, unknown>;
  customFieldsRaw: Record<string, unknown>;
  filledCustomFields: FilledCustomFieldItem[];
  emptyCustomFields: Array<{
    id: string;
    name: string;
    fieldType: string;
    required: boolean;
  }>;
}

export interface AccountFilledFieldsSummary {
  filledFields: {
    standard: string[];
    receitaFederal: string[];
    custom: string[];
    totalFilledCount: number;
  };
  emptyStandardFields: string[];
}

export function normalizeLookupKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isCustomFieldValueFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => isCustomFieldValueFilled(item));
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      isCustomFieldValueFilled(item),
    );
  }
  return false;
}

export function parseCustomFieldsObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function normalizeCustomFieldDefinitionRow(row: any): NormalizedCustomFieldDef {
  return {
    id: String(row.id),
    entityType: String(row.entityType ?? row.entity_type ?? "company"),
    name: String(row.name ?? ""),
    fieldType: String(row.fieldType ?? row.field_type ?? "text"),
    options: parseJsonArray<AccountCustomFieldOption>(row.options),
    required: Boolean(row.required),
    allPipelines:
      row.allPipelines !== undefined
        ? Boolean(row.allPipelines)
        : row.all_pipelines !== undefined
          ? Boolean(row.all_pipelines)
          : true,
    pipelineIds: parseJsonArray<string>(row.pipelineIds ?? row.pipeline_ids),
    visibleOnCreate:
      row.visibleOnCreate !== undefined
        ? Boolean(row.visibleOnCreate)
        : row.visible_on_create !== undefined
          ? Boolean(row.visible_on_create)
          : true,
    isUnique: Boolean(row.isUnique ?? row.is_unique),
    requiredRule: String(row.requiredRule ?? row.required_rule ?? "always"),
    requiredFromStageId: (row.requiredFromStageId ?? row.required_from_stage_id ?? null) as
      | string
      | null,
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    archivedAt: (row.archivedAt ?? row.archived_at ?? null) as string | Date | null,
  };
}

function formatSingleOrMultipleValue(
  def: NormalizedCustomFieldDef | undefined,
  value: unknown,
): { mappedValue: unknown; displayValue: string } {
  if (!def) {
    if (Array.isArray(value)) {
      const items = value.filter((item) => isCustomFieldValueFilled(item)).map(String);
      return { mappedValue: items, displayValue: items.join(", ") };
    }
    return { mappedValue: value, displayValue: String(value) };
  }

  const optionLabelById = new Map(def.options.map((opt) => [opt.id, opt.label]));

  if (def.fieldType === "single" && typeof value === "string") {
    const label = optionLabelById.get(value) || value;
    return { mappedValue: label, displayValue: label };
  }

  if (def.fieldType === "multiple" && Array.isArray(value)) {
    const labels = value
      .filter((item) => isCustomFieldValueFilled(item))
      .map((item) => (typeof item === "string" ? optionLabelById.get(item) || item : String(item)));
    return { mappedValue: labels, displayValue: labels.join(", ") };
  }

  return { mappedValue: value, displayValue: String(value) };
}

export function formatAccountCustomFields(
  rawCustomFields: unknown,
  definitions: NormalizedCustomFieldDef[],
): FormattedAccountCustomFields {
  const parsed = parseCustomFieldsObject(rawCustomFields);
  const defById = new Map<string, NormalizedCustomFieldDef>(definitions.map((d) => [d.id, d]));
  const defByLowerName = new Map<string, NormalizedCustomFieldDef>(
    definitions.map((d) => [normalizeLookupKey(d.name), d]),
  );

  const customFields: Record<string, unknown> = {};
  const customFieldsRaw: Record<string, unknown> = {};
  const filledCustomFields: FilledCustomFieldItem[] = [];
  const filledDefIds = new Set<string>();

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (!isCustomFieldValueFilled(rawValue)) continue;
    const def = defById.get(rawKey) || defByLowerName.get(normalizeLookupKey(rawKey));
    const fieldId = def?.id ?? rawKey;
    const fieldName = def?.name ?? rawKey;
    const { mappedValue, displayValue } = formatSingleOrMultipleValue(def, rawValue);

    customFields[fieldName] = mappedValue;
    customFieldsRaw[fieldId] = rawValue;
    filledCustomFields.push({
      fieldId,
      name: fieldName,
      fieldType: def?.fieldType ?? null,
      value: mappedValue,
      displayValue,
    });
    if (def) filledDefIds.add(def.id);
  }

  const emptyCustomFields = definitions
    .filter((def) => !def.archivedAt && !filledDefIds.has(def.id))
    .map((def) => ({
      id: def.id,
      name: def.name,
      fieldType: def.fieldType,
      required: def.required,
    }));

  return {
    customFields,
    customFieldsRaw,
    filledCustomFields,
    emptyCustomFields,
  };
}

export function computeAccountFilledFields(
  acc: {
    name?: unknown;
    tradeName?: unknown;
    trade_name?: unknown;
    segment?: unknown;
    document?: unknown;
    phone?: unknown;
    email?: unknown;
    website?: unknown;
    notes?: unknown;
    rdOrganizationId?: unknown;
    rd_organization_id?: unknown;
  },
  receitaFederal: {
    razaoSocial?: unknown;
    nomeFantasia?: unknown;
    situacaoCadastral?: unknown;
    dataAbertura?: unknown;
    porte?: unknown;
    capitalSocial?: unknown;
    naturezaJuridica?: unknown;
    atividadePrincipal?: unknown;
    atividadesSecundarias?: unknown;
    qsa?: unknown;
    consultedAt?: unknown;
    endereco?: {
      logradouro?: unknown;
      numero?: unknown;
      complemento?: unknown;
      bairro?: unknown;
      municipio?: unknown;
      uf?: unknown;
      cep?: unknown;
    };
  },
  filledCustomFields: FilledCustomFieldItem[],
): AccountFilledFieldsSummary {
  const standardCandidates: Array<[string, unknown]> = [
    ["name", acc.name],
    ["tradeName", acc.tradeName ?? acc.trade_name],
    ["segment", acc.segment],
    ["document", acc.document],
    ["phone", acc.phone],
    ["email", acc.email],
    ["website", acc.website],
    ["notes", acc.notes],
    ["rdOrganizationId", acc.rdOrganizationId ?? acc.rd_organization_id],
  ];

  const standard: string[] = [];
  const emptyStandardFields: string[] = [];
  for (const [key, val] of standardCandidates) {
    if (isCustomFieldValueFilled(val)) {
      standard.push(key);
    } else {
      emptyStandardFields.push(key);
    }
  }

  const receitaCandidates: Array<[string, unknown]> = [
    ["razaoSocial", receitaFederal.razaoSocial],
    ["nomeFantasia", receitaFederal.nomeFantasia],
    ["situacaoCadastral", receitaFederal.situacaoCadastral],
    ["dataAbertura", receitaFederal.dataAbertura],
    ["porte", receitaFederal.porte],
    ["capitalSocial", receitaFederal.capitalSocial],
    ["naturezaJuridica", receitaFederal.naturezaJuridica],
    ["atividadePrincipal", receitaFederal.atividadePrincipal],
    ["atividadesSecundarias", receitaFederal.atividadesSecundarias],
    ["qsa", receitaFederal.qsa],
    ["endereco.logradouro", receitaFederal.endereco?.logradouro],
    ["endereco.numero", receitaFederal.endereco?.numero],
    ["endereco.complemento", receitaFederal.endereco?.complemento],
    ["endereco.bairro", receitaFederal.endereco?.bairro],
    ["endereco.municipio", receitaFederal.endereco?.municipio],
    ["endereco.uf", receitaFederal.endereco?.uf],
    ["endereco.cep", receitaFederal.endereco?.cep],
  ];

  const receitaFilled: string[] = [];
  for (const [key, val] of receitaCandidates) {
    if (isCustomFieldValueFilled(val)) {
      receitaFilled.push(key);
    }
  }

  const custom = filledCustomFields.map((item) => item.name);

  return {
    filledFields: {
      standard,
      receitaFederal: receitaFilled,
      custom,
      totalFilledCount: standard.length + receitaFilled.length + custom.length,
    },
    emptyStandardFields,
  };
}

/**
 * Resolve input de `customFields` para empresa (`entityType = "company"`):
 * aceita chave por ID ou nome (case-insensitive) e, em campos `single`/`multiple`,
 * aceita tanto o ID da opção (`opt-...`) quanto o rótulo legível da opção.
 */
export async function resolveAccountCustomFieldsInput(
  tenantId: string,
  rawCustomFields: Record<string, unknown>,
  preloadedDefs?: CustomFieldDefinition[],
): Promise<Record<string, unknown>> {
  const defs = preloadedDefs ?? (await listCustomFields(tenantId, "company"));
  const defById = new Map<string, CustomFieldDefinition>(defs.map((d) => [d.id, d]));
  const defByNormName = new Map<string, CustomFieldDefinition>(
    defs.map((d) => [normalizeLookupKey(d.name), d]),
  );

  const resolved: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of Object.entries(rawCustomFields)) {
    const def = defById.get(rawKey) ?? defByNormName.get(normalizeLookupKey(rawKey));
    const targetKey = def?.id ?? rawKey;

    if (!def || rawVal === null || rawVal === undefined || rawVal === "") {
      resolved[targetKey] = rawVal;
      continue;
    }

    if (def.fieldType === "single" && typeof rawVal === "string") {
      const options = parseJsonArray<AccountCustomFieldOption>(def.options);
      const idSet = new Set(options.map((o) => o.id));
      if (idSet.has(rawVal)) {
        resolved[targetKey] = rawVal;
      } else {
        const matched = options.find(
          (o) => normalizeLookupKey(o.label) === normalizeLookupKey(rawVal),
        );
        resolved[targetKey] = matched ? matched.id : rawVal;
      }
      continue;
    }

    if (def.fieldType === "multiple" && Array.isArray(rawVal)) {
      const options = parseJsonArray<AccountCustomFieldOption>(def.options);
      const idSet = new Set(options.map((o) => o.id));
      resolved[targetKey] = rawVal.map((item) => {
        if (typeof item !== "string") return item;
        if (idSet.has(item)) return item;
        const matched = options.find(
          (o) => normalizeLookupKey(o.label) === normalizeLookupKey(item),
        );
        return matched ? matched.id : item;
      });
      continue;
    }

    resolved[targetKey] = rawVal;
  }

  return resolved;
}

export function buildHasCustomFieldsSqlCondition(sql: any, hasCustomFields: boolean) {
  const existsExpr = sql`EXISTS (
    SELECT 1
    FROM jsonb_each(COALESCE(acc.custom_fields, '{}'::jsonb)) AS cf(k, v)
    WHERE v IS NOT NULL
      AND jsonb_typeof(v) != 'null'
      AND NOT (jsonb_typeof(v) = 'string' AND BTRIM(v #>> '{}') = '')
      AND NOT (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0)
  )`;
  return hasCustomFields ? existsExpr : sql`NOT (${existsExpr})`;
}

export function buildAccountFilledFieldSqlCondition(
  sql: any,
  filledFieldRaw: string,
  definitions: NormalizedCustomFieldDef[],
) {
  const norm = normalizeLookupKey(filledFieldRaw);
  switch (norm) {
    case "document":
    case "cnpj":
    case "cpf":
      return sql`NULLIF(BTRIM(COALESCE(acc.document, '')), '') IS NOT NULL`;
    case "tradename":
    case "trade_name":
    case "nome fantasia":
    case "nome_fantasia":
      return sql`NULLIF(BTRIM(COALESCE(acc.trade_name, '')), '') IS NOT NULL`;
    case "segment":
    case "segmento":
      return sql`NULLIF(BTRIM(COALESCE(acc.segment, '')), '') IS NOT NULL`;
    case "phone":
    case "telefone":
      return sql`NULLIF(BTRIM(COALESCE(acc.phone, '')), '') IS NOT NULL`;
    case "email":
    case "e-mail":
      return sql`NULLIF(BTRIM(COALESCE(acc.email, '')), '') IS NOT NULL`;
    case "website":
    case "site":
    case "url":
      return sql`NULLIF(BTRIM(COALESCE(acc.website, '')), '') IS NOT NULL`;
    case "notes":
    case "observacoes":
    case "observacao":
      return sql`NULLIF(BTRIM(COALESCE(acc.notes, '')), '') IS NOT NULL`;
    case "rdorganizationid":
    case "rd_organization_id":
      return sql`NULLIF(BTRIM(COALESCE(acc.rd_organization_id, '')), '') IS NOT NULL`;
    case "uf":
    case "state":
    case "estado":
      return sql`NULLIF(BTRIM(COALESCE(acc.address->>'state', acc.address->>'uf', '')), '') IS NOT NULL`;
    case "city":
    case "municipio":
    case "cidade":
      return sql`NULLIF(BTRIM(COALESCE(acc.address->>'city', acc.address->>'municipio', '')), '') IS NOT NULL`;
    case "address":
    case "endereco":
      return sql`acc.address IS NOT NULL AND acc.address != '{}'::jsonb`;
    case "receitafederal":
    case "receita_federal":
    case "receita":
      return sql`NULLIF(BTRIM(COALESCE(acc.address->>'razaoSocial', acc.address->>'situacaoCadastral', acc.address->>'consultedAt', '')), '') IS NOT NULL`;
    default: {
      const matchedDef =
        definitions.find((d) => d.id === filledFieldRaw.trim()) ||
        definitions.find((d) => normalizeLookupKey(d.name) === norm);
      const fieldKey = matchedDef ? matchedDef.id : filledFieldRaw.trim();
      return sql`(
        COALESCE(acc.custom_fields, '{}'::jsonb) ? ${fieldKey}
        AND (acc.custom_fields -> ${fieldKey}) IS NOT NULL
        AND jsonb_typeof(acc.custom_fields -> ${fieldKey}) != 'null'
        AND NOT (
          jsonb_typeof(acc.custom_fields -> ${fieldKey}) = 'string'
          AND BTRIM(acc.custom_fields ->> ${fieldKey}) = ''
        )
        AND NOT (
          jsonb_typeof(acc.custom_fields -> ${fieldKey}) = 'array'
          AND jsonb_array_length(acc.custom_fields -> ${fieldKey}) = 0
        )
      )`;
    }
  }
}

export const LIST_CRM_CUSTOM_FIELDS_TOOL_SCHEMA = {
  name: "list_crm_custom_fields",
  description:
    "Lista as definições de campos personalizados do CRM (crm_custom_field_definitions) por entidade ('company', 'deal', 'contact', 'product' ou 'all'), incluindo opções de seleção, obrigatoriedade e — quando includeUsageStats=true — a contagem e taxa de preenchimento real de cada campo (inclusive cobertura dos campos padrão de empresas).",
  inputSchema: {
    type: "object",
    properties: {
      tenantId: {
        type: "string",
        enum: ["tecfag", "valem"],
        default: "tecfag",
        description: "Tenant do sistema ('tecfag' ou 'valem'). Padrão: 'tecfag'.",
      },
      entityType: {
        type: "string",
        enum: ["company", "deal", "contact", "product", "all"],
        default: "all",
        description:
          "Entidade do CRM: 'company' (empresas), 'deal' (negociações), 'contact' (contatos), 'product' (produtos) ou 'all' (todas).",
      },
      includeUsageStats: {
        type: "boolean",
        default: false,
        description:
          "Quando true, calcula quantos registros ativos têm cada campo personalizado preenchido (e, para empresas, a cobertura dos campos padrão de crm_accounts).",
      },
      search: {
        type: "string",
        description: "Filtro opcional por nome do campo personalizado.",
      },
      includeArchived: {
        type: "boolean",
        default: false,
        description: "Inclui campos arquivados (padrão: false).",
      },
    },
  },
};

function calcFillRate(filled: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.round((filled / total) * 1000) / 10;
}

async function queryEntityCustomFieldUsage(
  sql: any,
  tenantId: string,
  entity: CustomFieldEntity,
): Promise<{ totalRecords: number; countsByFieldId: Map<string, number> }> {
  let totalRows: any[] = [];
  let keyCountRows: any[] = [];

  if (entity === "company") {
    [totalRows, keyCountRows] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total
        FROM crm_accounts
        WHERE tenant_id = ${tenantId} AND archived_at IS NULL
      `,
      sql`
        SELECT cf.k AS field_key, COUNT(*)::int AS filled_count
        FROM crm_accounts acc
        CROSS JOIN LATERAL jsonb_each(COALESCE(acc.custom_fields, '{}'::jsonb)) AS cf(k, v)
        WHERE acc.tenant_id = ${tenantId}
          AND acc.archived_at IS NULL
          AND cf.v IS NOT NULL
          AND jsonb_typeof(cf.v) != 'null'
          AND NOT (jsonb_typeof(cf.v) = 'string' AND BTRIM(cf.v #>> '{}') = '')
          AND NOT (jsonb_typeof(cf.v) = 'array' AND jsonb_array_length(cf.v) = 0)
        GROUP BY cf.k
      `,
    ]);
  } else if (entity === "deal") {
    [totalRows, keyCountRows] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total
        FROM crm_deals
        WHERE tenant_id = ${tenantId}
          AND COALESCE(is_test, false) = false
          AND COALESCE(status, '') != 'archived'
      `,
      sql`
        SELECT cf.k AS field_key, COUNT(*)::int AS filled_count
        FROM crm_deals d
        CROSS JOIN LATERAL jsonb_each(COALESCE(d.custom_fields, '{}'::jsonb)) AS cf(k, v)
        WHERE d.tenant_id = ${tenantId}
          AND COALESCE(d.is_test, false) = false
          AND COALESCE(d.status, '') != 'archived'
          AND cf.v IS NOT NULL
          AND jsonb_typeof(cf.v) != 'null'
          AND NOT (jsonb_typeof(cf.v) = 'string' AND BTRIM(cf.v #>> '{}') = '')
          AND NOT (jsonb_typeof(cf.v) = 'array' AND jsonb_array_length(cf.v) = 0)
        GROUP BY cf.k
      `,
    ]);
  } else if (entity === "contact") {
    [totalRows, keyCountRows] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total
        FROM contacts
        WHERE tenant_id = ${tenantId}
      `,
      sql`
        SELECT cf.k AS field_key, COUNT(*)::int AS filled_count
        FROM contacts c
        CROSS JOIN LATERAL jsonb_each(COALESCE(c.custom_fields, '{}'::jsonb)) AS cf(k, v)
        WHERE c.tenant_id = ${tenantId}
          AND cf.v IS NOT NULL
          AND jsonb_typeof(cf.v) != 'null'
          AND NOT (jsonb_typeof(cf.v) = 'string' AND BTRIM(cf.v #>> '{}') = '')
          AND NOT (jsonb_typeof(cf.v) = 'array' AND jsonb_array_length(cf.v) = 0)
        GROUP BY cf.k
      `,
    ]);
  } else if (entity === "product") {
    [totalRows, keyCountRows] = await Promise.all([
      sql`
        SELECT COUNT(*)::int AS total
        FROM crm_products
        WHERE tenant_id = ${tenantId} AND is_active = true
      `,
      sql`
        SELECT cf.k AS field_key, COUNT(*)::int AS filled_count
        FROM crm_products p
        CROSS JOIN LATERAL jsonb_each(COALESCE(p.custom_fields, '{}'::jsonb)) AS cf(k, v)
        WHERE p.tenant_id = ${tenantId}
          AND p.is_active = true
          AND cf.v IS NOT NULL
          AND jsonb_typeof(cf.v) != 'null'
          AND NOT (jsonb_typeof(cf.v) = 'string' AND BTRIM(cf.v #>> '{}') = '')
          AND NOT (jsonb_typeof(cf.v) = 'array' AND jsonb_array_length(cf.v) = 0)
        GROUP BY cf.k
      `,
    ]);
  }

  const totalRecords = Number(totalRows?.[0]?.total ?? 0);
  const countsByFieldId = new Map<string, number>();
  for (const row of keyCountRows || []) {
    countsByFieldId.set(String(row.field_key), Number(row.filled_count ?? 0));
  }
  return { totalRecords, countsByFieldId };
}

async function queryCompanyStandardFieldsCoverage(sql: any, tenantId: string) {
  const [row] = await sql`
    SELECT
      COUNT(*)::int AS total_accounts,
      COUNT(*) FILTER (WHERE type = 'company')::int AS companies_count,
      COUNT(*) FILTER (WHERE type = 'person')::int AS persons_count,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(trade_name, '')), '') IS NOT NULL)::int AS trade_name_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(segment, '')), '') IS NOT NULL)::int AS segment_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(document, '')), '') IS NOT NULL)::int AS document_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(phone, '')), '') IS NOT NULL)::int AS phone_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(email, '')), '') IS NOT NULL)::int AS email_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(website, '')), '') IS NOT NULL)::int AS website_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(notes, '')), '') IS NOT NULL)::int AS notes_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(rd_organization_id, '')), '') IS NOT NULL)::int AS rd_org_filled,
      COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '{}'::jsonb)::int AS address_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(address->>'city', address->>'municipio', '')), '') IS NOT NULL)::int AS municipio_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(address->>'state', address->>'uf', '')), '') IS NOT NULL)::int AS uf_filled,
      COUNT(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(address->>'razaoSocial', address->>'situacaoCadastral', address->>'consultedAt', '')), '') IS NOT NULL)::int AS receita_filled,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1
          FROM jsonb_each(COALESCE(custom_fields, '{}'::jsonb)) AS cf(k, v)
          WHERE v IS NOT NULL
            AND jsonb_typeof(v) != 'null'
            AND NOT (jsonb_typeof(v) = 'string' AND BTRIM(v #>> '{}') = '')
            AND NOT (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0)
        )
      )::int AS with_any_custom_field
    FROM crm_accounts
    WHERE tenant_id = ${tenantId} AND archived_at IS NULL
  `;

  const total = Number(row?.total_accounts ?? 0);
  const mk = (count: unknown) => {
    const n = Number(count ?? 0);
    return { filledCount: n, fillRatePercent: calcFillRate(n, total) };
  };

  return {
    totalAccounts: total,
    companiesCount: Number(row?.companies_count ?? 0),
    personsCount: Number(row?.persons_count ?? 0),
    withAnyCustomField: mk(row?.with_any_custom_field),
    fields: {
      tradeName: mk(row?.trade_name_filled),
      segment: mk(row?.segment_filled),
      document: mk(row?.document_filled),
      phone: mk(row?.phone_filled),
      email: mk(row?.email_filled),
      website: mk(row?.website_filled),
      notes: mk(row?.notes_filled),
      rdOrganizationId: mk(row?.rd_org_filled),
      address: mk(row?.address_filled),
      municipio: mk(row?.municipio_filled),
      uf: mk(row?.uf_filled),
      receitaFederal: mk(row?.receita_filled),
    },
  };
}

export async function executeListCrmCustomFields(
  args: Record<string, any>,
  tenantId: string,
  sql: any,
) {
  const rawEntity = String(args.entityType || "all").trim().toLowerCase();
  const validEntities = new Set(["company", "deal", "contact", "product", "all"]);
  if (!validEntities.has(rawEntity)) {
    throw new Error(
      `entityType inválido ('${rawEntity}'). Use 'company', 'deal', 'contact', 'product' ou 'all'.`,
    );
  }
  const entityType = rawEntity as CustomFieldEntity | "all";
  const includeUsageStats = args.includeUsageStats === true;
  const includeArchived = args.includeArchived === true;
  const search = typeof args.search === "string" ? args.search.trim().toLowerCase() : "";

  const conditions = [sql`tenant_id = ${tenantId}`];
  if (entityType !== "all") {
    conditions.push(sql`entity_type = ${entityType}`);
  }
  if (!includeArchived) {
    conditions.push(sql`archived_at IS NULL`);
  }

  const whereClause = conditions.reduce((acc, curr, idx) =>
    idx === 0 ? curr : sql`${acc} AND ${curr}`,
  );

  const rawRows = await sql`
    SELECT
      id,
      entity_type,
      name,
      field_type,
      options,
      required,
      all_pipelines,
      pipeline_ids,
      visible_on_create,
      is_unique,
      required_rule,
      required_from_stage_id,
      sort_order,
      archived_at
    FROM crm_custom_field_definitions
    WHERE ${whereClause}
    ORDER BY entity_type ASC, sort_order ASC, created_at ASC
  `;

  let defs = (rawRows || []).map(normalizeCustomFieldDefinitionRow);
  if (search) {
    const normSearch = normalizeLookupKey(search);
    defs = defs.filter(
      (d) =>
        normalizeLookupKey(d.name).includes(normSearch) ||
        d.id.toLowerCase().includes(search),
    );
  }

  const usageByEntity = new Map<
    CustomFieldEntity,
    { totalRecords: number; countsByFieldId: Map<string, number> }
  >();
  let companyStandardFieldsCoverage:
    | Awaited<ReturnType<typeof queryCompanyStandardFieldsCoverage>>
    | undefined;

  if (includeUsageStats) {
    const entitiesToQuery: CustomFieldEntity[] =
      entityType === "all"
        ? (["company", "deal", "contact", "product"] as CustomFieldEntity[]).filter(
            (ent) => ent === "company" || defs.some((d) => d.entityType === ent),
          )
        : [entityType];

    const usageResults = await Promise.all(
      entitiesToQuery.map(async (ent) => ({
        ent,
        stats: await queryEntityCustomFieldUsage(sql, tenantId, ent),
      })),
    );
    for (const item of usageResults) {
      usageByEntity.set(item.ent, item.stats);
    }

    if (entityType === "company" || entityType === "all") {
      companyStandardFieldsCoverage = await queryCompanyStandardFieldsCoverage(sql, tenantId);
    }
  }

  const fieldsOut = defs.map((def) => {
    const usage = usageByEntity.get(def.entityType as CustomFieldEntity);
    const filledCount = usage ? (usage.countsByFieldId.get(def.id) ?? 0) : undefined;
    const totalRecords = usage ? usage.totalRecords : undefined;

    return {
      id: def.id,
      entityType: def.entityType,
      name: def.name,
      fieldType: def.fieldType,
      required: def.required,
      visibleOnCreate: def.visibleOnCreate,
      isUnique: def.isUnique,
      requiredRule: def.requiredRule,
      requiredFromStageId: def.requiredFromStageId,
      allPipelines: def.allPipelines,
      pipelineIds: def.pipelineIds,
      options: def.options,
      sortOrder: def.sortOrder,
      archivedAt: def.archivedAt,
      ...(usage
        ? {
            filledRecordsCount: filledCount,
            totalRecordsCount: totalRecords,
            fillRatePercent: calcFillRate(filledCount ?? 0, totalRecords ?? 0),
          }
        : {}),
    };
  });

  const byEntityCount: Record<string, number> = {};
  for (const field of fieldsOut) {
    byEntityCount[field.entityType] = (byEntityCount[field.entityType] ?? 0) + 1;
  }

  return {
    tenantId,
    entityType,
    includeUsageStats,
    totalFields: fieldsOut.length,
    byEntityCount,
    fields: fieldsOut,
    ...(companyStandardFieldsCoverage ? { companyStandardFieldsCoverage } : {}),
  };
}
