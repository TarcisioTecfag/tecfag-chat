import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as orm from "drizzle-orm";
import * as pgCore from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "../src/db/schema";
import type { Conversation } from "../src/lib/mockData";
import {
  compareConversationsForList,
  enqueueSupervisorAttentionAlert,
  extractRecoverableSupervisorAlertsFromConversations,
  extractSupervisorAttentionAlertFromEvent,
  hasActiveSupervisorAttention,
  markSupervisorAlertDismissed,
  normalizeSupervisorAttentionState,
  parseResolvedSupervisorAlertBroadcast,
  readDismissedSupervisorAlertIds,
  removeSupervisorAttentionAlert,
  RESOLVED_SUPERVISOR_ALERT_BROADCAST_KEY,
  SUPERVISOR_ALERT_RECOVERY_MAX_AGE_MS,
} from "../src/lib/supervisor-attention-queue";
import {
  tryAcquireCrossTabSoundSlot,
  tryAcquireNewLeadSoundSlot,
  tryAcquireSupervisorAttentionSoundSlot,
} from "../src/lib/sound-notifications";
import { persistSiteOperatorMessage } from "../src/lib/livechat/site-message-store";
import { loadAccessSource } from "./helpers/access-harness.mjs";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function makeConv(overrides: Partial<Conversation> & { pinned?: boolean }): Conversation & { pinned?: boolean } {
  return {
    id: "conv-1",
    name: "Cliente Teste",
    avatar: "",
    tags: [],
    channel: "whatsapp",
    queue: "meus",
    operatorId: "op-consultor-1",
    messages: [],
    lastMessageTime: "10:00",
    lastMessageAtISO: "2026-11-26T13:00:00.000Z",
    unreadCount: 0,
    ...overrides,
  };
}

describe("filterConversationEvent — isolamento estrito do pop-up supervisor_attention_alert", () => {
  it(
    "entrega supervisor_attention_alert SOMENTE ao consultor específico alvo (mesmo sem valentina.canAccessChat) e bloqueia terceiros/outro tenant",
    async () => {
    const client = new PGlite();
    try {
      const db = drizzle(client);
      const loadedSchema = loadAccessSource("src/db/schema.ts", {
        "drizzle-orm": orm,
        "drizzle-orm/pg-core": pgCore,
      });
      for (const table of [
        loadedSchema.conversations,
        loadedSchema.contacts,
        loadedSchema.whatsappConnections,
        loadedSchema.whatsappConnectionGroupAccess,
      ]) {
        const cfg = pgCore.getTableConfig(table);
        await client.exec(
          `CREATE TABLE "${cfg.name}" (${cfg.columns
            .map((c: any) => `"${c.name}" ${c.getSQLType()}`)
            .join(",")})`,
        );
      }

      await client.query(
        "INSERT INTO contacts (id, tenant_id, name, main_channel, phone) VALUES ('c-1', 'tecfag', 'Indústria Alfa', 'whatsapp', '5514999991111')",
      );
      await client.query(
        "INSERT INTO conversations (id, tenant_id, contact_id, operator_id, queue_state, created_at, last_message_time) VALUES ('conv-att-1', 'tecfag', 'c-1', 'op-alvo', 'meus', NOW(), NOW())",
      );

      const access = loadAccessSource("src/lib/access-control/conversation-access.ts", {
        "../../db": { db },
        "../../db/schema": loadedSchema,
        "drizzle-orm": orm,
      });
      const events = loadAccessSource("src/lib/access-control/conversation-events.ts", {
        "../../db": { db },
        "../../db/schema": loadedSchema,
        "drizzle-orm": orm,
        "./conversation-access": access,
      });

      const targetConsultant = {
        tenantId: "tecfag",
        operator: { id: "op-alvo", name: "Consultor Alvo", role: "agent", groupId: "grp-1" },
        permissions: {
          views: { chat: true, valentina: false },
          chat: {
            canViewQueueMine: true,
            canViewQueueWaiting: false,
            canViewQueueBot: false,
            canViewQueueClosed: false,
            restrictToOwnChats: true,
          },
          valentina: { canAccessChat: false },
        },
        accessGroup: { allowedChannels: ["whatsapp"] },
      };

      const alertEvent = {
        type: "supervisor_attention_alert",
        tenantId: "tecfag",
        operatorId: "op-alvo",
        alert: {
          id: "msg-whisper-1",
          tenantId: "tecfag",
          operatorId: "op-alvo",
          conversationId: "conv-att-1",
          supervisorName: "Patrícia",
          warningText: "Cliente aguardando retorno sobre a proposta há 35 min!",
          clientName: "Indústria Alfa",
          company: "Alfa Embalagens LTDA",
          machine: "Seladora DZ-400",
          receivedAt: new Date().toISOString(),
        },
      };

      // 1. Consultor específico recebe o pop-up mesmo com valentina.canAccessChat=false
      const delivered = await events.filterConversationEvent(targetConsultant, alertEvent);
      expect(delivered).not.toBeNull();
      expect(delivered?.alert?.warningText).toContain("35 min");

      // 2. Outro consultor do mesmo tenant (mesmo admin com acesso global à conversa) NÃO recebe o pop-up
      const otherAdmin = {
        ...targetConsultant,
        operator: { id: "op-gestor", name: "Gestor", role: "admin", groupId: "grp-admin" },
      };
      expect(await events.filterConversationEvent(otherAdmin, alertEvent)).toBeNull();

      // 3. Outro tenant nunca recebe
      const valemSession = {
        ...targetConsultant,
        tenantId: "valem",
      };
      expect(await events.filterConversationEvent(valemSession, alertEvent)).toBeNull();

      // 4. Operador sem permissão views.chat não recebe
      const noChatSession = {
        ...targetConsultant,
        permissions: {
          ...targetConsultant.permissions,
          views: { chat: false, valentina: true },
        },
      };
      expect(await events.filterConversationEvent(noChatSession, alertEvent)).toBeNull();
    } finally {
      await client.close();
    }
  }, 30_000);
});

describe("tag ATENÇÃO!, subida ao 1º lugar e expiração após 1ª mensagem ao cliente", () => {
  it("eleva conversa cobrada para o 1º lugar absoluto (acima de conversas recentes e fixadas) e volta ao normal ao expirar", () => {
    const convPinnedNewer = makeConv({
      id: "conv-pinned",
      name: "Cliente Fixado",
      pinned: true,
      lastMessageAtISO: "2026-11-26T15:30:00.000Z",
    });
    const convVeryRecent = makeConv({
      id: "conv-recent",
      name: "Cliente Recente",
      lastMessageAtISO: "2026-11-26T15:45:00.000Z",
    });
    const convWithAttentionOlder = makeConv({
      id: "conv-attention-1",
      name: "Cliente Cobrado 1",
      lastMessageAtISO: "2026-11-26T11:00:00.000Z",
      supervisorAttention: {
        at: "2026-11-26T15:00:00.000Z",
        operatorId: "op-consultor-1",
        message: "Responder urgente",
        by: "Patrícia",
        messageId: "msg-w-1",
      },
    });
    const convWithAttentionNewer = makeConv({
      id: "conv-attention-2",
      name: "Cliente Cobrado 2",
      lastMessageAtISO: "2026-11-26T10:00:00.000Z",
      supervisorAttention: {
        at: "2026-11-26T15:10:00.000Z",
        operatorId: "op-consultor-1",
        message: "Confirmar prazo hoje",
        by: "Patrícia",
        messageId: "msg-w-2",
      },
    });

    expect(hasActiveSupervisorAttention(convWithAttentionOlder, "op-consultor-1")).toBe(true);
    expect(hasActiveSupervisorAttention(convPinnedNewer, "op-consultor-1")).toBe(false);

    const sorted = [
      convVeryRecent,
      convPinnedNewer,
      convWithAttentionOlder,
      convWithAttentionNewer,
    ].sort((a, b) => compareConversationsForList(a, b, "op-consultor-1"));

    expect(sorted.map((c) => c.id)).toEqual([
      "conv-attention-2",
      "conv-attention-1",
      "conv-pinned",
      "conv-recent",
    ]);

    // Simula expiração após o consultor enviar a 1ª mensagem ao cliente em conv-attention-2
    const expiredConv = {
      ...convWithAttentionNewer,
      supervisorAttention: null,
      lastMessageAtISO: "2026-11-26T15:50:00.000Z",
    };
    expect(hasActiveSupervisorAttention(expiredConv, "op-consultor-1")).toBe(false);

    const sortedAfterReply = [
      convVeryRecent,
      convPinnedNewer,
      convWithAttentionOlder,
      expiredConv,
    ].sort((a, b) => compareConversationsForList(a, b, "op-consultor-1"));

    expect(sortedAfterReply.map((c) => c.id)).toEqual([
      "conv-attention-1",
      "conv-pinned",
      "conv-attention-2",
      "conv-recent",
    ]);
  });

  it("nunca exibe tag ATENÇÃO! nem prioriza conversas finalizadas", () => {
    const finalizedWithFlag = makeConv({
      id: "conv-finalized",
      queue: "finalizados",
      supervisorAttention: {
        at: "2026-11-26T15:00:00.000Z",
        operatorId: "op-consultor-1",
        message: "Cobrança antiga",
        by: "Patrícia",
      },
    });
    expect(hasActiveSupervisorAttention(finalizedWithFlag, "op-consultor-1")).toBe(false);
  });
});

describe("fila de pop-up supervisor-attention-queue e som dedicado", () => {
  it("extrai, enfileira FIFO, deduplica por conversa, sincroniza cross-tab e recupera apenas recentes do operador alvo", () => {
    const storage = createMemoryStorage();
    const now = 1_760_000_000_000;

    const a1 = extractSupervisorAttentionAlertFromEvent(
      {
        type: "supervisor_attention_alert",
        tenantId: "tecfag",
        operatorId: "op-1",
        alert: {
          id: "msg-w-1",
          conversationId: "conv-a",
          supervisorName: "Patrícia",
          warningText: "Retorne agora ao cliente",
          clientName: "João Carlos",
          clientPhone: "5514998887777",
          company: "Doces Sul",
          machine: "Seladora BS-450",
          receivedAt: new Date(now).toISOString(),
        },
      },
      { tenantId: "tecfag", operatorId: "op-1" },
    )!;
    expect(a1).not.toBeNull();
    expect(a1.supervisorName).toBe("Patrícia");
    expect(a1.warningText).toBe("Retorne agora ao cliente");
    expect(a1.company).toBe("Doces Sul");
    expect(a1.machine).toBe("Seladora BS-450");

    // Outro operador não extrai o alerta
    expect(
      extractSupervisorAttentionAlertFromEvent(
        {
          type: "supervisor_attention_alert",
          tenantId: "tecfag",
          operatorId: "op-1",
          alert: { id: "msg-w-1", conversationId: "conv-a", warningText: "Oi" },
        },
        { tenantId: "tecfag", operatorId: "op-2" },
      ),
    ).toBeNull();

    const a2 = extractSupervisorAttentionAlertFromEvent(
      {
        type: "supervisor_attention_alert",
        tenantId: "tecfag",
        operatorId: "op-1",
        alert: {
          id: "msg-w-2",
          conversationId: "conv-b",
          supervisorName: "Tarcísio",
          warningText: "Enviar tabela atualizada",
          clientName: "Maria Silva",
          receivedAt: new Date(now + 1000).toISOString(),
        },
      },
      { tenantId: "tecfag", operatorId: "op-1" },
    )!;

    let queue = enqueueSupervisorAttentionAlert([], a1);
    queue = enqueueSupervisorAttentionAlert(queue, a2);
    // 2ª cobrança na mesma conversa atualiza texto sem duplicar
    queue = enqueueSupervisorAttentionAlert(queue, {
      ...a1,
      id: "msg-w-1b",
      warningText: "Retorne agora com urgência!",
    });
    expect(queue).toHaveLength(2);
    expect(queue[0].warningText).toBe("Retorne agora com urgência!");
    expect(queue[1].conversationId).toBe("conv-b");

    markSupervisorAlertDismissed("tecfag", "op-1", "msg-w-1b", {
      conversationId: "conv-a",
      nowMs: now + 2000,
      storage,
    });
    expect(
      readDismissedSupervisorAlertIds("tecfag", "op-1", { nowMs: now + 3000, storage }).has("msg-w-1b"),
    ).toBe(true);
    // Outro tenant isolado
    expect(
      readDismissedSupervisorAlertIds("valem", "op-1", { nowMs: now + 3000, storage }).has("msg-w-1b"),
    ).toBe(false);

    const broadcast = parseResolvedSupervisorAlertBroadcast(
      storage.getItem(RESOLVED_SUPERVISOR_ALERT_BROADCAST_KEY),
    );
    expect(broadcast?.alertId).toBe("msg-w-1b");
    expect(broadcast?.conversationId).toBe("conv-a");

    queue = removeSupervisorAttentionAlert(queue, { conversationId: "conv-a" });
    expect(queue).toHaveLength(1);
    expect(queue[0].conversationId).toBe("conv-b");

    // Recuperação pós-reload a partir da lista de conversas
    const recoverable = extractRecoverableSupervisorAlertsFromConversations(
      [
        makeConv({
          id: "conv-fresh",
          name: "Lead Recente",
          operatorId: "op-1",
          supervisorAttention: {
            at: new Date(now - 60_000).toISOString(),
            operatorId: "op-1",
            message: "Ligar hoje",
            by: "Patrícia",
            messageId: "msg-fresh",
          },
        }),
        makeConv({
          id: "conv-old",
          operatorId: "op-1",
          supervisorAttention: {
            at: new Date(now - SUPERVISOR_ALERT_RECOVERY_MAX_AGE_MS - 30_000).toISOString(),
            operatorId: "op-1",
            message: "Antigo",
            by: "Patrícia",
            messageId: "msg-old",
          },
        }),
        makeConv({
          id: "conv-other-op",
          operatorId: "op-2",
          supervisorAttention: {
            at: new Date(now - 30_000).toISOString(),
            operatorId: "op-2",
            message: "Outro operador",
            by: "Patrícia",
            messageId: "msg-other",
          },
        }),
      ],
      {
        tenantId: "tecfag",
        operatorId: "op-1",
        nowMs: now,
        dismissedIds: new Set(["msg-dismissed"]),
      },
    );
    expect(recoverable).toHaveLength(1);
    expect(recoverable[0].conversationId).toBe("conv-fresh");
    expect(recoverable[0].warningText).toBe("Ligar hoje");

    expect(normalizeSupervisorAttentionState(null)).toBeNull();
  });

  it("garante slot sonoro independente de mensagem comum e lead novo, deduplicando entre abas", () => {
    const storage = createMemoryStorage();
    const t = 1_760_000_000_000;

    expect(tryAcquireCrossTabSoundSlot(t, storage)).toBe(true);
    expect(tryAcquireNewLeadSoundSlot(t + 20, storage)).toBe(true);
    // Mesmo 40ms após ping comum e lead novo, o som de cobrança da supervisão DEVE tocar
    expect(tryAcquireSupervisorAttentionSoundSlot(t + 40, storage)).toBe(true);
    // Mas duas abas tocando ao mesmo tempo são deduplicadas
    expect(tryAcquireSupervisorAttentionSoundSlot(t + 100, storage)).toBe(false);
    expect(tryAcquireSupervisorAttentionSoundSlot(t + 2200, storage)).toBe(true);
  });
});

describe("persistência PostgreSQL/PGlite — expiração real da flag ao enviar 1ª mensagem ao cliente", () => {
  it("limpa supervisor_attention_* na conversa do Site quando o operador envia a 1ª mensagem ao cliente", async () => {
    const pg = new PGlite();
    try {
      const testDb = drizzle(pg, { schema });
      for (const table of [
        schema.tenants,
        schema.operators,
        schema.contacts,
        schema.conversations,
        schema.messages,
        schema.lcVisitors,
        schema.lcChats,
        schema.lcMessages,
      ]) {
        const cfg = pgCore.getTableConfig(table);
        await pg.exec(
          `CREATE TABLE "${cfg.name}" (${cfg.columns
            .map((c: any) => `"${c.name}" ${c.getSQLType()}${c.primary ? " PRIMARY KEY" : ""}`)
            .join(",")})`,
        );
      }

      await pg.exec(`
        INSERT INTO tenants (id, name, slug, connection_type, created_at)
        VALUES ('tecfag', 'Tecfag', 'tecfag', 'meta', NOW());
        INSERT INTO operators (id, tenant_id, name, email, password_hash, role, status, is_online, must_change_password, usage_seconds_today, created_at)
        VALUES ('op-1', 'tecfag', 'Consultor', 'c@tecfag.com.br', 'x', 'agent', 'disponivel', true, false, 0, NOW());
        INSERT INTO contacts (id, tenant_id, name, main_channel, responsible_name, created_at, updated_at)
        VALUES ('cont-lc-v1', 'tecfag', 'Visitante Alfa', 'livechat', 'Consultor', NOW(), NOW());
        INSERT INTO lc_visitors (id, tenant_id, cookie_id, session_start, last_seen_at, intent_score, pipeline_stage, temperature)
        VALUES ('v1', 'tecfag', 'cookie-1', NOW(), NOW(), 0, 'novo', 'morno');
        INSERT INTO conversations (
          id, tenant_id, contact_id, operator_id, queue_state, unread_count, version,
          rd_marketing_cycle, last_message_time, created_at, updated_at,
          supervisor_attention_at, supervisor_attention_operator_id, supervisor_attention_message,
          supervisor_attention_by, supervisor_attention_message_id
        ) VALUES (
          'conv-lc-v1', 'tecfag', 'cont-lc-v1', 'op-1', 'meus', 1, 1,
          0, NOW(), NOW(), NOW(),
          NOW(), 'op-1', 'Responder urgente!', 'Patrícia', 'msg-w-1'
        );
      `);

      await persistSiteOperatorMessage(testDb as any, {
        tenantId: "tecfag",
        conversationId: "conv-lc-v1",
        operatorId: "op-1",
        operatorName: "Consultor",
        text: "Olá! Já estou verificando para você.",
        idempotencyKey: "site-reply-1",
      });

      const [convAfter] = await testDb
        .select({
          at: schema.conversations.supervisorAttentionAt,
          operatorId: schema.conversations.supervisorAttentionOperatorId,
          message: schema.conversations.supervisorAttentionMessage,
          by: schema.conversations.supervisorAttentionBy,
          messageId: schema.conversations.supervisorAttentionMessageId,
        })
        .from(schema.conversations)
        .where(
          orm.and(
            orm.eq(schema.conversations.tenantId, "tecfag"),
            orm.eq(schema.conversations.id, "conv-lc-v1"),
          ),
        );

      expect(convAfter.at).toBeNull();
      expect(convAfter.operatorId).toBeNull();
      expect(convAfter.message).toBeNull();
      expect(convAfter.by).toBeNull();
      expect(convAfter.messageId).toBeNull();
    } finally {
      await pg.close();
    }
  }, 30_000);
});

describe("contratos de UI, Design System e expiração multi-canal", () => {
  it("SupervisorAttentionAlertModal respeita Design System, Portal global e exibe aviso + dados do cliente + botão abrir conversa", () => {
    const modalSource = readFileSync(
      resolve(__dirname, "../src/components/ui/SupervisorAttentionAlertModal.tsx"),
      "utf-8",
    );
    const rootSource = readFileSync(resolve(__dirname, "../src/routes/__root.tsx"), "utf-8");

    expect(modalSource).toContain("ATENÇÃO!");
    expect(modalSource).toContain("ORIENTAÇÃO DA GESTÃO");
    expect(modalSource).toContain("Abrir conversa agora");
    expect(modalSource).toContain("Informações do cliente");
    expect(modalSource).toContain("playSupervisorAttentionAlertSound");
    expect(modalSource).toContain("createPortal");
    expect(modalSource).toContain("z-[10085]");
    expect(modalSource).toContain("getAiPersona");
    expect(modalSource).toContain("SystemTooltip");
    expect(modalSource).not.toMatch(/\btitle="/);
    expect(modalSource).not.toContain("<select");

    expect(rootSource).toContain("SupervisorAttentionAlertModal");
  });

  it("ChatList e CrmChatWidget exibem tag ATENÇÃO! e ordenam com compareConversationsForList", () => {
    const chatListSource = readFileSync(
      resolve(__dirname, "../src/components/chat/ChatList.tsx"),
      "utf-8",
    );
    const crmWidgetSource = readFileSync(
      resolve(__dirname, "../src/components/crm/CrmChatWidget.tsx"),
      "utf-8",
    );

    expect(chatListSource).toContain("compareConversationsForList");
    expect(chatListSource).toContain("hasActiveSupervisorAttention");
    expect(chatListSource).toContain("ATENÇÃO!");
    expect(crmWidgetSource).toContain("compareConversationsForList");
    expect(crmWidgetSource).toContain("hasActiveSupervisorAttention");
    expect(crmWidgetSource).toContain("ATENÇÃO!");
  });

  it("rotas de envio real de operador e cobrança gravam/limpam supervisorAttention isoladas por tenantId", () => {
    const gestaoMsgs = readFileSync(resolve(__dirname, "../src/routes/api/gestao/messages.ts"), "utf-8");
    const dispatchSrc = readFileSync(resolve(__dirname, "../src/lib/whatsapp/dispatch.ts"), "utf-8");
    const chatsRoute = readFileSync(resolve(__dirname, "../src/routes/api/chats.ts"), "utf-8");

    expect(gestaoMsgs).toContain("supervisorAttentionAt: now");
    expect(gestaoMsgs).toContain('type: "supervisor_attention_alert"');
    expect(dispatchSrc).toContain("supervisorAttentionAt: null");
    expect(dispatchSrc).toContain("clearSupervisorAttention");
    expect(chatsRoute).toContain("supervisorAttentionAt");
    expect(chatsRoute).toContain("supervisorAttention:");
  });
});
