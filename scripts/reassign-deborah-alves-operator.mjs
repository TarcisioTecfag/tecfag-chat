import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch {}
} else if (existsSync(".env")) {
  try {
    const envContent = readFileSync(".env", "utf8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  } catch {}
}

export const LEGACY_DEBORAH_ID = "op-1791377124750";
export const LEGACY_DEBORAH_EMAIL = "vendas15@tecfag.com.br";
export const REAL_DEBORAH_ID = "op-1794601994898";
export const REAL_DEBORAH_EMAIL = "ouvidoria@tecfag.com.br";
export const REAL_DEBORAH_NAME = "Deborah Alves";

function normKey(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function hasTable(tx, tableName) {
  const [row] = await tx`
    SELECT to_regclass(${tableName}) IS NOT NULL AS exists
  `;
  return Boolean(row?.exists);
}

/**
 * Transfere 100% do patrimônio operacional da conta antiga/incorreta
 * `Déborah Rayane` (`vendas15@tecfag.com.br` / `op-1791377124750`) para a
 * operadora verdadeira `Deborah Alves` (`ouvidoria@tecfag.com.br` / `op-1794601994898`)
 * exclusivamente no tenant `tecfag`, atualizando Setor Pós-Venda e Escala do Rodízio
 * e removendo definitivamente o cadastro antigo.
 */
export async function runReassignDeborahAlvesOperator(sql, options = {}) {
  const tenantId = options.tenantId || "tecfag";

  return await sql.begin(async (tx) => {
    const ops = await tx`
      SELECT id, tenant_id, account_id, name, email, password_hash, role, avatar, status, group_id
      FROM operators
      WHERE tenant_id = ${tenantId}
    `;

    let destOp =
      ops.find(
        (o) =>
          String(o.email || "").trim().toLowerCase() === REAL_DEBORAH_EMAIL,
      ) ||
      ops.find((o) => o.id === REAL_DEBORAH_ID) ||
      null;

    const sourceOp =
      ops.find(
        (o) =>
          o.id !== destOp?.id &&
          (String(o.email || "").trim().toLowerCase() === LEGACY_DEBORAH_EMAIL ||
            o.id === LEGACY_DEBORAH_ID),
      ) || null;

    if (!destOp && !sourceOp) {
      return {
        tenantId,
        applied: false,
        reason: "neither_source_nor_dest_found",
      };
    }

    if (!destOp && sourceOp) {
      const [createdDest] = await tx`
        INSERT INTO operators (
          id, tenant_id, name, email, password_hash, role, avatar, status, group_id, is_online
        ) VALUES (
          ${REAL_DEBORAH_ID},
          ${tenantId},
          ${REAL_DEBORAH_NAME},
          ${REAL_DEBORAH_EMAIL},
          ${sourceOp.password_hash || "rd_crm_migration_placeholder"},
          ${sourceOp.role || "agent"},
          ${sourceOp.avatar ?? null},
          ${sourceOp.status || "disponivel"},
          ${sourceOp.group_id ?? null},
          false
        )
        RETURNING id, tenant_id, account_id, name, email, password_hash, role, avatar, status, group_id
      `;
      destOp = createdDest;
    } else if (destOp && sourceOp) {
      // Herda group_id ou avatar caso o cadastro novo ainda esteja sem eles, sem tocar em credenciais/sessão
      const nextGroupId = destOp.group_id || sourceOp.group_id || null;
      const nextAvatar = destOp.avatar || sourceOp.avatar || null;
      if (nextGroupId !== destOp.group_id || nextAvatar !== destOp.avatar) {
        const [updatedDest] = await tx`
          UPDATE operators
          SET
            group_id = COALESCE(group_id, ${sourceOp.group_id ?? null}),
            avatar = COALESCE(avatar, ${sourceOp.avatar ?? null})
          WHERE tenant_id = ${tenantId}
            AND id = ${destOp.id}
          RETURNING id, tenant_id, account_id, name, email, password_hash, role, avatar, status, group_id
        `;
        if (updatedDest) destOp = updatedDest;
      }
    }

    const legacyIdsToScrub = Array.from(
      new Set([LEGACY_DEBORAH_ID, sourceOp?.id].filter((v) => v && v !== destOp.id)),
    );

    const stats = {
      dealsReassigned: 0,
      contactsReassigned: 0,
      activitiesReassigned: 0,
      activityArraysUpdated: 0,
      conversationsReassigned: 0,
      legacyTasksEmailUpdated: 0,
      sectorsUpdated: 0,
      rodizioUpdated: false,
      sourceOperatorDeleted: false,
      orphanPlatformAccountDeleted: false,
    };

    if (sourceOp && sourceOp.id !== destOp.id) {
      const sourceId = sourceOp.id;
      const sourceNameNorm = normKey(sourceOp.name);

      // 1. CRM Deals (preserva updated_at histórico para não distorcer cooling/esfriamento)
      if (await hasTable(tx, "crm_deals")) {
        const dealRes = await tx`
          UPDATE crm_deals
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
        stats.dealsReassigned = dealRes.count ?? 0;
      }

      // 2. Carteira de Contatos (wallet_operator_id + responsible_name)
      if (await hasTable(tx, "contacts")) {
        const contactRes = await tx`
          UPDATE contacts
          SET
            wallet_operator_id = CASE
              WHEN wallet_operator_id = ${sourceId} THEN ${destOp.id}
              ELSE wallet_operator_id
            END,
            responsible_name = CASE
              WHEN wallet_operator_id = ${sourceId}
                OR LOWER(TRIM(responsible_name)) IN (
                  'deborah rayane',
                  'déborah rayane',
                  'deborah alves - 94',
                  ${sourceNameNorm}
                )
              THEN ${destOp.name}
              ELSE responsible_name
            END
          WHERE tenant_id = ${tenantId}
            AND (
              wallet_operator_id = ${sourceId}
              OR LOWER(TRIM(responsible_name)) IN (
                'deborah rayane',
                'déborah rayane',
                'deborah alves - 94',
                ${sourceNameNorm}
              )
            )
        `;
        stats.contactsReassigned = contactRes.count ?? 0;
      }

      // 3. Atividades / Tarefas / Notas do CRM (colunas escalares + JSONB assigned_to_operator_ids + edit_history)
      if (await hasTable(tx, "crm_deal_activities")) {
        const actRes = await tx`
          UPDATE crm_deal_activities
          SET
            operator_id = CASE WHEN operator_id = ${sourceId} THEN ${destOp.id} ELSE operator_id END,
            assigned_to_operator_id = CASE WHEN assigned_to_operator_id = ${sourceId} THEN ${destOp.id} ELSE assigned_to_operator_id END
          WHERE tenant_id = ${tenantId}
            AND (operator_id = ${sourceId} OR assigned_to_operator_id = ${sourceId})
        `;
        stats.activitiesReassigned = actRes.count ?? 0;

        const arrayRows = await tx`
          SELECT id, assigned_to_operator_ids, edit_history
          FROM crm_deal_activities
          WHERE tenant_id = ${tenantId}
            AND (
              assigned_to_operator_ids @> ${tx.json([sourceId])}
              OR edit_history::text LIKE ${`%${sourceId}%`}
            )
        `;
        for (const row of arrayRows) {
          const rawAssigned = Array.isArray(row.assigned_to_operator_ids)
            ? row.assigned_to_operator_ids
            : [];
          const nextAssigned = Array.from(
            new Set(
              rawAssigned.map((id) => (id === sourceId ? destOp.id : id)).filter(Boolean),
            ),
          );
          const rawHistory = Array.isArray(row.edit_history) ? row.edit_history : [];
          const nextHistory = rawHistory.map((entry) =>
            entry && typeof entry === "object" && entry.operatorId === sourceId
              ? { ...entry, operatorId: destOp.id, operatorName: destOp.name }
              : entry,
          );
          await tx`
            UPDATE crm_deal_activities
            SET
              assigned_to_operator_ids = ${tx.json(nextAssigned)},
              edit_history = ${tx.json(nextHistory)}
            WHERE tenant_id = ${tenantId}
              AND id = ${row.id}
          `;
          stats.activityArraysUpdated++;
        }
      }

      // 4. Demais tabelas auxiliares de CRM
      if (await hasTable(tx, "crm_activity_messages")) {
        await tx`
          UPDATE crm_activity_messages
          SET marked_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND marked_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_deal_events")) {
        await tx`
          UPDATE crm_deal_events
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_contact_account_history")) {
        await tx`
          UPDATE crm_contact_account_history
          SET changed_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND changed_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_account_conversations")) {
        await tx`
          UPDATE crm_account_conversations
          SET created_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND created_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_conversation_deals")) {
        await tx`
          UPDATE crm_conversation_deals
          SET
            created_by_operator_id = CASE WHEN created_by_operator_id = ${sourceId} THEN ${destOp.id} ELSE created_by_operator_id END,
            unlinked_by_operator_id = CASE WHEN unlinked_by_operator_id = ${sourceId} THEN ${destOp.id} ELSE unlinked_by_operator_id END
          WHERE tenant_id = ${tenantId}
            AND (created_by_operator_id = ${sourceId} OR unlinked_by_operator_id = ${sourceId})
        `;
      }
      if (await hasTable(tx, "crm_action_history")) {
        await tx`
          UPDATE crm_action_history
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_proposals")) {
        await tx`
          UPDATE crm_proposals
          SET created_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND created_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_migration_runs")) {
        await tx`
          UPDATE crm_migration_runs
          SET triggered_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND triggered_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_deal_files")) {
        await tx`
          UPDATE crm_deal_files
          SET uploaded_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND uploaded_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_deal_questionnaires")) {
        await tx`
          UPDATE crm_deal_questionnaires
          SET filled_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND filled_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "crm_deal_emails")) {
        await tx`
          UPDATE crm_deal_emails
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "tasks")) {
        const legacyTaskRes = await tx`
          UPDATE tasks
          SET operator_email = ${destOp.email}
          WHERE tenant_id = ${tenantId}
            AND LOWER(TRIM(operator_email)) IN (
              ${LEGACY_DEBORAH_EMAIL},
              ${String(sourceOp.email || "").trim().toLowerCase()}
            )
        `;
        stats.legacyTasksEmailUpdated = legacyTaskRes.count ?? 0;
      }

      // 5. Conversas, Ligações, SLA, Auditorias, Templates, LiveChat e Eventos de Atendimento
      if (await hasTable(tx, "conversations")) {
        const convRes = await tx`
          UPDATE conversations
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
        stats.conversationsReassigned = convRes.count ?? 0;
      }
      if (await hasTable(tx, "attendance_events")) {
        await tx`
          UPDATE attendance_events
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "whatsapp_connections")) {
        await tx`
          UPDATE whatsapp_connections
          SET owner_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND owner_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "call_sessions")) {
        await tx`
          UPDATE call_sessions
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "response_time_logs")) {
        await tx`
          UPDATE response_time_logs
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "ai_conversation_audits")) {
        await tx`
          UPDATE ai_conversation_audits
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "operator_daily_metrics")) {
        await tx`
          DELETE FROM operator_daily_metrics src
          USING operator_daily_metrics dst
          WHERE src.tenant_id = ${tenantId}
            AND dst.tenant_id = ${tenantId}
            AND src.operator_id = ${sourceId}
            AND dst.operator_id = ${destOp.id}
            AND src.date = dst.date
        `;
        await tx`
          UPDATE operator_daily_metrics
          SET operator_id = ${destOp.id}, operator_name = ${destOp.name}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "ai_report_feedback")) {
        await tx`
          UPDATE ai_report_feedback
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "operator_templates")) {
        await tx`
          UPDATE operator_templates
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "lc_chats")) {
        await tx`
          UPDATE lc_chats
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "rd_marketing_oauth_states")) {
        await tx`
          UPDATE rd_marketing_oauth_states
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }

      // 6. Tabelas do Módulo Gestão Comercial / War Room (respeitando índices únicos)
      if (await hasTable(tx, "commercial_consultant_profiles")) {
        await tx`
          DELETE FROM commercial_consultant_profiles src
          USING commercial_consultant_profiles dst
          WHERE src.tenant_id = ${tenantId}
            AND dst.tenant_id = ${tenantId}
            AND src.operator_id = ${sourceId}
            AND dst.operator_id = ${destOp.id}
        `;
        await tx`
          UPDATE commercial_consultant_profiles
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "commercial_goals")) {
        await tx`
          UPDATE commercial_goals
          SET created_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND created_by_operator_id = ${sourceId}
        `;
        await tx`
          DELETE FROM commercial_goals src
          USING commercial_goals dst
          WHERE src.tenant_id = ${tenantId}
            AND dst.tenant_id = ${tenantId}
            AND src.operator_id = ${sourceId}
            AND dst.operator_id = ${destOp.id}
            AND src.month = dst.month
        `;
        await tx`
          UPDATE commercial_goals
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "commercial_calendar_days")) {
        await tx`
          UPDATE commercial_calendar_days
          SET created_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND created_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "commercial_directives")) {
        await tx`
          UPDATE commercial_directives
          SET
            assigned_to_operator_id = CASE WHEN assigned_to_operator_id = ${sourceId} THEN ${destOp.id} ELSE assigned_to_operator_id END,
            assigned_by_operator_id = CASE WHEN assigned_by_operator_id = ${sourceId} THEN ${destOp.id} ELSE assigned_by_operator_id END
          WHERE tenant_id = ${tenantId}
            AND (assigned_to_operator_id = ${sourceId} OR assigned_by_operator_id = ${sourceId})
        `;
      }
      if (await hasTable(tx, "commercial_evidence")) {
        await tx`
          UPDATE commercial_evidence
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "commercial_settings")) {
        await tx`
          UPDATE commercial_settings
          SET updated_by_operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND updated_by_operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "commercial_transfer_response_events")) {
        await tx`
          UPDATE commercial_transfer_response_events
          SET operator_id = ${destOp.id}
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }

      // 7. Limpar sessões e tabelas cascade da conta antiga e excluí-la definitivamente
      if (await hasTable(tx, "auth_sessions")) {
        await tx`
          DELETE FROM auth_sessions
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "internal_messages")) {
        await tx`
          DELETE FROM internal_messages
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "push_subscriptions")) {
        await tx`
          DELETE FROM push_subscriptions
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }
      if (await hasTable(tx, "operator_onboarding")) {
        await tx`
          DELETE FROM operator_onboarding
          WHERE tenant_id = ${tenantId}
            AND operator_id = ${sourceId}
        `;
      }

      const delOpRes = await tx`
        DELETE FROM operators
        WHERE tenant_id = ${tenantId}
          AND id = ${sourceId}
      `;
      stats.sourceOperatorDeleted = (delOpRes.count ?? 0) > 0;

      // Se havia platform_account vinculada exclusivamente a vendas15@tecfag.com.br e sem uso em nenhum tenant, limpa-a também
      if (sourceOp.account_id && (await hasTable(tx, "platform_accounts"))) {
        const [stillUsed] = await tx`
          SELECT COUNT(*)::int AS cnt
          FROM operators
          WHERE account_id = ${sourceOp.account_id}
        `;
        if ((stillUsed?.cnt ?? 0) === 0) {
          const delAccRes = await tx`
            DELETE FROM platform_accounts
            WHERE id = ${sourceOp.account_id}
              AND LOWER(TRIM(email)) = ${LEGACY_DEBORAH_EMAIL}
          `;
          stats.orphanPlatformAccountDeleted = (delAccRes.count ?? 0) > 0;
        }
      }

      // Registrar auditoria administrativa
      if (await hasTable(tx, "crm_action_history")) {
        await tx`
          INSERT INTO crm_action_history (
            id, tenant_id, operator_id, operator_name, action, entity_type, item_count, details, created_at
          ) VALUES (
            ${`act-hist-deborah-reassign-${Date.now()}`},
            ${tenantId},
            ${destOp.id},
            'Sistema (Migração CRM)',
            'transfer_and_delete_operator',
            'operator',
            1,
            ${tx.json({
              deletedOperator: {
                id: sourceOp.id,
                name: sourceOp.name,
                email: sourceOp.email,
              },
              transferredTo: {
                id: destOp.id,
                name: destOp.name,
                email: destOp.email,
              },
              stats: {
                deals: stats.dealsReassigned,
                contacts: stats.contactsReassigned,
                activities: stats.activitiesReassigned,
                conversations: stats.conversationsReassigned,
              },
            })},
            NOW()
          )
        `;
      }
    }

    // 8. Garantir Setor Pós-Venda (e qualquer outro setor do tenant) apontando para destOp.id sem o ID antigo
    if (await hasTable(tx, "sectors")) {
      const allSectors = await tx`
        SELECT id, name, operator_ids
        FROM sectors
        WHERE tenant_id = ${tenantId}
      `;
      for (const sec of allSectors) {
        const rawIds = Array.isArray(sec.operator_ids) ? sec.operator_ids : [];
        const nk = normKey(sec.name);
        const isPosVenda =
          sec.id === "sec-1793215589140" ||
          nk === "pos venda" ||
          nk === "pos-venda" ||
          nk === "setor pos venda" ||
          nk === "setor de pos venda";

        let nextIds = rawIds.map((id) =>
          legacyIdsToScrub.includes(id) ? destOp.id : id,
        );
        if (isPosVenda && !nextIds.includes(destOp.id)) {
          nextIds.push(destOp.id);
        }
        nextIds = Array.from(new Set(nextIds.filter(Boolean)));

        const changed =
          rawIds.length !== nextIds.length ||
          rawIds.some((id, idx) => id !== nextIds[idx]);
        if (changed) {
          await tx`
            UPDATE sectors
            SET operator_ids = ${tx.json(nextIds)}
            WHERE tenant_id = ${tenantId}
              AND id = ${sec.id}
          `;
          stats.sectorsUpdated++;
        }
      }
    }

    // 9. Atualizar round_robin_state se referenciar o ID antigo
    if ((await hasTable(tx, "round_robin_state")) && legacyIdsToScrub.length > 0) {
      const rrRows = await tx`
        SELECT id, last_assigned_operator_id, assignment_count
        FROM round_robin_state
        WHERE tenant_id = ${tenantId}
      `;
      for (const rr of rrRows) {
        let changed = false;
        let nextLast = rr.last_assigned_operator_id;
        if (legacyIdsToScrub.includes(nextLast)) {
          nextLast = destOp.id;
          changed = true;
        }
        const counts =
          rr.assignment_count && typeof rr.assignment_count === "object"
            ? { ...rr.assignment_count }
            : {};
        for (const oldId of legacyIdsToScrub) {
          if (Object.prototype.hasOwnProperty.call(counts, oldId)) {
            counts[destOp.id] =
              Number(counts[destOp.id] || 0) + Number(counts[oldId] || 0);
            delete counts[oldId];
            changed = true;
          }
        }
        if (changed) {
          await tx`
            UPDATE round_robin_state
            SET
              last_assigned_operator_id = ${nextLast},
              assignment_count = ${tx.json(counts)},
              updated_at = NOW()
            WHERE tenant_id = ${tenantId}
              AND id = ${rr.id}
          `;
        }
      }
    }

    // 10. Atualizar Escala Local do Rodízio (`agent_configs` WHERE agent_type = 'rodizio') sob lock transacional
    if (await hasTable(tx, "agent_configs")) {
      await tx`
        SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext('industrial-rodizio-v1'))
      `;
      const [rodizioRow] = await tx`
        SELECT id, config
        FROM agent_configs
        WHERE tenant_id = ${tenantId}
          AND agent_type = 'rodizio'
        FOR UPDATE
      `;
      if (rodizioRow) {
        const cfg =
          rodizioRow.config && typeof rodizioRow.config === "object"
            ? { ...rodizioRow.config }
            : {};
        const flowOps = Array.isArray(cfg.flowOperators)
          ? [...cfg.flowOperators]
          : [];
        const opsMap =
          cfg.operatorsMap && typeof cfg.operatorsMap === "object"
            ? { ...cfg.operatorsMap }
            : {};

        let rodizioChanged = false;
        const isLegacyFlowEntry = (fOp) =>
          fOp &&
          (legacyIdsToScrub.includes(fOp.id) ||
            String(fOp.email || "").trim().toLowerCase() === LEGACY_DEBORAH_EMAIL);
        const isDestFlowEntry = (fOp) =>
          fOp &&
          (fOp.id === destOp.id ||
            String(fOp.email || "").trim().toLowerCase() === REAL_DEBORAH_EMAIL);

        const legacyEntries = flowOps.filter(isLegacyFlowEntry);
        const existingDestIdx = flowOps.findIndex(isDestFlowEntry);

        if (legacyEntries.length > 0) {
          rodizioChanged = true;
          const legacyBase = legacyEntries[0];
          const mergedLeadsCount = legacyEntries.reduce(
            (acc, item) => acc + Number(item.leadsReceivedCount || 0),
            0,
          );
          const mergedCompensation = legacyEntries.reduce(
            (acc, item) => acc + Number(item.compensation || 0),
            0,
          );
          const mergedRecentLeads = legacyEntries.flatMap((item) =>
            Array.isArray(item.recentLeads) ? item.recentLeads : [],
          );

          if (existingDestIdx >= 0) {
            const cur = flowOps[existingDestIdx];
            flowOps[existingDestIdx] = {
              ...legacyBase,
              ...cur,
              id: destOp.id,
              name: destOp.name,
              email: destOp.email,
              avatar: destOp.avatar || cur.avatar || legacyBase.avatar || null,
              area: cur.area || legacyBase.area || "pos_venda",
              funnels:
                Array.isArray(cur.funnels) && cur.funnels.length > 0
                  ? cur.funnels
                  : Array.isArray(legacyBase.funnels) && legacyBase.funnels.length > 0
                    ? legacyBase.funnels
                    : ["Pós-Venda"],
              leadsReceivedCount:
                Number(cur.leadsReceivedCount || 0) + mergedLeadsCount,
              compensation: Number(cur.compensation || 0) + mergedCompensation,
              recentLeads: [
                ...(Array.isArray(cur.recentLeads) ? cur.recentLeads : []),
                ...mergedRecentLeads,
              ].slice(0, 30),
            };
            cfg.flowOperators = flowOps.filter((item) => !isLegacyFlowEntry(item));
          } else {
            cfg.flowOperators = flowOps.map((item, idx) => {
              if (!isLegacyFlowEntry(item)) return item;
              if (item !== legacyBase && idx !== flowOps.indexOf(legacyBase)) {
                return null;
              }
              return {
                ...item,
                id: destOp.id,
                name: destOp.name,
                email: destOp.email,
                avatar: destOp.avatar || item.avatar || null,
                area: item.area || "pos_venda",
                funnels:
                  Array.isArray(item.funnels) && item.funnels.length > 0
                    ? item.funnels
                    : ["Pós-Venda"],
                leadsReceivedCount: mergedLeadsCount,
                compensation: mergedCompensation,
                recentLeads: mergedRecentLeads.slice(0, 30),
              };
            }).filter(Boolean);
          }
        } else if (existingDestIdx === -1 && flowOps.length > 0) {
          rodizioChanged = true;
          cfg.flowOperators = [
            ...flowOps,
            {
              id: destOp.id,
              name: destOp.name,
              email: destOp.email,
              avatar: destOp.avatar || null,
              area: "pos_venda",
              funnels: ["Pós-Venda"],
              departmentTag: "Pós-Venda",
              roleTag: "Consultor",
              isParticipating: true,
              isOnLeave: false,
              leaveDate: null,
              isPenalized: false,
              compensation: 0,
              leadsReceivedCount: 0,
              recentLeads: [],
            },
          ];
        }

        for (const oldId of legacyIdsToScrub) {
          if (Object.prototype.hasOwnProperty.call(opsMap, oldId)) {
            const oldMapEntry = opsMap[oldId] || {};
            const curMapEntry = opsMap[destOp.id] || {};
            opsMap[destOp.id] = {
              ...oldMapEntry,
              ...curMapEntry,
              operatorId: destOp.id,
              isParticipating:
                curMapEntry.isParticipating ?? oldMapEntry.isParticipating ?? true,
              leadsReceivedCount:
                Number(curMapEntry.leadsReceivedCount || 0) +
                Number(oldMapEntry.leadsReceivedCount || 0),
              recentLeads: [
                ...(Array.isArray(curMapEntry.recentLeads)
                  ? curMapEntry.recentLeads
                  : []),
                ...(Array.isArray(oldMapEntry.recentLeads)
                  ? oldMapEntry.recentLeads
                  : []),
              ].slice(0, 30),
            };
            delete opsMap[oldId];
            rodizioChanged = true;
          }
        }

        if (rodizioChanged) {
          cfg.operatorsMap = opsMap;
          await tx`
            UPDATE agent_configs
            SET config = ${tx.json(cfg)}, updated_at = NOW()
            WHERE tenant_id = ${tenantId}
              AND id = ${rodizioRow.id}
          `;
          stats.rodizioUpdated = true;
        }
      }
    }

    return {
      tenantId,
      applied: true,
      destOperator: {
        id: destOp.id,
        name: destOp.name,
        email: destOp.email,
      },
      deletedSourceOperator: sourceOp
        ? { id: sourceOp.id, name: sourceOp.name, email: sourceOp.email }
        : null,
      stats,
    };
  });
}

if (
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("reassign-deborah-alves-operator.mjs")
) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL não configurada.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 4, prepare: false });
  runReassignDeborahAlvesOperator(sql)
    .then((summary) => {
      console.log(
        "[reassign-deborah-alves] Concluído com sucesso:",
        JSON.stringify(summary, null, 2),
      );
      return sql.end();
    })
    .catch(async (err) => {
      console.error("[reassign-deborah-alves] Falha:", err);
      await sql.end();
      process.exit(1);
    });
}
