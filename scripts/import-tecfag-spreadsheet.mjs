import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizeDoc(val) {
  if (!val) return null;
  const digits = String(val).replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function parseBrazilianDate(dateStr, timeStr) {
  if (!dateStr || typeof dateStr !== 'string') return new Date();
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return new Date();
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  let hours = 12;
  let minutes = 0;
  if (timeStr && typeof timeStr === 'string' && timeStr.includes(':')) {
    const tParts = timeStr.trim().split(':');
    hours = parseInt(tParts[0], 10) || 12;
    minutes = parseInt(tParts[1], 10) || 0;
  }

  const d = new Date(year, month, day, hours, minutes);
  return isNaN(d.getTime()) ? new Date() : d;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function cleanStageName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function generatePlaceholderPasswordHash() {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.randomBytes(64).toString('hex');
  return `scrypt:${salt}:${derivedKey}`;
}

/**
 * Função principal de importação idempotente da planilha Tecfag
 * @param {import('postgres').Sql} sql - Conexão ativa do PostgreSQL
 */
export async function runTecfagSpreadsheetImport(sql) {
  const tenantId = 'tecfag';
  console.log(`\n============================================================`);
  console.log(`🚀 [Tecfag Import] Iniciando importação em massa da planilha`);
  console.log(`   Tenant alvo: ${tenantId}`);
  console.log(`============================================================\n`);

  const dataPath = path.join(__dirname, 'data', 'tecfag_deals.csv.gz');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Arquivo não encontrado: ${dataPath}`);
  }

  const gzBuffer = fs.readFileSync(dataPath);
  const csvBuffer = zlib.gunzipSync(gzBuffer);
  const workbook = XLSX.read(csvBuffer, { type: 'buffer', raw: true, codepage: 65001 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);
  console.log(`[Tecfag Import] ${rows.length} linhas lidas da planilha.`);

  // 1. LOCALIZAR OU CRIAR FUNIL "MÁQUINAS"
  console.log(`[Tecfag Import] Buscando funil 'Máquinas' para tenant '${tenantId}'...`);
  const existingPipelines = await sql`
    SELECT id, name, is_default 
    FROM crm_pipelines 
    WHERE tenant_id = ${tenantId}
  `;

  let targetPipeline = existingPipelines.find(p => 
    cleanStageName(p.name).includes('maquina')
  );

  if (!targetPipeline) {
    if (existingPipelines.length > 0) {
      targetPipeline = existingPipelines[0];
      console.log(`[Tecfag Import] Usando funil existente '${targetPipeline.name}' (${targetPipeline.id}).`);
    } else {
      console.log(`[Tecfag Import] Criando funil 'Máquinas'...`);
      const [newPipe] = await sql`
        INSERT INTO crm_pipelines (id, tenant_id, name, is_default, color, cooling_days, order_index)
        VALUES ('pipe-tecfag-maquinas', ${tenantId}, 'Máquinas', true, '#0284c7', 10, 0)
        RETURNING id, name
      `;
      targetPipeline = newPipe;
    }
  }
  console.log(`[Tecfag Import] Funil alvo selecionado: [${targetPipeline.id}] "${targetPipeline.name}"`);

  // 2. BUSCAR OU CRIAR ETAPAS DO FUNIL
  const existingStages = await sql`
    SELECT id, name, order_index 
    FROM crm_stages 
    WHERE pipeline_id = ${targetPipeline.id} AND tenant_id = ${tenantId}
    ORDER BY order_index ASC
  `;

  const stageMap = new Map();
  for (const stg of existingStages) {
    stageMap.set(cleanStageName(stg.name), stg.id);
  }

  // As 7 etapas operacionais da planilha
  const expectedStages = [
    { name: 'LEADS RECEBIDOS', order: 0, win: false, loss: false },
    { name: 'ABORDAGEM COMERCIAL', order: 1, win: false, loss: false },
    { name: 'ESFRIANDO', order: 2, win: false, loss: false },
    { name: 'QUALIFICADO', order: 3, win: false, loss: false },
    { name: 'PROPOSTA ENVIADA', order: 4, win: false, loss: false },
    { name: 'FECHAMENTO', order: 5, win: false, loss: false },
    { name: 'REQUALIFICAÇÃO', order: 6, win: false, loss: false },
  ];

  let nextOrderIndex = existingStages.length > 0 
    ? Math.max(...existingStages.map(s => s.order_index ?? 0)) + 1 
    : 0;

  for (const exp of expectedStages) {
    const key = cleanStageName(exp.name);
    if (!stageMap.has(key)) {
      console.log(`[Tecfag Import] Etapa '${exp.name}' não existe no funil. Criando...`);
      const stageId = `stg-tf-${slugify(exp.name)}`;
      const [created] = await sql`
        INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage)
        VALUES (${stageId}, ${tenantId}, ${targetPipeline.id}, ${exp.name}, ${nextOrderIndex++}, ${exp.win}, ${exp.loss})
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      `;
      stageMap.set(key, created.id);
    }
  }
  console.log(`[Tecfag Import] Todas as etapas sincronizadas: ${stageMap.size} etapas mapeadas.`);

  // 3. OPERADORES (VENDEDORES / CONSULTORES)
  console.log(`[Tecfag Import] Mapeando e cadastrando operadores...`);
  const existingOps = await sql`
    SELECT id, name, email 
    FROM operators 
    WHERE tenant_id = ${tenantId}
  `;
  const opByName = new Map();
  for (const op of existingOps) {
    opByName.set(op.name.toLowerCase().trim(), op.id);
  }

  const uniqueResponsibles = new Set();
  for (const r of rows) {
    const resp = (r['Responsável'] || '').trim();
    if (resp) uniqueResponsibles.add(resp);
  }

  for (const respName of uniqueResponsibles) {
    const key = respName.toLowerCase().trim();
    if (!opByName.has(key)) {
      const slug = slugify(respName).substring(0, 30);
      const opId = `op-tf-${slug}`;
      const email = `${slug}@tecfag.com.br`;
      const passHash = generatePlaceholderPasswordHash();
      
      const [createdOp] = await sql`
        INSERT INTO operators (id, tenant_id, name, email, password_hash, role, status, is_online)
        VALUES (${opId}, ${tenantId}, ${respName}, ${email}, ${passHash}, 'agent', 'disponivel', false)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        RETURNING id, name
      `;
      opByName.set(key, createdOp.id);
    }
  }
  console.log(`[Tecfag Import] Operadores disponíveis para atribuição: ${opByName.size}`);

  // 4. EXTRAÇÃO E INSERÇÃO DE EMPRESAS (crm_accounts)
  console.log(`[Tecfag Import] Processando empresas...`);
  const accountIdByDoc = new Map();
  const accountIdByRdOrg = new Map();
  const accountIdByName = new Map();
  const companiesToInsertMap = new Map();

  // Carregar contas que já existem no banco para este tenant para reaproveitamento direto
  const existingAccounts = await sql`
    SELECT id, document, rd_organization_id, name
    FROM crm_accounts
    WHERE tenant_id = ${tenantId}
  `;
  const existingDocSet = new Set();
  for (const acc of existingAccounts) {
    if (acc.document) {
      accountIdByDoc.set(acc.document, acc.id);
      existingDocSet.add(acc.document);
    }
    if (acc.rd_organization_id) {
      accountIdByRdOrg.set(acc.rd_organization_id, acc.id);
    }
    if (acc.name) {
      accountIdByName.set(acc.name.toLowerCase().trim(), acc.id);
    }
  }

  for (const r of rows) {
    const rdOrgId = (r['ID da Empresa'] || '').trim();
    const orgName = (r['Empresa'] || r['Nome'] || 'Empresa Sem Nome').trim();
    const extra = r['INFORMAÇÕES COMPLEMENTARES'] || '';
    const docMatch = extra.match(/CNPJ\/CPF:\s*([0-9.\-\/]+)/i);
    const cleanDoc = normalizeDoc(docMatch ? docMatch[1] : null);

    let accId = null;
    if (cleanDoc && accountIdByDoc.has(cleanDoc)) {
      accId = accountIdByDoc.get(cleanDoc);
    } else if (rdOrgId && accountIdByRdOrg.has(rdOrgId)) {
      accId = accountIdByRdOrg.get(rdOrgId);
    } else if (accountIdByName.has(orgName.toLowerCase())) {
      accId = accountIdByName.get(orgName.toLowerCase());
    }

    if (!accId) {
      if (cleanDoc) {
        accId = `acc-doc-${cleanDoc}`;
      } else if (rdOrgId) {
        accId = `acc-rd-${rdOrgId}`;
      } else {
        accId = `acc-tf-${slugify(orgName).substring(0, 25)}-${Math.random().toString(36).substring(2, 7)}`;
      }

      companiesToInsertMap.set(accId, {
        id: accId,
        tenant_id: tenantId,
        type: cleanDoc && cleanDoc.length === 11 ? 'person' : 'company',
        name: orgName,
        trade_name: orgName,
        document: cleanDoc || null,
        document_type: cleanDoc ? (cleanDoc.length === 14 ? 'cnpj' : 'cpf') : null,
        rd_organization_id: rdOrgId || null,
      });

      if (cleanDoc) accountIdByDoc.set(cleanDoc, accId);
      if (rdOrgId) accountIdByRdOrg.set(rdOrgId, accId);
      accountIdByName.set(orgName.toLowerCase(), accId);
    } else {
      // Se a conta já existe mas achamos um documento novo agora, atualizamos
      if (cleanDoc && !accountIdByDoc.has(cleanDoc)) {
        accountIdByDoc.set(cleanDoc, accId);
        const item = companiesToInsertMap.get(accId);
        if (item && !item.document) {
          item.document = cleanDoc;
          item.document_type = cleanDoc.length === 14 ? 'cnpj' : 'cpf';
        }
      }
      if (rdOrgId && !accountIdByRdOrg.has(rdOrgId)) {
        accountIdByRdOrg.set(rdOrgId, accId);
      }
    }
  }

  // Deduplicação estrita de document para respeitar o unique index
  const docSeen = new Set(existingDocSet);
  const safeCompaniesList = [];
  for (const comp of companiesToInsertMap.values()) {
    if (comp.document) {
      if (docSeen.has(comp.document)) {
        // Já existe uma conta com este documento, anula o documento deste registro para não violar unique
        comp.document = null;
        comp.document_type = null;
      } else {
        docSeen.add(comp.document);
      }
    }
    safeCompaniesList.push(comp);
  }

  console.log(`[Tecfag Import] ${safeCompaniesList.length} empresas únicas para inserir.`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < safeCompaniesList.length; i += BATCH_SIZE) {
    const chunk = safeCompaniesList.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO crm_accounts ${sql(chunk, 'id', 'tenant_id', 'type', 'name', 'trade_name', 'document', 'document_type', 'rd_organization_id')}
      ON CONFLICT DO NOTHING
    `;
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= safeCompaniesList.length) {
      console.log(`[Tecfag Import] Empresas inseridas: ${Math.min(i + BATCH_SIZE, safeCompaniesList.length)}/${safeCompaniesList.length}`);
    }
  }

  // Mapear todas as contas reais e garantidas em crm_accounts para garantir integridade referencial
  const allAccountsInDb = await sql`
    SELECT id FROM crm_accounts WHERE tenant_id = ${tenantId}
  `;
  const validAccountIds = new Set(allAccountsInDb.map(a => a.id));

  // 5. EXTRAÇÃO E INSERÇÃO DE CONTATOS (contacts)
  console.log(`[Tecfag Import] Processando contatos...`);
  const contactIdByKey = new Map();
  const contactsToInsertMap = new Map();

  for (const r of rows) {
    const rdContactId = (r['ID do Contato'] || '').trim();
    const contactName = (r['Contatos'] || r['Nome'] || 'Contato').trim();
    const phone = normalizeDoc(r['Telefone']);
    const email = (r['Email'] || '').trim().toLowerCase() || null;
    
    // Identificar a empresa
    const rdOrgId = (r['ID da Empresa'] || '').trim();
    const orgName = (r['Empresa'] || r['Nome'] || 'Empresa Sem Nome').trim();
    const extra = r['INFORMAÇÕES COMPLEMENTARES'] || '';
    const docMatch = extra.match(/CNPJ\/CPF:\s*([0-9.\-\/]+)/i);
    const cleanDoc = normalizeDoc(docMatch ? docMatch[1] : null);

    let accountId = null;
    if (cleanDoc && accountIdByDoc.has(cleanDoc)) accountId = accountIdByDoc.get(cleanDoc);
    else if (rdOrgId && accountIdByRdOrg.has(rdOrgId)) accountId = accountIdByRdOrg.get(rdOrgId);
    else if (accountIdByName.has(orgName.toLowerCase())) accountId = accountIdByName.get(orgName.toLowerCase());

    const key = rdContactId ? `rd-${rdContactId}` : (phone ? `ph-${phone}` : (email ? `em-${email}` : `name-${contactName.toLowerCase()}`));
    let ctId = contactIdByKey.get(key);

    if (!ctId) {
      ctId = rdContactId ? `ct-rd-${rdContactId}` : `ct-tf-${Math.random().toString(36).substring(2, 10)}`;
      contactIdByKey.set(key, ctId);
      if (phone) contactIdByKey.set(`ph-${phone}`, ctId);
      if (email) contactIdByKey.set(`em-${email}`, ctId);

      contactsToInsertMap.set(ctId, {
        id: ctId,
        tenant_id: tenantId,
        account_id: accountId,
        name: contactName,
        phone: phone || null,
        email: email || null,
        main_channel: 'whatsapp',
        responsible_name: (r['Responsável'] || 'Na Fila').trim(),
      });
    }
  }

  const contactsList = Array.from(contactsToInsertMap.values());
  for (const ct of contactsList) {
    if (ct.account_id && !validAccountIds.has(ct.account_id)) {
      ct.account_id = null;
    }
  }
  console.log(`[Tecfag Import] ${contactsList.length} contatos únicos para inserir.`);

  for (let i = 0; i < contactsList.length; i += BATCH_SIZE) {
    const chunk = contactsList.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO contacts ${sql(chunk, 'id', 'tenant_id', 'account_id', 'name', 'phone', 'email', 'main_channel', 'responsible_name')}
      ON CONFLICT DO NOTHING
    `;
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= contactsList.length) {
      console.log(`[Tecfag Import] Contatos inseridos: ${Math.min(i + BATCH_SIZE, contactsList.length)}/${contactsList.length}`);
    }
  }

  // 6. EXTRAÇÃO E INSERÇÃO DE NEGOCIAÇÕES (crm_deals)
  console.log(`[Tecfag Import] Processando ${rows.length} negociações...`);
  const dealsToInsertMap = new Map();
  const dealContactLinksMap = new Map();

  const defaultStageId = stageMap.get('leads recebidos') || Array.from(stageMap.values())[0];

  for (const r of rows) {
    const rdDealId = (r['ID'] || '').trim();
    if (!rdDealId) continue;

    const dealId = `deal-rd-${rdDealId}`;
    const title = (r['Nome'] || `Negócio ${rdDealId}`).trim();

    // Etapa
    const rawStage = cleanStageName(r['Etapa']);
    const stageId = stageMap.get(rawStage) || defaultStageId;

    // Empresa
    const rdOrgId = (r['ID da Empresa'] || '').trim();
    const orgName = (r['Empresa'] || r['Nome'] || 'Empresa Sem Nome').trim();
    const extra = r['INFORMAÇÕES COMPLEMENTARES'] || '';
    const docMatch = extra.match(/CNPJ\/CPF:\s*([0-9.\-\/]+)/i);
    const cleanDoc = normalizeDoc(docMatch ? docMatch[1] : null);

    let accountId = null;
    if (cleanDoc && accountIdByDoc.has(cleanDoc)) accountId = accountIdByDoc.get(cleanDoc);
    else if (rdOrgId && accountIdByRdOrg.has(rdOrgId)) accountId = accountIdByRdOrg.get(rdOrgId);
    else if (accountIdByName.has(orgName.toLowerCase())) accountId = accountIdByName.get(orgName.toLowerCase());

    // Operador
    const resp = (r['Responsável'] || '').trim();
    const operatorId = opByName.get(resp.toLowerCase()) || null;

    // Status
    const rawState = (r['Estado'] || '').toLowerCase();
    let status = 'open';
    if (rawState.includes('ganh') || rawState.includes('vend')) status = 'won';
    else if (rawState.includes('perd')) status = 'lost';

    // Valores
    const rawVal = parseFloat(r['Valor Único']) || parseFloat(r['Valor Recorrente']) || 0;
    const value = rawVal.toFixed(2);

    // Datas
    const createdAt = parseBrazilianDate(r['Data de criação'], r['Hora de criação']);
    const lastActivity = parseBrazilianDate(r['Data do último contato'], r['Hora do último contato']);
    const closeDate = r['Data de fechamento'] ? parseBrazilianDate(r['Data de fechamento'], r['Hora de fechamento']) : null;
    const expectedClose = r['Previsão de fechamento'] ? parseBrazilianDate(r['Previsão de fechamento'], '') : null;

    // Metadados / Campos customizados
    const customFields = {
      produto_fabricado: r['QUAL O PRODUTO FABRICADO?'] || null,
      ajuda_necessaria: r['ONDE O CLIENTE PRECISA DE AJUDA?'] || null,
      processo_atual: r['COMO É FEITO HOJE?'] || null,
      volume_producao: r['VOLUME DE PRODUÇÃO?'] || null,
      expectativa_uso: r['EXPECTATIVA DE USO?'] || null,
      nivel_automacao: r['NÍVEL DE AUTOMAÇÃO EXIGIDO'] || null,
      tipo_embalagem: r['QUE TIPO DE EMBALAGEM?'] || null,
      producao_hora: r['PRODUÇÃO DESEJADA POR HORA'] || null,
      perfil_cliente: r['QUAL PERFIL O CLIENTE SE ENCAIXA?'] || null,
      budget: r['Budget'] || null,
      sdr_qualificacao: r['QUALIFICADO POR SDR'] || null,
      info_complementares: r['INFORMAÇÕES COMPLEMENTARES'] || null,
      cliente_novo: r['CLIENTE NOVO?'] || null,
      descricao: r['DESCRIÇÃO'] || null,
    };

    if (!dealsToInsertMap.has(dealId)) {
      dealsToInsertMap.set(dealId, {
        id: dealId,
        tenant_id: tenantId,
        pipeline_id: targetPipeline.id,
        stage_id: stageId,
        account_id: accountId,
        operator_id: operatorId,
        title,
        value,
        currency: 'BRL',
        status,
        rating: parseInt(r['Qualificação'], 10) || 1,
        source: r['Fonte'] || 'rd_crm_import',
        campaign: r['Campanha'] || null,
        loss_reason: r['Motivo de Perda'] && r['Motivo de Perda'] !== 'Nada' ? r['Motivo de Perda'] : null,
        expected_close_date: expectedClose,
        closed_at: closeDate,
        rd_deal_id: rdDealId,
        custom_fields: JSON.stringify(customFields),
        created_at: createdAt,
        updated_at: new Date(),
        last_activity_at: lastActivity,
      });
    }

    // Contato participante
    const rdContactId = (r['ID do Contato'] || '').trim();
    const contactName = (r['Contatos'] || r['Nome'] || 'Contato').trim();
    const phone = normalizeDoc(r['Telefone']);
    const email = (r['Email'] || '').trim().toLowerCase() || null;
    const contactKey = rdContactId ? `rd-${rdContactId}` : (phone ? `ph-${phone}` : (email ? `em-${email}` : `name-${contactName.toLowerCase()}`));
    const contactId = contactIdByKey.get(contactKey);

    if (contactId) {
      const linkKey = `${dealId}_${contactId}`;
      if (!dealContactLinksMap.has(linkKey)) {
        dealContactLinksMap.set(linkKey, {
          id: `dc-${dealId}-${contactId}`,
          deal_id: dealId,
          contact_id: contactId,
          tenant_id: tenantId,
          is_primary: true,
          role: r['Cargo'] || 'buyer',
        });
      }
    }
  }

  const finalDeals = Array.from(dealsToInsertMap.values());
  for (const deal of finalDeals) {
    if (deal.account_id && !validAccountIds.has(deal.account_id)) {
      deal.account_id = null;
    }
  }
  console.log(`[Tecfag Import] ${finalDeals.length} negociações únicas preparadas para gravação.`);

  for (let i = 0; i < finalDeals.length; i += BATCH_SIZE) {
    const chunk = finalDeals.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO crm_deals ${sql(
        chunk,
        'id',
        'tenant_id',
        'pipeline_id',
        'stage_id',
        'account_id',
        'operator_id',
        'title',
        'value',
        'currency',
        'status',
        'rating',
        'source',
        'campaign',
        'loss_reason',
        'expected_close_date',
        'closed_at',
        'rd_deal_id',
        'custom_fields',
        'created_at',
        'updated_at',
        'last_activity_at'
      )}
      ON CONFLICT DO NOTHING
    `;
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= finalDeals.length) {
      console.log(`[Tecfag Import] Negociações salvas: ${Math.min(i + BATCH_SIZE, finalDeals.length)}/${finalDeals.length}`);
    }
  }

  // 7. INSERÇÃO DOS VÍNCULOS NEGOCIAÇÃO ↔ CONTATO (crm_deal_contacts)
  console.log(`[Tecfag Import] Vinculando contatos às negociações...`);
  
  // Buscar contatos e negociações reais garantidas no banco para integridade referencial estrita
  const allContactsInDb = await sql`
    SELECT id FROM contacts WHERE tenant_id = ${tenantId}
  `;
  const validContactIds = new Set(allContactsInDb.map(c => c.id));
  const validDealIds = new Set(finalDeals.map(d => d.id));

  const finalLinks = Array.from(dealContactLinksMap.values()).filter(
    link => validDealIds.has(link.deal_id) && validContactIds.has(link.contact_id)
  );
  console.log(`[Tecfag Import] ${finalLinks.length} vínculos únicos para inserir.`);

  for (let i = 0; i < finalLinks.length; i += BATCH_SIZE) {
    const chunk = finalLinks.slice(i, i + BATCH_SIZE);
    await sql`
      INSERT INTO crm_deal_contacts ${sql(chunk, 'id', 'deal_id', 'contact_id', 'tenant_id', 'is_primary', 'role')}
      ON CONFLICT DO NOTHING
    `;
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= finalLinks.length) {
      console.log(`[Tecfag Import] Vínculos inseridos: ${Math.min(i + BATCH_SIZE, finalLinks.length)}/${finalLinks.length}`);
    }
  }

  console.log(`\n============================================================`);
  console.log(`✅ [Tecfag Import] IMPORTAÇÃO CONCLUÍDA COM SUCESSO!`);
  console.log(`   - Funil: ${targetPipeline.name} (${targetPipeline.id})`);
  console.log(`   - Etapas sincronizadas: ${stageMap.size}`);
  console.log(`   - Operadores: ${opByName.size}`);
  console.log(`   - Empresas criadas: ${safeCompaniesList.length}`);
  console.log(`   - Contatos criados: ${contactsList.length}`);
  console.log(`   - Negociações gravadas: ${finalDeals.length}`);
  console.log(`   - Vínculos deal x contato: ${finalLinks.length}`);
  console.log(`============================================================\n`);

  return {
    pipeline: targetPipeline,
    stagesCount: stageMap.size,
    operatorsCount: opByName.size,
    companiesCount: safeCompaniesList.length,
    contactsCount: contactsList.length,
    dealsCount: finalDeals.length,
    linksCount: finalLinks.length,
  };
}
