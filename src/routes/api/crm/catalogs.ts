import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { crmCatalogItems, crmCatalogPolicies } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { requireCrmPermission } from "../../../lib/rbac";
import {
  getCatalogPolicy,
  isCatalogKind,
  listCatalogItems,
  normalizeCatalogName,
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
        return Response.json({
          items: await listCatalogItems(tenantId, kind),
          allowUserCreate: await getCatalogPolicy(tenantId, kind),
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
          if (
            session.operator.role !== "admin" &&
            !(await getCatalogPolicy(session.tenantId, body.kind))
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
          if (
            !isCatalogKind(body.kind) ||
            body.kind === "loss_reason" ||
            typeof body.allowUserCreate !== "boolean"
          )
            throw new Error("Preferência inválida.");
          const [policy] = await db
            .insert(crmCatalogPolicies)
            .values({
              tenantId: session.tenantId,
              kind: body.kind,
              allowUserCreate: body.allowUserCreate,
            })
            .onConflictDoUpdate({
              target: [crmCatalogPolicies.tenantId, crmCatalogPolicies.kind],
              set: { allowUserCreate: body.allowUserCreate, updatedAt: new Date() },
            })
            .returning();
          return Response.json({ policy });
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
