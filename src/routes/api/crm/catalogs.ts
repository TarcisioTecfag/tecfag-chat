import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { crmCatalogItems, crmCatalogPolicies } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import {
  getCatalogPolicy,
  isCatalogKind,
  listAvailableCatalogOptions,
  listCatalogItems,
  normalizeCatalogItemScope,
  normalizeCatalogName,
  STANDARD_CATALOG_ITEMS,
  type CatalogItemScope,
} from "../../../lib/crm/catalogs";
import { and, eq } from "drizzle-orm";
import { handleConditionalResponse } from "../../../lib/http-cache";

export const Route = createFileRoute("/api/crm/catalogs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const permission = requireCrmPermission(auth.session, "canViewCrm");
        if (permission) return permission;
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        if (!isCatalogKind(kind))
          return Response.json({ error: "Catálogo inválido." }, { status: 400 });
        const pipelineId = url.searchParams.get("pipelineId") || undefined;
        const stageId = url.searchParams.get("stageId") || undefined;
        const tenantId = auth.session.tenantId;
        const policy = await getCatalogPolicy(tenantId, kind);
        const items = await listCatalogItems(tenantId, kind);
        const options = await listAvailableCatalogOptions(tenantId, kind, { pipelineId, stageId });
        const allOptions =
          pipelineId || stageId ? await listAvailableCatalogOptions(tenantId, kind) : options;
        return handleConditionalResponse(request, {
          items,
          options,
          allOptions,
          allowUserCreate: policy.allowUserCreate,
          includeStandard: policy.includeStandard,
          disabledStandardItems: policy.disabledStandardItems,
          restrictByStage: policy.restrictByStage,
          standardItemScopes: policy.standardItemScopes,
          standardItems: STANDARD_CATALOG_ITEMS[kind] || [],
          isAdmin: auth.session.operator.role === "admin",
        });
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const permission = requireCrmPermission(session, "canViewCrm");
        if (permission) return permission;
        try {
          const body = await request.json();
          if (!isCatalogKind(body.kind)) throw new Error("Catálogo inválido.");
          const policy = await getCatalogPolicy(session.tenantId, body.kind);
          if (
            session.operator.role !== "admin" &&
            !policy.allowUserCreate
          )
            return Response.json(
              { error: "Permissão insuficiente.", code: "FORBIDDEN" },
              { status: 403 },
            );
          const name = normalizeCatalogName(body.name);
          const description =
            body.kind === "campaign" && typeof body.description === "string"
              ? body.description.trim()
              : "";
          if (description.length > 500) throw new Error("A descrição deve ter até 500 caracteres.");
          const scope = normalizeCatalogItemScope(body);
          const items = await listCatalogItems(session.tenantId, body.kind);
          if (
            items.some(
              (item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
            )
          )
            throw new Error("Já existe um item com esse nome.");
          const [item] = await db
            .insert(crmCatalogItems)
            .values({
              id: `cat-${crypto.randomUUID()}`,
              tenantId: session.tenantId,
              kind: body.kind,
              name,
              description: description || null,
              allPipelines: scope.allPipelines,
              pipelineIds: scope.pipelineIds,
              stageIds: scope.stageIds,
            })
            .returning();
          return Response.json({ item }, { status: 201 });
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "23505")
            return Response.json({ error: "Já existe um item com esse nome." }, { status: 409 });
          return Response.json(
            { error: error instanceof Error ? error.message : "Dados inválidos." },
            { status: 400 },
          );
        }
      },
      PATCH: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const body = await request.json();
          if (!isCatalogKind(body.kind)) {
            throw new Error("Catálogo inválido.");
          }

          const currentPolicy = await getCatalogPolicy(session.tenantId, body.kind);

          // Ação de atalho para vincular/desvincular motivos diretamente da gaveta de uma etapa do funil
          if (body.action === "set_stage_items" && typeof body.stageId === "string" && body.stageId.trim()) {
            const targetStageId = body.stageId.trim();
            const targetPipelineId = typeof body.pipelineId === "string" ? body.pipelineId.trim() : "";
            const selectedNamesLower = new Set(
              (Array.isArray(body.selectedNames) ? body.selectedNames : [])
                .filter((n: unknown): n is string => typeof n === "string")
                .map((n: string) => n.trim().toLocaleLowerCase("pt-BR"))
                .filter(Boolean),
            );

            const items = await listCatalogItems(session.tenantId, body.kind);
            for (const item of items) {
              const scope = normalizeCatalogItemScope(item);
              const isSelected = selectedNamesLower.has(item.name.toLocaleLowerCase("pt-BR"));
              const hasStage = scope.stageIds.includes(targetStageId);
              if (isSelected && !hasStage) {
                const nextStageIds = Array.from(new Set([...scope.stageIds, targetStageId]));
                const nextPipeIds = targetPipelineId
                  ? Array.from(new Set([...scope.pipelineIds, targetPipelineId]))
                  : scope.pipelineIds;
                await db
                  .update(crmCatalogItems)
                  .set({
                    allPipelines: false,
                    pipelineIds: nextPipeIds,
                    stageIds: nextStageIds,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(crmCatalogItems.id, item.id), eq(crmCatalogItems.tenantId, session.tenantId)));
              } else if (!isSelected && hasStage) {
                const nextStageIds = scope.stageIds.filter((s) => s !== targetStageId);
                const nextAllPipelines = scope.pipelineIds.length === 0 && nextStageIds.length === 0;
                await db
                  .update(crmCatalogItems)
                  .set({
                    allPipelines: nextAllPipelines,
                    stageIds: nextStageIds,
                    updatedAt: new Date(),
                  })
                  .where(and(eq(crmCatalogItems.id, item.id), eq(crmCatalogItems.tenantId, session.tenantId)));
              }
            }

            const nextStandardScopes: Record<string, CatalogItemScope> = { ...currentPolicy.standardItemScopes };
            const standards = STANDARD_CATALOG_ITEMS[body.kind as CatalogKind] || [];
            for (const stdName of standards) {
              const scope = normalizeCatalogItemScope(nextStandardScopes[stdName]);
              const isSelected = selectedNamesLower.has(stdName.toLocaleLowerCase("pt-BR"));
              const hasStage = scope.stageIds.includes(targetStageId);
              if (isSelected && !hasStage) {
                nextStandardScopes[stdName] = {
                  allPipelines: false,
                  pipelineIds: targetPipelineId
                    ? Array.from(new Set([...scope.pipelineIds, targetPipelineId]))
                    : scope.pipelineIds,
                  stageIds: Array.from(new Set([...scope.stageIds, targetStageId])),
                };
              } else if (!isSelected && hasStage) {
                const nextStageIds = scope.stageIds.filter((s) => s !== targetStageId);
                nextStandardScopes[stdName] = {
                  allPipelines: scope.pipelineIds.length === 0 && nextStageIds.length === 0,
                  pipelineIds: scope.pipelineIds,
                  stageIds: nextStageIds,
                };
              }
            }

            const nextRestrictByStage =
              selectedNamesLower.size > 0 ? true : currentPolicy.restrictByStage;

            await db
              .insert(crmCatalogPolicies)
              .values({
                tenantId: session.tenantId,
                kind: body.kind,
                allowUserCreate: currentPolicy.allowUserCreate,
                includeStandard: currentPolicy.includeStandard,
                disabledStandardItems: currentPolicy.disabledStandardItems,
                restrictByStage: nextRestrictByStage,
                standardItemScopes: nextStandardScopes,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [crmCatalogPolicies.tenantId, crmCatalogPolicies.kind],
                set: {
                  restrictByStage: nextRestrictByStage,
                  standardItemScopes: nextStandardScopes,
                  updatedAt: new Date(),
                },
              });

            return Response.json({ ok: true, restrictByStage: nextRestrictByStage });
          }

          const allowUserCreate =
            body.kind === "loss_reason"
              ? false
              : typeof body.allowUserCreate === "boolean"
                ? body.allowUserCreate
                : currentPolicy.allowUserCreate;

          const includeStandard =
            typeof body.includeStandard === "boolean"
              ? body.includeStandard
              : currentPolicy.includeStandard;

          const disabledStandardItems = Array.isArray(body.disabledStandardItems)
            ? (body.disabledStandardItems.filter((i: unknown) => typeof i === "string") as string[])
            : currentPolicy.disabledStandardItems;

          const restrictByStage =
            typeof body.restrictByStage === "boolean"
              ? body.restrictByStage
              : currentPolicy.restrictByStage;

          let standardItemScopes = currentPolicy.standardItemScopes;
          if (body.standardItemScopes && typeof body.standardItemScopes === "object" && !Array.isArray(body.standardItemScopes)) {
            const nextScopes: Record<string, CatalogItemScope> = { ...currentPolicy.standardItemScopes };
            for (const [k, v] of Object.entries(body.standardItemScopes)) {
              if (k.trim()) {
                nextScopes[k.trim()] = normalizeCatalogItemScope(v);
              }
            }
            standardItemScopes = nextScopes;
          }

          const [policy] = await db
            .insert(crmCatalogPolicies)
            .values({
              tenantId: session.tenantId,
              kind: body.kind,
              allowUserCreate,
              includeStandard,
              disabledStandardItems,
              restrictByStage,
              standardItemScopes,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [crmCatalogPolicies.tenantId, crmCatalogPolicies.kind],
              set: {
                allowUserCreate,
                includeStandard,
                disabledStandardItems,
                restrictByStage,
                standardItemScopes,
                updatedAt: new Date(),
              },
            })
            .returning();

          return Response.json({
            policy: {
              kind: policy.kind,
              allowUserCreate: policy.allowUserCreate,
              includeStandard: policy.includeStandard,
              disabledStandardItems: policy.disabledStandardItems,
              restrictByStage: policy.restrictByStage,
              standardItemScopes: policy.standardItemScopes,
            },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Dados inválidos." },
            { status: 400 },
          );
        }
      },
    },
  },
});
