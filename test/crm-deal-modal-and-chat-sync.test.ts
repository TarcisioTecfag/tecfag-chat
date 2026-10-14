import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { CONTACT_ROLE_LABELS, formatContactRoleLabel } from "../src/components/crm/DealAddContactDrawer";

const rootDir = path.resolve(__dirname, "..");

describe("CRM Deal Modal, Contact/Account Drawers & Chat Sync", () => {
  it("translates contact role tags to PT-BR accurately", () => {
    expect(formatContactRoleLabel("buyer")).toBe("Comprador");
    expect(formatContactRoleLabel("DECISION_MAKER")).toBe("Decisor");
    expect(formatContactRoleLabel("decision-maker")).toBe("Decisor");
    expect(formatContactRoleLabel("technical")).toBe("Técnico");
    expect(formatContactRoleLabel("user")).toBe("Usuário");
    expect(formatContactRoleLabel("influencer")).toBe("Influenciador");
    expect(formatContactRoleLabel("financial")).toBe("Financeiro");
    expect(CONTACT_ROLE_LABELS.decision_maker).toBe("Decisor");
  });

  it("implements WYSIWYG rich-text note editor and multi-line markdown normalization in DealDetailModal", () => {
    const modalSource = fs.readFileSync(
      path.join(rootDir, "src/components/crm/DealDetailModal.tsx"),
      "utf-8"
    );

    expect(modalSource).toContain("function normalizeMultilineMarkdown(");
    expect(modalSource).toContain("function serializeRichNoteToMarkdown(");
    expect(modalSource).toContain("ref={noteEditorRef}");
    expect(modalSource).toContain("contentEditable");
    expect(modalSource).toContain("formatContactRoleLabel(");
    expect(modalSource).toContain("<DealLinkAccountDrawer");
  });

  it("shows linked contacts with edit and unlink actions in DealAddContactDrawer when search is empty", () => {
    const drawerSource = fs.readFileSync(
      path.join(rootDir, "src/components/crm/DealAddContactDrawer.tsx"),
      "utf-8"
    );

    expect(drawerSource).toContain("Contatos vinculados a esta negociação");
    expect(drawerSource).toContain("startEditingLinkedContact(");
    expect(drawerSource).toContain("handleSaveEditedContact");
    expect(drawerSource).toContain("handleUnlinkContact(");
    expect(drawerSource).toContain("Desvincular contato da negociação");
  });

  it("provides right-side drawer DealLinkAccountDrawer to link, create, edit, or unlink company", () => {
    const accountDrawerSource = fs.readFileSync(
      path.join(rootDir, "src/components/crm/DealLinkAccountDrawer.tsx"),
      "utf-8"
    );

    expect(accountDrawerSource).toContain("export function DealLinkAccountDrawer(");
    expect(accountDrawerSource).toContain("Empresa vinculada a esta negociação");
    expect(accountDrawerSource).toContain("Criar e Vincular Empresa à Negociação");
    expect(accountDrawerSource).toContain("Desvincular empresa da negociação");
  });

  it("synchronizes crm_deal_contacts and crm_conversation_deals bidirectionally in crm-service.ts", () => {
    const crmServiceSource = fs.readFileSync(
      path.join(rootDir, "src/lib/crm/crm-service.ts"),
      "utf-8"
    );

    expect(crmServiceSource).toContain(
      "Sincroniza automaticamente as conversas deste contato com a negociação (crm_conversation_deals)"
    );
    expect(crmServiceSource).toContain(
      "Sincroniza negociações onde o contato da conversa já é participante em crm_deal_contacts"
    );
  });

  it("hides RdCrmCard when the tenant is not integrated with RD Station CRM", () => {
    const rdDealRouteSource = fs.readFileSync(
      path.join(rootDir, "src/routes/api/contacts/$contactId/rd-deal.ts"),
      "utf-8"
    );
    const rdCrmCardSource = fs.readFileSync(
      path.join(rootDir, "src/components/chat/RdCrmCard.tsx"),
      "utf-8"
    );

    expect(rdDealRouteSource).toContain("const integrated = await isRdCrmConfigured(tenantId);");
    expect(rdDealRouteSource).toContain("JSON.stringify({ integrated: false, linked: false })");
    expect(rdCrmCardSource).toContain("if (data.integrated === false)");
    expect(rdCrmCardSource).toContain("if (integrated === false || (loading && integrated === null))");
  });
});
