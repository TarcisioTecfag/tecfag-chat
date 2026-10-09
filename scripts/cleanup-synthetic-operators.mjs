import postgres from "postgres";

export const explicitOverrides = {
  "op-tf-tarcisio.pereira": "38306207-265e-4cd1-b702-a78805526b94",
  "op-tf-rosenvaldo.lucas.121": "op-1791376812068", // Lucas Rosenvaldo
  "op-tf-roseli.recepcao": "op-1791376365982", // Roseli Costa
  "op-tf-deborah.alves.94": "op-1791377124750", // Déborah Rayane
  "op-tf-diana.gimenes.93": "op-1791376744668", // Diana Vieira
  "op-tf-jessica": "op-1791376520586", // Jessica Pimentel
};

function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSyntheticRemapping(realOps, syntheticOps) {
  const tarcisio = realOps.find(o => 
    o.id === "38306207-265e-4cd1-b702-a78805526b94" || 
    (o.email && o.email.toLowerCase().includes("suporte2@tecfag.com.br")) ||
    (o.name && o.name.toLowerCase().includes("tarcisio"))
  );
  const fallbackOp = tarcisio || realOps[0] || { id: "38306207-265e-4cd1-b702-a78805526b94", name: "Tarcisio Pereira" };

  const remapping = new Map();

  for (const syn of syntheticOps) {
    if (explicitOverrides[syn.id]) {
      const match = realOps.find(r => r.id === explicitOverrides[syn.id]);
      if (match) {
        remapping.set(syn.id, match);
        continue;
      }
    }

    const cleanName = norm(syn.name).replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim();

    // 1. Match exato por nome normalizado limpo
    let matched = realOps.find(r => norm(r.name) === cleanName);

    // 2. Match por primeiro e último nome
    if (!matched) {
      const parts = cleanName.split(" ").filter(p => p.length > 2);
      if (parts.length >= 2) {
        matched = realOps.find(r => {
          const rParts = norm(r.name).split(" ").filter(p => p.length > 2);
          return parts[0] === rParts[0] && parts[parts.length - 1] === rParts[rParts.length - 1];
        });
      }
    }

    // 3. Fallback estrito para Tarcísio Pereira
    remapping.set(syn.id, matched || fallbackOp);
  }

  return { remapping, fallbackOp };
}

export async function cleanupSyntheticOperators(sql) {
  const tenantId = "tecfag";
  console.log(`[cleanup-operators] Iniciando auditoria e limpeza de operadores sintéticos para tenant '${tenantId}'...`);

  const allOps = await sql`
    SELECT id, name, email, role FROM operators WHERE tenant_id = ${tenantId}
  `;

  const realOps = allOps.filter(o => !o.id.startsWith("op-tf-"));
  const syntheticOps = allOps.filter(o => o.id.startsWith("op-tf-"));

  console.log(`[cleanup-operators] Operadores reais encontrados: ${realOps.length}`);
  console.log(`[cleanup-operators] Operadores sintéticos encontrados: ${syntheticOps.length}`);

  if (syntheticOps.length === 0) {
    console.log(`[cleanup-operators] Nenhum operador sintético encontrado. Banco já higienizado.`);
    return {
      success: true,
      syntheticDeleted: 0,
      remainingOperators: realOps.length,
      dealsRemapped: 0,
      contactsRemapped: 0,
    };
  }

  const { remapping, fallbackOp } = buildSyntheticRemapping(realOps, syntheticOps);

  for (const [sId, target] of remapping.entries()) {
    console.log(`[cleanup-operators] [${sId}] -> [${target.id}] "${target.name}"`);
  }

  let totalDealsRemapped = 0;
  let totalContactsRemapped = 0;

  await sql.begin(async (tx) => {
    for (const [sourceId, target] of remapping.entries()) {
      const targetId = target.id;

      const dealRes = await tx`
        UPDATE crm_deals 
        SET operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
      `;
      totalDealsRemapped += dealRes.count;

      const contactRes = await tx`
        UPDATE contacts 
        SET wallet_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND wallet_operator_id = ${sourceId}
      `;
      totalContactsRemapped += contactRes.count;

      await tx`
        UPDATE crm_deal_activities 
        SET operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
      `;
      await tx`
        UPDATE crm_deal_activities 
        SET assigned_to_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND assigned_to_operator_id = ${sourceId}
      `;
      await tx`
        UPDATE crm_activity_messages 
        SET marked_by_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND marked_by_operator_id = ${sourceId}
      `;

      await tx`
        UPDATE crm_deal_events 
        SET operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
      `;

      await tx`
        UPDATE crm_contact_account_history 
        SET changed_by_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND changed_by_operator_id = ${sourceId}
      `;
      await tx`
        UPDATE crm_account_conversations 
        SET created_by_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND created_by_operator_id = ${sourceId}
      `;
      await tx`
        UPDATE crm_conversation_deals 
        SET created_by_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND created_by_operator_id = ${sourceId}
      `;
      await tx`
        UPDATE crm_conversation_deals 
        SET unlinked_by_operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND unlinked_by_operator_id = ${sourceId}
      `;
      await tx`
        UPDATE crm_action_history 
        SET operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
      `;
      await tx`
        UPDATE conversations 
        SET operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
      `;
      await tx`
        UPDATE internal_messages 
        SET operator_id = ${targetId} 
        WHERE tenant_id = ${tenantId} AND operator_id = ${sourceId}
      `;
    }

    // Deletar os operadores sintéticos definitivamente
    const deleteRes = await tx`
      DELETE FROM operators 
      WHERE tenant_id = ${tenantId} AND id LIKE 'op-tf-%'
    `;
    console.log(`[cleanup-operators] Operadores sintéticos removidos da tabela operators: ${deleteRes.count}`);

    // Registrar migração
    await tx`
      INSERT INTO app_deploy_migrations (name, applied_at)
      VALUES ('0034_cleanup_synthetic_operators', NOW())
      ON CONFLICT (name) DO UPDATE SET applied_at = NOW()
    `;
  });

  const [remainingOps] = await sql`
    SELECT count(*)::int as count FROM operators WHERE tenant_id = ${tenantId}
  `;
  console.log(`[cleanup-operators] Limpeza concluída com sucesso! Restam ${remainingOps.count} operadores legítimos.`);

  return {
    success: true,
    syntheticDeleted: syntheticOps.length,
    remainingOperators: remainingOps.count,
    dealsRemapped: totalDealsRemapped,
    contactsRemapped: totalContactsRemapped,
  };
}

if (process.argv[1] && process.argv[1].endsWith("cleanup-synthetic-operators.mjs")) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL não configurada.");
    process.exit(1);
  }
  const sql = postgres(dbUrl, { max: 5, prepare: false });
  cleanupSyntheticOperators(sql)
    .then((res) => {
      console.log("Resultado:", res);
      return sql.end();
    })
    .catch((err) => {
      console.error("Erro na limpeza:", err);
      process.exit(1);
    });
}
