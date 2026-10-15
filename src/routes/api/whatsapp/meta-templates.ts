import { createFileRoute } from "@tanstack/react-router";
import { recordCrmAction } from "../../../lib/crm/action-history";
import { requirePermission, requireSession } from "../../../lib/auth-session";
import {
  createMetaTemplate,
  deleteMetaTemplate,
  deleteMetaTemplateGroup,
  listMetaTemplateGroups,
  saveMetaTemplateGroupWithLinks,
  setMetaTemplateBindings,
  setMetaTemplateCustomGroups,
  syncMetaTemplates,
  updateMetaTemplate,
} from "../../../lib/whatsapp/meta-templates";

async function authorize(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth;
  const denied = requirePermission(auth.session, (permissions) => permissions.security?.canManageGlobalTemplates === true);
  return denied ? { response: denied } : auth;
}

function failure(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Falha ao gerenciar template da Meta." }, { status: 400 });
}

export const Route = createFileRoute("/api/whatsapp/meta-templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const templates = await syncMetaTemplates(auth.session.tenantId);
          const groups = await listMetaTemplateGroups(auth.session.tenantId);
          return Response.json({ templates, groups });
        } catch (error) { return failure(error); }
      },
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const body = await request.json();
          if (body?.action === "save_group") {
            const result = await saveMetaTemplateGroupWithLinks(auth.session.tenantId, {
              groupId: typeof body.groupId === "string" ? body.groupId : undefined,
              name: String(body.name || ""),
              templateIds: Array.isArray(body.templateIds) ? body.templateIds : undefined,
            });
            return Response.json(result);
          }
          if (body?.action === "delete_group") {
            const result = await deleteMetaTemplateGroup(auth.session.tenantId, {
              groupId: typeof body.groupId === "string" ? body.groupId : undefined,
              name: typeof body.name === "string" ? body.name : undefined,
            });
            return Response.json(result);
          }
          if (body?.action === "set_template_groups") {
            if (typeof body.metaTemplateId !== "string") {
              return Response.json({ error: "ID do template é obrigatório." }, { status: 400 });
            }
            const result = await setMetaTemplateCustomGroups(
              auth.session.tenantId,
              body.metaTemplateId,
              body.customGroups,
            );
            const groups = await listMetaTemplateGroups(auth.session.tenantId);
            return Response.json({ ...result, groups });
          }
          const result = await createMetaTemplate(auth.session.tenantId, body);
          return Response.json(result);
        } catch (error) { return failure(error); }
      },
      PUT: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const body = await request.json();
          if (typeof body.metaTemplateId !== "string") return Response.json({ error: "ID obrigatório." }, { status: 400 });
          return Response.json(await updateMetaTemplate(auth.session.tenantId, body.metaTemplateId, body));
        } catch (error) { return failure(error); }
      },
      PATCH: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const body = await request.json();
          if (typeof body.metaTemplateId !== "string") return Response.json({ error: "ID obrigatório." }, { status: 400 });
          return Response.json(
            await setMetaTemplateBindings(
              auth.session.tenantId,
              body.metaTemplateId,
              body.bindings,
              body.customGroups,
            ),
          );
        } catch (error) { return failure(error); }
      },
      DELETE: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const searchParams = new URL(request.url).searchParams;
          const groupId = searchParams.get("groupId");
          const groupName = searchParams.get("groupName");
          if (groupId || groupName) {
            return Response.json(
              await deleteMetaTemplateGroup(auth.session.tenantId, {
                groupId: groupId || undefined,
                name: groupName || undefined,
              }),
            );
          }
          const id = searchParams.get("id");
          if (!id) return Response.json({ error: "ID obrigatório." }, { status: 400 });
          const result = await deleteMetaTemplate(auth.session.tenantId, id);
          await recordCrmAction({ tenantId: auth.session.tenantId,
            operatorId: auth.session.operator.id, operatorName: auth.session.operator.name,
            action: "delete_meta_template", entityType: "meta_template", itemCount: 1,
            details: { id } });
          return Response.json(result);
        } catch (error) { return failure(error); }
      },
    },
  },
});

