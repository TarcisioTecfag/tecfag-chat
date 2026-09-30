import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { crmAccounts, crmCatalogItems, crmDeals } from "../../../../db/schema";
import { requireSession } from "../../../../lib/auth-session";
import { listCatalogItems, normalizeCatalogName } from "../../../../lib/crm/catalogs";

export const Route = createFileRoute("/api/crm/catalogs/$itemId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        try {
          const [current] = await db
            .select()
            .from(crmCatalogItems)
            .where(
              and(
                eq(crmCatalogItems.id, params.itemId),
                eq(crmCatalogItems.tenantId, session.tenantId),
                isNull(crmCatalogItems.archivedAt),
              ),
            )
            .limit(1);
          if (!current) return Response.json({ error: "Item não encontrado." }, { status: 404 });
          const body = await request.json();
          const name = normalizeCatalogName(body.name);
          const description =
            current.kind === "campaign" && typeof body.description === "string"
              ? body.description.trim()
              : null;
          if (description && description.length > 500)
            throw new Error("A descrição deve ter até 500 caracteres.");
          const siblings = await listCatalogItems(
            session.tenantId,
            current.kind as "segment" | "source" | "campaign" | "loss_reason",
          );
          if (
            siblings.some(
              (item) =>
                item.id !== current.id &&
                item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"),
            )
          )
            throw new Error("Já existe um item com esse nome.");
          const item = await db.transaction(async (tx) => {
            const [updated] = await tx
              .update(crmCatalogItems)
              .set({
                name,
                ...(description !== null ? { description: description || null } : {}),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(crmCatalogItems.id, current.id),
                  eq(crmCatalogItems.tenantId, session.tenantId),
                  isNull(crmCatalogItems.archivedAt),
                ),
              )
              .returning();
            if (!updated) throw new Error("Item não encontrado.");
            if (name !== current.name) {
              if (current.kind === "segment")
                await tx
                  .update(crmAccounts)
                  .set({ segment: name, updatedAt: new Date() })
                  .where(
                    and(
                      eq(crmAccounts.tenantId, session.tenantId),
                      eq(crmAccounts.segment, current.name),
                    ),
                  );
              if (current.kind === "source")
                await tx
                  .update(crmDeals)
                  .set({
                    source: name,
                    updatedAt: new Date(),
                    version: sql`${crmDeals.version} + 1`,
                  })
                  .where(
                    and(eq(crmDeals.tenantId, session.tenantId), eq(crmDeals.source, current.name)),
                  );
              if (current.kind === "campaign")
                await tx
                  .update(crmDeals)
                  .set({
                    campaign: name,
                    updatedAt: new Date(),
                    version: sql`${crmDeals.version} + 1`,
                  })
                  .where(
                    and(
                      eq(crmDeals.tenantId, session.tenantId),
                      eq(crmDeals.campaign, current.name),
                    ),
                  );
              if (current.kind === "loss_reason")
                await tx
                  .update(crmDeals)
                  .set({
                    lossReason: name,
                    updatedAt: new Date(),
                    version: sql`${crmDeals.version} + 1`,
                  })
                  .where(
                    and(
                      eq(crmDeals.tenantId, session.tenantId),
                      eq(crmDeals.lossReason, current.name),
                    ),
                  );
            }
            return updated;
          });
          return Response.json({ item });
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "23505")
            return Response.json({ error: "Já existe um item com esse nome." }, { status: 409 });
          return Response.json(
            { error: error instanceof Error ? error.message : "Dados inválidos." },
            { status: 400 },
          );
        }
      },
      DELETE: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        if (session.operator.role !== "admin")
          return Response.json(
            { error: "Permissão insuficiente.", code: "FORBIDDEN" },
            { status: 403 },
          );
        const [item] = await db
          .update(crmCatalogItems)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(crmCatalogItems.id, params.itemId),
              eq(crmCatalogItems.tenantId, session.tenantId),
              isNull(crmCatalogItems.archivedAt),
            ),
          )
          .returning();
        return item
          ? Response.json({ item })
          : Response.json({ error: "Item não encontrado." }, { status: 404 });
      },
    },
  },
});
