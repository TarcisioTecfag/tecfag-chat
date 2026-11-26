import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CustomFieldError,
  stripUnchangedNonActiveCustomFields,
  validateFieldValues,
  type CustomFieldDefinition,
} from "../src/lib/crm/custom-fields";
import { changedCustomFieldValues } from "../src/components/crm/CustomFieldsEditor";

function makeFieldDef(overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition {
  const now = new Date("2026-11-26T08:00:00.000Z");
  return {
    id: "cf-contact-role",
    tenantId: "tecfag",
    entityType: "contact",
    name: "Cargo",
    fieldType: "text",
    options: [],
    required: false,
    requiredRule: "always",
    requiredFromStageId: null,
    isUnique: false,
    visibleOnCreate: true,
    allPipelines: true,
    pipelineIds: [],
    sortOrder: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Edição de contatos/empresas/deals com metadados internos em customFields", () => {
  it("caso real Daiane Takahama: permite salvar 2º telefone mesmo quando payload reenvia company gravado pela triagem Fagner e há 0 campos de contato", () => {
    const existingContactCustomFields = {
      company: "AUTOPLAST INDUSTRIA E COMERCIO DE AUTO PECAS LTDA",
    };

    const incomingFromLegacyClient = {
      company: "AUTOPLAST INDUSTRIA E COMERCIO DE AUTO PECAS LTDA",
    };

    const sanitized = stripUnchangedNonActiveCustomFields(
      [],
      incomingFromLegacyClient,
      existingContactCustomFields,
    );
    const patch = validateFieldValues([], sanitized);

    expect(patch).toEqual({});
    const merged = { ...existingContactCustomFields, ...patch };
    expect(merged).toEqual({
      company: "AUTOPLAST INDUSTRIA E COMERCIO DE AUTO PECAS LTDA",
    });
  });

  it("preserva metadados internos (company, secondaryEmails, siteVisitorId, siteContinuity reordenado, legacyFagnerSite) enquanto valida e aplica alterações em campos ativos", () => {
    const defs: CustomFieldDefinition[] = [
      makeFieldDef({ id: "cf-cargo", name: "Cargo", fieldType: "text" }),
    ];

    const existing = {
      company: "AUTOPLAST",
      secondaryEmails: ["compras@autoplast.ind.br", "financeiro@autoplast.ind.br"],
      siteVisitorId: "vis-123",
      siteCookieId: "ck-456",
      linkedSiteContactIds: ["cont-lc-vis-123"],
      siteContinuity: { codeHash: "abc", expiresAt: "2026-12-01T00:00:00Z" },
      legacyFagnerSite: { migratedAt: "2026-11-19T12:00:00Z", visitorIds: ["vis-123"] },
      "cf-cargo": "Compradora",
    };

    // Simula ordem de chaves diferente em objetos JSONB devolvidos pelo PostgreSQL
    const incoming = {
      company: "AUTOPLAST",
      secondaryEmails: ["compras@autoplast.ind.br", "financeiro@autoplast.ind.br"],
      siteVisitorId: "vis-123",
      siteCookieId: "ck-456",
      linkedSiteContactIds: ["cont-lc-vis-123"],
      siteContinuity: { expiresAt: "2026-12-01T00:00:00Z", codeHash: "abc" },
      legacyFagnerSite: { visitorIds: ["vis-123"], migratedAt: "2026-11-19T12:00:00Z" },
      "cf-cargo": "Gerente Industrial",
    };

    const sanitized = stripUnchangedNonActiveCustomFields(defs, incoming, existing);
    const patch = validateFieldValues(defs, sanitized);

    expect(patch).toEqual({ "cf-cargo": "Gerente Industrial" });
    const merged = { ...existing, ...patch };
    expect(merged.company).toBe("AUTOPLAST");
    expect(merged.secondaryEmails).toEqual([
      "compras@autoplast.ind.br",
      "financeiro@autoplast.ind.br",
    ]);
    expect(merged.siteVisitorId).toBe("vis-123");
    expect(merged["cf-cargo"]).toBe("Gerente Industrial");
  });

  it("continua rejeitando chaves desconhecidas novas ou tentativas de alterar chaves internas/inativadas", () => {
    const existing = {
      company: "AUTOPLAST",
      "cf-inativo": "valor-legado",
    };

    // 1) Nova chave desconhecida -> deve falhar
    const sanitizedNewKey = stripUnchangedNonActiveCustomFields(
      [],
      { company: "AUTOPLAST", chave_inventada: "x" },
      existing,
    );
    expect(() => validateFieldValues([], sanitizedNewKey)).toThrow(CustomFieldError);
    expect(() => validateFieldValues([], sanitizedNewKey)).toThrow(
      "Campo personalizado inválido: chave_inventada.",
    );

    // 2) Tentativa de modificar chave interna -> deve falhar
    const sanitizedModifiedInternal = stripUnchangedNonActiveCustomFields(
      [],
      { company: "OUTRA EMPRESA" },
      existing,
    );
    expect(() => validateFieldValues([], sanitizedModifiedInternal)).toThrow(
      "Campo personalizado inválido: company.",
    );

    // 3) Tentativa de modificar campo inativado -> deve falhar
    const sanitizedModifiedInactive = stripUnchangedNonActiveCustomFields(
      [],
      { "cf-inativo": "novo-valor" },
      existing,
    );
    expect(() => validateFieldValues([], sanitizedModifiedInactive)).toThrow(
      "Campo personalizado inválido: cf-inativo.",
    );
  });

  it("preserva campos inativados ou de outro funil quando inalterados no deal, mas valida campos ativos do funil atual", () => {
    const dealDefs: CustomFieldDefinition[] = [
      makeFieldDef({
        id: "cf-deal-ativo",
        entityType: "deal",
        name: "Volume",
        fieldType: "text",
        allPipelines: false,
        pipelineIds: ["pipe-cwr"],
      }),
      makeFieldDef({
        id: "cf-deal-outro-funil",
        entityType: "deal",
        name: "Outro Funil",
        fieldType: "text",
        allPipelines: false,
        pipelineIds: ["pipe-pecas"],
      }),
    ];

    const existingDealCf = {
      "cf-rd-legado-inativo": "Valor Histórico RD",
      "cf-deal-outro-funil": "Preservado",
      "cf-deal-ativo": "10 un/min",
    };

    const incomingDealCf = {
      "cf-rd-legado-inativo": "Valor Histórico RD",
      "cf-deal-outro-funil": "Preservado",
      "cf-deal-ativo": "20 un/min",
    };

    const sanitized = stripUnchangedNonActiveCustomFields(dealDefs, incomingDealCf, existingDealCf, {
      pipelineId: "pipe-cwr",
    });
    const patch = validateFieldValues(dealDefs, sanitized, { pipelineId: "pipe-cwr" });
    expect(patch).toEqual({ "cf-deal-ativo": "20 un/min" });
  });

  it("mantém erro de tipo quando incoming não é objeto (ex.: array)", () => {
    const sanitized = stripUnchangedNonActiveCustomFields([], ["invalido"], { company: "X" });
    expect(() => validateFieldValues([], sanitized)).toThrow(
      "Os campos personalizados devem ser um objeto.",
    );
  });

  it("changedCustomFieldValues retorna diff vazio quando apenas telefones foram editados e isola apenas chaves alteradas", () => {
    const original = {
      company: "AUTOPLAST INDUSTRIA E COMERCIO DE AUTO PECAS LTDA",
      secondaryEmails: ["extra@autoplast.ind.br"],
      "cf-cargo": "Compradora",
    };

    expect(changedCustomFieldValues(original, { ...original })).toEqual({});
    expect(
      changedCustomFieldValues(original, { ...original, "cf-cargo": "Diretora" }),
    ).toEqual({ "cf-cargo": "Diretora" });
  });

  it("regressão estrutural: DealAddContactDrawer, DealLinkAccountDrawer e rotas PATCH usam diff e sanitização", () => {
    const root = path.resolve(import.meta.dir, "..");
    const contactDrawer = readFileSync(
      path.join(root, "src/components/crm/DealAddContactDrawer.tsx"),
      "utf8",
    );
    const accountDrawer = readFileSync(
      path.join(root, "src/components/crm/DealLinkAccountDrawer.tsx"),
      "utf8",
    );
    const contactRoute = readFileSync(
      path.join(root, "src/routes/api/contacts/$contactId.ts"),
      "utf8",
    );
    const crmService = readFileSync(path.join(root, "src/lib/crm/crm-service.ts"), "utf8");

    expect(contactDrawer).toContain("changedCustomFieldValues(originalEditCustomFields, editCustomFields)");
    expect(contactDrawer).not.toContain("customFields: editCustomFields,");

    expect(accountDrawer).toContain("changedCustomFieldValues(originalEditCustomFields, editCustomFields)");
    expect(accountDrawer).not.toContain("customFields: editCustomFields,");

    expect(contactRoute).toContain("stripUnchangedNonActiveCustomFields(");
    expect(crmService).toContain("stripUnchangedNonActiveCustomFields(");
  });
});
