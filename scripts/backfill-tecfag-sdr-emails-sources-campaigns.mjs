import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import crypto from "node:crypto";
import postgres from "postgres";

if (typeof process.loadEnvFile === "function") {
  try {
    if (existsSync(".env")) process.loadEnvFile(".env");
  } catch {}
}

function getPhoneVariants(rawPhone) {
  if (!rawPhone) return [];
  const parts = String(rawPhone).split(/[,/;|\n]+/);
  const variants = new Set();
  for (const part of parts) {
    let digits = part.replace(/\D/g, "");
    if (digits.length < 8) continue;
    if (digits.startsWith("00") && digits.length > 11) {
      digits = digits.slice(2);
    }
    digits = digits.replace(/^0+/, "");
    if (digits.length < 8) continue;
    const local =
      digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
    variants.add(local);
    variants.add("55" + local);
    if (local.length === 11 && local[2] === "9") {
      const w = local.slice(0, 2) + local.slice(3);
      variants.add(w);
      variants.add("55" + w);
    } else if (local.length === 10) {
      const w = local.slice(0, 2) + "9" + local.slice(2);
      variants.add(w);
      variants.add("55" + w);
    }
  }
  return Array.from(variants);
}

function isGenericSource(src) {
  if (!src) return true;
  const s = String(src).trim().toLowerCase();
  return (
    s === "" ||
    s === "manual" ||
    s === "desconhecido" ||
    s === "chat" ||
    s === "whatsapp sdr (fagner)"
  );
}

export async function runTecfagSdrEmailsSourcesCampaignsBackfill(externalSql = null) {
  const databaseUrl = process.env.DATABASE_URL;
  const sql =
    externalSql ||
    postgres(databaseUrl, {
      max: 5,
      prepare: false,
      transform: { undefined: null },
    });
  const shouldClose = !externalSql;

  try {
    const gzUrl = new URL(
      "./data/tecfag-sdr-backfill-2026-11-06.json.gz",
      import.meta.url,
    );
    const jsonUrl = new URL(
      "./data/tecfag-sdr-backfill-2026-11-06.json",
      import.meta.url,
    );
    const gzPath = fileURLToPath(gzUrl);
    const jsonPath = fileURLToPath(jsonUrl);

    let payload;
    if (existsSync(gzPath)) {
      const rawBuffer = readFileSync(gzPath);
      payload = JSON.parse(gunzipSync(rawBuffer).toString("utf8"));
    } else if (existsSync(jsonPath)) {
      payload = JSON.parse(readFileSync(jsonPath, "utf8"));
    } else {
      throw new Error(
        `Arquivo de seed não encontrado: ${gzPath} nem ${jsonPath}`,
      );
    }

    const tenantId = "tecfag";
    const explicitRecords = Array.isArray(payload.explicitRecords)
      ? payload.explicitRecords
      : Array.isArray(payload.records)
        ? payload.records
        : [];
    const phoneLookup = payload.phoneLookup || {};

    let contactsUpdatedExplicit = 0;
    let contactsUpdatedByPhone = 0;
    let dealsUpdatedExplicit = 0;
    let dealsUpdatedByPhone = 0;
    let catalogSourcesInserted = 0;
    let catalogCampaignsInserted = 0;

    const distinctSources = new Set();
    const distinctCampaigns = new Set();

    await sql.begin(async (tx) => {
      // 1. Atualização direta dos Contatos (Email) pelos IDs explícitos da planilha (187 registros)
      for (const rec of explicitRecords) {
        const email = rec.email ? String(rec.email).trim().toLowerCase() : null;
        if (email && rec.contactId) {
          const res = await tx`
            UPDATE contacts
            SET email = ${email}
            WHERE tenant_id = ${tenantId}
              AND id = ${rec.contactId}
              AND (email IS NULL OR btrim(email) = '')
          `;
          contactsUpdatedExplicit += res.count || 0;
        }
        if (email && rec.dealId) {
          const resLinked = await tx`
            UPDATE contacts c
            SET email = ${email}
            FROM crm_deal_contacts dc
            WHERE c.tenant_id = ${tenantId}
              AND dc.tenant_id = ${tenantId}
              AND dc.deal_id = ${rec.dealId}
              AND dc.contact_id = c.id
              AND (c.email IS NULL OR btrim(c.email) = '')
          `;
          contactsUpdatedExplicit += resLinked.count || 0;
        }
      }

      // 2. Atualização complementar de Contatos sem Email via Telefone Normalizado (toda a base tecfag)
      if (Object.keys(phoneLookup).length > 0) {
        const contactsMissingEmail = await tx`
          SELECT id, phone
          FROM contacts
          WHERE tenant_id = ${tenantId}
            AND (email IS NULL OR btrim(email) = '')
            AND phone IS NOT NULL
            AND btrim(phone) <> ''
        `;

        for (const c of contactsMissingEmail) {
          const variants = getPhoneVariants(c.phone);
          let matchedEmail = null;
          for (const v of variants) {
            if (phoneLookup[v]?.email) {
              matchedEmail = String(phoneLookup[v].email).trim().toLowerCase();
              break;
            }
          }
          if (matchedEmail) {
            const res = await tx`
              UPDATE contacts
              SET email = ${matchedEmail}
              WHERE tenant_id = ${tenantId}
                AND id = ${c.id}
                AND (email IS NULL OR btrim(email) = '')
            `;
            contactsUpdatedByPhone += res.count || 0;
          }
        }
      }

      // 3. Atualização direta das Negociações (Fonte e Campanha) pelos IDs explícitos da planilha
      for (const rec of explicitRecords) {
        if (!rec.dealId) continue;
        const newSource =
          rec.source && String(rec.source).trim() !== "manual"
            ? String(rec.source).trim()
            : null;
        const newCampaign = rec.campaign ? String(rec.campaign).trim() : null;

        if (newSource) distinctSources.add(newSource);
        if (newCampaign) distinctCampaigns.add(newCampaign);

        if (!newSource && !newCampaign) continue;

        const [curDeal] = await tx`
          SELECT id, source, campaign
          FROM crm_deals
          WHERE tenant_id = ${tenantId}
            AND id = ${rec.dealId}
          LIMIT 1
        `;
        if (!curDeal) continue;

        const shouldUpdateSource =
          newSource &&
          (isGenericSource(curDeal.source) ||
            (curDeal.source === "Desconhecido" && newSource !== "Desconhecido"));
        const shouldUpdateCampaign =
          newCampaign &&
          (!curDeal.campaign || String(curDeal.campaign).trim() === "");

        if (shouldUpdateSource || shouldUpdateCampaign) {
          const finalSource = shouldUpdateSource ? newSource : curDeal.source;
          const finalCampaign = shouldUpdateCampaign
            ? newCampaign
            : curDeal.campaign;
          const res = await tx`
            UPDATE crm_deals
            SET source = ${finalSource},
                campaign = ${finalCampaign},
                updated_at = NOW()
            WHERE tenant_id = ${tenantId}
              AND id = ${rec.dealId}
          `;
          dealsUpdatedExplicit += res.count || 0;
        }
      }

      // 4. Atualização complementar de Negociações sem Fonte/Campanha via Telefone do Contato Vinculado
      if (Object.keys(phoneLookup).length > 0) {
        const dealsMissingInfo = await tx`
          SELECT d.id, d.source, d.campaign, c.phone
          FROM crm_deals d
          JOIN crm_deal_contacts dc
            ON dc.deal_id = d.id AND dc.tenant_id = d.tenant_id
          JOIN contacts c
            ON c.id = dc.contact_id AND c.tenant_id = d.tenant_id
          WHERE d.tenant_id = ${tenantId}
            AND c.phone IS NOT NULL
            AND (
              d.source IS NULL
              OR btrim(d.source) = ''
              OR d.source IN ('manual', 'Desconhecido', 'chat', 'WhatsApp SDR (Fagner)')
              OR d.campaign IS NULL
              OR btrim(d.campaign) = ''
            )
        `;

        for (const d of dealsMissingInfo) {
          const variants = getPhoneVariants(d.phone);
          let matchedSource = null;
          let matchedCampaign = null;
          for (const v of variants) {
            const info = phoneLookup[v];
            if (info) {
              if (!matchedSource && info.source && info.source !== "manual") {
                matchedSource = String(info.source).trim();
              }
              if (!matchedCampaign && info.campaign) {
                matchedCampaign = String(info.campaign).trim();
              }
            }
          }

          const shouldUpdateSource =
            matchedSource &&
            (isGenericSource(d.source) ||
              (d.source === "Desconhecido" && matchedSource !== "Desconhecido")) &&
            matchedSource !== d.source;
          const shouldUpdateCampaign =
            matchedCampaign &&
            (!d.campaign || String(d.campaign).trim() === "");

          if (shouldUpdateSource || shouldUpdateCampaign) {
            const finalSource = shouldUpdateSource ? matchedSource : d.source;
            const finalCampaign = shouldUpdateCampaign
              ? matchedCampaign
              : d.campaign;
            if (finalSource) distinctSources.add(finalSource);
            if (finalCampaign) distinctCampaigns.add(finalCampaign);

            const res = await tx`
              UPDATE crm_deals
              SET source = ${finalSource},
                  campaign = ${finalCampaign},
                  updated_at = NOW()
              WHERE tenant_id = ${tenantId}
                AND id = ${d.id}
            `;
            dealsUpdatedByPhone += res.count || 0;
          }
        }
      }

      // 5. Garantir que todas as Fontes e Campanhas utilizadas existam em crm_catalog_items
      const existingCatalog = await tx`
        SELECT kind, lower(btrim(name)) AS norm_name
        FROM crm_catalog_items
        WHERE tenant_id = ${tenantId}
          AND kind IN ('source', 'campaign')
      `;
      const existingSourceNames = new Set(
        existingCatalog
          .filter((r) => r.kind === "source")
          .map((r) => r.norm_name),
      );
      const existingCampaignNames = new Set(
        existingCatalog
          .filter((r) => r.kind === "campaign")
          .map((r) => r.norm_name),
      );

      for (const src of distinctSources) {
        const norm = src.toLowerCase().trim();
        if (!norm || existingSourceNames.has(norm)) continue;
        existingSourceNames.add(norm);
        await tx`
          INSERT INTO crm_catalog_items (
            id, tenant_id, kind, name, description, all_pipelines, pipeline_ids, stage_ids, created_at, updated_at
          ) VALUES (
            ${`cat-${crypto.randomUUID()}`},
            ${tenantId},
            'source',
            ${src},
            'Importado via pareamento RD Station',
            true,
            '[]'::jsonb,
            '[]'::jsonb,
            NOW(),
            NOW()
          )
        `;
        catalogSourcesInserted++;
      }

      for (const camp of distinctCampaigns) {
        const norm = camp.toLowerCase().trim();
        if (!norm || existingCampaignNames.has(norm)) continue;
        existingCampaignNames.add(norm);
        await tx`
          INSERT INTO crm_catalog_items (
            id, tenant_id, kind, name, description, all_pipelines, pipeline_ids, stage_ids, created_at, updated_at
          ) VALUES (
            ${`cat-${crypto.randomUUID()}`},
            ${tenantId},
            'campaign',
            ${camp},
            'Importado via pareamento RD Station',
            true,
            '[]'::jsonb,
            '[]'::jsonb,
            NOW(),
            NOW()
          )
        `;
        catalogCampaignsInserted++;
      }
    });

    return {
      tenantId,
      explicitRecordsCount: explicitRecords.length,
      phoneLookupKeysCount: Object.keys(phoneLookup).length,
      contactsUpdatedExplicit,
      contactsUpdatedByPhone,
      totalContactsUpdated: contactsUpdatedExplicit + contactsUpdatedByPhone,
      dealsUpdatedExplicit,
      dealsUpdatedByPhone,
      totalDealsUpdated: dealsUpdatedExplicit + dealsUpdatedByPhone,
      catalogSourcesInserted,
      catalogCampaignsInserted,
    };
  } finally {
    if (shouldClose) {
      await sql.end();
    }
  }
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("backfill-tecfag-sdr-emails-sources-campaigns.mjs")
) {
  runTecfagSdrEmailsSourcesCampaignsBackfill()
    .then((res) => {
      console.log("Resultado do backfill:", JSON.stringify(res, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erro no backfill:", err);
      process.exit(1);
    });
}
