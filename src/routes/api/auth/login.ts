import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db/index.js";
import { operators } from "../../../db/schema.js";
import { eq, and } from "drizzle-orm";
import { verifyPassword, hashPassword, needsPasswordMigration } from "../../../lib/auth-crypto.js";
import { getAvailableTenants, getPlatformMembership } from "../../../lib/platform-access.js";
import { platformAccounts } from "../../../db/schema.js";
import {
  createSession,
  buildSessionCookie,
  sanitizeOperator,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginRateLimit,
} from "../../../lib/auth-session.js";

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
        try {
          const body = await request.json().catch(() => ({}));
          const email = (body.email || "").toString().trim().toLowerCase();
          const password = (body.password || "").toString();
          const tenantId = (body.tenantId || "").toString().trim().toLowerCase();

          if (!email || !password) {
            return new Response(
              JSON.stringify({ success: false, error: "E-mail e senha são obrigatórios." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          if (!tenantId || (tenantId !== "valem" && tenantId !== "tecfag")) {
            return new Response(
              JSON.stringify({ success: false, error: "Selecione a empresa (Tecfag ou Valem)." }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }

          // Rate Limit por identificador (tenant + email)
          const rateLimitKey = `${tenantId}:${email}`;
          const rateCheck = checkLoginRateLimit(rateLimitKey);
          if (!rateCheck.allowed) {
            return new Response(
              JSON.stringify({
                success: false,
                error: `Muitas tentativas incorretas. Tente novamente em ${rateCheck.remainingSeconds} segundos.`,
              }),
              { status: 429, headers: { "Content-Type": "application/json" } }
            );
          }

          // Buscar operador estritamente dentro do tenant selecionado
          const matchedOp = await db.query.operators.findFirst({
            where: and(
              eq(operators.tenantId, tenantId),
              eq(operators.email, email)
            ),
          });

          if (!matchedOp) {
            recordFailedLogin(rateLimitKey);
            return new Response(
              JSON.stringify({ success: false, error: "Credenciais inválidas. Tente novamente." }),
              { status: 401, headers: { "Content-Type": "application/json" } }
            );
          }

          const platformMembership = matchedOp.accountId
            ? await getPlatformMembership(matchedOp.accountId, tenantId)
            : null;
          if (matchedOp.accountId && platformMembership?.operator.id !== matchedOp.id) {
            recordFailedLogin(rateLimitKey);
            return new Response(JSON.stringify({ success: false, error: "Credenciais inválidas. Tente novamente." }), {
              status: 401, headers: { "Content-Type": "application/json" },
            });
          }
          const storedHash = platformMembership?.account.passwordHash ?? matchedOp.passwordHash;
          // Validação segura com scrypt / timingSafeEqual
          const isPasswordValid = verifyPassword(password, storedHash);
          if (!isPasswordValid) {
            recordFailedLogin(rateLimitKey);
            return new Response(
              JSON.stringify({ success: false, error: "Credenciais inválidas. Tente novamente." }),
              { status: 401, headers: { "Content-Type": "application/json" } }
            );
          }

          // Login com sucesso: reseta limitador
          resetLoginRateLimit(rateLimitKey);

          // Migração suave de senha se ainda não estiver em scrypt
          if (needsPasswordMigration(storedHash)) {
            const upgradedHash = hashPassword(password);
            if (platformMembership) {
              await db.update(platformAccounts).set({ passwordHash: upgradedHash })
                .where(eq(platformAccounts.id, platformMembership.account.id));
            } else {
              await db.update(operators).set({ passwordHash: upgradedHash })
                .where(and(eq(operators.id, matchedOp.id), eq(operators.tenantId, tenantId)));
            }
          }

          // Criar sessão de servidor segura
          const { token, expiresAt } = await createSession(matchedOp.tenantId, matchedOp.id);
          const cookieHeader = buildSessionCookie(token, expiresAt);

          console.log(`[Login API] ✅ Operador autenticado com sessão HttpOnly: ${matchedOp.name} (${matchedOp.email}) | Tenant: ${matchedOp.tenantId}`);

          const sanitized = sanitizeOperator(matchedOp);

          return new Response(
            JSON.stringify({
              success: true,
              operator: sanitized,
              tenantId: matchedOp.tenantId,
              availableTenants: matchedOp.accountId
                ? await getAvailableTenants(matchedOp.accountId)
                : [matchedOp.tenantId],
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": cookieHeader,
              },
            }
          );
        } catch (e: any) {
          console.error("[Login API] Erro ao autenticar no servidor:", e);
          return new Response(
            JSON.stringify({ success: false, error: "Erro interno no servidor ao autenticar." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }
      },
    },
  },
});
