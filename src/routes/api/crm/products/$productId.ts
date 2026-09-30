import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../lib/rbac";
import { crmService, handleCrmError } from "../../../../lib/crm/crm-service";

export const Route = createFileRoute("/api/crm/products/$productId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const permission = requireCrmPermission(session, "canManageProducts");
          if (permission) return permission;
          const body = await request.json();
          const productId = (params as unknown as { productId: string }).productId;
          const product = await crmService.updateProduct(session.tenantId, productId, {
            name: body.name,
            sku: body.sku,
            description: body.description,
            unitPrice: body.unitPrice,
            unit: body.unit,
            category: body.category,
            isActive: body.isActive,
            customFields: body.customFields,
          });
          return Response.json({ product });
        } catch (error) {
          return handleCrmError(error);
        }
      },
    },
  },
});
