import { afterAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import postgres from "postgres";
import {
  pgContactPhoneIdentity,
  runTecfagSdrRdCrmMigration,
} from "../scripts/import-tecfag-sdr-rd-crm.mjs";

const SEED_PATH = path.resolve(
  "scripts/data/tecfag-sdr-rd-crm-2026-11-19.json.gz",
);

function loadLocalDbUrl(): string | null {
  if (fs.existsSync(".env")) {
    const raw = fs.readFileSync(".env", "utf8");
    const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (m?.[1]) {
      try {
        const u = new URL(m[1]);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
          return m[1];
        }
      } catch {}
    }
  }
  return null;
}

describe("Migração RD Station CRM — FUNIL SDR (19/11/2026)", () => {
  const payload = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(SEED_PATH)).toString("utf8"),
  );

  it("contém 3.816 negociações únicas nas 8 etapas oficiais do FUNIL SDR sem duplicatas internas", () => {
    expect(payload.tenantId).toBe("tecfag");
    expect(payload.deals.length).toBe(3816);
    expect(payload.stages.length).toBe(8);

    const dealIds = new Set(payload.deals.map((d: any) => d.id));
    const rdIds = new Set(payload.deals.map((d: any) => d.rd_deal_id));
    expect(dealIds.size).toBe(3816);
    expect(rdIds.size).toBe(3816);

    // Nenhum card perde fonte/campanha; Referência | tecfag.com.br normalizada para Tráfego Direto
    const sources = new Set(payload.deals.map((d: any) => d.source).filter(Boolean));
    expect(sources.has("Tráfego Direto")).toBe(true);
    expect(sources.has("Referência | tecfag.com.br")).toBe(false);
    expect(sources.has("(direct)")).toBe(false);

    // 125 cards de ex-colaboradores mantidos no FUNIL SDR com responsavel_original_rd preservado
    const exDeals = payload.deals.filter((d: any) => !d.operator_key);
    expect(exDeals.length).toBe(125);
    expect(exDeals.every((d: any) => Boolean(d.custom_fields?.responsavel_original_rd))).toBe(true);
  });

  it("garante zero duplicatas de CNPJ/CPF em empresas e zero duplicatas de telefone em contatos no seed", () => {
    const seenDocs = new Set<string>();
    for (const acc of payload.accounts) {
      if (acc.document) {
        const cleanDoc = String(acc.document).replace(/\D/g, "");
        expect(seenDocs.has(cleanDoc)).toBe(false);
        seenDocs.add(cleanDoc);
      }
    }

    const ownerByPhone = new Map<string, string>();
    for (const c of payload.contacts) {
      const phones = Array.isArray(c.phones) ? [...c.phones] : [];
      if (c.phone) phones.unshift({ phone: c.phone });
      for (const p of phones) {
        const idKey = pgContactPhoneIdentity(p.phone);
        if (!idKey || idKey.length < 8) continue;
        const prev = ownerByPhone.get(idKey);
        if (prev) expect(prev).toBe(c.id);
        else ownerByPhone.set(idKey, c.id);
      }
    }
  });

  const localDbUrl = loadLocalDbUrl();
  const describeDb = localDbUrl ? describe : describe.skip;

  describeDb("PostgreSQL isolado — deduplicação 2 camadas, enriquecimento não-destrutivo e idempotência", () => {
    const tenantId = `test-sdr-mig-${randomUUID().slice(0, 8)}`;
    const sql = postgres(localDbUrl!, { max: 2, prepare: false });

    afterAll(async () => {
      await sql`DELETE FROM tenants WHERE id = ${tenantId}`.catch(() => {});
      await sql.end();
    });

    it("deduplica negociações (ID RD + telefone/título), contatos e empresas, preserva edições locais e é 100% idempotente", async () => {
      // Pick 12 representative deals from real payload (including one with company + CNPJ, one with multi-contact, one ex-collab)
      const dealWithAcc = payload.deals.find(
        (d: any) => d.account_id && payload.accounts.find((a: any) => a.id === d.account_id && a.document),
      );
      const dealWithSource = payload.deals.find(
        (d: any) => d.id !== dealWithAcc?.id && d.source && d.campaign && Object.keys(d.custom_fields || {}).length > 1,
      );
      const dealForFuzzy = payload.deals.find(
        (d: any) =>
          d.id !== dealWithAcc?.id &&
          d.id !== dealWithSource?.id &&
          payload.dealContacts.some((dc: any) => dc.deal_id === d.id),
      );
      const dealExCollab = payload.deals.find((d: any) => !d.operator_key);
      const sampleDeals = [dealWithAcc, dealWithSource, dealForFuzzy, dealExCollab, ...payload.deals.slice(0, 8)]
        .filter(Boolean)
        .filter((d: any, i: number, arr: any[]) => arr.findIndex((x) => x.id === d.id) === i);
      const sampleDealIds = new Set(sampleDeals.map((d: any) => d.id));
      const sampleDealContacts = payload.dealContacts.filter((dc: any) => sampleDealIds.has(dc.deal_id));
      const sampleContactIds = new Set(sampleDealContacts.map((dc: any) => dc.contact_id));
      const sampleContacts = payload.contacts.filter((c: any) => sampleContactIds.has(c.id));
      const sampleAccountIds = new Set(
        [...sampleDeals.map((d: any) => d.account_id), ...sampleContacts.map((c: any) => c.account_id)].filter(Boolean),
      );
      const sampleAccounts = payload.accounts.filter((a: any) => sampleAccountIds.has(a.id));

      const pfx = (id: string | null | undefined) => (id ? `${tenantId}-${id}` : null);
      const miniSeedPath = path.resolve(`scripts/data/.tmp-sdr-test-${tenantId}.json.gz`);
      const miniPayload = {
        ...payload,
        tenantId,
        stages: payload.stages.map((s: any) => ({ ...s, id: pfx(s.id) })),
        accounts: sampleAccounts.map((a: any) => ({ ...a, id: pfx(a.id) })),
        contacts: sampleContacts.map((c: any) => ({
          ...c,
          id: pfx(c.id),
          account_id: pfx(c.account_id),
        })),
        deals: sampleDeals.map((d: any) => ({
          ...d,
          id: pfx(d.id),
          account_id: pfx(d.account_id),
          stage_id: pfx(d.stage_id),
        })),
        dealContacts: sampleDealContacts.map((dc: any) => ({
          ...dc,
          deal_id: pfx(dc.deal_id),
          contact_id: pfx(dc.contact_id),
        })),
      };
      fs.writeFileSync(miniSeedPath, zlib.gzipSync(Buffer.from(JSON.stringify(miniPayload), "utf8")));

      try {
        // Pre-seed tenant, CWR pipeline, SDR pipeline, existing operator, existing account (same CNPJ), existing contact (same phone without 9th digit),
        // existing moved deal (same rd_deal_id in CWR), and existing fuzzy non-RD deal in SDR
        await sql`
          INSERT INTO tenants (id, name, slug, connection_type)
          VALUES (${tenantId}, 'Teste SDR Mig', ${tenantId}, 'meta')
        `;
        const opId = `op-${tenantId}-rafaela`;
        await sql`
          INSERT INTO operators (id, tenant_id, name, email, password_hash, role, status)
          VALUES (${opId}, ${tenantId}, 'Rafaela Lima', 'apoiocomercial3@tecfag.com.br', 'test', 'agent', 'disponivel')
        `;
        const cwrPipeId = `pipe-cwr-${tenantId}`;
        const cwrStageId = `stg-cwr-atender-${tenantId}`;
        const sdrPipeId = `pipe-sdr-${tenantId}`;
        const sdrStageId = `stg-sdr-triar-${tenantId}`;
        await sql`
          INSERT INTO crm_pipelines (id, tenant_id, name, order_index, is_default, color, cooling_days)
          VALUES
            (${cwrPipeId}, ${tenantId}, 'FUNIL CWR', 0, true, '#0ea5e9', 10),
            (${sdrPipeId}, ${tenantId}, 'FUNIL SDR', 1, false, '#8b5cf6', 7)
        `;
        await sql`
          INSERT INTO crm_stages (id, tenant_id, pipeline_id, name, order_index, is_win_stage, is_loss_stage, required_fields)
          VALUES
            (${cwrStageId}, ${tenantId}, ${cwrPipeId}, 'ATENDER', 0, false, false, '[]'::jsonb),
            (${sdrStageId}, ${tenantId}, ${sdrPipeId}, 'PARA TRIAR', 0, false, false, '[]'::jsonb)
        `;

        // 1. Pre-existing company with same CNPJ as dealWithAcc's account
        const accWithDoc = sampleAccounts.find((a: any) => a.id === dealWithAcc.account_id);
        const existingAccId = `acc-existing-${tenantId}`;
        await sql`
          INSERT INTO crm_accounts (id, tenant_id, type, name, document_type, document)
          VALUES (${existingAccId}, ${tenantId}, 'company', 'Empresa Existente Local', 'CNPJ', ${accWithDoc.document})
        `;

        // 2. Pre-existing deal moved to FUNIL CWR with empty source/campaign/custom_fields (Layer 1 match by rd_deal_id)
        const existingMovedDealId = `deal-existing-cwr-${tenantId}`;
        await sql`
          INSERT INTO crm_deals (id, tenant_id, title, pipeline_id, stage_id, status, value, operator_id, rd_deal_id, source, campaign, custom_fields)
          VALUES (${existingMovedDealId}, ${tenantId}, 'Titulo Editado Localmente', ${cwrPipeId}, ${cwrStageId}, 'open', '9999.00', ${opId}, ${dealWithSource.rd_deal_id}, NULL, NULL, '{"campo_local": "preservado"}'::jsonb)
        `;

        // 3. Pre-existing contact (same phone) + non-RD deal in FUNIL SDR (Layer 2 fuzzy match)
        const fuzzyDc = sampleDealContacts.find((dc: any) => dc.deal_id === dealForFuzzy.id);
        const fuzzyContact = sampleContacts.find((c: any) => c.id === fuzzyDc.contact_id);
        const existingContactId = `cont-existing-${tenantId}`;
        await sql`
          INSERT INTO contacts (id, tenant_id, name, phone, main_channel)
          VALUES (${existingContactId}, ${tenantId}, 'Contato Existente Local', ${fuzzyContact.phone}, 'whatsapp')
        `;
        const existingFuzzyDealId = `deal-existing-fuzzy-${tenantId}`;
        await sql`
          INSERT INTO crm_deals (id, tenant_id, title, pipeline_id, stage_id, status, value, operator_id, rd_deal_id, source, campaign, custom_fields)
          VALUES (${existingFuzzyDealId}, ${tenantId}, ${dealForFuzzy.title}, ${sdrPipeId}, ${sdrStageId}, 'open', '0.00', ${opId}, NULL, 'manual', NULL, '{}'::jsonb)
        `;
        await sql`
          INSERT INTO crm_deal_contacts (id, tenant_id, deal_id, contact_id, role, is_primary)
          VALUES (${`dc-pre-${tenantId}`}, ${tenantId}, ${existingFuzzyDealId}, ${existingContactId}, 'buyer', true)
        `;

        // RUN 1
        const run1 = await runTecfagSdrRdCrmMigration(sql, { tenantId, seedPath: miniSeedPath });
        expect(run1.totalCsvDeals).toBe(sampleDeals.length);
        expect(run1.dealsMatchedByRdId).toBe(1);
        expect(run1.dealsMatchedByContactFuzzy).toBe(1);
        expect(run1.dealsInserted).toBe(sampleDeals.length - 2);
        expect(run1.accountsReused).toBeGreaterThanOrEqual(1);
        expect(run1.contactsReused).toBeGreaterThanOrEqual(1);

        // Verify Layer 1 existing moved deal was NOT overwritten in pipeline/stage/title/value, AND got enriched!
        const [movedDeal] = await sql`
          SELECT * FROM crm_deals WHERE id = ${existingMovedDealId} AND tenant_id = ${tenantId}
        `;
        expect(movedDeal.pipeline_id).toBe(cwrPipeId);
        expect(movedDeal.stage_id).toBe(cwrStageId);
        expect(movedDeal.title).toBe("Titulo Editado Localmente");
        expect(movedDeal.value).toBe("9999.00");
        expect(movedDeal.source).toBe(dealWithSource.source);
        expect(movedDeal.campaign).toBe(dealWithSource.campaign);
        expect(movedDeal.custom_fields.campo_local).toBe("preservado");

        // Verify Layer 2 fuzzy deal was NOT duplicated, linked rd_deal_id, and replaced generic 'manual' source
        const [fuzzyDeal] = await sql`
          SELECT * FROM crm_deals WHERE id = ${existingFuzzyDealId} AND tenant_id = ${tenantId}
        `;
        expect(fuzzyDeal.rd_deal_id).toBe(dealForFuzzy.rd_deal_id);
        if (dealForFuzzy.source) expect(fuzzyDeal.source).toBe(dealForFuzzy.source);

        // Verify company with same CNPJ was reused (zero duplicates)
        const accsByDoc = await sql`
          SELECT id FROM crm_accounts WHERE tenant_id = ${tenantId} AND document = ${accWithDoc.document}
        `;
        expect(accsByDoc.length).toBe(1);
        expect(accsByDoc[0].id).toBe(existingAccId);

        // Verify total deal count equals exact sampleDeals.length (ZERO duplicates!)
        const [{ count: totalDealsAfterRun1 }] = await sql`
          SELECT count(*)::int AS count FROM crm_deals WHERE tenant_id = ${tenantId}
        `;
        expect(totalDealsAfterRun1).toBe(sampleDeals.length);

        // RUN 2 (idempotency check)
        const run2 = await runTecfagSdrRdCrmMigration(sql, { tenantId, seedPath: miniSeedPath });
        expect(run2.dealsInserted).toBe(0);
        expect(run2.dealsMatchedByRdId).toBe(sampleDeals.length);
        expect(run2.accountsCreated).toBe(0);
        expect(run2.contactsCreated).toBe(0);
        expect(run2.secondaryPhonesAdded).toBe(0);

        const [{ count: totalDealsAfterRun2 }] = await sql`
          SELECT count(*)::int AS count FROM crm_deals WHERE tenant_id = ${tenantId}
        `;
        expect(totalDealsAfterRun2).toBe(sampleDeals.length);
      } finally {
        if (fs.existsSync(miniSeedPath)) fs.unlinkSync(miniSeedPath);
      }
    });
  });
});
