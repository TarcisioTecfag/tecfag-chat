import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { operators } from "../../../db/schema";
import { eq, sql } from "drizzle-orm";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      },
      POST: async ({ request }) => {
        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        };

        try {
          const body = await request.json();
          const email = (body.email || "").toString().trim().toLowerCase();
          const password = (body.password || body.passwordHash || "").toString();

          if (!email || !password) {
            return new Response(
              JSON.stringify({ success: false, error: "E-mail e senha são obrigatórios" }),
              {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          // Buscar operador no PostgreSQL por e-mail (case-insensitive)
          const allOps = await db.select().from(operators);
          const matchedOp = allOps.find(
            (op) => op.email.trim().toLowerCase() === email && op.passwordHash === password
          );

          if (!matchedOp) {
            console.warn(`[Login API] Falha no login para o e-mail: ${email}`);
            return new Response(
              JSON.stringify({ success: false, error: "Credenciais inválidas. Tente novamente." }),
              {
                status: 401,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }

          console.log(`[Login API] ✅ Operador autenticado com sucesso: ${matchedOp.name} (${matchedOp.email}) | Tenant: ${matchedOp.tenantId}`);

          return new Response(
            JSON.stringify({
              success: true,
              operator: matchedOp,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch (e: any) {
          console.error("[Login API] Erro ao autenticar no DB:", e);
          return new Response(
            JSON.stringify({ success: false, error: e.message || "Erro interno no servidor ao autenticar" }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
