/**
 * Migração idempotente única (25/11/2026) — Inativação em lote de campos legados RD (Negociação) na Tecfag.
 *
 * Regra solicitada:
 * - Preservar 100% dos valores históricos já preenchidos em `crm_deals.custom_fields` (NÃO excluir nada).
 * - Manter ATIVOS na aba Negociação (`entity_type = 'deal'`) do tenant `tecfag`:
 *   - Os 6 campos principais de operação:
 *     - `cf-6301c0e7-a9df-422d-99f0-524cb88b2f30` (CLIENTE NOVO?)
 *     - `cf-dbf17e8d-6657-4dea-8914-2fb60ab3cc3f` (QUALIFICADO POR SDR)
 *     - `cf-3d854c1d-03eb-43ab-9959-394a4792fe8b` (PROPOSTA NEXT)
 *     - `cf-39e7205f-b6bb-4522-8a6e-03e3180b1025` (QUAL O PRODUTO FABRICADO?)
 *     - `cf-4c8d4c1d-ef02-4dfe-82b2-64b0e7aaa5b9` (QUAL O TIPO DE PRODUTO DO CLIENTE)
 *     - `cf-a3669215-f9e7-46fd-a2e9-754ca2356ef3` (VOLUME DE PRODUÇÃO)
 *   - Os 4 campos do Piloto Black November (bindings dos templates `reeng_black_piloto_*`):
 *     - `black_maquina` (Máquina Black)
 *     - `black_preco` (Preço Black)
 *     - `gap_t1` (Gap — trecho T1)
 *     - `gap_t3` (Gap — lista T3)
 * - Marcar como INATIVOS (`archived_at = NOW()`) apenas os 29 campos legados importados do RD Station (`cf-tf-deal-*`).
 * - Preservar intactos os demais tenants (`valem`) e entidades (`company`, `contact`, `product`).
 */

export const TECFAG_KEEP_ACTIVE_DEAL_FIELD_IDS = [
  "cf-6301c0e7-a9df-422d-99f0-524cb88b2f30",
  "cf-dbf17e8d-6657-4dea-8914-2fb60ab3cc3f",
  "cf-3d854c1d-03eb-43ab-9959-394a4792fe8b",
  "cf-39e7205f-b6bb-4522-8a6e-03e3180b1025",
  "cf-4c8d4c1d-ef02-4dfe-82b2-64b0e7aaa5b9",
  "cf-a3669215-f9e7-46fd-a2e9-754ca2356ef3",
  "black_maquina",
  "black_preco",
  "gap_t1",
  "gap_t3",
];

export const TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE = [
  "cf-tf-deal-ajuda-necessaria",
  "cf-tf-deal-processo-atual",
  "cf-tf-deal-expectativa-uso",
  "cf-tf-deal-nivel-automacao",
  "cf-tf-deal-tipo-embalagem",
  "cf-tf-deal-producao-hora",
  "cf-tf-deal-perfil-cliente",
  "cf-tf-deal-apresentacao-proposta",
  "cf-tf-deal-projetos-desenvolvimento",
  "cf-tf-deal-info-complementares",
  "cf-tf-deal-escopo-validado",
  "cf-tf-deal-destino-projeto",
  "cf-tf-deal-justificativa-movimentacao",
  "cf-tf-deal-descricao",
  "cf-tf-deal-feito-por",
  "cf-tf-deal-equipamento",
  "cf-tf-deal-budget",
  "cf-tf-deal-pre-analise",
  "cf-tf-deal-anotacao-perda",
  "cf-tf-deal-equipes-responsavel",
  "cf-tf-deal-produtos",
  "cf-tf-deal-foto-anexada",
  "cf-tf-deal-qual-cliente",
  "cf-tf-deal-video-chamada",
  "cf-tf-deal-visita-tecnica",
  "cf-tf-deal-tem-etiqueta",
  "cf-tf-deal-numero-os",
  "cf-tf-deal-tipo-atendimento",
  "cf-tf-deal-tipo-pecas",
];

export async function runInactivateTecfagLegacyDealFields(sql, tenantId = "tecfag") {
  const [tenantRow] = await sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`;
  if (!tenantRow) {
    return { tenantId, skipped: "tenant_not_found", inactivatedCount: 0, inactivatedIds: [] };
  }

  const idsToInactivate = TECFAG_LEGACY_DEAL_FIELD_IDS_TO_INACTIVATE.filter(
    (id) => !TECFAG_KEEP_ACTIVE_DEAL_FIELD_IDS.includes(id),
  );

  const updated = await sql`
    UPDATE crm_custom_field_definitions
    SET archived_at = NOW(), updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND entity_type = 'deal'
      AND archived_at IS NULL
      AND id = ANY(${idsToInactivate}::text[])
    RETURNING id, name
  `;

  return {
    tenantId,
    inactivatedCount: updated.length,
    inactivatedIds: updated.map((r) => r.id),
    inactivatedNames: updated.map((r) => r.name),
  };
}
