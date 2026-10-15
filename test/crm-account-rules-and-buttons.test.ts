import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import {
  formatAccountDocumentInput,
  getInlineDocumentMismatch,
  validateAccountDocument,
} from "../src/lib/crm/account-validation";
import { validateDocument, CrmValidationError } from "../src/lib/crm/crm-service";

const rootDir = path.resolve(__dirname, "..");

describe("CRM Account Buttons & PF/PJ / CPF/CNPJ Business Rules", () => {
  it("removes redundant 'Vincular existente' and 'Criar nova' buttons from DealDetailModal EMPRESA card, keeping only '+ Adicionar'", () => {
    const modalSource = fs.readFileSync(
      path.join(rootDir, "src/components/crm/DealDetailModal.tsx"),
      "utf-8"
    );

    expect(modalSource).not.toContain("<span>Vincular existente</span>");
    expect(modalSource).not.toContain("<span>Criar nova</span>");
    expect(modalSource).toContain("Nenhum cliente ou empresa vinculado.");
    expect(modalSource).toContain("<span>Adicionar</span>");
  });

  it("disables switching between PJ and PF after creation in AccountDetailModal, DealLinkAccountDrawer edit mode, and crm-service updateAccount", () => {
    const accountModalSource = fs.readFileSync(
      path.join(rootDir, "src/components/crm/AccountDetailModal.tsx"),
      "utf-8"
    );
    const linkDrawerSource = fs.readFileSync(
      path.join(rootDir, "src/components/crm/DealLinkAccountDrawer.tsx"),
      "utf-8"
    );
    const crmServiceSource = fs.readFileSync(
      path.join(rootDir, "src/lib/crm/crm-service.ts"),
      "utf-8"
    );

    // AccountDetailModal has disabled buttons for PJ and PF
    expect(accountModalSource).toContain(
      "O tipo de cliente (PJ/PF) é definido na criação e não pode ser alterado depois."
    );
    expect(accountModalSource).not.toContain('setType("company")');
    expect(accountModalSource).not.toContain('setType("person")');

    // DealLinkAccountDrawer disables Select for editType when editing existing account
    expect(linkDrawerSource).toContain("<Select value={editType} disabled>");

    // Backend crmService.updateAccount blocks changing type after creation
    expect(crmServiceSource).toContain("if (data.type !== undefined && data.type !== current.type)");
    expect(crmServiceSource).toContain('"IMMUTABLE_ACCOUNT_TYPE"');
  });

  it("requires CNPJ for PJ (company) and CPF for PF (person) and blocks empty documents", () => {
    const pjEmpty = validateAccountDocument("company", "");
    expect(pjEmpty.valid).toBe(false);
    expect(pjEmpty.error).toContain("CNPJ é obrigatório");

    const pfEmpty = validateAccountDocument("person", "   ");
    expect(pfEmpty.valid).toBe(false);
    expect(pfEmpty.error).toContain("CPF é obrigatório");

    expect(() => validateDocument("company", "")).toThrow(CrmValidationError);
    expect(() => validateDocument("person", "")).toThrow(CrmValidationError);
  });

  it("blocks creating PJ with a CPF (indicating to create PF) and blocks creating PF with a CNPJ (indicating to create PJ)", () => {
    // Tentar criar PJ com CPF (11 dígitos)
    const pjWithCpf = validateAccountDocument("company", "123.456.789-01");
    expect(pjWithCpf.valid).toBe(false);
    expect(pjWithCpf.mismatchSuggestedType).toBe("person");
    expect(pjWithCpf.error).toContain("Pessoa Física (PF)");

    const inlinePjMismatch = getInlineDocumentMismatch("company", "123.456.789-01");
    expect(inlinePjMismatch).not.toBeNull();
    expect(inlinePjMismatch?.suggestedType).toBe("person");
    expect(inlinePjMismatch?.message).toContain("Pessoa Física (PF)");

    // Tentar criar PF com CNPJ (14 dígitos)
    const pfWithCnpj = validateAccountDocument("person", "12.345.678/0001-90");
    expect(pfWithCnpj.valid).toBe(false);
    expect(pfWithCnpj.mismatchSuggestedType).toBe("company");
    expect(pfWithCnpj.error).toContain("Pessoa Jurídica (PJ)");

    // Input formatter preserves 14 digits when pasting CNPJ into PF so it is detected as CNPJ
    const formattedInPf = formatAccountDocumentInput("12345678000190", "person");
    expect(formattedInPf).toBe("12.345.678/0001-90");
    const inlinePfMismatch = getInlineDocumentMismatch("person", formattedInPf);
    expect(inlinePfMismatch).not.toBeNull();
    expect(inlinePfMismatch?.suggestedType).toBe("company");
    expect(inlinePfMismatch?.message).toContain("Pessoa Jurídica (PJ)");

    // Valid cases pass
    expect(validateAccountDocument("company", "12.345.678/0001-90").valid).toBe(true);
    expect(validateAccountDocument("person", "123.456.789-01").valid).toBe(true);
  });
});
