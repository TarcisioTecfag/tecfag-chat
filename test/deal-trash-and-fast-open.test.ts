import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isCurrentDealEligible,
  isTrashedDeal,
} from "../src/lib/crm/conversation-deal-policy";

describe("Política de Lixeira no Painel do Chat", () => {
  test("isTrashedDeal identifica corretamente negociações na Lixeira e preserva pausadas legítimas", () => {
    expect(isTrashedDeal({ status: "paused", pausedReason: "Lixeira" })).toBe(true);
    expect(isTrashedDeal({ status: "paused", pausedReason: "  lixeira  " })).toBe(true);
    expect(isTrashedDeal({ status: "paused", pausedReason: "Lixeira — Duplicada" })).toBe(true);
    expect(isTrashedDeal({ status: "paused", pausedReason: "Lixeira - Teste" })).toBe(true);
    expect(isTrashedDeal({ status: "paused", pausedReason: "Lixeira: duplicado" })).toBe(true);

    // Pausas legítimas e outros status NÃO são lixeira
    expect(isTrashedDeal({ status: "paused", pausedReason: "Retomar em janeiro" })).toBe(false);
    expect(isTrashedDeal({ status: "paused", pausedReason: null })).toBe(false);
    expect(isTrashedDeal({ status: "open", pausedReason: "Lixeira" })).toBe(false);
    expect(isTrashedDeal({ status: "won", pausedReason: "Lixeira" })).toBe(false);
    expect(isTrashedDeal({ status: "lost", pausedReason: "Lixeira" })).toBe(false);
  });

  test("isCurrentDealEligible bloqueia negociações na Lixeira mas mantém pausadas normais", () => {
    expect(isCurrentDealEligible({ status: "open", isLinked: true })).toBe(true);
    expect(
      isCurrentDealEligible({ status: "paused", isLinked: true, pausedReason: "Cliente em férias" }),
    ).toBe(true);
    expect(
      isCurrentDealEligible({ status: "paused", isLinked: true, pausedReason: "Lixeira" }),
    ).toBe(false);
    expect(
      isCurrentDealEligible({
        status: "paused",
        isLinked: true,
        pausedReason: "Lixeira — Card duplicado",
      }),
    ).toBe(false);
  });
});

describe("Regressão estrutural — Performance de getDealById, Lixeira e sincronização de cache", () => {
  const readSrc = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

  test("contact-deals-query.ts não usa regexp_replace em contacts.phone e filtra lixeira por padrão", () => {
    const src = readSrc("src/lib/crm/contact-deals-query.ts");
    expect(src).not.toContain("regexp_replace(coalesce(${contacts.phone}");
    expect(src).toContain("inArray(contacts.phone, exactPhoneVariants)");
    expect(src).toContain("eq(contactPhones.phoneIdentity, phoneIdentity)");
    expect(src).toContain("notTrashedDealCondition");
    expect(src).toContain("export async function getContactsDealRows");
  });

  test("crm-service.ts não roda getDealContext em conversas finalizadas nem N+1 getContactDealRows no getDealById", () => {
    const src = readSrc("src/lib/crm/crm-service.ts");
    expect(src).toContain('r.conversation.queueState !== "finalizados"');
    expect(src).toContain("getContactsDealRows(db, tenantId, directParticipantIds");
    expect(src).toContain("inArray(conversationDealContexts.currentDealId, chunk)");
    // Garante ausência do loop N+1 antigo em getDealById
    expect(src).not.toContain("for (const cId of participantIds) {\n          const rows = await getContactDealRows");
  });

  test("exclusões no CRM disparam crm-deals-changed e limpam caches do chat/preview", () => {
    const crmView = readSrc("src/components/crm/CrmView.tsx");
    const dealModal = readSrc("src/components/crm/DealDetailModal.tsx");
    const bulkSuite = readSrc("src/components/crm/BulkActionsSuite.tsx");
    const panel = readSrc("src/components/crm/ConversationDealsPanel.tsx");
    const dealCtx = readSrc("src/components/crm/ConversationDealContext.tsx");
    const prefetch = readSrc("src/lib/crm/deal-prefetch.ts");

    expect(crmView).toContain('window.dispatchEvent(new Event("crm-deals-changed"))');
    expect(dealModal).toContain('window.dispatchEvent(new Event("crm-deals-changed"))');
    expect(bulkSuite).toContain('window.dispatchEvent(new Event("crm-deals-changed"))');
    expect(panel).toContain("conversationDealsCache.clear()");
    expect(panel).toContain("!isTrashedDeal(d)");
    expect(dealCtx).toContain("invalidateAllDealContextCaches()");
    expect(prefetch).toContain("dealPreviewCache.delete(dealId)");
  });
});
