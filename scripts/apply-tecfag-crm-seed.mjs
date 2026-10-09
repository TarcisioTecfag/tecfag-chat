import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carrega .env nativamente se existir
if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch (e) {}
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
  } catch (e) {}
}

const databaseUrl = process.env.DATABASE_URL;
const isForce = process.argv.includes("--force");
const seedFile = join(__dirname, "data/tecfag-crm-seed.json.gz");

export async function applyTecfagCrmSeed(externalSql = null) {
  const sql = externalSql || postgres(databaseUrl, {
    max: 10,
    prepare: false,
    transform: { undefined: null }
  });
  const shouldClose = !externalSql;

  try {
    if (!existsSync(seedFile)) {
      console.warn(`[tecfag crm seed] Arquivo de seed não encontrado: ${seedFile}. Ignorando.`);
      return;
    }

    // 1. Verificar se a migração já foi aplicada no app_deploy_migrations
    const [alreadyApplied] = await sql`
      SELECT name FROM app_deploy_migrations WHERE name = '0033_tecfag_crm_complete_seed'
    `;

    if (alreadyApplied && !isForce) {
      console.log(`[tecfag crm seed] 0033_tecfag_crm_complete_seed já foi aplicada anteriormente.`);
      return;
    }

    console.log(`[tecfag crm seed] Lendo e descompactando arquivo de seed (${seedFile})...`);
    const gzBuffer = readFileSync(seedFile);
    const jsonStr = gunzipSync(gzBuffer).toString("utf8");
    const payload = JSON.parse(jsonStr);

    console.log(`[tecfag crm seed] Dados carregados:`, payload.counts);

    const { operators, pipelines, stages, customFields, accounts, contacts, deals, links } = payload;
    const tenantId = payload.tenantId || "tecfag";

    console.log(`[tecfag crm seed] Iniciando transação no PostgreSQL para tenant '${tenantId}'...`);
    const startTime = Date.now();

    await sql.begin(async (tx) => {
      // Otimização de alta performance: desativa triggers de identidade temporariamente durante a carga atômica
      try {
        await tx.unsafe("ALTER TABLE contacts DISABLE TRIGGER trg_contact_phone_identity");
        await tx.unsafe("ALTER TABLE crm_accounts DISABLE TRIGGER trg_account_document_identity");
      } catch (e) {
        console.warn("[tecfag crm seed] Aviso: não foi possível alterar triggers, prosseguindo com triggers ativas:", e.message);
      }

      // 0. OPERADORES: Não criar nem alterar operadores no seed.
      // O sistema deve estritamente usar os operadores reais já cadastrados na plataforma.
      const dbOps = await tx`
        SELECT id, name FROM operators 
        WHERE tenant_id = ${tenantId} AND id NOT LIKE 'op-tf-%'
      `;
      const validOpIds = new Set(dbOps.map(o => o.id));
      const tarcisio = dbOps.find(o => 
        o.id === "38306207-265e-4cd1-b702-a78805526b94" || 
        o.name.toLowerCase().includes("tarcisio")
      ) || dbOps[0];
      const fallbackOpId = tarcisio?.id || "38306207-265e-4cd1-b702-a78805526b94";
      console.log(`[tecfag crm seed] Operadores legítimos validados no banco (${dbOps.length}). Fallback oficial: [${fallbackOpId}] ${tarcisio?.name}`);


      // 1. PIPELINES (Funis)
      console.log(`[tecfag crm seed] Inserindo ${pipelines.length} funis...`);
      for (const p of pipelines) {
        await tx`
          INSERT INTO crm_pipelines (
            id, tenant_id, name, order_index, is_default, color, cooling_days, rd_pipeline_id, created_at, updated_at
          ) VALUES (
            ${p.id}, ${tenantId}, ${p.name}, ${p.order_index ?? p.orderIndex ?? 0},
            ${p.is_default ?? p.isDefault ?? false}, ${p.color || "#0284c7"},
            ${p.cooling_days ?? p.coolingDays ?? 10}, ${p.rd_pipeline_id ?? p.rdPipelineId ?? null},
            ${p.created_at ?? p.createdAt ?? new Date()}, ${p.updated_at ?? p.updatedAt ?? new Date()}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            order_index = EXCLUDED.order_index,
            is_default = EXCLUDED.is_default,
            color = EXCLUDED.color,
            updated_at = NOW()
        `;
      }

      // 2. STAGES (Etapas)
      console.log(`[tecfag crm seed] Inserindo ${stages.length} etapas...`);
      for (const s of stages) {
        await tx`
          INSERT INTO crm_stages (
            id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage,
            required_fields, rd_stage_id, created_at, updated_at
          ) VALUES (
            ${s.id}, ${tenantId}, ${s.pipeline_id ?? s.pipelineId}, ${s.name},
            ${s.order_index ?? s.orderIndex ?? 0}, ${s.is_win_stage ?? s.isWinStage ?? false},
            ${s.is_loss_stage ?? s.isLossStage ?? false},
            ${JSON.stringify(s.required_fields ?? s.requiredFields ?? [])}::jsonb,
            ${s.rd_stage_id ?? s.rdStageId ?? null},
            ${s.created_at ?? s.createdAt ?? new Date()}, ${s.updated_at ?? s.updatedAt ?? new Date()}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            order_index = EXCLUDED.order_index,
            is_win_stage = EXCLUDED.is_win_stage,
            is_loss_stage = EXCLUDED.is_loss_stage,
            updated_at = NOW()
        `;
      }

      // 3. CUSTOM FIELDS DEFINITIONS
      console.log(`[tecfag crm seed] Inserindo ${customFields.length} definições de campos customizados...`);
      for (const f of customFields) {
        await tx`
          INSERT INTO crm_custom_field_definitions (
            id, tenant_id, entity_type, name, field_type, options, required,
            required_rule, required_from_stage_id, is_unique, visible_on_create,
            all_pipelines, pipeline_ids, sort_order, archived_at, created_at, updated_at
          ) VALUES (
            ${f.id}, ${tenantId}, ${f.entity_type ?? f.entityType ?? "deal"}, ${f.name},
            ${f.field_type ?? f.fieldType ?? "text"},
            ${JSON.stringify(f.options ?? [])}::jsonb,
            ${f.required ?? false}, ${f.required_rule ?? f.requiredRule ?? "always"},
            ${f.required_from_stage_id ?? f.requiredFromStageId ?? null},
            ${f.is_unique ?? f.isUnique ?? false},
            ${f.visible_on_create ?? f.visibleOnCreate ?? true},
            ${f.all_pipelines ?? f.allPipelines ?? true},
            ${JSON.stringify(f.pipeline_ids ?? f.pipelineIds ?? [])}::jsonb,
            ${f.sort_order ?? f.sortOrder ?? 0},
            ${f.archived_at ?? f.archivedAt ?? null},
            ${f.created_at ?? f.createdAt ?? new Date()},
            ${f.updated_at ?? f.updatedAt ?? new Date()}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            field_type = EXCLUDED.field_type,
            options = EXCLUDED.options,
            required = EXCLUDED.required,
            updated_at = NOW()
        `;
      }

      // 4. ACCOUNTS (Empresas) em BULK
      console.log(`[tecfag crm seed] Inserindo ${accounts.length} empresas em blocos otimizados...`);
      const BATCH_SIZE = 500;
      for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
        const chunk = accounts.slice(i, i + BATCH_SIZE);
        const formattedAccounts = chunk.map(a => ({
          id: a.id,
          tenant_id: tenantId,
          type: a.type || "company",
          name: a.name,
          trade_name: a.trade_name ?? a.tradeName ?? null,
          segment: a.segment ?? null,
          document_type: a.document_type ?? a.documentType ?? null,
          document: a.document ?? null,
          email: a.email ?? null,
          phone: a.phone ?? null,
          website: a.website ?? null,
          address: a.address ?? {},
          custom_fields: a.custom_fields ?? a.customFields ?? {},
          notes: a.notes ?? null,
          rd_organization_id: a.rd_organization_id ?? a.rdOrganizationId ?? null,
          archived_at: a.archived_at ?? a.archivedAt ?? null,
          created_at: a.created_at ?? a.createdAt ?? new Date(),
          updated_at: a.updated_at ?? a.updatedAt ?? new Date()
        }));

        await tx`
          INSERT INTO crm_accounts ${tx(formattedAccounts,
            'id', 'tenant_id', 'type', 'name', 'trade_name', 'segment',
            'document_type', 'document', 'email', 'phone', 'website',
            'address', 'custom_fields', 'notes', 'rd_organization_id',
            'archived_at', 'created_at', 'updated_at'
          )}
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            document = COALESCE(EXCLUDED.document, crm_accounts.document),
            phone = COALESCE(EXCLUDED.phone, crm_accounts.phone),
            email = COALESCE(EXCLUDED.email, crm_accounts.email),
            updated_at = NOW()
        `;

        if ((i + BATCH_SIZE) % 2500 === 0 || i + BATCH_SIZE >= accounts.length) {
          console.log(`  -> Empresas: ${Math.min(i + BATCH_SIZE, accounts.length)}/${accounts.length}`);
        }
      }

      // 5. CONTACTS (Contatos) em BULK com Fallback Seguro de Operador
      console.log(`[tecfag crm seed] Inserindo ${contacts.length} contatos em blocos otimizados...`);
      for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        const chunk = contacts.slice(i, i + BATCH_SIZE);
        const formattedContacts = chunk.map(c => {
          const rawWalletOpId = c.wallet_operator_id ?? c.walletOperatorId ?? null;
          const safeWalletOpId = rawWalletOpId && validOpIds.has(rawWalletOpId) ? rawWalletOpId : fallbackOpId;

          return {
            id: c.id,
            tenant_id: tenantId,
            account_id: c.account_id ?? c.accountId ?? null,
            name: c.name,
            phone: c.phone ?? null,
            whatsapp_jid: c.whatsapp_jid ?? c.whatsappJid ?? null,
            whatsapp_user_id: c.whatsapp_user_id ?? c.whatsappUserId ?? null,
            whatsapp_username: c.whatsapp_username ?? c.whatsappUsername ?? null,
            email: c.email ?? null,
            cnpj: c.cnpj ?? null,
            cpf: c.cpf ?? null,
            avatar: c.avatar ?? null,
            tags: c.tags ?? [],
            main_channel: c.main_channel ?? c.mainChannel ?? "whatsapp",
            wallet_operator_id: safeWalletOpId,
            responsible_name: c.responsible_name ?? c.responsibleName ?? "Na Fila",
            rd_crm_deal_id: c.rd_crm_deal_id ?? c.rdCrmDealId ?? null,
            rd_crm_deal_link: c.rd_crm_deal_link ?? c.rdCrmDealLink ?? null,
            cnpj_details: c.cnpj_details ?? c.cnpjDetails ?? {},
            custom_fields: c.custom_fields ?? c.customFields ?? {},
            created_at: c.created_at ?? c.createdAt ?? new Date()
          };
        });

        await tx`
          INSERT INTO contacts ${tx(formattedContacts,
            'id', 'tenant_id', 'account_id', 'name', 'phone',
            'whatsapp_jid', 'whatsapp_user_id', 'whatsapp_username',
            'email', 'cnpj', 'cpf', 'avatar', 'tags', 'main_channel',
            'wallet_operator_id', 'responsible_name', 'rd_crm_deal_id',
            'rd_crm_deal_link', 'cnpj_details', 'custom_fields', 'created_at'
          )}
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            account_id = COALESCE(EXCLUDED.account_id, contacts.account_id),
            phone = COALESCE(EXCLUDED.phone, contacts.phone),
            email = COALESCE(EXCLUDED.email, contacts.email)
        `;

        if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= contacts.length) {
          console.log(`  -> Contatos: ${Math.min(i + BATCH_SIZE, contacts.length)}/${contacts.length}`);
        }
      }

      // 6. DEALS (Negociações) em BULK com Fallback Seguro de Operador
      console.log(`[tecfag crm seed] Inserindo ${deals.length} negociações em blocos otimizados...`);
      for (let i = 0; i < deals.length; i += BATCH_SIZE) {
        const chunk = deals.slice(i, i + BATCH_SIZE);
        const formattedDeals = chunk.map(d => {
          const rawOpId = d.operator_id ?? d.operatorId ?? null;
          const safeOpId = rawOpId && validOpIds.has(rawOpId) ? rawOpId : fallbackOpId;

          return {
            id: d.id,
            tenant_id: tenantId,
            title: d.title,
            account_id: d.account_id ?? d.accountId ?? null,
            pipeline_id: d.pipeline_id ?? d.pipelineId,
            stage_id: d.stage_id ?? d.stageId,
            status: d.status || "open",
            value: d.value ?? null,
            currency: d.currency || "BRL",
            expected_close_date: d.expected_close_date ?? d.expectedCloseDate ?? null,
            operator_id: safeOpId,
            source: d.source ?? null,
            campaign: d.campaign ?? null,
            rating: d.rating ?? 0,
            loss_reason: d.loss_reason ?? d.lossReason ?? null,
            paused_reason: d.paused_reason ?? d.pausedReason ?? null,
            rd_deal_id: d.rd_deal_id ?? d.rdDealId ?? null,
            rd_deal_url: d.rd_deal_url ?? d.rdDealUrl ?? null,
            custom_fields: d.custom_fields ?? d.customFields ?? {},
            version: d.version ?? 1,
            ai_priority_score: d.ai_priority_score ?? d.aiPriorityScore ?? null,
            ai_priority_level: d.ai_priority_level ?? d.aiPriorityLevel ?? null,
            ai_priority_reason: d.ai_priority_reason ?? d.aiPriorityReason ?? null,
            ai_priority_updated_at: d.ai_priority_updated_at ?? d.aiPriorityUpdatedAt ?? null,
            last_activity_at: d.last_activity_at ?? d.lastActivityAt ?? new Date(),
            closed_at: d.closed_at ?? d.closedAt ?? null,
            created_at: d.created_at ?? d.createdAt ?? new Date(),
            updated_at: d.updated_at ?? d.updatedAt ?? new Date()
          };
        });

        await tx`
          INSERT INTO crm_deals ${tx(formattedDeals,
            'id', 'tenant_id', 'title', 'account_id', 'pipeline_id',
            'stage_id', 'status', 'value', 'currency', 'expected_close_date',
            'operator_id', 'source', 'campaign', 'rating', 'loss_reason',
            'paused_reason', 'rd_deal_id', 'rd_deal_url', 'custom_fields',
            'version', 'ai_priority_score', 'ai_priority_level', 'ai_priority_reason',
            'ai_priority_updated_at', 'last_activity_at', 'closed_at', 'created_at', 'updated_at'
          )}
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            account_id = COALESCE(EXCLUDED.account_id, crm_deals.account_id),
            pipeline_id = EXCLUDED.pipeline_id,
            stage_id = EXCLUDED.stage_id,
            status = EXCLUDED.status,
            value = EXCLUDED.value,
            operator_id = EXCLUDED.operator_id,
            custom_fields = EXCLUDED.custom_fields,
            updated_at = NOW()
        `;

        if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= deals.length) {
          console.log(`  -> Negociações: ${Math.min(i + BATCH_SIZE, deals.length)}/${deals.length}`);
        }
      }

      // 7. DEAL CONTACTS (Vínculos Relacionais) em BULK
      console.log(`[tecfag crm seed] Inserindo ${links.length} vínculos Deal-Contato em blocos otimizados...`);
      for (let i = 0; i < links.length; i += BATCH_SIZE) {
        const chunk = links.slice(i, i + BATCH_SIZE);
        const formattedLinks = chunk.map(l => ({
          id: l.id,
          tenant_id: tenantId,
          deal_id: l.deal_id ?? l.dealId,
          contact_id: l.contact_id ?? l.contactId,
          role: l.role || "contact",
          is_primary: l.is_primary ?? l.isPrimary ?? false,
          created_at: l.created_at ?? l.createdAt ?? new Date()
        }));

        await tx`
          INSERT INTO crm_deal_contacts ${tx(formattedLinks,
            'id', 'tenant_id', 'deal_id', 'contact_id', 'role', 'is_primary', 'created_at'
          )}
          ON CONFLICT (id) DO NOTHING
        `;

        if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= links.length) {
          console.log(`  -> Vínculos: ${Math.min(i + BATCH_SIZE, links.length)}/${links.length}`);
        }
      }

      // Reativa triggers de integridade
      try {
        await tx.unsafe("ALTER TABLE contacts ENABLE TRIGGER trg_contact_phone_identity");
        await tx.unsafe("ALTER TABLE crm_accounts ENABLE TRIGGER trg_account_document_identity");
      } catch (e) {
        console.warn("[tecfag crm seed] Aviso: não foi possível reativar triggers:", e.message);
      }

      // 8. REGISTRAR MIGRAÇÃO CONCLUÍDA
      await tx`
        INSERT INTO app_deploy_migrations (name, applied_at)
        VALUES ('0033_tecfag_crm_complete_seed', NOW())
        ON CONFLICT (name) DO UPDATE SET applied_at = NOW()
      `;
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ [tecfag crm seed] Sincronização concluída com 100% de sucesso em ${elapsed}s!`);
    console.log(`   - Operadores: ${operators?.length || 0}`);
    console.log(`   - Negociações: ${deals.length}`);
    console.log(`   - Contatos: ${contacts.length}`);
    console.log(`   - Empresas: ${accounts.length}`);
    console.log(`   - Vínculos: ${links.length}`);

    return {
      success: true,
      elapsedSeconds: parseFloat(elapsed),
      counts: {
        operators: operators?.length || 0,
        deals: deals.length,
        contacts: contacts.length,
        accounts: accounts.length,
        links: links.length
      }
    };
  } catch (error) {
    console.error(`❌ [tecfag crm seed] Falha durante a aplicação do seed:`, error);
    throw error;
  } finally {
    if (shouldClose) await sql.end();
  }
}

// Se executado diretamente via terminal
if (process.argv[1] && process.argv[1].endsWith("apply-tecfag-crm-seed.mjs")) {
  applyTecfagCrmSeed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
