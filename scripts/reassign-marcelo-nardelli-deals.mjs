import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Carrega .env se existir
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

export const MARCELO_RD_DEAL_IDS = [
  "6ac7ed3067e65000299abecd",
  "6aad31381f646c0027701b18",
  "6aac4cd30f3a8f00266d5454",
  "6aaaef4472f16e0024bedd9d",
  "6a9ac449ec62d7002010e765",
  "6a99ae2634e4390022f53c37",
  "6a95cdfaba989e0029f6b7d2",
  "6a8c6558d995e6000116476f",
  "6a89971b676b070001c3deac",
  "6a84c2a11b24ec0020399790",
  "6a83a871ba6a99002ac4382c",
  "6a803c05098b3000017f9c92",
  "6a7f7db4eba9a200204847ef",
  "6a79ef221a3a020025387dd9",
  "6a70d4b942d6be00202b6968",
  "6a67b784390b71000144c367",
  "6a6569c654ac050001ae16d5",
  "6a60b5dd7e46f600014406d4",
  "6a483de3c5aee60001eddedd",
  "6a42e46ce37f1c00014ac646",
  "6a42d186fb341b000185897c",
  "6a4294223e50b00001e47b59",
  "6a424cc28bd69800016538aa",
  "6a423be8ff3ccd0001a25cb4",
  "6a3c2799424bbe00015a83af",
  "6a3c2796424bbe00015a82e0",
  "6a3c2792424bbe00015a8226",
  "6a3c2790424bbe00015a81cc",
  "6a3c276f424bbe00015a7c8a",
  "6a3c26f8424bbe00015a64cb",
  "6a3c26f1424bbe00015a633c",
  "6a3c268d424bbe00015a492e",
  "6a3c2686424bbe00015a4676",
  "6a3c2654424bbe00015a3b8f",
  "6a3147e47ed4470001a43087",
  "6a3147cb7ed4470001a42d24",
  "6a303ff77bc304000146f2b3",
  "69df8aa9b47a610013ab2cea",
  "69d53e683439f5000188de53",
  "69b42bacefe2310013e420e4",
  "69b41e60978d010013d0e75a",
  "69b18af7144cac0015fa8e1c",
  "69b1883584304d0013a6a435",
  "69b17b1884304d0013a69987",
  "69b16d30bd2202001bd96b5f",
  "69aeedeeddc7e1000110af7c",
  "69a1984b614e45001312554a",
  "6996064509097100166f5a37",
  "698a47b45d958e00131b5e07",
  "694a8b53bddc35001a438608",
  "699876d8c62f76001357f84b",
  "694a98eb071c75001740d6cd",
  "6a3147c57ed4470001a42c74",
  "6a3147e37ed4470001a43062",
  "6a430488d22c51000104fbfb",
  "6a3147e67ed4470001a430bc",
  "6a3147f97ed4470001a4335f",
  "6a3c2792424bbe00015a8206",
  "6a3c2664424bbe00015a3ec1",
  "6a3c2655424bbe00015a3bd6",
  "6a3c2685424bbe00015a45ff",
  "6a3c2693424bbe00015a4a89",
  "6a3147f87ed4470001a4333b",
  "6a7a26748096420025a4e5da",
  "6a8e3f696748920001f41329",
  "69b8328b0d62cc0021328e8a",
  "69b184c6e648e100161e34ff",
  "69a5e4ca639c300013f5319c",
  "69a5e2a1bb946b001ee15c68",
  "69a5dcbda885e7001d75aafa",
  "69a5d923179297001b1fb5aa",
  "69a5d46883e1d70017361686",
  "69a5d14539414a002203f924",
  "69a5a585fe00ea0013b98907",
  "69a5a18a59b68e001c27c6b5",
  "69a203c72e859900137875c2",
  "69a2000564d7210017826e2e",
  "69a1fa3147d175001356494f",
  "69a1f2b6c12d570013c57cef",
  "6998a633888b99001554cbc8",
  "6998a02d716ddc00144a7459",
  "699871463217df001cd0abf7",
  "69986dabd6ccdb0017cec91d",
  "698e7eb26577e90019380085",
  "6968d91c13ddc900135dbfb4",
  "694ad724ffdde6001d34b346",
  "694ad43a40dad100162564bc",
  "694ace51d9a5fa0013f33817",
  "694aa100fb92f10013d6fc70",
  "694a87726a93500021d76480",
  "69499dea2dec3f001b3d35c0",
  "694998f23e76e300139d8cda",
  "69499197c12fb3001de9fe3e",
  "69987ba4b194110016402517",
  "6a3c2787424bbe00015a800b",
  "6a3c2732424bbe00015a728b",
  "6a3c2725424bbe00015a70d2",
  "6a3c26a2424bbe00015a4f81",
  "6a3c2678424bbe00015a420b",
  "6a4d47ea257ce100241fa9a6",
  "6a3c2771424bbe00015a7cc9",
  "69f3acaf748d040013be1289",
  "6949a37fe5ab53001c467191",
  "693955bcbddb18001c64762c",
  "699608a054d13b001692d37d",
  "6a281649bc6c300022ced32a"
];

export async function reassignMarceloNardelliDeals(externalSql = null) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!externalSql && !databaseUrl) {
    throw new Error("[reassign-marcelo] DATABASE_URL não configurada.");
  }

  const sql = externalSql || postgres(databaseUrl, { max: 5, prepare: false });
  const shouldClose = !externalSql;
  const tenantId = "tecfag";

  try {
    console.log(`[reassign-marcelo] Iniciando reatribuição das negociações de Marcelo Nardelli (tenant '${tenantId}')...`);

    // 1. Localizar operador Marcelo Nardelli
    const [marceloOp] = await sql`
      SELECT id, name, email, role 
      FROM operators 
      WHERE tenant_id = ${tenantId}
        AND (
          id = 'op-1791376825772'
          OR email = 'vendas17@tecfag.com.br'
          OR LOWER(name) LIKE '%marcelo nardelli%'
        )
      LIMIT 1
    `;

    if (!marceloOp) {
      throw new Error(`[reassign-marcelo] Operador Marcelo Nardelli não encontrado na tabela operators do tenant '${tenantId}'!`);
    }

    console.log(`[reassign-marcelo] Operador destino confirmado: [${marceloOp.id}] "${marceloOp.name}" (${marceloOp.email})`);

    const rawIds = MARCELO_RD_DEAL_IDS;
    const formattedIds = rawIds.map(id => `deal-rd-${id}`);
    const allDealLookupIds = [...rawIds, ...formattedIds];

    let result = {
      success: true,
      operator: {
        id: marceloOp.id,
        name: marceloOp.name,
        email: marceloOp.email,
      },
      dealsCountTarget: rawIds.length,
      dealsUpdated: 0,
      contactsUpdated: 0,
      activitiesUpdated: 0,
      eventsUpdated: 0,
      actionHistoryUpdated: 0,
    };

    await sql.begin(async (tx) => {
      // 2. Atualizar crm_deals
      const dealRes = await tx`
        UPDATE crm_deals
        SET operator_id = ${marceloOp.id},
            updated_at = NOW()
        WHERE tenant_id = ${tenantId}
          AND (
            id = ANY(${allDealLookupIds})
            OR rd_deal_id = ANY(${rawIds})
          )
      `;
      result.dealsUpdated = dealRes.count;
      console.log(`[reassign-marcelo] crm_deals atualizados: ${dealRes.count}`);

      // 3. Atualizar contatos associados aos deals de Marcelo (somente os que estavam atribuídos ao Tarcísio)
      const contactRes = await tx`
        UPDATE contacts
        SET wallet_operator_id = ${marceloOp.id},
            responsible_name = ${marceloOp.name}
        WHERE tenant_id = ${tenantId}
          AND (
            wallet_operator_id = '38306207-265e-4cd1-b702-a78805526b94'
            OR wallet_operator_id IS NULL
          )
          AND (
            rd_crm_deal_id = ANY(${rawIds})
            OR id IN (
              SELECT contact_id FROM crm_deal_contacts
              WHERE tenant_id = ${tenantId}
                AND deal_id = ANY(${allDealLookupIds})
            )
          )
      `;
      result.contactsUpdated = contactRes.count;
      console.log(`[reassign-marcelo] contacts atualizados: ${contactRes.count}`);

      // 4. Atualizar atividades vinculadas
      const actRes = await tx`
        UPDATE crm_deal_activities
        SET operator_id = ${marceloOp.id},
            assigned_to_operator_id = ${marceloOp.id}
        WHERE tenant_id = ${tenantId}
          AND deal_id = ANY(${allDealLookupIds})
      `;
      result.activitiesUpdated = actRes.count;

      // 5. Atualizar eventos vinculados
      const evRes = await tx`
        UPDATE crm_deal_events
        SET operator_id = ${marceloOp.id}
        WHERE tenant_id = ${tenantId}
          AND deal_id = ANY(${allDealLookupIds})
      `;
      result.eventsUpdated = evRes.count;

      // 6. Atualizar histórico de ações
      const histRes = await tx`
        UPDATE crm_action_history
        SET operator_id = ${marceloOp.id}
        WHERE tenant_id = ${tenantId}
          AND deal_id = ANY(${allDealLookupIds})
      `;
      result.actionHistoryUpdated = histRes.count;

      // 7. Registrar migração no app_deploy_migrations
      await tx`
        INSERT INTO app_deploy_migrations (name, applied_at)
        VALUES ('0035_reassign_marcelo_nardelli_deals', NOW())
        ON CONFLICT (name) DO UPDATE SET applied_at = NOW()
      `;
    });

    console.log(`[reassign-marcelo] Concluído com sucesso!`, result);
    return result;
  } finally {
    if (shouldClose) {
      await sql.end();
    }
  }
}

// Execução standalone se chamado diretamente
if (process.argv[1] && process.argv[1].endsWith("reassign-marcelo-nardelli-deals.mjs")) {
  reassignMarceloNardelliDeals()
    .then((r) => {
      console.log("Resultado final:", JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erro fatal:", err);
      process.exit(1);
    });
}
