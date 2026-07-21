import { db } from "./src/db";
import { agentConfigs, agentFlowStates, conversations, contacts, messages } from "./src/db/schema";
import { eq, desc, asc } from "drizzle-orm";

async function testApiEndpoint() {
  console.log("=== EXECUTANDO O MESMO CÓDIGO DO ENDPOINT /api/valentina/sdr ===");

  const flowStates = await db.select().from(agentFlowStates).orderBy(desc(agentFlowStates.lastInteractionAt)).limit(50);
  const sessions: any[] = [];
  const addedConvIds = new Set<string>();

  for (const fs of flowStates) {
    addedConvIds.add(fs.conversationId);
    const conv = await db.query.conversations.findFirst({ where: (t, { eq: dEq }) => dEq(t.id, fs.conversationId) });
    const contact = conv ? await db.query.contacts.findFirst({ where: (t, { eq: dEq }) => dEq(t.id, conv.contactId) }) : null;
    const realMsgs = await db.select().from(messages).where(eq(messages.conversationId, fs.conversationId)).orderBy(asc(messages.sentAt)).limit(100);

    const formattedMessages = realMsgs.map((m) => ({
      sender: m.senderType === "client" ? "client" : "bot",
      text: m.content,
      time: new Date(m.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    }));

    sessions.push({
      id: fs.id,
      conversationId: fs.conversationId,
      contactName: contact?.name || "Contato WhatsApp",
      company: "Empresa",
      phone: contact?.phone || "",
      currentStep: fs.currentStep,
      collectedData: fs.collectedData,
      status: "active",
      messages: formattedMessages,
    });
  }

  const allConvs = await db.select().from(conversations).orderBy(desc(conversations.lastMessageTime)).limit(50);

  for (const c of allConvs) {
    if (!addedConvIds.has(c.id)) {
      addedConvIds.add(c.id);
      const contact = await db.query.contacts.findFirst({ where: (t, { eq: dEq }) => dEq(t.id, c.contactId) });
      const realMsgs = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(asc(messages.sentAt)).limit(100);

      const formattedMessages = realMsgs.map((m) => ({
        sender: m.senderType === "client" ? "client" : "bot",
        text: m.content,
        time: new Date(m.sentAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      }));

      sessions.push({
        id: `fs-auto-${c.id}`,
        conversationId: c.id,
        contactName: contact?.name || "Contato WhatsApp",
        company: "Empresa não informada",
        phone: contact?.phone || "",
        currentStep: "Em Qualificação",
        collectedData: {},
        status: "active",
        messages: formattedMessages,
      });
    }
  }

  console.log(`\nRetorno de sessions (Total de conversas prontas para o painel SDR): ${sessions.length}`);
  console.log(JSON.stringify(sessions, null, 2));

  process.exit(0);
}

testApiEndpoint().catch(err => {
  console.error("Erro no teste:", err);
  process.exit(1);
});
