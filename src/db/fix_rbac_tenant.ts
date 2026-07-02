import postgres from "postgres";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:123@localhost:5432/valemchat";

async function main() {
  const client = postgres(connectionString, { max: 1 });
  try {
    console.log("⚙️ Iniciando script de correção de Tenant dos Operadores, Grupos e Setores...");

    // 1. Corrigir Operadores
    // Qualquer operador com email contendo @valempack.com.br ou @valem.com.br vai para o tenant 'valem'
    // Qualquer operador com email contendo @tecfag.com.br vai para o tenant 'tecfag'
    const ops = await client`SELECT id, email, name FROM operators`;
    let opsUpdated = 0;
    for (const op of ops) {
      let targetTenant: string | null = null;
      if (op.email.toLowerCase().includes("valempack") || op.email.toLowerCase().includes("valem")) {
        targetTenant = "valem";
      } else if (op.email.toLowerCase().includes("tecfag")) {
        targetTenant = "tecfag";
      }

      if (targetTenant) {
        await client`UPDATE operators SET tenant_id = ${targetTenant} WHERE id = ${op.id}`;
        console.log(`✅ Operador [${op.name}] atualizado para tenant: ${targetTenant}`);
        opsUpdated++;
      }
    }

    // 2. Corrigir Grupos de Acesso
    // Se o nome contiver Valem ou se pertencer aos operadores da Valem
    const groups = await client`SELECT id, name FROM access_groups`;
    let groupsUpdated = 0;
    for (const g of groups) {
      let targetTenant: string | null = null;
      if (g.name.toLowerCase().includes("valem") || g.name.toLowerCase().includes("sdr")) {
        targetTenant = "valem";
      } else if (g.name.toLowerCase().includes("tecfag") || g.name.toLowerCase().includes("administradores") || g.name.toLowerCase().includes("admin")) {
        targetTenant = "tecfag";
      }

      if (targetTenant) {
        await client`UPDATE access_groups SET tenant_id = ${targetTenant} WHERE id = ${g.id}`;
        console.log(`✅ Grupo de Acesso [${g.name}] atualizado para tenant: ${targetTenant}`);
        groupsUpdated++;
      }
    }

    // 3. Corrigir Setores
    // Com base no nome do setor
    const secs = await client`SELECT id, name FROM sectors`;
    let sectorsUpdated = 0;
    for (const s of secs) {
      let targetTenant: string | null = null;
      if (
        s.name.toLowerCase().includes("valem") || 
        s.name.toLowerCase() === "sdr" || 
        s.name.toLowerCase() === "comercial"
      ) {
        targetTenant = "valem";
      } else if (
        s.name.toLowerCase().includes("tecfag") || 
        s.name.toLowerCase() === "financeiro" || 
        s.name.toLowerCase() === "marketing" ||
        s.name.toLowerCase() === "faturamento" ||
        s.name.toLowerCase() === "suporte técnico"
      ) {
        targetTenant = "tecfag";
      }

      if (targetTenant) {
        await client`UPDATE sectors SET tenant_id = ${targetTenant} WHERE id = ${s.id}`;
        console.log(`✅ Setor [${s.name}] atualizado para tenant: ${targetTenant}`);
        sectorsUpdated++;
      }
    }

    console.log(`\n🎉 Correção finalizada com sucesso!`);
    console.log(`- Operadores atualizados: ${opsUpdated}`);
    console.log(`- Grupos atualizados: ${groupsUpdated}`);
    console.log(`- Setores atualizados: ${sectorsUpdated}`);
  } catch (err) {
    console.error("❌ Erro ao rodar script de correção:", err);
  } finally {
    await client.end();
  }
}

main();
