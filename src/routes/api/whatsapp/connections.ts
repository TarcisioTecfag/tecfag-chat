import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../../../db";
import {
  channelConfigs,
  contacts,
  conversations,
  operators,
  whatsappConnections,
  whatsappConnectionContacts,
} from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";
import { canManageWhatsappConnection } from "../../../lib/access-control/channel-permissions";
import { conversationReadRules } from "../../../lib/access-control/conversation-policy";
import { requireConversationAccess } from "../../../lib/access-control/conversation-access";
import { SessionManager } from "../../../lib/baileys/session-manager";
import {
  connectionEncryptionReady,
  decryptConnectionAuth,
} from "../../../lib/whatsapp/connection-crypto";
import {
  CORPORATE_CONNECTION,
  multiConnectionEnabled,
  ownsConnection,
} from "../../../lib/whatsapp/connection-policy";
import { conversationConnectionCondition } from "../../../lib/whatsapp/connections";
import { lockContactDeals, syncConversationDeals } from "../../../lib/crm/deal-associations";

const headers = { "Cache-Control": "no-store" };
export const Route = createFileRoute("/api/whatsapp/connections")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const rules = conversationReadRules(session);
        if (!rules.enabled || !rules.channels.includes("whatsapp"))
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        if (!multiConnectionEnabled(session.tenantId))
          return Response.json({ enabled: false, connections: [] }, { headers });
        const requestedId = new URL(request.url).searchParams.get("id");
        const rows = await db
          .select()
          .from(whatsappConnections)
          .where(
            and(
              eq(whatsappConnections.tenantId, session.tenantId),
              session.operator.role === "admin"
                ? undefined
                : eq(whatsappConnections.ownerOperatorId, session.operator.id),
            ),
          );
        if (requestedId) {
          const row = rows.find((r) => r.id === requestedId);
          if (!row) return Response.json({ error: "Conexão não encontrada." }, { status: 404 });
          if (row.ownerOperatorId !== session.operator.id && !canManageWhatsappConnection(session))
            return Response.json(
              { error: "Sem permissão para parear esta conexão." },
              { status: 403 },
            );
          const liveLease = row.leaseUntil && row.leaseUntil.getTime() > Date.now();
          const qr =
            liveLease &&
            row.qrEncrypted &&
            row.qrExpiresAt &&
            row.qrExpiresAt.getTime() > Date.now() &&
            row.enabled
              ? decryptConnectionAuth(session.tenantId, `${row.id}:qr`, row.qrEncrypted)
              : null;
          return Response.json(
            {
              id: row.id,
              status: liveLease ? row.baileysSessionStatus : "disconnected",
              qr,
              phone: row.baileysPairedPhone,
              error: row.lastError,
            },
            { headers },
          );
        }
        const [corporate] = await db
          .select({
            activeProvider: channelConfigs.activeProvider,
            phone: channelConfigs.baileysPairedPhone,
            status: channelConfigs.connectionStatus,
          })
          .from(channelConfigs)
          .where(eq(channelConfigs.tenantId, session.tenantId));
        return Response.json(
          {
            enabled: true,
            canManage: canManageWhatsappConnection(session),
            encryptionReady: connectionEncryptionReady(),
            connections: [
              {
                id: CORPORATE_CONNECTION,
                name: "WhatsApp da empresa",
                provider: corporate?.activeProvider || "baileys",
                phone: corporate?.activeProvider === "baileys" ? corporate.phone : null,
                status: corporate?.status || "disconnected",
                corporate: true,
                enabled: true,
              },
              ...rows.map((row) => ({
                id: row.id,
                name: row.name,
                provider: row.provider,
                ownerOperatorId: row.ownerOperatorId,
                phone: row.baileysPairedPhone,
                status: row.baileysSessionStatus,
                enabled: row.enabled,
                capturePolicy: row.capturePolicy,
                error: row.lastError,
                corporate: false,
              })),
            ],
          },
          { headers },
        );
      },
      POST: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const rules = conversationReadRules(session);
        if (!rules.enabled || !rules.channels.includes("whatsapp"))
          return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
        if (!multiConnectionEnabled(tenantId))
          return Response.json({ error: "Múltiplas conexões não habilitadas." }, { status: 409 });
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object")
          return Response.json({ error: "Requisição inválida." }, { status: 400 });
        if (body.action === "create") {
          if (session.operator.role !== "admin" || !canManageWhatsappConnection(session))
            return Response.json({ error: "Permissão insuficiente." }, { status: 403 });
          const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
          const ownerOperatorId =
            typeof body.ownerOperatorId === "string" ? body.ownerOperatorId : "";
          if (!name || !ownerOperatorId || !["all", "selected"].includes(body.capturePolicy))
            return Response.json(
              { error: "Informe nome, titular e política de captura." },
              { status: 400 },
            );
          const [owner] = await db
            .select({ id: operators.id })
            .from(operators)
            .where(and(eq(operators.tenantId, tenantId), eq(operators.id, ownerOperatorId)));
          if (!owner) return Response.json({ error: "Titular não encontrado." }, { status: 404 });
          if (!connectionEncryptionReady())
            return Response.json(
              { error: "Configure a chave de proteção das novas conexões no servidor." },
              { status: 409 },
            );
          const id = randomUUID();
          await db
            .insert(whatsappConnections)
            .values({ id, tenantId, name, ownerOperatorId, capturePolicy: body.capturePolicy });
          return Response.json({ id }, { status: 201 });
        }
        const id = typeof body.connectionId === "string" ? body.connectionId : "";
        if (!id || id.length > 160)
          return Response.json({ error: "Conexão inválida." }, { status: 400 });
        const corporate = id === CORPORATE_CONNECTION;
        const [connection] = corporate
          ? []
          : await db
              .select()
              .from(whatsappConnections)
              .where(
                and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.id, id)),
              );
        if (!corporate && (!connection || !ownsConnection(session, connection)))
          return Response.json({ error: "Conexão não encontrada." }, { status: 404 });
        if (body.action === "start") {
          if (session.permissions.chat.canCaptureChat !== true || !rules.queues.includes("meus"))
            return Response.json(
              { error: "Sem permissão para iniciar atendimento." },
              { status: 403 },
            );
          if (connection && !connection.enabled)
            return Response.json({ error: "Conexão desativada." }, { status: 409 });
          const contactId = typeof body.contactId === "string" ? body.contactId : "";
          const [contact] = await db
            .select()
            .from(contacts)
            .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
            .limit(1);
          if (!contact) return Response.json({ error: "Contato não encontrado." }, { status: 404 });
          if (corporate && contact.mainChannel !== "whatsapp")
            return Response.json(
              { error: "Abra o atendimento do canal original pela ficha do contato." },
              { status: 409 },
            );
          const connectionId = corporate ? null : id;
          const conversationId = await db.transaction(async (tx) => {
            await lockContactDeals(tx, tenantId, contactId);
            if (connectionId)
              await tx
                .insert(whatsappConnectionContacts)
                .values({ id: randomUUID(), tenantId, connectionId, contactId })
                .onConflictDoNothing();
            const [existing] = await tx
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  eq(conversations.contactId, contactId),
                  conversationConnectionCondition(connectionId),
                ),
              )
              .limit(1);
            if (existing) return existing.id;
            const newId = randomUUID();
            await tx.insert(conversations).values({
              id: newId,
              tenantId,
              contactId,
              whatsappConnectionId: connectionId,
              operatorId: session.operator.id,
              queueState: "meus",
            });
            await syncConversationDeals(tx, tenantId, newId, contactId, session.operator.id);
            return newId;
          });
          const denied = await requireConversationAccess(session, conversationId);
          if (denied) return denied;
          SessionManager.getInstance().notifyPublic(tenantId, {
            type: "queue_update",
            conversationId,
            queueState: "meus",
            operatorId: session.operator.id,
            sectorId: null,
          });
          return Response.json({ conversationId });
        }
        if (corporate || !connection)
          return Response.json(
            { error: "Gerencie a conexão principal nas configurações existentes." },
            { status: 400 },
          );
        const manager = SessionManager.forConnection(tenantId, id);
        if (
          connection.ownerOperatorId !== session.operator.id &&
          !canManageWhatsappConnection(session)
        )
          return Response.json(
            { error: "Sem permissão para gerenciar esta conexão." },
            { status: 403 },
          );
        if (body.action === "connect") {
          if (!connection.enabled || !connectionEncryptionReady())
            return Response.json(
              { error: "Conexão indisponível ou proteção não configurada." },
              { status: 409 },
            );
          await db
            .update(whatsappConnections)
            .set({ lastError: null })
            .where(and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.id, id)));
          void manager
            .initSession(tenantId)
            .catch(async () => {
              await db
                .update(whatsappConnections)
                .set({
                  lastError: "Não foi possível conectar. Verifique a sessão e tente novamente.",
                })
                .where(
                  and(eq(whatsappConnections.tenantId, tenantId), eq(whatsappConnections.id, id)),
                );
            })
            .catch(() =>
              console.error("[WhatsApp] Falha de conexão preservada para nova tentativa."),
            );
          return Response.json({ status: "connecting" }, { status: 202 });
        }
        if (body.action === "disconnect") {
          if (
            connection.leaseUntil &&
            connection.leaseUntil.getTime() > Date.now() &&
            !manager.getSession(tenantId)
          )
            return Response.json(
              { error: "Sessão ativa em outra instância. Desconecte pelo servidor responsável." },
              { status: 409 },
            );
          await manager.disconnectSession(tenantId);
          const [revoked] = await db
            .update(whatsappConnections)
            .set({
              authEncrypted: null,
              qrEncrypted: null,
              qrExpiresAt: null,
              leaseToken: null,
              leaseUntil: null,
              baileysSessionStatus: "disconnected",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(whatsappConnections.tenantId, tenantId),
                eq(whatsappConnections.id, id),
                or(
                  isNull(whatsappConnections.leaseUntil),
                  sql`${whatsappConnections.leaseUntil} < now()`,
                ),
              ),
            )
            .returning({ id: whatsappConnections.id });
          if (!revoked)
            return Response.json(
              { error: "A conexão foi assumida por outra instância. Atualize o status." },
              { status: 409 },
            );
          return Response.json({ status: "disconnected" });
        }
        return Response.json({ error: "Ação inválida." }, { status: 400 });
      },
    },
  },
});
