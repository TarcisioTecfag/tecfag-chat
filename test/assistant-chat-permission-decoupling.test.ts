import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as orm from "drizzle-orm";
import * as pg from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { loadAccessSource, routeStub, apiRequest } from "./helpers/access-harness.mjs";

const schema = loadAccessSource("src/db/schema.ts", {
  "drizzle-orm": orm,
  "drizzle-orm/pg-core": pg,
});
const rbac = loadAccessSource("src/lib/rbac.ts");

describe("Desacoplamento da permissão do Assistente IA no Chat vs. módulo lateral IA Hub (views.valentina)", () => {
  const tenantId = "tecfag";
  let client: PGlite;
  let db: any;
  let access: any;
  let engine: any;
  let events: any;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client);
    for (const table of [
      schema.conversations,
      schema.contacts,
      schema.messages,
      schema.whatsappConnections,
      schema.whatsappConnectionGroupAccess,
      schema.crmAccounts,
      schema.crmConversationDeals,
      schema.crmDeals,
      schema.crmPipelines,
      schema.crmStages,
      schema.crmDealProducts,
      schema.crmDealActivities,
      schema.crmCustomFieldDefinitions,
      schema.agentFlowStates,
    ]) {
      const config = pg.getTableConfig(table);
      await client.exec(
        `CREATE TABLE "${config.name}" (${config.columns
          .map((column: any) => `"${column.name}" ${column.getSQLType()}`)
          .join(",")})`,
      );
    }

    await client.query(
      "INSERT INTO contacts (id, tenant_id, name, main_channel, phone) VALUES ($1, $2, 'Tiago Marchiori', 'whatsapp', '5516997444141')",
      ["cont-melissa-1", tenantId],
    );
    await client.query(
      "INSERT INTO conversations (id, tenant_id, contact_id, operator_id, queue_state, created_at, last_message_time) VALUES ($1, $2, 'cont-melissa-1', 'op-melissa', 'meus', NOW(), NOW())",
      ["conv-melissa-1", tenantId],
    );
    await client.query(
      "INSERT INTO messages (id, tenant_id, conversation_id, content, sender_type, sender_name, is_internal_note, sent_at) VALUES ('msg-1', $1, 'conv-melissa-1', 'Preciso de orçamento de uma seladora contínua', 'client', 'Tiago Marchiori', false, NOW())",
      [tenantId],
    );

    access = loadAccessSource("src/lib/access-control/conversation-access.ts", {
      "../../db": { db },
      "../../db/schema": schema,
      "drizzle-orm": orm,
    });
    const customCommon = loadAccessSource("src/lib/crm/custom-field-common.ts");
    const customFields = loadAccessSource("src/lib/crm/custom-fields.ts", {
      "../../db": { db },
      "../../db/schema": schema,
      "drizzle-orm": orm,
      "./custom-field-common": customCommon,
    });
    engine = loadAccessSource("src/lib/valentina/assistant-engine.ts", {
      "../../db": { db },
      "../../db/schema": schema,
      "drizzle-orm": orm,
      "../access-control/conversation-access": access,
      "../rbac": rbac,
      "../ai-persona": { getAiPersona: () => ({ name: "Fagner", gender: "male", chatFeatureKey: "fagner_chat" }) },
      "./knowledge-service": { getKnowledgeBaseContext: async () => "" },
      "../crm/custom-fields": customFields,
      "./grammar-corrector": { expandPtBrAbbreviationsAndAccents: (t: string) => t, validateGrammarFidelity: () => ({ valid: true }) },
      "./vtex-assistant-service": { lookupVtexProductsForAssistant: async () => "" },
    });
    events = loadAccessSource("src/lib/access-control/conversation-events.ts", {
      "../../db": { db },
      "../../db/schema": schema,
      "drizzle-orm": orm,
      "./conversation-access": access,
    });
  });

  afterAll(async () => {
    await client?.close();
  });

  function buildSellerSessionWithoutHub(overrides: Record<string, any> = {}) {
    return {
      tenantId,
      operator: { id: "op-melissa", name: "Melissa Gomes", role: "agent", groupId: "group-vendedor" },
      permissions: {
        views: {
          chat: true,
          valentina: false, // Módulo Fagner IA Hub DESMARCADO no menu lateral
          crm: true,
          analytics: false,
          monitor: false,
        },
        chat: {
          canViewQueueMine: true,
          canViewQueueWaiting: true,
          canViewQueueBot: true,
          canViewQueueClosed: true,
          restrictToOwnChats: false,
          canViewAllChats: true,
        },
        valentina: {
          canAccessChat: true, // Permissão do Assistente IA no Chat ATIVA
          canAccessSdr: false,
          canManageSdr: false,
        },
        crm: {
          canViewCrm: true,
          canViewAllDeals: false,
          pipelineScope: "all",
        },
        ...overrides,
      },
      accessGroup: { allowedChannels: ["whatsapp"] },
    };
  }

  function buildAssistantHandler(session: any) {
    const calls: any[] = [];
    const post = loadAccessSource("src/routes/api/valentina/assistant.ts", {
      "@tanstack/react-router": routeStub,
      "../../../lib/auth-session": { requireSession: async () => ({ session }) },
      "../../../lib/ai-persona": {
        getAiPersona: () => ({ name: "Fagner", gender: "male", chatFeatureKey: "fagner_chat" }),
      },
      "../../../lib/access-control/conversation-access": access,
      "../../../lib/vertex-ai": {
        vertexAi: {
          isReady: () => true,
          generateText: async (prompt: string, _model: string, _signal: unknown, context: any) => {
            calls.push({ prompt, context });
            return "Resumo estruturado gerado pelo Fagner com sucesso.";
          },
        },
      },
      "../../../lib/valentina/assistant-engine": engine,
    }).Route.server.handlers.POST;

    return {
      calls,
      run: (body: Record<string, any>) => post({ request: apiRequest(body) }),
    };
  }

  it("permite vendedora gerar Resumo do Atendimento (lead_summary) com views.chat=true e views.valentina=false", async () => {
    const session = buildSellerSessionWithoutHub();
    const h = buildAssistantHandler(session);

    const res = await h.run({
      action: "lead_summary",
      conversationId: "conv-melissa-1",
      contactName: "Tiago Marchiori",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe("lead_summary");
    expect(body.text).toContain("Resumo estruturado gerado pelo Fagner");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].context.tenantId).toBe("tecfag");
    expect(h.calls[0].context.feature).toBe("operator_assistant");
    expect(h.calls[0].prompt).toContain("seladora contínua");
  });

  it("bloqueia com 403 quando canAccessChat=false ou quando nenhum módulo (chat nem valentina) está habilitado", async () => {
    const disabledAssistant = buildSellerSessionWithoutHub({
      valentina: { canAccessChat: false },
    });
    const h1 = buildAssistantHandler(disabledAssistant);
    const res1 = await h1.run({ action: "lead_summary", conversationId: "conv-melissa-1" });
    expect(res1.status).toBe(403);
    expect(h1.calls).toHaveLength(0);

    const noModules = buildSellerSessionWithoutHub({
      views: { chat: false, valentina: false },
    });
    const h2 = buildAssistantHandler(noModules);
    const res2 = await h2.run({ action: "lead_summary", conversationId: "conv-melissa-1" });
    expect(res2.status).toBe(403);
    expect(h2.calls).toHaveLength(0);
  });

  it("entrega eventos SSE operator_ai_notification para vendedora com views.chat=true e views.valentina=false", async () => {
    const session = buildSellerSessionWithoutHub();
    const delivered = await events.filterConversationEvent(session, {
      type: "operator_ai_notification",
      tenantId,
      operatorId: "op-melissa",
      message: { content: "Alerta do Fagner", warningMetadata: { conversationId: "conv-melissa-1" } },
    });
    expect(delivered).not.toBeNull();

    const otherSellerBlocked = await events.filterConversationEvent(session, {
      type: "operator_ai_notification",
      tenantId,
      operatorId: "op-outro",
      message: { content: "Alerta alheio" },
    });
    expect(otherSellerBlocked).toBeNull();
  });

  it("expõe o controle Assistente IA no Chat em 2. Operações de Atendimento (Chat) e protege contra Desmarcar do IA Hub", () => {
    const groupsSource = readFileSync(
      resolve(__dirname, "../src/components/chat/GroupsView.tsx"),
      "utf-8",
    );
    expect(groupsSource).toContain("Assistente ${aiPersona.name} no Chat");
    expect(groupsSource).toContain('if (category === "valentina" && k === "canAccessChat" && !value) continue;');
  });
});
