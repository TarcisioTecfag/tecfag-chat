import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Migração de campos personalizados, catálogos e enriquecimento de cards/empresas
 * @param {import('postgres').Sql} sql - Conexão ativa do PostgreSQL
 */
export async function runCustomFieldsMigration(sql) {
  const tenantId = 'tecfag';
  console.log(`\n============================================================`);
  console.log(`🚀 [Tecfag Custom Fields] Iniciando migração de campos e catálogos`);
  console.log(`   Tenant alvo: ${tenantId}`);
  console.log(`============================================================\n`);

  // 1. CARREGAR PLANILHA COMPRIMIDA
  const dataPath = path.join(__dirname, 'data', 'tecfag_deals.csv.gz');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Arquivo não encontrado: ${dataPath}`);
  }

  const gzBuffer = fs.readFileSync(dataPath);
  let csvText = zlib.gunzipSync(gzBuffer).toString('utf8');
  if (csvText.startsWith('sep=')) {
    csvText = csvText.replace(/^sep=[^\r\n]*\r?\n/, '');
  }

  const workbook = XLSX.read(Buffer.from(csvText, 'utf8'), { type: 'buffer', raw: true, codepage: 65001 });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`[Tecfag Custom Fields] ${rows.length} linhas lidas da planilha.`);

  // 2. DEFINIR E CRIAR CAMPOS PERSONALIZADOS (crm_custom_field_definitions)
  console.log(`[Tecfag Custom Fields] Inserindo definições de campos personalizados...`);

  const dealFieldsDefs = [
    { id: 'cf-tf-deal-sdr-qualificacao', name: 'Qualificado por SDR', col: 'QUALIFICADO POR SDR' },
    { id: 'cf-tf-deal-produto-fabricado', name: 'Qual o Produto Fabricado?', col: 'QUAL O PRODUTO FABRICADO?' },
    { id: 'cf-tf-deal-ajuda-necessaria', name: 'Onde o Cliente Precisa de Ajuda?', col: 'ONDE O CLIENTE PRECISA DE AJUDA?' },
    { id: 'cf-tf-deal-processo-atual', name: 'Como é Feito Hoje?', col: 'COMO É FEITO HOJE?' },
    { id: 'cf-tf-deal-volume-producao', name: 'Volume de Produção?', col: 'VOLUME DE PRODUÇÃO?' },
    { id: 'cf-tf-deal-expectativa-uso', name: 'Expectativa de Uso?', col: 'EXPECTATIVA DE USO?' },
    { id: 'cf-tf-deal-nivel-automacao', name: 'Nível de Automação Exigido', col: 'NÍVEL DE AUTOMAÇÃO EXIGIDO' },
    { id: 'cf-tf-deal-tipo-embalagem', name: 'Que Tipo de Embalagem?', col: 'QUE TIPO DE EMBALAGEM?' },
    { id: 'cf-tf-deal-producao-hora', name: 'Produção Desejada por Hora', col: 'PRODUÇÃO DESEJADA POR HORA' },
    { id: 'cf-tf-deal-perfil-cliente', name: 'Qual Perfil o Cliente se Encaixa?', col: 'QUAL PERFIL O CLIENTE SE ENCAIXA?' },
    { id: 'cf-tf-deal-apresentacao-proposta', name: 'Apresentação da Proposta', col: 'APRESENTAÇÃO DA PROPOSTA' },
    { id: 'cf-tf-deal-tipo-produto-cliente', name: 'Qual o Tipo de Produto do Cliente', col: 'QUAL O TIPO DE PRODUTO DO CLIENTE' },
    { id: 'cf-tf-deal-projetos-desenvolvimento', name: 'Projetos / Desenvolvimento', col: 'PROJETOS / DESENVOLVIMENTO' },
    { id: 'cf-tf-deal-info-complementares', name: 'Informações Complementares', col: 'INFORMAÇÕES COMPLEMENTARES' },
    { id: 'cf-tf-deal-escopo-validado', name: 'Escopo Validado pelo Cliente', col: 'ESCOPO VALIDADO PELO CLIENTE' },
    { id: 'cf-tf-deal-destino-projeto', name: 'Destino Final do Projeto (Auditoria CEO)', col: 'DESTINO FINAL DO PROJETO (AUDITORIA CEO)' },
    { id: 'cf-tf-deal-justificativa-movimentacao', name: 'Justificativa de Movimentação de Projeto', col: 'JUSTIFICATIVA DE MOVIMENTAÇÃO DE PROJETO' },
    { id: 'cf-tf-deal-cliente-novo', name: 'Cliente Novo?', col: 'CLIENTE NOVO?' },
    { id: 'cf-tf-deal-descricao', name: 'Descrição', col: 'DESCRIÇÃO' },
    { id: 'cf-tf-deal-feito-por', name: 'Feito Por', col: 'FEITO POR' },
    { id: 'cf-tf-deal-equipamento', name: 'Equipamento', col: 'EQUIPAMENTO' },
    { id: 'cf-tf-deal-budget', name: 'Budget', col: 'Budget' },
    { id: 'cf-tf-deal-pre-analise', name: 'Pré-Análise', col: 'PRÉ-ANÁLISE ' },
    { id: 'cf-tf-deal-proposta', name: 'Número da Proposta', col: 'PROPOSTA' },
    { id: 'cf-tf-deal-anotacao-perda', name: 'Anotação do Motivo de Perda', col: 'Anotação do motivo de perda' },
    { id: 'cf-tf-deal-equipes-responsavel', name: 'Equipes do Responsável', col: 'Equipes do responsável' },
    { id: 'cf-tf-deal-produtos', name: 'Produtos de Interesse', col: 'Produtos' },
    { id: 'cf-tf-deal-fonte', name: 'Fonte de Origem', col: 'Fonte' },
    { id: 'cf-tf-deal-campanha', name: 'Campanha de Origem', col: 'Campanha' },
  ];

  const companyFieldsDefs = [
    { id: 'cf-tf-comp-info-complementares', name: 'Informações Complementares' },
    { id: 'cf-tf-comp-cliente-novo', name: 'Cliente Novo?' },
    { id: 'cf-tf-comp-tipo-produto', name: 'Tipo de Produto do Cliente' },
    { id: 'cf-tf-comp-sdr-qualificacao', name: 'Qualificado por SDR' },
    { id: 'cf-tf-comp-rd-org-id', name: 'ID RD Station Empresa' },
    { id: 'cf-tf-comp-fonte', name: 'Fonte de Origem' },
    { id: 'cf-tf-comp-campanha', name: 'Campanha de Origem' },
  ];

  // Inserir definições para Negociações (deals)
  let orderIndex = 0;
  for (const def of dealFieldsDefs) {
    await sql`
      INSERT INTO crm_custom_field_definitions (
        id, tenant_id, entity_type, name, field_type, options, required,
        visible_on_create, all_pipelines, pipeline_ids, sort_order, created_at, updated_at
      )
      VALUES (
        ${def.id}, ${tenantId}, 'deal', ${def.name}, 'text', '[]'::jsonb, false,
        true, true, '[]'::jsonb, ${orderIndex++}, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `;
  }

  // Inserir definições para Empresas (companies)
  orderIndex = 0;
  for (const def of companyFieldsDefs) {
    await sql`
      INSERT INTO crm_custom_field_definitions (
        id, tenant_id, entity_type, name, field_type, options, required,
        visible_on_create, all_pipelines, pipeline_ids, sort_order, created_at, updated_at
      )
      VALUES (
        ${def.id}, ${tenantId}, 'company', ${def.name}, 'text', '[]'::jsonb, false,
        true, true, '[]'::jsonb, ${orderIndex++}, NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `;
  }
  console.log(`[Tecfag Custom Fields] ${dealFieldsDefs.length} campos de Negociação e ${companyFieldsDefs.length} campos de Empresa criados.`);

  // 3. CATÁLOGOS NATIVOS (crm_catalog_items & crm_catalog_policies)
  console.log(`[Tecfag Custom Fields] Sincronizando catálogos de Fontes, Campanhas e Motivos de Perda...`);

  // Políticas que permitem criação livre por consultores (segment, source, campaign)
  const policyKinds = ['source', 'campaign', 'segment'];
  for (const k of policyKinds) {
    await sql`
      INSERT INTO crm_catalog_policies (tenant_id, kind, allow_user_create, updated_at)
      VALUES (${tenantId}, ${k}, true, NOW())
      ON CONFLICT (tenant_id, kind) DO UPDATE SET allow_user_create = true, updated_at = NOW()
    `;
  }

  // Coleta única de Fontes, Campanhas e Motivos de perda
  const uniqueSources = new Set();
  const uniqueCampaigns = new Set();
  const uniqueLossReasons = new Set();

  for (const r of rows) {
    const src = (r['Fonte'] || '').trim();
    if (src && src.length <= 120) uniqueSources.add(src);

    const cmp = (r['Campanha'] || '').trim();
    if (cmp && cmp.length <= 120) uniqueCampaigns.add(cmp);

    const lss = (r['Motivo de Perda'] || '').trim();
    if (lss && lss !== 'Nada' && lss.length <= 120) uniqueLossReasons.add(lss);
  }

  for (const name of uniqueSources) {
    const id = `cat-src-tf-${slugify(name).substring(0, 40)}-${Buffer.from(name).toString('hex').substring(0, 6)}`;
    await sql`
      INSERT INTO crm_catalog_items (id, tenant_id, kind, name, created_at, updated_at)
      VALUES (${id}, ${tenantId}, 'source', ${name}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const name of uniqueCampaigns) {
    const id = `cat-cmp-tf-${slugify(name).substring(0, 40)}-${Buffer.from(name).toString('hex').substring(0, 6)}`;
    await sql`
      INSERT INTO crm_catalog_items (id, tenant_id, kind, name, created_at, updated_at)
      VALUES (${id}, ${tenantId}, 'campaign', ${name}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
  }

  for (const name of uniqueLossReasons) {
    const id = `cat-lss-tf-${slugify(name).substring(0, 40)}-${Buffer.from(name).toString('hex').substring(0, 6)}`;
    await sql`
      INSERT INTO crm_catalog_items (id, tenant_id, kind, name, created_at, updated_at)
      VALUES (${id}, ${tenantId}, 'loss_reason', ${name}, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `;
  }
  console.log(`[Tecfag Custom Fields] Catálogos inseridos: ${uniqueSources.size} Fontes, ${uniqueCampaigns.size} Campanhas, ${uniqueLossReasons.size} Motivos de Perda.`);

  // 4. ATUALIZAR NEGOCIAÇÕES (crm_deals) COM CAMPOS PERSONALIZADOS COMPLETOS
  console.log(`[Tecfag Custom Fields] Atualizando metadados e custom_fields de ${rows.length} negociações...`);

  // Montar mapa por dealId para consolidar caso o mesmo dealId apareça com múltiplos contatos
  const dealUpdatesMap = new Map();

  for (const r of rows) {
    const rdDealId = (r['ID'] || '').trim();
    if (!rdDealId) continue;
    const dealId = `deal-rd-${rdDealId}`;

    // Montar objeto de campos personalizados com os IDs oficiais
    const customFieldsObj = {};
    for (const def of dealFieldsDefs) {
      let val = r[def.col];
      // Tratamento especial para proposta (combina PROPOSTA e PROPOSTA.)
      if (def.col === 'PROPOSTA' && (!val || String(val).trim() === '')) {
        val = r['PROPOSTA.'];
      }
      if (val !== null && val !== undefined) {
        const sVal = String(val).trim();
        if (sVal !== '' && sVal !== 'null') {
          customFieldsObj[def.id] = sVal;
        }
      }
    }

    const src = (r['Fonte'] || '').trim() || 'rd_crm_import';
    const cmp = (r['Campanha'] || '').trim() || null;
    const lss = (r['Motivo de Perda'] || '').trim();
    const cleanLoss = lss && lss !== 'Nada' ? lss : null;

    if (!dealUpdatesMap.has(dealId)) {
      dealUpdatesMap.set(dealId, {
        id: dealId,
        source: src,
        campaign: cmp,
        loss_reason: cleanLoss,
        custom_fields: customFieldsObj,
      });
    } else {
      // Mesclar campos se houver preenchimento adicional
      const existing = dealUpdatesMap.get(dealId);
      Object.assign(existing.custom_fields, customFieldsObj);
      if (!existing.campaign && cmp) existing.campaign = cmp;
      if (!existing.loss_reason && cleanLoss) existing.loss_reason = cleanLoss;
    }
  }

  const dealUpdatesList = Array.from(dealUpdatesMap.values());
  console.log(`[Tecfag Custom Fields] ${dealUpdatesList.length} negociações prontas para gravação em lote.`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < dealUpdatesList.length; i += BATCH_SIZE) {
    const chunk = dealUpdatesList.slice(i, i + BATCH_SIZE);
    
    // Atualização atômica usando unnest e cast explícito
    const ids = chunk.map(d => d.id);
    const sources = chunk.map(d => d.source);
    const campaigns = chunk.map(d => d.campaign);
    const lossReasons = chunk.map(d => d.loss_reason);
    const customFieldsJson = chunk.map(d => JSON.stringify(d.custom_fields));

    await sql`
      UPDATE crm_deals AS d
      SET
        source = COALESCE(v.source, d.source),
        campaign = COALESCE(v.campaign, d.campaign),
        loss_reason = COALESCE(v.loss_reason, d.loss_reason),
        custom_fields = v.custom_fields::jsonb,
        updated_at = NOW()
      FROM (
        SELECT 
          UNNEST(${ids}::text[]) AS id,
          UNNEST(${sources}::text[]) AS source,
          UNNEST(${campaigns}::text[]) AS campaign,
          UNNEST(${lossReasons}::text[]) AS loss_reason,
          UNNEST(${customFieldsJson}::text[]) AS custom_fields
      ) AS v
      WHERE d.id = v.id AND d.tenant_id = ${tenantId}
    `;

    if ((i + BATCH_SIZE) % 2500 === 0 || i + BATCH_SIZE >= dealUpdatesList.length) {
      console.log(`[Tecfag Custom Fields] Deals atualizados: ${Math.min(i + BATCH_SIZE, dealUpdatesList.length)}/${dealUpdatesList.length}`);
    }
  }

  // 5. ATUALIZAR EMPRESAS (crm_accounts) COM CAMPOS PERSONALIZADOS
  console.log(`[Tecfag Custom Fields] Atualizando custom_fields das empresas...`);
  const accountUpdatesMap = new Map();

  for (const r of rows) {
    const rdOrgId = (r['ID da Empresa'] || '').trim();
    const orgName = (r['Empresa'] || r['Nome'] || '').trim();
    if (!rdOrgId && !orgName) continue;

    const extra = r['INFORMAÇÕES COMPLEMENTARES'] || '';
    const cleanNovo = (r['CLIENTE NOVO?'] || '').trim();
    const sdr = (r['QUALIFICADO POR SDR'] || '').trim();
    const tipoProd = (r['QUAL O TIPO DE PRODUTO DO CLIENTE'] || '').trim();
    const src = (r['Fonte'] || '').trim();
    const cmp = (r['Campanha'] || '').trim();

    const compFieldsObj = {};
    if (extra) compFieldsObj['cf-tf-comp-info-complementares'] = extra;
    if (cleanNovo) compFieldsObj['cf-tf-comp-cliente-novo'] = cleanNovo;
    if (sdr) compFieldsObj['cf-tf-comp-sdr-qualificacao'] = sdr;
    if (tipoProd) compFieldsObj['cf-tf-comp-tipo-produto'] = tipoProd;
    if (rdOrgId) compFieldsObj['cf-tf-comp-rd-org-id'] = rdOrgId;
    if (src) compFieldsObj['cf-tf-comp-fonte'] = src;
    if (cmp) compFieldsObj['cf-tf-comp-campanha'] = cmp;

    if (Object.keys(compFieldsObj).length === 0) continue;

    // Chave de agrupamento
    const accKey = rdOrgId ? `rd-${rdOrgId}` : `name-${orgName.toLowerCase()}`;
    if (!accountUpdatesMap.has(accKey)) {
      accountUpdatesMap.set(accKey, {
        rdOrgId: rdOrgId || null,
        name: orgName,
        custom_fields: compFieldsObj,
      });
    } else {
      Object.assign(accountUpdatesMap.get(accKey).custom_fields, compFieldsObj);
    }
  }

  console.log(`[Tecfag Custom Fields] ${accountUpdatesMap.size} empresas identificadas com campos para atualizar.`);

  // Atualizar por rd_organization_id
  const byRdOrg = Array.from(accountUpdatesMap.values()).filter(a => a.rdOrgId);
  for (let i = 0; i < byRdOrg.length; i += BATCH_SIZE) {
    const chunk = byRdOrg.slice(i, i + BATCH_SIZE);
    const orgIds = chunk.map(c => c.rdOrgId);
    const customFieldsJson = chunk.map(c => JSON.stringify(c.custom_fields));

    await sql`
      UPDATE crm_accounts AS a
      SET
        custom_fields = v.custom_fields::jsonb,
        updated_at = NOW()
      FROM (
        SELECT 
          UNNEST(${orgIds}::text[]) AS rd_org_id,
          UNNEST(${customFieldsJson}::text[]) AS custom_fields
      ) AS v
      WHERE a.rd_organization_id = v.rd_org_id AND a.tenant_id = ${tenantId}
    `;
  }
  console.log(`[Tecfag Custom Fields] Empresas com RD ID atualizadas.`);

  // Atualizar por nome para empresas sem rd_organization_id
  const byName = Array.from(accountUpdatesMap.values()).filter(a => !a.rdOrgId);
  for (let i = 0; i < byName.length; i += BATCH_SIZE) {
    const chunk = byName.slice(i, i + BATCH_SIZE);
    const names = chunk.map(c => c.name);
    const customFieldsJson = chunk.map(c => JSON.stringify(c.custom_fields));

    await sql`
      UPDATE crm_accounts AS a
      SET
        custom_fields = v.custom_fields::jsonb,
        updated_at = NOW()
      FROM (
        SELECT 
          UNNEST(${names}::text[]) AS name,
          UNNEST(${customFieldsJson}::text[]) AS custom_fields
      ) AS v
      WHERE LOWER(a.name) = LOWER(v.name) AND a.tenant_id = ${tenantId}
    `;
  }
  console.log(`[Tecfag Custom Fields] Empresas por nome atualizadas.`);

  console.log(`\n============================================================`);
  console.log(`✅ [Tecfag Custom Fields] Migração concluída com sucesso!`);
  console.log(`============================================================\n`);
}
