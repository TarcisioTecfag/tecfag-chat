import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { tenants, channelConfigs, operators, accessGroups, sectors, quickResponses, contacts, conversations, messages } from "./schema";
import { eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/valemchat";

async function main() {
  console.log("🌱 Iniciando o seeding do banco de dados...");
  
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  try {
    // Migração em tempo de execução: garante a coluna responsible_name no banco (local e Railway)
    console.log("🔍 Verificando/Criando coluna responsible_name...");
    await client`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS responsible_name text DEFAULT 'Na Fila' NOT NULL;`;
    
    // Se o banco já possuir operadores, não rodar seeding para evitar recriação de registros deletados
    const allOps = await db.select().from(operators).limit(1);
    if (allOps.length > 0) {
      console.log("🌱 Banco de dados já possui operadores. Pulando seeding.");
      return;
    }

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

    // 1.5. Criar Grupos de Acesso (RBAC)
    console.log("Verificando grupos de acesso...");
    
    const defaultGroups = [
      {
        id: "group-admin",
        tenantId: "tecfag",
        name: "Administradores",
        allowedTenants: ["tecfag", "valem"],
        allowedChannels: ["whatsapp", "instagram", "messenger"],
        canCreateUser: true,
        canResetPassword: true,
        canEditProfile: true,
      },
      {
        id: "group-valem-comercial",
        tenantId: "valem",
        name: "Valem Comercial",
        allowedTenants: ["valem"],
        allowedChannels: ["whatsapp", "instagram", "messenger"],
        canCreateUser: true,
        canResetPassword: true,
        canEditProfile: true,
      },
      {
        id: "group-tecfag-vendedor",
        tenantId: "tecfag",
        name: "Tecfag Vendedores",
        allowedTenants: ["tecfag"],
        allowedChannels: ["whatsapp", "instagram", "messenger"],
        canCreateUser: false,
        canResetPassword: false,
        canEditProfile: true,
      },
      {
        id: "group-whats-only",
        tenantId: "valem",
        name: "Vendedores WhatsApp Only",
        allowedTenants: ["tecfag", "valem"],
        allowedChannels: ["whatsapp"],
        canCreateUser: false,
        canResetPassword: false,
        canEditProfile: true,
      },
    ];

    for (const group of defaultGroups) {
      const existingGroup = await db.select().from(accessGroups).where(eq(accessGroups.id, group.id)).limit(1);
      if (existingGroup.length === 0) {
        console.log(`Inserindo grupo de acesso: ${group.id}`);
        await db.insert(accessGroups).values(group);
      }
    }

    // 1.6. Criar Setores (Sectors)
    console.log("Verificando setores...");
    
    const defaultSectors = [
      { id: "sec-1", tenantId: "valem", name: "Comercial Valem", operatorIds: ["op-2"] },
      { id: "sec-2", tenantId: "tecfag", name: "Comercial Tecfag", operatorIds: ["op-3"] },
      { id: "sec-3", tenantId: "tecfag", name: "Faturamento", operatorIds: ["op-1"] },
      { id: "sec-4", tenantId: "tecfag", name: "Suporte Técnico", operatorIds: ["op-1", "op-2"] },
      { id: "sec-5", tenantId: "tecfag", name: "Financeiro", operatorIds: ["op-1"] },
    ];

    for (const sec of defaultSectors) {
      const existingSec = await db.select().from(sectors).where(eq(sectors.id, sec.id)).limit(1);
      if (existingSec.length === 0) {
        console.log(`Inserindo setor: ${sec.id}`);
        await db.insert(sectors).values(sec);
      }
    }

    // 1.7. Criar Respostas Rápidas (Quick Responses)
    console.log("Verificando respostas rápidas...");
    
    const defaultQrs = [
      {
        id: "qr-1",
        tenantId: "tecfag",
        shortcut: "/saudacao",
        text: "Olá! Tudo bem? Me chamo Fagner, consultor de atendimento. Como posso te ajudar hoje?",
        description: "Saudação inicial padrão",
      },
      {
        id: "qr-2",
        tenantId: "tecfag",
        shortcut: "/cnpj",
        text: "Para que eu possa cadastrar sua oportunidade e verificar condições de faturamento, você poderia me informar o CNPJ da sua empresa, por favor?",
        description: "Solicitação de CNPJ",
      },
      {
        id: "qr-3",
        tenantId: "tecfag",
        shortcut: "/dados_bancarios",
        text: "Claro! Seguem nossos dados para faturamento: PIX CNPJ: 12.345.678/0001-90 (Valem Chat & Tecfag Comércio Ltda) | Banco do Brasil, Agência: 3122-1, Conta: 44532-9.",
        description: "Dados bancários para pagamento",
      },
      {
        id: "qr-4",
        tenantId: "tecfag",
        shortcut: "/suporte",
        text: "Compreendo a situação. Vou transferir este atendimento para a nossa equipe técnica especializada. Só um momento, por favor.",
        description: "Transferência para suporte técnico",
      },
      {
        id: "qr-5",
        tenantId: "valem",
        shortcut: "/saudacao",
        text: "Olá! Tudo bem? Me chamo Tarcísio, consultor de atendimento Valem. Como posso te ajudar hoje?",
        description: "Saudação inicial padrão",
      },
      {
        id: "qr-6",
        tenantId: "valem",
        shortcut: "/cnpj",
        text: "Para prosseguirmos com seu pedido Valem, você poderia nos informar o CNPJ faturamento, por favor?",
        description: "Solicitação de CNPJ",
      },
      {
        id: "qr-7",
        tenantId: "valem",
        shortcut: "/dados_bancarios",
        text: "Dados para depósito Valem: PIX CNPJ: 98.765.432/0001-10 (Valem Embaladoras S.A.).",
        description: "Dados bancários para pagamento",
      },
    ];

    for (const qr of defaultQrs) {
      const existingQr = await db.select().from(quickResponses).where(eq(quickResponses.id, qr.id)).limit(1);
      if (existingQr.length === 0) {
        console.log(`Inserindo resposta rápida: ${qr.id}`);
        await db.insert(quickResponses).values(qr);
      }
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

    // 4. Criar Contatos e Conversas Iniciais para Teste
    console.log("Verificando contatos de teste...");

    const defaultContacts = [
      {
        id: "cont-1",
        tenantId: "tecfag",
        name: "Pedro Silva",
        phone: "5511981234567",
        mainChannel: "whatsapp",
      },
      {
        id: "cont-2",
        tenantId: "tecfag",
        name: "Mariana Souza",
        phone: "5511999998888",
        mainChannel: "instagram",
      },
      {
        id: "cont-3",
        tenantId: "valem",
        name: "Tarcísio Júnior",
        phone: "5581998765432",
        mainChannel: "whatsapp",
      },
      {
        id: "cont-4",
        tenantId: "valem",
        name: "Metalúrgica Recife",
        phone: "558134445555",
        mainChannel: "whatsapp",
      },
    ];

    for (const c of defaultContacts) {
      const existingContact = await db.select().from(contacts).where(eq(contacts.id, c.id)).limit(1);
      if (existingContact.length === 0) {
        console.log(`Inserindo contato: ${c.id}`);
        await db.insert(contacts).values(c);
      }
    }

    console.log("Verificando conversas de teste...");
    const defaultConversations = [
      {
        id: "tec-1",
        tenantId: "tecfag",
        contactId: "cont-1",
        operatorId: "op-1",
        queueState: "meus",
        lastMessageText: "Cerca de 2000 sacos por dia.",
        lastMessageTime: new Date(),
      },
      {
        id: "tec-2",
        tenantId: "tecfag",
        contactId: "cont-2",
        operatorId: "op-3",
        queueState: "meus",
        lastMessageText: "Qual a largura da sua seladora?",
        lastMessageTime: new Date(),
      },
      {
        id: "val-1",
        tenantId: "valem",
        contactId: "cont-3",
        operatorId: "op-2",
        queueState: "meus",
        lastMessageText: "Excelente! Consegue me mandar a nota fiscal por aqui?",
        lastMessageTime: new Date(),
      },
      {
        id: "val-2",
        tenantId: "valem",
        contactId: "cont-4",
        operatorId: null,
        queueState: "fila",
        lastMessageText: "Olá, recebemos uma peça com as dimensões trocadas. Vocês conseguem mandar a correta hoje?",
        lastMessageTime: new Date(),
      },
    ];

    for (const conv of defaultConversations) {
      const existingConv = await db.select().from(conversations).where(eq(conversations.id, conv.id)).limit(1);
      if (existingConv.length === 0) {
        console.log(`Inserindo conversa: ${conv.id}`);
        await db.insert(conversations).values(conv);

        // Atualizar o responsibleName no contato correspondente
        if (conv.operatorId && conv.queueState === "meus") {
          let opName = "Na Fila";
          if (conv.operatorId === "op-1") opName = "Fagner F. (Admin)";
          else if (conv.operatorId === "op-2") opName = "Tarcísio (Valem)";
          else if (conv.operatorId === "op-3") opName = "Pedro (Tecfag)";
          else if (conv.operatorId === "op-4") opName = "Julia (Whats Only)";

          await db.update(contacts)
            .set({ responsibleName: opName })
            .where(eq(contacts.id, conv.contactId));
        }
      }
    }

    console.log("Verificando mensagens de teste...");
    const defaultMessages = [
      {
        id: "msg-v1-1",
        tenantId: "valem",
        conversationId: "val-1",
        senderType: "client",
        senderName: "Tarcísio Júnior",
        content: "Bom dia! Como está a liberação da carga de embaladoras da Valem?",
        sentAt: new Date(Date.now() - 3600000),
      },
      {
        id: "msg-v1-2",
        tenantId: "valem",
        conversationId: "val-1",
        senderType: "agent",
        senderName: "Atendente Valem",
        content: "Bom dia Tarcísio! O lote de embaladoras já foi faturado e está na transportadora. A previsão de chegada é até quinta-feira.",
        sentAt: new Date(Date.now() - 1800000),
      },
      {
        id: "msg-v2-1",
        tenantId: "valem",
        conversationId: "val-2",
        senderType: "client",
        senderName: "Metalúrgica Recife",
        content: "Olá, recebemos uma peça com as dimensões trocadas. Vocês conseguem mandar a correta hoje?",
        sentAt: new Date(),
      },
    ];

    for (const msg of defaultMessages) {
      const existingMsg = await db.select().from(messages).where(eq(messages.id, msg.id)).limit(1);
      if (existingMsg.length === 0) {
        console.log(`Inserindo mensagem: ${msg.id}`);
        await db.insert(messages).values(msg);
      }
    }

    console.log("✅ Seeding concluído com sucesso!");
  } catch (err) {
    console.error("❌ Erro durante o seeding:", err);
  } finally {
    await client.end();
  }
}

main();
