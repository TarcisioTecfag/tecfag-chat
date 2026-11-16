import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  CrmDealContactRequiredError,
  DEAL_CONTACT_REQUIRED_MESSAGE,
  DEAL_CREATION_CONTACT_REQUIRED_MESSAGE,
  DEAL_LAST_CONTACT_REMOVAL_MESSAGE,
} from "../src/lib/crm/crm-service";

describe("CRM — Obrigatoriedade de Contato em Negociações e Bloqueio de Cards Legados", () => {
  test("CrmDealContactRequiredError retorna HTTP 409 com código CONTACT_REQUIRED", () => {
    const err = new CrmDealContactRequiredError();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONTACT_REQUIRED");
    expect(err.message).toBe(DEAL_CONTACT_REQUIRED_MESSAGE);

    const createErr = new CrmDealContactRequiredError(DEAL_CREATION_CONTACT_REQUIRED_MESSAGE);
    expect(createErr.statusCode).toBe(409);
    expect(createErr.code).toBe("CONTACT_REQUIRED");
    expect(createErr.message).toContain("contato vinculado");

    const removeErr = new CrmDealContactRequiredError(DEAL_LAST_CONTACT_REMOVAL_MESSAGE);
    expect(removeErr.statusCode).toBe(409);
    expect(removeErr.code).toBe("CONTACT_REQUIRED");
  });

  test("CreateDealDialog exige contato obrigatório com suporte a busca ou cadastro inline atômico", async () => {
    const src = await readFile(
      new URL("../src/components/crm/CreateDealDialog.tsx", import.meta.url),
      "utf8",
    );
    expect(src).toContain("Criar novo contato");
    expect(src).toContain("isCreatingNewContact && newContactName.trim()");
    expect(src).toContain("contact: {");
    expect(src).toContain("Vincule um contato existente ou cadastre um novo contato para criar a negociação.");
    // Conformidade com Design System: zero controles nativos HTML proibidos
    expect(src).not.toMatch(/<select[\s>]/);
    expect(src).not.toMatch(/\btitle\s*=/);
    expect(src).not.toMatch(/type=["'](?:date|time|datetime-local)["']/i);
  });

  test("DealDetailModal e DealAddContactDrawer forçam vínculo de contato em cards legados e bloqueiam mutações", async () => {
    const modalSrc = await readFile(
      new URL("../src/components/crm/DealDetailModal.tsx", import.meta.url),
      "utf8",
    );
    const drawerSrc = await readFile(
      new URL("../src/components/crm/DealAddContactDrawer.tsx", import.meta.url),
      "utf8",
    );
    const crmViewSrc = await readFile(
      new URL("../src/components/crm/CrmView.tsx", import.meta.url),
      "utf8",
    );

    expect(modalSrc).toContain("isMissingRequiredContact");
    expect(modalSrc).toContain("requireLinkedContactBeforeMutation");
    expect(modalSrc).toContain("deal-missing-contact-lock-banner");
    expect(modalSrc).toContain("requiredMode={isMissingRequiredContact}");
    expect(modalSrc).toContain('errData?.code === "CONTACT_REQUIRED"');

    expect(drawerSrc).toContain("requiredMode");
    expect(drawerSrc).toContain("Vínculo de contato obrigatório");
    expect(drawerSrc).toContain("Não é possível desvincular o único contato desta negociação");

    expect(crmViewSrc).toContain('errData?.code === "CONTACT_REQUIRED"');

    // Conformidade com Design System no Drawer
    expect(drawerSrc).not.toMatch(/<select[\s>]/);
    expect(drawerSrc).not.toMatch(/\btitle\s*=/);
    expect(drawerSrc).not.toMatch(/type=["'](?:date|time|datetime-local)["']/i);
  });
});
