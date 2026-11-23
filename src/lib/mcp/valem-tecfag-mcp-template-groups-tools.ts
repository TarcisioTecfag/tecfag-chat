import { asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { metaMessageTemplates, metaTemplateGroups, sectors } from "../../db/schema";
import { stripTemplateAccents } from "../whatsapp/meta-template-common";
import {
  deleteMetaTemplateGroup,
  ensureMetaTemplateGroupsSchema,
  listMetaTemplateGroups,
  normalizeCustomGroups,
  normalizeMetaTemplateSectorScope,
  saveMetaTemplateGroupWithLinks,
  setMetaTemplateCustomGroups,
} from "../whatsapp/meta-templates";
import type { McpToolDefinition, McpWriteActorContext } from "./valem-tecfag-mcp-write-tools";

const TENANT_ID_PROP = {
  type: "string",
  enum: ["tecfag", "valem"],
  default: "tecfag",
  description:
    "Tenant alvo ('tecfag' ou 'valem'). Ignorado quando a chave MCP está travada em um tenant.",
};

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Resolve o nome canônico de um grupo no tenant comparando sem acentos/caixa.
 * Se já existir um grupo cadastrado (ex: "COMERCIAL"), reutiliza exatamente o nome oficial
 * para evitar duplicatas como "Comercial" vs "COMERCIAL".
 */
export function resolveCanonicalGroupNames(
  requestedNames: string[],
  existingGroupNames: string[],
): string[] {
  const existingByKey = new Map<string, string>();
  for (const name of existingGroupNames) {
    const trimmed = name.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const key = stripTemplateAccents(trimmed);
    if (!existingByKey.has(key)) {
      existingByKey.set(key, trimmed);
    }
  }

  const normalized = normalizeCustomGroups(requestedNames);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const rawName of normalized) {
    const key = stripTemplateAccents(rawName);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(existingByKey.get(key) ?? rawName);
  }
  return resolved;
}

/**
 * Calcula a próxima lista de grupos de um template aplicando substituição total (`groups`)
 * ou operações incrementais (`addGroups` / `removeGroups`), sempre preservando os nomes canônicos.
 */
export function computeNextTemplateGroups(
  currentGroups: string[],
  options: {
    groups?: string[];
    addGroups?: string[];
    removeGroups?: string[];
  },
  existingGroupNames: string[],
): string[] {
  const allKnownNames = [...existingGroupNames, ...currentGroups];
  let base =
    options.groups !== undefined
      ? resolveCanonicalGroupNames(options.groups, allKnownNames)
      : resolveCanonicalGroupNames(currentGroups, allKnownNames);

  if (options.removeGroups && options.removeGroups.length > 0) {
    const removeKeys = new Set(options.removeGroups.map((name) => stripTemplateAccents(name)));
    base = base.filter((name) => !removeKeys.has(stripTemplateAccents(name)));
  }

  if (options.addGroups && options.addGroups.length > 0) {
    const additions = resolveCanonicalGroupNames(options.addGroups, [...allKnownNames, ...base]);
    base = resolveCanonicalGroupNames([...base, ...additions], [...allKnownNames, ...base]);
  }

  return base;
}

export const MCP_TEMPLATE_GROUPS_TOOLS: McpToolDefinition[] = [
  {
    name: "list_meta_template_groups",
    access: "read",
    description:
      "Lista todas as categorias/grupos internos de templates Meta cadastrados no tenant (incluindo categorias vazias sem templates), com contagem de templates vinculados, escopo por funil/etapa, lista de templates por categoria e lista de templates sem categoria.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        search: {
          type: "string",
          description: "Filtro opcional por trecho do nome da categoria/grupo.",
        },
        status: {
          type: "string",
          description:
            "Filtra os templates contabilizados/listados por status Meta (ex: 'APPROVED', 'PENDING'). Padrão: todos os templates ativos (exceto DELETED).",
        },
        includeTemplates: {
          type: "boolean",
          default: true,
          description:
            "Quando true (padrão), inclui a lista de templates vinculados em cada categoria e os templates sem categoria (unclassifiedTemplates).",
        },
      },
    },
  },
  {
    name: "save_meta_template_group",
    access: "write",
    description:
      "[ESCRITA] Cria uma nova categoria/grupo de templates Meta ou edita/renomeia uma categoria existente, com suporte a vinculação total (templateIds/templateNames), inclusão/remoção incremental de templates (addTemplateIds/addTemplateNames/removeTemplateIds/removeTemplateNames) e escopo por funil/etapa.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        tenantId: TENANT_ID_PROP,
        groupId: {
          type: "string",
          description: "ID da categoria existente (meta_template_groups.id) para edição/renomeação.",
        },
        currentName: {
          type: "string",
          description:
            "Nome atual da categoria para localizar e renomear/editar (alternativa a groupId).",
        },
        name: {
          type: "string",
          description: "Nome da categoria/grupo a criar ou salvar (ex: 'Fagner', 'COMERCIAL', 'PEÇAS').",
        },
        templateIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional (substituição total): lista completa de IDs (metaTemplateId ou id interno) dos templates que devem pertencer a esta categoria. Omita para preservar vínculos atuais.",
        },
        templateNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional (substituição total): lista completa de nomes exatos dos templates que devem pertencer a esta categoria (combinável com templateIds).",
        },
        addTemplateIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional (incremental): IDs de templates a INCLUIR nesta categoria preservando os já vinculados.",
        },
        addTemplateNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional (incremental): nomes exatos de templates a INCLUIR nesta categoria preservando os já vinculados.",
        },
        removeTemplateIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional (incremental): IDs de templates a REMOVER desta categoria preservando os demais.",
        },
        removeTemplateNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional (incremental): nomes exatos de templates a REMOVER desta categoria preservando os demais.",
        },
        allPipelines: {
          type: "boolean",
          description: "Opcional: true libera a categoria em todos os funis; false restringe a pipelineIds/stageIds.",
        },
        pipelineIds: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: IDs de funis permitidos para a categoria.",
        },
        stageIds: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: IDs de etapas permitidas para a categoria.",
        },
        allSectors: {
          type: "boolean",
          description:
            "Opcional: true libera a categoria para todos os setores; false restringe aos setores informados em sectorIds/sectorNames (admins sempre veem todos).",
        },
        sectorIds: {
          type: "array",
          items: { type: "string" },
          description: "Opcional: IDs de setores que podem ver e enviar templates desta categoria no chat.",
        },
        sectorNames: {
          type: "array",
          items: { type: "string" },
          description:
            "Opcional: nomes dos setores que podem ver esta categoria (ex: ['Máquinas', 'Personnalité', 'Projetos']). Resolvidos automaticamente para os IDs do tenant.",
        },
      },
    },
  },
  {
    name: "delete_meta_template_group",
    access: "write",
    description:
      "[ESCRITA] Exclui uma categoria/grupo interno de templates Meta e desvincula essa categoria dos templates do tenant (os templates oficiais na Meta permanecem intactos). Exige confirmDelete=true.",
    inputSchema: {
      type: "object",
      required: ["confirmDelete"],
      properties: {
        tenantId: TENANT_ID_PROP,
        groupId: {
          type: "string",
          description: "ID da categoria (meta_template_groups.id) a excluir.",
        },
        name: {
          type: "string",
          description: "Nome da categoria a excluir (alternativa a groupId).",
        },
        confirmDelete: {
          type: "boolean",
          description: "OBRIGATÓRIO ser true para confirmar a exclusão da categoria.",
        },
      },
    },
  },
  {
    name: "set_meta_template_groups",
    access: "write",
    description:
      "[ESCRITA] Inclui, substitui ou remove categorias/grupos em um template Meta específico ou em lote (até 200 templates em uma única chamada). Cria automaticamente categorias novas que ainda não existam no tenant e reutiliza nomes oficiais já cadastrados sem duplicar.",
    inputSchema: {
      type: "object",
      properties: {
        tenantId: TENANT_ID_PROP,
        templateId: {
          type: "string",
          description: "Modo unitário: ID interno ou metaTemplateId do template.",
        },
        templateName: {
          type: "string",
          description: "Modo unitário: nome exato do template (alternativa a templateId).",
        },
        groups: {
          type: "array",
          items: { type: "string" },
          description:
            "Modo unitário (substituição): lista exata de categorias do template (passe [] para remover todas).",
        },
        addGroups: {
          type: "array",
          items: { type: "string" },
          description: "Modo unitário (incremental): categorias a adicionar ao template.",
        },
        removeGroups: {
          type: "array",
          items: { type: "string" },
          description: "Modo unitário (incremental): categorias a remover do template.",
        },
        assignments: {
          type: "array",
          description:
            "Modo lote (até 200 itens): lista de atribuições por template ({ templateId?, templateName?, groups?, addGroups?, removeGroups? }).",
          items: {
            type: "object",
            properties: {
              templateId: { type: "string" },
              templateName: { type: "string" },
              groups: { type: "array", items: { type: "string" } },
              addGroups: { type: "array", items: { type: "string" } },
              removeGroups: { type: "array", items: { type: "string" } },
            },
          },
        },
        dryRun: {
          type: "boolean",
          default: false,
          description: "Quando true, simula todas as alterações sem gravar no banco.",
        },
      },
    },
  },
];

export const MCP_TEMPLATE_GROUPS_TOOL_LABELS_PT: Record<string, string> = {
  list_meta_template_groups: "Listagem de Categorias de Templates Meta",
  save_meta_template_group: "Criar / Editar Categoria de Templates Meta",
  delete_meta_template_group: "Excluir Categoria de Templates Meta",
  set_meta_template_groups: "Vincular Templates Meta a Categorias (Unitário/Lote)",
};

const TEMPLATE_GROUPS_TOOL_NAMES = new Set(MCP_TEMPLATE_GROUPS_TOOLS.map((t) => t.name));

export function isTemplateGroupsMcpTool(name: string): boolean {
  return TEMPLATE_GROUPS_TOOL_NAMES.has(name);
}

type TemplateRow = {
  id: string;
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  customGroups: unknown;
};

function findTemplateInList(
  templates: TemplateRow[],
  ref: { templateId?: string; templateName?: string },
): TemplateRow | undefined {
  if (ref.templateId) {
    const byId = templates.find(
      (t) => t.metaTemplateId === ref.templateId || t.id === ref.templateId,
    );
    if (byId) return byId;
  }
  if (ref.templateName) {
    const targetLower = ref.templateName.toLowerCase();
    return templates.find((t) => t.name.toLowerCase() === targetLower);
  }
  return undefined;
}

export async function resolveTenantSectorScopeInput(
  tenantId: string,
  input: {
    allSectors?: boolean;
    sectorIds?: string[];
    sectorNames?: string[];
  },
): Promise<{
  hasSectorPatch: boolean;
  allSectors?: boolean;
  sectorIds?: string[];
  notFoundSectors: string[];
}> {
  const hasSectorPatch =
    input.allSectors !== undefined ||
    input.sectorIds !== undefined ||
    input.sectorNames !== undefined;
  if (!hasSectorPatch) {
    return { hasSectorPatch: false, notFoundSectors: [] };
  }
  if (input.allSectors === true) {
    return { hasSectorPatch: true, allSectors: true, sectorIds: [], notFoundSectors: [] };
  }

  const tenantSectors = await db
    .select({ id: sectors.id, name: sectors.name })
    .from(sectors)
    .where(eq(sectors.tenantId, tenantId))
    .orderBy(asc(sectors.name));

  const resolvedIds = new Set<string>();
  const notFoundSectors: string[] = [];

  for (const idRef of input.sectorIds ?? []) {
    const found = tenantSectors.find((s) => s.id === idRef);
    if (found) resolvedIds.add(found.id);
    else notFoundSectors.push(idRef);
  }
  for (const nameRef of input.sectorNames ?? []) {
    const targetKey = stripTemplateAccents(nameRef);
    const found = tenantSectors.find((s) => stripTemplateAccents(s.name) === targetKey);
    if (found) resolvedIds.add(found.id);
    else notFoundSectors.push(nameRef);
  }

  const idsArr = Array.from(resolvedIds);
  if (input.allSectors === false && idsArr.length === 0) {
    throw new Error(
      notFoundSectors.length > 0
        ? `Nenhum setor válido encontrado (${notFoundSectors.join(", ")}). Informe sectorIds ou sectorNames válidos do tenant '${tenantId}'.`
        : "Informe pelo menos um setor em 'sectorIds' ou 'sectorNames' quando allSectors=false.",
    );
  }

  const normalized = normalizeMetaTemplateSectorScope({
    allSectors: input.allSectors !== undefined ? input.allSectors : idsArr.length === 0,
    sectorIds: idsArr,
  });

  return {
    hasSectorPatch: true,
    allSectors: normalized.allSectors,
    sectorIds: normalized.sectorIds,
    notFoundSectors,
  };
}

export async function executeTemplateGroupsMcpTool(
  name: string,
  args: Record<string, unknown>,
  tenantId: "tecfag" | "valem",
  _actor?: McpWriteActorContext,
): Promise<unknown> {
  await ensureMetaTemplateGroupsSchema();

  switch (name) {
    case "list_meta_template_groups": {
      const searchFilter = asTrimmedString(args.search);
      const searchKey = searchFilter ? stripTemplateAccents(searchFilter) : null;
      const statusFilter = asTrimmedString(args.status)?.toUpperCase();
      const includeTemplates = args.includeTemplates !== false;

      const [groups, rawTemplates, tenantSectors] = await Promise.all([
        listMetaTemplateGroups(tenantId),
        db
          .select({
            id: metaMessageTemplates.id,
            metaTemplateId: metaMessageTemplates.metaTemplateId,
            name: metaMessageTemplates.name,
            language: metaMessageTemplates.language,
            category: metaMessageTemplates.category,
            status: metaMessageTemplates.status,
            customGroups: metaMessageTemplates.customGroups,
            allSectors: metaMessageTemplates.allSectors,
            sectorIds: metaMessageTemplates.sectorIds,
          })
          .from(metaMessageTemplates)
          .where(eq(metaMessageTemplates.tenantId, tenantId))
          .orderBy(asc(metaMessageTemplates.name)),
        db
          .select({ id: sectors.id, name: sectors.name })
          .from(sectors)
          .where(eq(sectors.tenantId, tenantId))
          .orderBy(asc(sectors.name)),
      ]);
      const sectorNameById = new Map(tenantSectors.map((s) => [s.id, s.name]));

      const activeTemplates = rawTemplates
        .filter((t) => {
          if (t.status === "DELETED") return false;
          if (statusFilter && String(t.status || "").toUpperCase() !== statusFilter) return false;
          return true;
        })
        .map((t) => ({
          ...t,
          customGroups: normalizeCustomGroups(t.customGroups),
        }));

      const templatesByGroupKey = new Map<string, typeof activeTemplates>();
      const unclassifiedTemplates: typeof activeTemplates = [];

      for (const tpl of activeTemplates) {
        if (tpl.customGroups.length === 0) {
          unclassifiedTemplates.push(tpl);
          continue;
        }
        for (const gName of tpl.customGroups) {
          const key = stripTemplateAccents(gName);
          const list = templatesByGroupKey.get(key) ?? [];
          list.push(tpl);
          templatesByGroupKey.set(key, list);
        }
      }

      const filteredGroups = groups.filter((g) => {
        if (!searchKey) return true;
        return stripTemplateAccents(g.name).includes(searchKey);
      });

      return {
        tenantId,
        totalGroups: filteredGroups.length,
        totalTemplates: activeTemplates.length,
        classifiedCount: activeTemplates.length - unclassifiedTemplates.length,
        unclassifiedCount: unclassifiedTemplates.length,
        availableSectors: tenantSectors,
        groups: filteredGroups.map((g) => {
          const linked = templatesByGroupKey.get(stripTemplateAccents(g.name)) ?? [];
          const sectorScope = normalizeMetaTemplateSectorScope(g);
          return {
            id: g.id,
            name: g.name,
            allPipelines: g.allPipelines !== false,
            pipelineIds: Array.isArray(g.pipelineIds) ? g.pipelineIds : [],
            stageIds: Array.isArray(g.stageIds) ? g.stageIds : [],
            allSectors: sectorScope.allSectors,
            sectorIds: sectorScope.sectorIds,
            sectorNames: sectorScope.sectorIds
              .map((id) => sectorNameById.get(id))
              .filter((n): n is string => Boolean(n)),
            createdAt: g.createdAt,
            templateCount: linked.length,
            ...(includeTemplates
              ? {
                  templates: linked.map((t) => ({
                    id: t.id,
                    metaTemplateId: t.metaTemplateId,
                    name: t.name,
                    category: t.category,
                    status: t.status,
                    language: t.language,
                    allSectors: t.allSectors !== false,
                    sectorIds: Array.isArray(t.sectorIds) ? t.sectorIds : [],
                  })),
                }
              : {}),
          };
        }),
        ...(includeTemplates
          ? {
              unclassifiedTemplates: unclassifiedTemplates.map((t) => ({
                id: t.id,
                metaTemplateId: t.metaTemplateId,
                name: t.name,
                category: t.category,
                status: t.status,
                language: t.language,
                allSectors: t.allSectors !== false,
                sectorIds: Array.isArray(t.sectorIds) ? t.sectorIds : [],
              })),
            }
          : {}),
      };
    }

    case "save_meta_template_group": {
      const targetName = asTrimmedString(args.name);
      if (!targetName) {
        throw new Error("Campo obrigatório 'name' não informado.");
      }
      const groupIdInput = asTrimmedString(args.groupId);
      const currentNameInput = asTrimmedString(args.currentName);

      const existingGroups = await db
        .select()
        .from(metaTemplateGroups)
        .where(eq(metaTemplateGroups.tenantId, tenantId))
        .orderBy(asc(metaTemplateGroups.name));

      const matchedExistingGroup = groupIdInput
        ? existingGroups.find((g) => g.id === groupIdInput)
        : currentNameInput
          ? existingGroups.find(
              (g) => stripTemplateAccents(g.name) === stripTemplateAccents(currentNameInput),
            )
          : existingGroups.find(
              (g) => stripTemplateAccents(g.name) === stripTemplateAccents(targetName),
            );

      if (groupIdInput && !matchedExistingGroup) {
        throw new Error(`Categoria '${groupIdInput}' não encontrada no tenant '${tenantId}'.`);
      }
      if (currentNameInput && !matchedExistingGroup) {
        throw new Error(`Categoria '${currentNameInput}' não encontrada no tenant '${tenantId}'.`);
      }

      const replaceIds = asStringArray(args.templateIds);
      const replaceNames = asStringArray(args.templateNames);
      const addIds = asStringArray(args.addTemplateIds);
      const addNames = asStringArray(args.addTemplateNames);
      const removeIds = asStringArray(args.removeTemplateIds);
      const removeNames = asStringArray(args.removeTemplateNames);

      const hasReplace = replaceIds !== undefined || replaceNames !== undefined;
      const hasIncremental =
        (addIds && addIds.length > 0) ||
        (addNames && addNames.length > 0) ||
        (removeIds && removeIds.length > 0) ||
        (removeNames && removeNames.length > 0);

      if (hasReplace && hasIncremental) {
        throw new Error(
          "Use substituição total (templateIds/templateNames) OU alteração incremental (addTemplate*/removeTemplate*), não ambos juntos.",
        );
      }

      let resolvedTemplateIds: string[] | undefined;
      const notFoundRefs: string[] = [];

      if (hasReplace || hasIncremental) {
        const tenantTemplates = (
          await db
            .select({
              id: metaMessageTemplates.id,
              metaTemplateId: metaMessageTemplates.metaTemplateId,
              name: metaMessageTemplates.name,
              language: metaMessageTemplates.language,
              category: metaMessageTemplates.category,
              status: metaMessageTemplates.status,
              customGroups: metaMessageTemplates.customGroups,
            })
            .from(metaMessageTemplates)
            .where(eq(metaMessageTemplates.tenantId, tenantId))
        ).filter((t) => t.status !== "DELETED");

        const resolveRefs = (ids?: string[], names?: string[]): string[] => {
          const out: string[] = [];
          for (const idRef of ids ?? []) {
            const tpl = findTemplateInList(tenantTemplates, { templateId: idRef });
            if (tpl) out.push(tpl.metaTemplateId);
            else notFoundRefs.push(idRef);
          }
          for (const nameRef of names ?? []) {
            const tpl = findTemplateInList(tenantTemplates, { templateName: nameRef });
            if (tpl) out.push(tpl.metaTemplateId);
            else notFoundRefs.push(nameRef);
          }
          return out;
        };

        if (hasReplace) {
          resolvedTemplateIds = Array.from(new Set(resolveRefs(replaceIds, replaceNames)));
        } else {
          const matchNames = new Set<string>([
            stripTemplateAccents(targetName),
            ...(matchedExistingGroup ? [stripTemplateAccents(matchedExistingGroup.name)] : []),
          ]);
          const currentLinked = new Set<string>();
          for (const tpl of tenantTemplates) {
            const groups = normalizeCustomGroups(tpl.customGroups);
            if (groups.some((g) => matchNames.has(stripTemplateAccents(g)))) {
              currentLinked.add(tpl.metaTemplateId);
            }
          }
          for (const id of resolveRefs(addIds, addNames)) {
            currentLinked.add(id);
          }
          for (const id of resolveRefs(removeIds, removeNames)) {
            currentLinked.delete(id);
          }
          resolvedTemplateIds = Array.from(currentLinked);
        }
      }

      const sectorPatch = await resolveTenantSectorScopeInput(tenantId, {
        allSectors: typeof args.allSectors === "boolean" ? args.allSectors : undefined,
        sectorIds: asStringArray(args.sectorIds),
        sectorNames: asStringArray(args.sectorNames),
      });

      const saved = await saveMetaTemplateGroupWithLinks(tenantId, {
        groupId: matchedExistingGroup?.id,
        name: targetName,
        templateIds: resolvedTemplateIds,
        allPipelines: typeof args.allPipelines === "boolean" ? args.allPipelines : undefined,
        pipelineIds: asStringArray(args.pipelineIds),
        stageIds: asStringArray(args.stageIds),
        ...(sectorPatch.hasSectorPatch
          ? {
              allSectors: sectorPatch.allSectors,
              sectorIds: sectorPatch.sectorIds,
            }
          : {}),
      });

      const savedNameKey = stripTemplateAccents(saved.group.name);
      const linkedTemplates = saved.templates
        .filter(
          (t) =>
            t.status !== "DELETED" &&
            normalizeCustomGroups(t.customGroups).some(
              (g) => stripTemplateAccents(g) === savedNameKey,
            ),
        )
        .map((t) => ({
          id: t.id,
          metaTemplateId: t.metaTemplateId,
          name: t.name,
          category: t.category,
          status: t.status,
        }));

      const savedSectorScope = normalizeMetaTemplateSectorScope(saved.group);
      return {
        success: true,
        tenantId,
        created: !matchedExistingGroup,
        renamedFrom:
          matchedExistingGroup && matchedExistingGroup.name !== saved.group.name
            ? matchedExistingGroup.name
            : null,
        group: {
          id: saved.group.id,
          name: saved.group.name,
          allPipelines: saved.group.allPipelines !== false,
          pipelineIds: Array.isArray(saved.group.pipelineIds) ? saved.group.pipelineIds : [],
          stageIds: Array.isArray(saved.group.stageIds) ? saved.group.stageIds : [],
          allSectors: savedSectorScope.allSectors,
          sectorIds: savedSectorScope.sectorIds,
        },
        templateCount: linkedTemplates.length,
        templates: linkedTemplates,
        notFoundTemplates: notFoundRefs,
        notFoundSectors: sectorPatch.notFoundSectors,
        totalGroupsInTenant: saved.groups.length,
      };
    }

    case "delete_meta_template_group": {
      if (args.confirmDelete !== true) {
        throw new Error(
          "Exclusão cancelada: informe confirmDelete=true para confirmar a exclusão da categoria de templates.",
        );
      }
      const groupIdInput = asTrimmedString(args.groupId);
      const nameInput = asTrimmedString(args.name);
      if (!groupIdInput && !nameInput) {
        throw new Error("Informe 'groupId' ou 'name' da categoria que deseja excluir.");
      }

      const existingGroups = await listMetaTemplateGroups(tenantId);
      const matched = groupIdInput
        ? existingGroups.find((g) => g.id === groupIdInput)
        : existingGroups.find(
            (g) => stripTemplateAccents(g.name) === stripTemplateAccents(nameInput!),
          );

      if (!matched) {
        throw new Error(
          `Categoria '${groupIdInput || nameInput}' não encontrada no tenant '${tenantId}'.`,
        );
      }

      const beforeTemplates = await db
        .select({
          name: metaMessageTemplates.name,
          status: metaMessageTemplates.status,
          customGroups: metaMessageTemplates.customGroups,
        })
        .from(metaMessageTemplates)
        .where(eq(metaMessageTemplates.tenantId, tenantId));

      const targetKey = stripTemplateAccents(matched.name);
      const detachedTemplateNames = beforeTemplates
        .filter(
          (t) =>
            t.status !== "DELETED" &&
            normalizeCustomGroups(t.customGroups).some((g) => stripTemplateAccents(g) === targetKey),
        )
        .map((t) => t.name);

      const deleted = await deleteMetaTemplateGroup(tenantId, {
        groupId: matched.id,
        name: matched.name,
      });

      return {
        success: true,
        tenantId,
        deleted: true,
        deletedGroup: {
          id: matched.id,
          name: matched.name,
        },
        detachedTemplateCount: detachedTemplateNames.length,
        detachedTemplates: detachedTemplateNames,
        remainingGroupsCount: deleted.groups.length,
      };
    }

    case "set_meta_template_groups": {
      const dryRun = args.dryRun === true;
      type RawAssignment = {
        templateId?: string;
        templateName?: string;
        groups?: string[];
        addGroups?: string[];
        removeGroups?: string[];
      };

      const rawAssignments: RawAssignment[] = [];
      if (Array.isArray(args.assignments)) {
        if (args.assignments.length === 0) {
          throw new Error("O array 'assignments' não pode ser vazio.");
        }
        if (args.assignments.length > 200) {
          throw new Error("O limite máximo por chamada em 'assignments' é de 200 templates.");
        }
        for (const item of args.assignments) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const obj = item as Record<string, unknown>;
          rawAssignments.push({
            templateId: asTrimmedString(obj.templateId),
            templateName: asTrimmedString(obj.templateName),
            groups: asStringArray(obj.groups),
            addGroups: asStringArray(obj.addGroups),
            removeGroups: asStringArray(obj.removeGroups),
          });
        }
      } else {
        const templateId = asTrimmedString(args.templateId);
        const templateName = asTrimmedString(args.templateName);
        if (!templateId && !templateName) {
          throw new Error(
            "Informe 'templateId'/'templateName' (modo unitário) ou 'assignments' (modo lote).",
          );
        }
        rawAssignments.push({
          templateId,
          templateName,
          groups: asStringArray(args.groups),
          addGroups: asStringArray(args.addGroups),
          removeGroups: asStringArray(args.removeGroups),
        });
      }

      const [existingGroups, rawTemplates] = await Promise.all([
        listMetaTemplateGroups(tenantId),
        db
          .select({
            id: metaMessageTemplates.id,
            metaTemplateId: metaMessageTemplates.metaTemplateId,
            name: metaMessageTemplates.name,
            language: metaMessageTemplates.language,
            category: metaMessageTemplates.category,
            status: metaMessageTemplates.status,
            customGroups: metaMessageTemplates.customGroups,
          })
          .from(metaMessageTemplates)
          .where(eq(metaMessageTemplates.tenantId, tenantId)),
      ]);

      const activeTemplates = rawTemplates.filter((t) => t.status !== "DELETED");
      const knownGroupNames = existingGroups.map((g) => g.name);
      const knownGroupKeysBefore = new Set(knownGroupNames.map((g) => stripTemplateAccents(g)));
      const createdGroupNames = new Set<string>();

      const results: Array<{
        templateRef: string;
        templateId: string | null;
        metaTemplateId: string | null;
        name: string | null;
        status: "updated" | "unchanged" | "not_found" | "invalid";
        previousGroups: string[];
        nextGroups: string[];
        error?: string;
      }> = [];

      let updatedCount = 0;
      let unchangedCount = 0;
      let notFoundCount = 0;

      // Mantém estado em memória caso o mesmo template apareça duas vezes no lote
      const workingGroupsByMetaId = new Map<string, string[]>();
      for (const tpl of activeTemplates) {
        workingGroupsByMetaId.set(tpl.metaTemplateId, normalizeCustomGroups(tpl.customGroups));
      }

      for (const item of rawAssignments) {
        const refLabel = item.templateName || item.templateId || "(vazio)";
        if (!item.templateId && !item.templateName) {
          results.push({
            templateRef: refLabel,
            templateId: null,
            metaTemplateId: null,
            name: null,
            status: "invalid",
            previousGroups: [],
            nextGroups: [],
            error: "Item sem templateId ou templateName.",
          });
          continue;
        }
        if (
          item.groups === undefined &&
          item.addGroups === undefined &&
          item.removeGroups === undefined
        ) {
          results.push({
            templateRef: refLabel,
            templateId: null,
            metaTemplateId: null,
            name: null,
            status: "invalid",
            previousGroups: [],
            nextGroups: [],
            error: "Informe 'groups', 'addGroups' ou 'removeGroups'.",
          });
          continue;
        }

        const tpl = findTemplateInList(activeTemplates, {
          templateId: item.templateId,
          templateName: item.templateName,
        });
        if (!tpl) {
          notFoundCount++;
          results.push({
            templateRef: refLabel,
            templateId: null,
            metaTemplateId: null,
            name: null,
            status: "not_found",
            previousGroups: [],
            nextGroups: [],
            error: `Template '${refLabel}' não encontrado no tenant '${tenantId}'.`,
          });
          continue;
        }

        const previousGroups = workingGroupsByMetaId.get(tpl.metaTemplateId) ?? [];
        const nextGroups = computeNextTemplateGroups(previousGroups, item, knownGroupNames);

        for (const g of nextGroups) {
          const key = stripTemplateAccents(g);
          if (!knownGroupKeysBefore.has(key)) {
            knownGroupKeysBefore.add(key);
            knownGroupNames.push(g);
            createdGroupNames.add(g);
          }
        }

        const changed =
          nextGroups.length !== previousGroups.length ||
          nextGroups.some((g, idx) => g !== previousGroups[idx]);

        if (changed) {
          if (!dryRun) {
            await setMetaTemplateCustomGroups(tenantId, tpl.metaTemplateId, nextGroups);
          }
          workingGroupsByMetaId.set(tpl.metaTemplateId, nextGroups);
          updatedCount++;
        } else {
          unchangedCount++;
        }

        results.push({
          templateRef: refLabel,
          templateId: tpl.id,
          metaTemplateId: tpl.metaTemplateId,
          name: tpl.name,
          status: changed ? "updated" : "unchanged",
          previousGroups,
          nextGroups,
        });
      }

      const finalGroups = dryRun ? existingGroups : await listMetaTemplateGroups(tenantId);

      return {
        success: true,
        tenantId,
        dryRun,
        totalRequested: rawAssignments.length,
        updatedCount,
        unchangedCount,
        notFoundCount,
        createdGroups: Array.from(createdGroupNames),
        totalGroupsInTenant: dryRun
          ? existingGroups.length + createdGroupNames.size
          : finalGroups.length,
        results,
      };
    }

    default:
      throw new Error(`Ferramenta de categorias de templates desconhecida: '${name}'.`);
  }
}
