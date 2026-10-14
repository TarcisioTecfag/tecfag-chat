import { createFileRoute } from "@tanstack/react-router";
import {
  journeyEndpointForToken,
  storeJourneyNotification,
} from "../../../../../lib/rd-marketing/notifications";
import { integrationError, readIntegrationJson } from "../../../../../lib/rd-marketing/http";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
export const Route = createFileRoute("/api/webhooks/rd-marketing/journey/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const hook = await journeyEndpointForToken(params.token);
          return Response.json(
            { status: hook.enabled ? "ready" : "paused", kind: hook.kind, label: hook.label },
            { headers },
          );
        } catch (error) {
          return integrationError(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          // Tenant/account/point come exclusively from the random endpoint secret, never the body.
          const hook = await journeyEndpointForToken(params.token, true);
          if (!hook.enabled)
            return Response.json(
              { accepted: true, paused: true, stored: 0 },
              { status: 202, headers },
            );
          if (
            hook.registrationStatus === "registering" &&
            (!request.body || request.headers.get("content-length") === "0")
          )
            return Response.json(
              { accepted: true, validation: true, stored: 0 },
              { status: 202, headers },
            );
          const receipt = await storeJourneyNotification(hook, await readIntegrationJson(request));
          return Response.json(receipt, { status: 202, headers });
        } catch (error) {
          return integrationError(error);
        }
      },
    },
  },
});
