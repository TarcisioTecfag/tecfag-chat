import { createFileRoute } from "@tanstack/react-router";
import { requirePermission, requireSession } from "../../../lib/auth-session";
import {
  createMetaTemplate, deleteMetaTemplate, setMetaTemplateBindings,
  syncMetaTemplates, updateMetaTemplate,
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
          return Response.json({ templates });
        } catch (error) { return failure(error); }
      },
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const result = await createMetaTemplate(auth.session.tenantId, await request.json());
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
          return Response.json(await setMetaTemplateBindings(auth.session.tenantId, body.metaTemplateId, body.bindings));
        } catch (error) { return failure(error); }
      },
      DELETE: async ({ request }) => {
        const auth = await authorize(request);
        if ("response" in auth) return auth.response;
        try {
          const id = new URL(request.url).searchParams.get("id");
          if (!id) return Response.json({ error: "ID obrigatório." }, { status: 400 });
          return Response.json(await deleteMetaTemplate(auth.session.tenantId, id));
        } catch (error) { return failure(error); }
      },
    },
  },
});
