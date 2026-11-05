import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";

const rootDir = path.resolve(__dirname, "..");

describe("CRM Bulk Delete - Opção 'Excluir apenas os que não possuem conversa'", () => {
  it("BulkActionsSuite.tsx deve conter o estado, cálculo e componentes visuais da opção 'Excluir apenas os que não possuem conversa'", () => {
    const suiteContent = fs.readFileSync(
      path.join(rootDir, "src/components/crm/BulkActionsSuite.tsx"),
      "utf-8"
    );

    // Estado e handlers
    expect(suiteContent).toContain("deleteOnlyWithoutConversations");
    expect(suiteContent).toContain("handleToggleDeleteOnlyWithoutConversations");
    expect(suiteContent).toContain("targetDeleteDealCount");
    expect(suiteContent).toContain("nonBlockingCount");
    expect(suiteContent).toContain("localWithoutConvsCount");

    // Textos visuais
    expect(suiteContent).toContain("Excluir apenas os que não possuem conversa");
    expect(suiteContent).toContain(
      "Preserva automaticamente todas as negociações que possuem conversas ou atendimentos ativos vinculados."
    );
    expect(suiteContent).toContain("bulk-delete-only-without-convs");

    // Botão de ação rápida no bloco de negociações bloqueadoras
    expect(suiteContent).toContain("Excluir apenas sem conversa");

    // Repasse de onlyWithoutConversations nas requisições
    expect(suiteContent).toContain("onlyWithoutConversations: deleteOnlyWithoutConversations || undefined");
  });

  it("src/routes/api/crm/deals/bulk.ts deve receber e repassar onlyWithoutConversations para o crmService", () => {
    const routeContent = fs.readFileSync(
      path.join(rootDir, "src/routes/api/crm/deals/bulk.ts"),
      "utf-8"
    );

    expect(routeContent).toContain(
      "onlyWithoutConversations: typeof body.onlyWithoutConversations === \"boolean\" ? body.onlyWithoutConversations : undefined"
    );
  });

  it("src/lib/crm/crm-service.ts deve filtrar e preservar negociações com conversas e retornar preservedCount", () => {
    const crmServiceContent = fs.readFileSync(
      path.join(rootDir, "src/lib/crm/crm-service.ts"),
      "utf-8"
    );

    expect(crmServiceContent).toContain("onlyWithoutConversations?: boolean;");
    expect(crmServiceContent).toContain("crmConversationDeals");
    expect(crmServiceContent).toContain("crmDealContacts");
    expect(crmServiceContent).toContain("preservedWithConversationsCount");
    expect(crmServiceContent).toContain("preservedCount: preservedWithConversationsCount");
    expect(crmServiceContent).toContain(
      "Nenhuma negociação foi excluída: todas as"
    );
  });
});
