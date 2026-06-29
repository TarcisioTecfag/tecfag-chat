import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { tenants, channelConfigs, operators } from "./schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

async function main() {
  console.log("🌱 Iniciando o seeding do banco de dados...");
  
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    // 1. Criar Tenants
    console.log("Verificando tenants...");
    
    // Tenant Valem
    const existingValem = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, "valem"))
      .limit(1);

    if (existingValem.length === 0) {
      console.log("Inserindo tenant: valem");
      await db.insert(tenants).values({
        id: "valem",
        name: "Valem Chat",
        slug: "valem",
        connectionType: "baileys",
      });
    }

    // Tenant Tecfag
    const existingTecfag = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, "tecfag"))
      .limit(1);

    if (existingTecfag.length === 0) {
      console.log("Inserindo tenant: tecfag");
      await db.insert(tenants).values({
        id: "tecfag",
        name: "Tecfag Chat",
        slug: "tecfag",
        connectionType: "meta",
      });
    }

    // 2. Criar Configurações de Canal (Channel Configs)
    console.log("Verificando configurações de canais...");

    // Canal Valem
    const existingValemConfig = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, "valem"))
      .limit(1);

    if (existingValemConfig.length === 0) {
      console.log("Inserindo configuração de canal para: valem");
      await db.insert(channelConfigs).values({
        id: "valem-channel",
        tenantId: "valem",
        baileysSessionStatus: "disconnected",
      });
    }

    // Canal Tecfag
    const existingTecfagConfig = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, "tecfag"))
      .limit(1);

    if (existingTecfagConfig.length === 0) {
      console.log("Inserindo configuração de canal para: tecfag");
      await db.insert(channelConfigs).values({
        id: "tecfag-channel",
        tenantId: "tecfag",
        metaVerifyToken: "tecfag_verify_token",
      });
    }

    // 3. Criar Operadores Iniciais
    console.log("Verificando operadores...");

    // Operador Valem
    const existingValemOp = await db
      .select()
      .from(operators)
      .where(eq(operators.id, "valem-op"))
      .limit(1);

    if (existingValemOp.length === 0) {
      console.log("Inserindo operador inicial para: valem");
      await db.insert(operators).values({
        id: "valem-op",
        tenantId: "valem",
        name: "Fagner F. (Vendedor)",
        email: "vendedor@valem.com",
        passwordHash: "dummyhash",
        role: "agent",
        isOnline: true,
      });
    }

    // Operador Tecfag
    const existingTecfagOp = await db
      .select()
      .from(operators)
      .where(eq(operators.id, "tecfag-op"))
      .limit(1);

    if (existingTecfagOp.length === 0) {
      console.log("Inserindo operador inicial para: tecfag");
      await db.insert(operators).values({
        id: "tecfag-op",
        tenantId: "tecfag",
        name: "Tarcísio (Vendedor)",
        email: "vendedor@tecfag.com",
        passwordHash: "dummyhash",
        role: "admin",
        isOnline: true,
      });
    }

    console.log("✅ Seeding concluído com sucesso!");
  } catch (err) {
    console.error("❌ Erro durante o seeding:", err);
  } finally {
    await client.end();
  }
}

main();
