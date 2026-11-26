import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { contacts, conversations } from "../src/db/schema";

describe("POST /api/gestao/messages — consulta de conversa/contato no sussurro de supervisão", () => {
  it("usa contacts.walletOperatorId (coluna válida do schema) e compila SQL sem TypeError do Drizzle", () => {
    const qb = new QueryBuilder();

    // Prova que o bug original (contacts.operatorId === undefined) quebrava o Drizzle com TypeError
    expect((contacts as Record<string, unknown>).operatorId).toBeUndefined();
    expect(() =>
      qb
        .select({
          id: conversations.id,
          walletOperatorId: (contacts as any).operatorId,
        })
        .from(conversations)
        .leftJoin(contacts, eq(conversations.contactId, contacts.id))
        .toSQL(),
    ).toThrow(TypeError);

    // Consulta corrigida com exatamente os mesmos campos de POST /api/gestao/messages
    const compiled = qb
      .select({
        id: conversations.id,
        operatorId: conversations.operatorId,
        queueState: conversations.queueState,
        sectorId: conversations.sectorId,
        version: conversations.version,
        contactName: contacts.name,
        contactPhone: contacts.phone,
        contactAvatar: contacts.avatar,
        walletOperatorId: contacts.walletOperatorId,
      })
      .from(conversations)
      .leftJoin(
        contacts,
        and(eq(conversations.contactId, contacts.id), eq(contacts.tenantId, "tecfag")),
      )
      .where(and(eq(conversations.id, "conv-test-1"), eq(conversations.tenantId, "tecfag")))
      .limit(1)
      .toSQL();

    expect(compiled.sql).toContain('"contacts"."wallet_operator_id"');
    expect(compiled.sql).toContain('"conversations"."tenant_id"');
    expect(compiled.sql).toContain('"contacts"."tenant_id"');
  });

  it("src/routes/api/gestao/messages.ts não referencia contacts.operatorId e preserva isolamento multi-tenant", () => {
    const source = readFileSync(resolve("src/routes/api/gestao/messages.ts"), "utf-8");

    expect(source).not.toContain("contacts.operatorId");
    expect(source).toContain("walletOperatorId: contacts.walletOperatorId");
    expect(source).toContain("requireSession(request)");
    expect(source).toContain("eq(conversations.tenantId, tenantId)");
    expect(source).toContain("eq(contacts.tenantId, tenantId)");
    expect(source).toContain("eq(operators.tenantId, tenantId)");
    expect(source).toContain("eq(messages.tenantId, tenantId)");
  });
});
