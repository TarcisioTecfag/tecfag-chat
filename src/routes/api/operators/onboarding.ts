import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "../../../lib/auth-session";
import {
  applyOperatorOnboardingAction,
  getOperatorOnboardingState,
  validateOnboardingPatchPayload,
} from "../../../lib/onboarding/service";

const NO_STORE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

export const Route = createFileRoute("/api/operators/onboarding")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        try {
          const state = await getOperatorOnboardingState(session);
          return new Response(JSON.stringify(state), {
            status: 200,
            headers: NO_STORE_HEADERS,
          });
        } catch (error) {
          console.error("[api/operators/onboarding] Erro no GET:", error);
          return new Response(
            JSON.stringify({
              error: "Falha ao carregar estado do treinamento.",
              code: "INTERNAL_ERROR",
            }),
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }
      },

      PATCH: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;

        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          return new Response(
            JSON.stringify({
              error: "Corpo da requisição JSON inválido.",
              code: "INVALID_JSON",
            }),
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }

        const validation = validateOnboardingPatchPayload(rawBody);
        if (!validation.ok) {
          return new Response(
            JSON.stringify({
              error: validation.error,
              code: "INVALID_PAYLOAD",
            }),
            { status: 400, headers: NO_STORE_HEADERS },
          );
        }

        try {
          const outcome = await applyOperatorOnboardingAction(
            session,
            validation.input,
          );

          if (!outcome.ok) {
            return new Response(
              JSON.stringify({
                error: outcome.error,
                code: outcome.code,
                missingStepIds: outcome.missingStepIds,
                state: outcome.dto,
              }),
              { status: outcome.status, headers: NO_STORE_HEADERS },
            );
          }

          return new Response(JSON.stringify(outcome.dto), {
            status: 200,
            headers: NO_STORE_HEADERS,
          });
        } catch (error) {
          console.error("[api/operators/onboarding] Erro no PATCH:", error);
          return new Response(
            JSON.stringify({
              error: "Falha ao atualizar progresso do treinamento.",
              code: "INTERNAL_ERROR",
            }),
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }
      },
    },
  },
});
