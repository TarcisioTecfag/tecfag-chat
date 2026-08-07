/**
 * Script de merge de contatos duplicados.
 * 
 * Situacao: Tarcisio Silva existe duas vezes no banco por variacao de numero (8/9 digitos).
 * Este script:
 *   1. Identifica o contato PRINCIPAL (com mais dados preenchidos) e o DUPLICADO
 *   2. Move todas as conversas/msgs do duplicado para o principal
 *   3. Apaga o contato duplicado
 * 
 * Como usar:
 *   PHONE_KEEP=5514998364338 PHONE_DELETE=551498364338 bun run scratch/merge-duplicate-contact.ts
 */

import { db } from "./src/db";
import { contacts, conversations, agentFlowStates, messages } from "./src/db/schema";
import { eq, and } from "drizzle-orm";

const TENANT_ID = "valem";

// Numeros dos dois contatos duplicados (sem formatacao)
// Ajuste estes valores conforme o que voce ver no banco
const PHONE_KEEP   = process.env.PHONE_KEEP   || "5514998364338";  // principal (mais dados)
const PHONE_DELETE = process.env.PHONE_DELETE  || "551498364338";   // duplicado (mesclar para o principal)

async function mergeDuplicateContact() {
  console.log(`\n🔍 Buscando contatos duplicados...`);
  console.log(`  MANTER:  ${PHONE_KEEP}`);
  console.log(`  DELETAR: ${PHONE_DELETE}\n`);

  // 1. Buscar os dois contatos
  const keepContact = await db.query.contacts.findFirst({
    where: (t, { eq: dEq, and: dAnd, or: dOr }) =>
      dAnd(dEq(t.tenantId, TENANT_ID), dOr(dEq(t.phone, PHONE_KEEP), dEq(t.whatsappJid, `${PHONE_KEEP}@s.whatsapp.net`))),
  });

  const deleteContact = await db.query.contacts.findFirst({
    where: (t, { eq: dEq, and: dAnd, or: dOr }) =>
      dAnd(dEq(t.tenantId, TENANT_ID), dOr(dEq(t.phone, PHONE_DELETE), dEq(t.whatsappJid, `${PHONE_DELETE}@s.whatsapp.net`))),
  });

  if (!keepContact) {
    console.error(`❌ Contato PRINCIPAL nao encontrado para phone: ${PHONE_KEEP}`);
    process.exit(1);
  }
  if (!deleteContact) {
    console.error(`❌ Contato DUPLICADO nao encontrado para phone: ${PHONE_DELETE}`);
    process.exit(1);
  }

  console.log(`✅ Contato PRINCIPAL: id=${keepContact.id} | nome=${keepContact.name} | phone=${keepContact.phone}`);
  console.log(`🗑️  Contato DUPLICADO: id=${deleteContact.id} | nome=${deleteContact.name} | phone=${deleteContact.phone}\n`);

  // 2. Buscar conversas do contato duplicado
  const dupeConversations = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, TENANT_ID), eq(conversations.contactId, deleteContact.id)));

  console.log(`📋 Conversas do duplicado a mover: ${dupeConversations.length}`);

  // 3. Para cada conversa do duplicado, mover para o contato principal
  for (const conv of dupeConversations) {
    // Verificar se ja existe uma conversa do principal
    const existingMainConv = await db.query.conversations.findFirst({
      where: (t, { eq: dEq, and: dAnd }) =>
        dAnd(dEq(t.tenantId, TENANT_ID), dEq(t.contactId, keepContact.id)),
    });

    if (existingMainConv) {
      // Ja tem conversa no principal - mover mensagens e agentFlowStates para ela
      console.log(`  ↔️  Conversa ${conv.id} sera fundida na conversa principal ${existingMainConv.id}`);
      
      // Mover mensagens
      const movedMsgs = await db
        .update(messages)
        .set({ conversationId: existingMainConv.id })
        .where(eq(messages.conversationId, conv.id));
      console.log(`     Mensagens movidas para conversa principal.`);

      // Mover agentFlowStates
      const existingFlow = await db.query.agentFlowStates.findFirst({
        where: (t, { eq: dEq }) => dEq(t.conversationId, existingMainConv.id),
      });

      if (!existingFlow) {
        // Nao tem flow na conversa principal - mover o do duplicado
        await db
          .update(agentFlowStates)
          .set({ conversationId: existingMainConv.id })
          .where(eq(agentFlowStates.conversationId, conv.id));
        console.log(`     agentFlowState movido para conversa principal.`);
      } else {
        // Ja tem flow - apagar o do duplicado
        await db
          .delete(agentFlowStates)
          .where(eq(agentFlowStates.conversationId, conv.id));
        console.log(`     agentFlowState duplicado removido (principal ja tem um).`);
      }

      // Apagar conversa do duplicado
      await db.delete(conversations).where(eq(conversations.id, conv.id));
      console.log(`     Conversa duplicada ${conv.id} removida.`);
    } else {
      // Nao tem conversa no principal - reatribuir esta para o principal
      console.log(`  ↔️  Conversa ${conv.id} reatribuida ao contato principal.`);
      await db
        .update(conversations)
        .set({ contactId: keepContact.id })
        .where(eq(conversations.id, conv.id));
    }
  }

  // 4. Atualizar contato principal com dados que possam estar faltando
  const updates: any = {};
  if (!keepContact.cnpj && deleteContact.cnpj) updates.cnpj = deleteContact.cnpj;
  if (!keepContact.whatsappJid && deleteContact.whatsappJid) updates.whatsappJid = deleteContact.whatsappJid;
  if ((!keepContact.name || keepContact.name.startsWith("Cliente")) && deleteContact.name) updates.name = deleteContact.name;
  
  if (Object.keys(updates).length > 0) {
    await db.update(contacts).set(updates).where(eq(contacts.id, keepContact.id));
    console.log(`\n📝 Contato principal atualizado com dados do duplicado:`, updates);
  }

  // 5. Deletar o contato duplicado
  await db.delete(contacts).where(eq(contacts.id, deleteContact.id));
  console.log(`\n✅ Contato duplicado ${deleteContact.id} removido com sucesso!`);
  console.log(`🎉 Merge concluido! Todas as conversas agora estao sob o contato ${keepContact.id}.`);
  
  process.exit(0);
}

mergeDuplicateContact().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});