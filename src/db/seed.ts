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

    // Operador 1
    const existingOp1 = await db.select().from(operators).where(eq(operators.id, "op-1")).limit(1);
    if (existingOp1.length === 0) {
      console.log("Inserindo operador: op-1");
      await db.insert(operators).values({
        id: "op-1",
        tenantId: "tecfag",
        name: "Fagner F. (Admin)",
        email: "fagner@tecfag.com.br",
        passwordHash: "123456",
        role: "admin",
        avatar: "https://i.pravatar.cc/80?img=12",
        status: "disponivel",
        groupId: "group-admin",
        isOnline: true,
      });
    }

    // Operador 2
    const existingOp2 = await db.select().from(operators).where(eq(operators.id, "op-2")).limit(1);
    if (existingOp2.length === 0) {
      console.log("Inserindo operador: op-2");
      await db.insert(operators).values({
        id: "op-2",
        tenantId: "valem",
        name: "Tarcísio (Valem)",
        email: "tarcisio@valem.com.br",
        passwordHash: "123456",
        role: "agent",
        avatar: "https://i.pravatar.cc/80?img=60",
        status: "disponivel",
        groupId: "group-valem-comercial",
        isOnline: true,
      });
    }

    // Operador 3
    const existingOp3 = await db.select().from(operators).where(eq(operators.id, "op-3")).limit(1);
    if (existingOp3.length === 0) {
      console.log("Inserindo operador: op-3");
      await db.insert(operators).values({
        id: "op-3",
        tenantId: "tecfag",
        name: "Pedro (Tecfag)",
        email: "pedro@tecfag.com.br",
        passwordHash: "123456",
        role: "agent",
        avatar: "https://i.pravatar.cc/80?img=33",
        status: "disponivel",
        groupId: "group-tecfag-vendedor",
        isOnline: true,
      });
    }

    // Operador 4
    const existingOp4 = await db.select().from(operators).where(eq(operators.id, "op-4")).limit(1);
    if (existingOp4.length === 0) {
      console.log("Inserindo operador: op-4");
      await db.insert(operators).values({
        id: "op-4",
        tenantId: "valem",
        name: "Julia (Whats Only)",
        email: "julia@valem.com.br",
        passwordHash: "123456",
        role: "agent",
        avatar: "https://i.pravatar.cc/80?img=47",
        status: "disponivel",
        groupId: "group-whats-only",
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
