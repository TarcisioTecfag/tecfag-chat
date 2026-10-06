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
  normalizeCatalogName,
  STANDARD_CATALOG_ITEMS,
} from "../../../lib/crm/catalogs";

export const Route = createFileRoute("/api/crm/catalogs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const permission = requireCrmPermission(auth.session, "canViewCrm");
        if (permission) return permission;
        const kind = new URL(request.url).searchParams.get("kind");
        if (!isCatalogKind(kind))
          return Response.json({ error: "Catálogo inválido." }, { status: 400 });
        const tenantId = auth.session.tenantId;
        const policy = await getCatalogPolicy(tenantId, kind);
        const items = await listCatalogItems(tenantId, kind);
        const options = await listAvailableCatalogOptions(tenantId, kind);
        return Response.json({
          items,
          options,
          allowUserCreate: policy.allowUserCreate,
          includeStandard: policy.includeStandard,
          disabledStandardItems: policy.disabledStandardItems,
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

          const [policy] = await db
            .insert(crmCatalogPolicies)
            .values({
              tenantId: session.tenantId,
              kind: body.kind,
              allowUserCreate,
              includeStandard,
              disabledStandardItems,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [crmCatalogPolicies.tenantId, crmCatalogPolicies.kind],
              set: {
                allowUserCreate,
                includeStandard,
                disabledStandardItems,
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
