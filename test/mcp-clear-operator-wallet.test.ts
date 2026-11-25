import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { contacts, conversations, operators, tenants } from "../src/db/schema";
import {
  MCP_TOOLS,
  formatMcpToolLabel,
  getVisibleMcpTools,
  isWriteMcpTool,
  processMcpJsonRpcPayload,
  summarizeMcpToolResult,
  type McpAccessContext,
} from "../src/lib/mcp/valem-tecfag-mcp-core";
import { getApiLibraryCatalog } from "../src/lib/marketing/api-library-catalog";

const RUN_DB_TESTS = Boolean(process.env.DATABASE_URL);

function makeAccess(
  accessLevel: "read" | "read_write",
  tenantId: "tecfag" | "valem" = "tecfag",
): McpAccessContext {
  return {
    authorized: true,
    lockedTenantId: tenantId,
    defaultTenantId: tenantId,
    authMode: tenantId === "valem" ? "token_valem" : "token_tecfag",
    accessLevel,
    keyId: `test-clear-wallet-${accessLevel}`,
    keyLabel: `Teste Clear Wallet (${accessLevel})`,
    skipAuditLog: true,
  };
}

describe("MCP clear_operator_wallet — Limpeza em lote de carteira legada", () => {
  it("expõe clear_operator_wallet apenas em read_write com paridade no catálogo da Biblioteca de API", () => {
    const readNames = new Set(getVisibleMcpTools(makeAccess("read")).map((t) => t.name));
    const rwNames = new Set(getVisibleMcpTools(makeAccess("read_write")).map((t) => t.name));

    expect(readNames.has("clear_operator_wallet")).toBe(false);
    expect(rwNames.has("clear_operator_wallet")).toBe(true);
    expect(isWriteMcpTool("clear_operator_wallet")).toBe(true);
    expect(formatMcpToolLabel("clear_operator_wallet")).toBe("Limpar Carteira de Operador em Lote");

    const catalogEntry = getApiLibraryCatalog("tecfag").find(
      (e) => e.mcpToolName === "clear_operator_wallet",
    );
    expect(catalogEntry).toBeTruthy();
    expect(MCP_TOOLS.some((t) => t.name === "clear_operator_wallet")).toBe(true);

    expect(
      summarizeMcpToolResult("clear_operator_wallet", {
        dryRun: true,
        operator: { name: "Vinicius" },
        matchedContactsCount: 2463,
        byQueueState: { finalizados: 2463 },
      }),
    ).toContain("2463");
    expect(
      summarizeMcpToolResult("clear_operator_wallet", {
        dryRun: false,
        operator: { name: "Vinicius" },
        clearedContactsCount: 2463,
        movedConversationsCount: 2,
      }),
    ).toContain("2463");
  });

  if (!RUN_DB_TESTS) return;

  const suffix = crypto.randomBytes(4).toString("hex");
  const managerOpId = `op-test-mgr-${suffix}`;
  const sellerOpId = `op-test-sel-${suffix}`;
  const valemOpId = `op-test-valem-${suffix}`;

  const cFinalizedId = `cont-test-fin-${suffix}`;
  const cNoConvId = `cont-test-noconv-${suffix}`;
  const cOpenMgrId = `cont-test-openmgr-${suffix}`;
  const cExcludedId = `cont-test-excl-${suffix}`;
  const cOtherWalletBlackId = `cont-test-black-${suffix}`;
  const cValemId = `cont-test-valem-${suffix}`;

  const convFinalizedId = `conv-test-fin-${suffix}`;
  const convOpenMgrId = `conv-test-openmgr-${suffix}`;
  const convOtherWalletBlackId = `conv-test-black-${suffix}`;
  const convValemId = `conv-test-valem-${suffix}`;

  beforeAll(async () => {
    await db
      .insert(tenants)
      .values([
        { id: "tecfag", name: "Tecfag", slug: "tecfag", connectionType: "meta" },
        { id: "valem", name: "Valem", slug: "valem", connectionType: "baileys" },
      ])
      .onConflictDoNothing();

    await db.insert(operators).values([
      {
        id: managerOpId,
        tenantId: "tecfag",
        name: "Gestor Teste",
        email: `gestor-${suffix}@tecfag.test`,
        passwordHash: "hash",
        role: "admin",
        status: "disponivel",
      },
      {
        id: sellerOpId,
        tenantId: "tecfag",
        name: "Vendedora Teste",
        email: `vendedora-${suffix}@tecfag.test`,
        passwordHash: "hash",
        role: "agent",
        status: "disponivel",
      },
      {
        id: valemOpId,
        tenantId: "valem",
        name: "Operador Valem Teste",
        email: `valem-${suffix}@valem.test`,
        passwordHash: "hash",
        role: "admin",
        status: "disponivel",
      },
    ]);

    await db.insert(contacts).values([
      {
        id: cFinalizedId,
        tenantId: "tecfag",
        name: "Lead Finalizado RD",
        phone: `5511991${suffix.slice(0, 6)}`,
        mainChannel: "whatsapp",
        walletOperatorId: managerOpId,
        responsibleName: "Gestor Teste",
      },
      {
        id: cNoConvId,
        tenantId: "tecfag",
        name: "Lead Sem Conversa RD",
        phone: `5511992${suffix.slice(0, 6)}`,
        mainChannel: "whatsapp",
        walletOperatorId: managerOpId,
        responsibleName: "Gestor Teste",
      },
      {
        id: cOpenMgrId,
        tenantId: "tecfag",
        name: "Lead Aberto Carteira Gestor",
        phone: `5511993${suffix.slice(0, 6)}`,
        mainChannel: "whatsapp",
        walletOperatorId: managerOpId,
        responsibleName: "Gestor Teste",
      },
      {
        id: cExcludedId,
        tenantId: "tecfag",
        name: "Lead VIP Preservado",
        phone: `5511994${suffix.slice(0, 6)}`,
        mainChannel: "whatsapp",
        walletOperatorId: managerOpId,
        responsibleName: "Gestor Teste",
      },
      {
        id: cOtherWalletBlackId,
        tenantId: "tecfag",
        name: "Lead Black Outra Carteira",
        phone: `5511995${suffix.slice(0, 6)}`,
        mainChannel: "whatsapp",
        walletOperatorId: sellerOpId,
        responsibleName: "Vendedora Teste",
      },
      {
        id: cValemId,
        tenantId: "valem",
        name: "Cliente Valem Intocavel",
        phone: `5511996${suffix.slice(0, 6)}`,
        mainChannel: "whatsapp",
        walletOperatorId: valemOpId,
        responsibleName: "Operador Valem Teste",
      },
    ]);

    await db.insert(conversations).values([
      {
        id: convFinalizedId,
        tenantId: "tecfag",
        contactId: cFinalizedId,
        operatorId: managerOpId,
        queueState: "finalizados",
        version: 1,
      },
      {
        id: convOpenMgrId,
        tenantId: "tecfag",
        contactId: cOpenMgrId,
        operatorId: managerOpId,
        queueState: "meus",
        version: 1,
      },
      {
        id: convOtherWalletBlackId,
        tenantId: "tecfag",
        contactId: cOtherWalletBlackId,
        operatorId: managerOpId,
        queueState: "meus",
        version: 1,
      },
      {
        id: convValemId,
        tenantId: "valem",
        contactId: cValemId,
        operatorId: valemOpId,
        queueState: "meus",
        version: 1,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(conversations)
      .where(
        inArray(conversations.id, [
          convFinalizedId,
          convOpenMgrId,
          convOtherWalletBlackId,
          convValemId,
        ]),
      );
    await db
      .delete(contacts)
      .where(
        inArray(contacts.id, [
          cFinalizedId,
          cNoConvId,
          cOpenMgrId,
          cExcludedId,
          cOtherWalletBlackId,
          cValemId,
        ]),
      );
    await db
      .delete(operators)
      .where(inArray(operators.id, [managerOpId, sellerOpId, valemOpId]));
  });

  it("executa dryRun, scope only_finalized_or_none, limpeza total preservando exclusões/Black e isola tenant valem", async () => {
    const unwrap = (resp: any) => resp?.body ?? resp;

    // 1. Bloqueado para chave somente leitura
    const readBlocked = unwrap(
      await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "clear_operator_wallet",
            arguments: { tenantId: "tecfag", operatorId: managerOpId, dryRun: true },
          },
        },
        makeAccess("read", "tecfag"),
      ),
    );
    expect(Boolean(readBlocked?.error || readBlocked?.result?.isError)).toBe(true);

    // 2. Dry-run em scope="all" excluindo VIP
    const dryResp = unwrap(
      await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "clear_operator_wallet",
            arguments: {
              tenantId: "tecfag",
              operatorId: managerOpId,
              dryRun: true,
              scope: "all",
              excludeContactIds: [cExcludedId],
            },
          },
        },
        makeAccess("read_write", "tecfag"),
      ),
    );
    const dryData = JSON.parse(dryResp.result.content[0].text);
    expect(dryData.success).toBe(true);
    expect(dryData.dryRun).toBe(true);
    expect(dryData.matchedContactsCount).toBe(3);
    expect(dryData.byQueueState).toEqual({
      meus: 1,
      fila: 0,
      automacao: 0,
      finalizados: 1,
      no_conversation: 1,
    });
    expect(dryData.clearedContactsCount).toBe(0);

    // 3. Executa scope="only_finalized_or_none" (limpa apenas finalizado + sem conversa; mantém aberto)
    const finResp = unwrap(
      await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "clear_operator_wallet",
            arguments: {
              tenantId: "tecfag",
              operatorId: managerOpId,
              dryRun: false,
              scope: "only_finalized_or_none",
              excludeContactIds: [cExcludedId],
              reason: "Teste limpeza finalizados",
            },
          },
        },
        makeAccess("read_write", "tecfag"),
      ),
    );
    const finData = JSON.parse(finResp.result.content[0].text);
    expect(finData.clearedContactsCount).toBe(2);
    expect(finData.remainingWalletContactsCount).toBe(2); // cOpenMgrId + cExcludedId

    // Conversa finalizada NÃO pode ter sido reaberta!
    const [finConvRow] = await db
      .select({ queueState: conversations.queueState })
      .from(conversations)
      .where(and(eq(conversations.tenantId, "tecfag"), eq(conversations.id, convFinalizedId)));
    expect(finConvRow.queueState).toBe("finalizados");

    // 4. Executa scope="all" + moveOpenWalletConversationsToAutomacao=true (move só cOpenMgrId, preserva Black e VIP!)
    const allResp = unwrap(
      await processMcpJsonRpcPayload(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "clear_operator_wallet",
            arguments: {
              tenantId: "tecfag",
              operatorId: managerOpId,
              dryRun: false,
              scope: "all",
              moveOpenWalletConversationsToAutomacao: true,
              excludeContactIds: [cExcludedId],
              reason: "Teste limpeza total + mover aberta da carteira",
            },
          },
        },
        makeAccess("read_write", "tecfag"),
      ),
    );
    const allData = JSON.parse(allResp.result.content[0].text);
    expect(allData.clearedContactsCount).toBe(1);
    expect(allData.movedConversationsCount).toBe(1);
    expect(allData.remainingWalletContactsCount).toBe(1); // apenas cExcludedId

    const [openMgrConv] = await db
      .select({ queueState: conversations.queueState, operatorId: conversations.operatorId })
      .from(conversations)
      .where(and(eq(conversations.tenantId, "tecfag"), eq(conversations.id, convOpenMgrId)));
    expect(openMgrConv.queueState).toBe("automacao");
    expect(openMgrConv.operatorId).toBeNull();

    // Conversa Black November (atribuída ao gestor mas carteira de outra vendedora) permanece intacta!
    const [blackConv] = await db
      .select({ queueState: conversations.queueState, operatorId: conversations.operatorId })
      .from(conversations)
      .where(and(eq(conversations.tenantId, "tecfag"), eq(conversations.id, convOtherWalletBlackId)));
    expect(blackConv.queueState).toBe("meus");
    expect(blackConv.operatorId).toBe(managerOpId);

    // VIP excluído preservado
    const [vipContact] = await db
      .select({ walletOperatorId: contacts.walletOperatorId, responsibleName: contacts.responsibleName })
      .from(contacts)
      .where(and(eq(contacts.tenantId, "tecfag"), eq(contacts.id, cExcludedId)));
    expect(vipContact.walletOperatorId).toBe(managerOpId);

    // Contato limpo gravou responsibleName = "Na Fila"
    const [clearedContact] = await db
      .select({ walletOperatorId: contacts.walletOperatorId, responsibleName: contacts.responsibleName })
      .from(contacts)
      .where(and(eq(contacts.tenantId, "tecfag"), eq(contacts.id, cFinalizedId)));
    expect(clearedContact.walletOperatorId).toBeNull();
    expect(clearedContact.responsibleName).toBe("Na Fila");

    // Isolamento multi-tenant: Valem 100% intocado
    const [valemContact] = await db
      .select({ walletOperatorId: contacts.walletOperatorId })
      .from(contacts)
      .where(and(eq(contacts.tenantId, "valem"), eq(contacts.id, cValemId)));
    expect(valemContact.walletOperatorId).toBe(valemOpId);
  });
});
