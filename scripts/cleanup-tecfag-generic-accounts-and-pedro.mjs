/**
 * Higienização idempotente — Tenant Tecfag (24/11/2026)
 *
 * 1. Reatribui a conversa/carteira do Pedro (`conv-rdc-556181565406` / `cont-rdc-556181565406`)
 *    do Gustavo Sessilio (`op-1791377401679`, capturado acidentalmente via autoCapture)
 *    para o Jhordan Rueda (`op-1791376776876`, dono do card oficial `deal-rd-6afcfca921bffa000105a72d`),
 *    restaurando `last_message_time` real e apontando `conversation_deal_contexts` para o card oficial.
 * 2. Identifica contas-balde sem CNPJ no tenant `tecfag` (as 4 comprovadas em produção:
 *    `formulario-contato`, `LEAD SEM CADASTRO`, `PESSOA FISICA - COMPRA REALIZADA PELO CPF`,
 *    `Magoga Especiarias` [antigo formulario-contato renomeado no RD], além de quaisquer outras
 *    contas sem documento válido com nome genérico/placeholder).
 * 3. Limpa a contaminação cruzada em cascata nos deals dessas contas-balde (mantendo o contato
 *    `is_primary = true`, removendo participantes `is_primary = false` injetados automaticamente,
 *    removendo vínculos `crm_conversation_deals` de contatos que não pertencem mais ao deal e
 *    ajustando `conversation_deal_contexts` órfãos).
 * 4. Desvincula `contacts.account_id` e `crm_deals.account_id` dessas contas-balde (setando NULL)
 *    e registra a ação em `crm_action_history`.
 *
 * Isolamento: atua ESTRITAMENTE no tenant `tecfag`; nunca toca em `valem`.
 */

import crypto from "node:crypto";

const KNOWN_BUCKET_ACCOUNT_IDS = [
  "acc-rd-6a318db9abf2b1000136ad00", // formulario-contato
  "acc-rd-68c16eba8dcea10018e9e0a1", // LEAD SEM CADASTRO
  "acc-rd-691c6bb79a451b00160c3721", // PESSOA FISICA - COMPRA REALIZADA PELO CPF
  "acc-rd-676471dfda3b24000138b96f", // Magoga Especiarias (antigo formulario-contato renomeado no RD)
];

const GENERIC_ACCOUNT_EXACT_LABELS = new Set([
  "formulario contato",
  "formulario de contato",
  "form contato",
  "contato site",
  "site",
  "chat site",
  "whatsapp",
  "lead sem cadastro",
  "sem cadastro",
  "sem empresa",
  "sem razao social",
  "nao informado",
  "nao informada",
  "nao possui",
  "nao tem",
  "nenhuma",
  "nenhum",
  "desconhecido",
  "desconhecida",
  "consumidor final",
  "cliente avulso",
  "pessoa fisica",
  "pessoa fisica compra realizada pelo cpf",
  "compra realizada pelo cpf",
  "pf",
  "n a",
  "na",
  "null",
  "undefined",
  "teste",
]);

const GENERIC_ACCOUNT_PATTERNS = [
  /^formulario\b/,
  /^form\s+(contato|site|meta|google|lp|landing)\b/,
  /^botao\s+whatsapp\b/,
  /^landing\s+page\b/,
  /^lead\s+sem\s+cadastro\b/,
  /^pessoa\s+fisica\s*-\s*compra\s+realizada/,
  /^sem\s+empresa\b/,
];

function normalizeLabel(raw) {
  if (!raw) return "";
  return String(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function isGenericPlaceholderName(raw) {
  const normalized = normalizeLabel(raw);
  if (!normalized) return false;
  if (GENERIC_ACCOUNT_EXACT_LABELS.has(normalized)) return true;
  return GENERIC_ACCOUNT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export async function runTecfagGenericAccountsAndPedroCleanup(sql, tenantId = "tecfag") {
  if (tenantId !== "tecfag") {
    return { skipped: true, reason: "tenant_mismatch" };
  }

  return sql.begin(async (tx) => {
    const summary = {
      tenantId,
      pedroReassignedToJhordan: false,
      pedroDealContextUpdated: false,
      bucketAccountsMatched: [],
      contaminatedDealsCleanedCount: 0,
      dealContactsRemovedCount: 0,
      conversationDealsRemovedCount: 0,
      dealContextsRepairedCount: 0,
      contactsUnlinkedFromBucketCount: 0,
      dealsUnlinkedFromBucketCount: 0,
    };

    // ── 1. Reatribuir atendimento e carteira do Pedro do Gustavo Sessilio -> Jhordan Rueda ──
    const pedroConvId = "conv-rdc-556181565406";
    const pedroContactId = "cont-rdc-556181565406";
    const gustavoOpId = "op-1791377401679";
    const jhordanOpId = "op-1791376776876";
    const personnaliteSectorId = "sec-1793186160332";
    const pedroOfficialDealId = "deal-rd-6afcfca921bffa000105a72d";

    const [jhordanOp] = await tx`
      SELECT id, name
      FROM operators
      WHERE tenant_id = ${tenantId} AND id = ${jhordanOpId}
      LIMIT 1
    `;
    const [pedroConv] = await tx`
      SELECT id, operator_id, queue_state, created_at
      FROM conversations
      WHERE tenant_id = ${tenantId} AND id = ${pedroConvId}
      LIMIT 1
    `;

    if (jhordanOp && pedroConv && pedroConv.operator_id === gustavoOpId) {
      const [sectorRow] = await tx`
        SELECT id FROM sectors
        WHERE tenant_id = ${tenantId} AND id = ${personnaliteSectorId}
        LIMIT 1
      `;
      const [lastMsgRow] = await tx`
        SELECT MAX(sent_at) AS max_sent_at
        FROM messages
        WHERE tenant_id = ${tenantId} AND conversation_id = ${pedroConvId}
      `;
      const restoredLastMessageTime = lastMsgRow?.max_sent_at || pedroConv.created_at;

      await tx`
        UPDATE conversations
        SET operator_id = ${jhordanOp.id},
            queue_state = 'meus',
            sector_id = ${sectorRow ? sectorRow.id : null},
            last_message_time = ${restoredLastMessageTime},
            updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND id = ${pedroConvId}
          AND operator_id = ${gustavoOpId}
      `;

      await tx`
        UPDATE contacts
        SET wallet_operator_id = ${jhordanOp.id},
            responsible_name = ${jhordanOp.name}
        WHERE tenant_id = ${tenantId}
          AND id = ${pedroContactId}
          AND (wallet_operator_id = ${gustavoOpId} OR wallet_operator_id IS NULL)
      `;

      summary.pedroReassignedToJhordan = true;
    }

    const [officialDeal] = await tx`
      SELECT id FROM crm_deals
      WHERE tenant_id = ${tenantId} AND id = ${pedroOfficialDealId}
      LIMIT 1
    `;
    if (pedroConv && officialDeal) {
      await tx`
        INSERT INTO conversation_deal_contexts (
          tenant_id,
          conversation_id,
          current_deal_id,
          previous_deal_id,
          selection_required,
          version,
          updated_at
        )
        VALUES (
          ${tenantId},
          ${pedroConvId},
          ${pedroOfficialDealId},
          NULL,
          false,
          1,
          NOW()
        )
        ON CONFLICT (conversation_id) DO UPDATE
        SET current_deal_id = EXCLUDED.current_deal_id,
            selection_required = false,
            version = conversation_deal_contexts.version + 1,
            updated_at = NOW()
        WHERE conversation_deal_contexts.tenant_id = ${tenantId}
      `;
      summary.pedroDealContextUpdated = true;
    }

    // ── 2. Identificar todas as contas-balde sem documento válido no tenant `tecfag` ──
    const candidateAccounts = await tx`
      SELECT id, name, trade_name, document
      FROM crm_accounts
      WHERE tenant_id = ${tenantId}
        AND (document IS NULL OR trim(document) = '')
    `;

    const knownSet = new Set(KNOWN_BUCKET_ACCOUNT_IDS);
    const bucketAccounts = candidateAccounts.filter(
      (acc) =>
        knownSet.has(acc.id) ||
        isGenericPlaceholderName(acc.name) ||
        isGenericPlaceholderName(acc.trade_name),
    );
    const bucketIds = bucketAccounts.map((acc) => acc.id);
    summary.bucketAccountsMatched = bucketAccounts.map((acc) => ({
      id: acc.id,
      name: acc.name,
    }));

    if (bucketIds.length > 0) {
      // ── 3. Limpar contaminação cruzada em deals vinculados a essas contas-balde ──
      const bucketDealRows = await tx`
        SELECT id
        FROM crm_deals
        WHERE tenant_id = ${tenantId}
          AND account_id IN ${tx(bucketIds)}
      `;
      const bucketDealIds = bucketDealRows.map((row) => row.id);

      if (bucketDealIds.length > 0) {
        // Apenas deals com > 1 contato que possuem ao menos 1 contato primário garantido
        const contaminatedDealRows = await tx`
          SELECT dc.deal_id
          FROM crm_deal_contacts dc
          WHERE dc.tenant_id = ${tenantId}
            AND dc.deal_id IN ${tx(bucketDealIds)}
          GROUP BY dc.deal_id
          HAVING COUNT(DISTINCT dc.contact_id) > 1
             AND BOOL_OR(dc.is_primary) = true
        `;
        const contaminatedDealIds = contaminatedDealRows.map((r) => r.deal_id);
        summary.contaminatedDealsCleanedCount = contaminatedDealIds.length;

        if (contaminatedDealIds.length > 0) {
          const deletedParticipants = await tx`
            DELETE FROM crm_deal_contacts
            WHERE tenant_id = ${tenantId}
              AND deal_id IN ${tx(contaminatedDealIds)}
              AND is_primary = false
            RETURNING id
          `;
          summary.dealContactsRemovedCount = deletedParticipants.length;

          const deletedConvDeals = await tx`
            DELETE FROM crm_conversation_deals cd
            USING conversations c
            WHERE cd.tenant_id = ${tenantId}
              AND c.tenant_id = ${tenantId}
              AND c.id = cd.conversation_id
              AND cd.deal_id IN ${tx(contaminatedDealIds)}
              AND NOT EXISTS (
                SELECT 1
                FROM crm_deal_contacts dc
                WHERE dc.tenant_id = ${tenantId}
                  AND dc.deal_id = cd.deal_id
                  AND dc.contact_id = c.contact_id
              )
            RETURNING cd.id
          `;
          summary.conversationDealsRemovedCount = deletedConvDeals.length;

          const orphanContexts = await tx`
            SELECT ctx.conversation_id, c.contact_id, ctx.current_deal_id
            FROM conversation_deal_contexts ctx
            JOIN conversations c
              ON c.id = ctx.conversation_id AND c.tenant_id = ctx.tenant_id
            WHERE ctx.tenant_id = ${tenantId}
              AND ctx.current_deal_id IN ${tx(contaminatedDealIds)}
              AND NOT EXISTS (
                SELECT 1
                FROM crm_deal_contacts dc
                WHERE dc.tenant_id = ${tenantId}
                  AND dc.deal_id = ctx.current_deal_id
                  AND dc.contact_id = c.contact_id
              )
          `;

          for (const ctx of orphanContexts) {
            const [fallbackDeal] = await tx`
              SELECT d.id
              FROM crm_deal_contacts dc
              JOIN crm_deals d
                ON d.id = dc.deal_id AND d.tenant_id = dc.tenant_id
              WHERE dc.tenant_id = ${tenantId}
                AND dc.contact_id = ${ctx.contact_id}
              ORDER BY
                CASE WHEN d.status = 'open' THEN 0 WHEN d.status = 'paused' THEN 1 ELSE 2 END,
                d.created_at DESC
              LIMIT 1
            `;
            await tx`
              UPDATE conversation_deal_contexts
              SET current_deal_id = ${fallbackDeal ? fallbackDeal.id : null},
                  previous_deal_id = NULL,
                  selection_required = false,
                  version = version + 1,
                  updated_at = NOW()
              WHERE tenant_id = ${tenantId}
                AND conversation_id = ${ctx.conversation_id}
            `;
            summary.dealContextsRepairedCount++;
          }
        }
      }

      // ── 4. Desvincular contatos e negociações das contas-balde ──
      const updatedContacts = await tx`
        UPDATE contacts
        SET account_id = NULL
        WHERE tenant_id = ${tenantId}
          AND account_id IN ${tx(bucketIds)}
        RETURNING id
      `;
      summary.contactsUnlinkedFromBucketCount = updatedContacts.length;

      const updatedDeals = await tx`
        UPDATE crm_deals
        SET account_id = NULL,
            updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND account_id IN ${tx(bucketIds)}
        RETURNING id
      `;
      summary.dealsUnlinkedFromBucketCount = updatedDeals.length;
    }

    // ── 5. Registrar trilha de auditoria administrativa ──
    const totalAffected =
      summary.contactsUnlinkedFromBucketCount +
      summary.dealsUnlinkedFromBucketCount +
      summary.dealContactsRemovedCount +
      summary.conversationDealsRemovedCount +
      (summary.pedroReassignedToJhordan ? 1 : 0);

    if (totalAffected > 0) {
      await tx`
        INSERT INTO crm_action_history (
          id,
          tenant_id,
          operator_id,
          operator_name,
          action,
          entity_type,
          item_count,
          details,
          created_at
        )
        VALUES (
          ${`act-hist-${crypto.randomUUID()}`},
          ${tenantId},
          NULL,
          ${"Sistema (Higienização Automática)"},
          ${"cleanup_generic_account_contamination"},
          ${"account"},
          ${totalAffected},
          ${tx.json(summary)},
          NOW()
        )
      `;
    }

    return summary;
  });
}
