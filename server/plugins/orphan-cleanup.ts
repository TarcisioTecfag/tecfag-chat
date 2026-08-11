/**
 * Plugin Nitro: Limpeza automática de registros órfãos no startup.
 *
 * Problema raiz: quando um operador é deletado, o FK `onDelete: set null`
 * definido no schema Drizzle pode não estar fisicamente ativo no banco de produção
 * se o `drizzle-kit push` não propagou a constraint corretamente.
 * Resultado: conversations.operatorId e contacts.walletOperatorId ficam apontando
 * para IDs de operadores que não existem mais, causando exibição incorreta no painel.
 *
 * Esta lógica roda UMA VEZ a cada startup do servidor (silenciosamente) e corrige:
 *  1. conversations.operatorId → null  (onde o operador foi deletado)
 *  2. conversations.queueState → "fila" (devolve à fila se estava em "meus")
 *  3. contacts.walletOperatorId → null  (remove carteira de operadores deletados)
 */

export default function orphanCleanupPlugin(nitroApp: any) {
  nitroApp.hooks.hook("listen", async () => {
    try {
      // Import lazy para evitar que erros de inicialização do DB
      // quebrem o startup do servidor antes do listen estar pronto.
      const { db } = await import("../../src/db/index.js");
      const { operators, conversations, contacts } = await import("../../src/db/schema.js");
      const { sql, notInArray, isNotNull } = await import("drizzle-orm");

      console.log("[OrphanCleanup] 🔍 Verificando registros órfãos...");

      // 1. Buscar todos os IDs de operadores existentes
      const existingOperators = await db
        .select({ id: operators.id })
        .from(operators);

      const existingIds = existingOperators.map((o) => o.id);

      if (existingIds.length === 0) {
        console.log("[OrphanCleanup] ⚠️ Nenhum operador encontrado no banco. Pulando limpeza.");
        return;
      }

      // 2. Conversas com operatorId que não existe mais → zerar + devolver à fila
      const orphanedConvs = await db
        .select({ id: conversations.id, operatorId: conversations.operatorId })
        .from(conversations)
        .where(
          // operatorId não nulo E não está na lista de operadores existentes
          // Usamos sql raw para o NOT IN com array dinâmico via drizzle
          isNotNull(conversations.operatorId as any)
        );

      // Filtrar no JS (mais seguro que NOT IN com array potencialmente vazio)
      const realOrphans = orphanedConvs.filter(
        (c) => c.operatorId && !existingIds.includes(c.operatorId)
      );

      if (realOrphans.length > 0) {
        const orphanConvIds = realOrphans.map((c) => c.id);
        const { eq, inArray, and } = await import("drizzle-orm");

        // Zerar operatorId e devolver à fila
        await db
          .update(conversations)
          .set({
            operatorId: null,
            queueState: "fila",
          })
          .where(inArray(conversations.id, orphanConvIds));

        console.log(
          `[OrphanCleanup] ✅ ${realOrphans.length} conversa(s) com operador deletado → devolvidas à fila.`,
          realOrphans.map((c) => `${c.id} (era: ${c.operatorId})`).join(", ")
        );
      } else {
        console.log("[OrphanCleanup] ✅ Nenhuma conversa órfã encontrada.");
      }

      // 3. Contatos com walletOperatorId que não existe mais → zerar carteira
      const allContacts = await db
        .select({ id: contacts.id, walletOperatorId: contacts.walletOperatorId })
        .from(contacts)
        .where(isNotNull(contacts.walletOperatorId));

      const orphanWallets = allContacts.filter(
        (c) => c.walletOperatorId && !existingIds.includes(c.walletOperatorId)
      );

      if (orphanWallets.length > 0) {
        const { inArray } = await import("drizzle-orm");
        const orphanContactIds = orphanWallets.map((c) => c.id);

        await db
          .update(contacts)
          .set({ walletOperatorId: null })
          .where(inArray(contacts.id, orphanContactIds));

        console.log(
          `[OrphanCleanup] ✅ ${orphanWallets.length} contato(s) com carteira de operador deletado → carteira removida.`,
          orphanWallets.map((c) => `${c.id} (era: ${c.walletOperatorId})`).join(", ")
        );
      } else {
        console.log("[OrphanCleanup] ✅ Nenhuma carteira órfã encontrada.");
      }

      console.log("[OrphanCleanup] 🏁 Limpeza concluída.");
    } catch (err: any) {
      // Erros de cleanup nunca devem derrubar o servidor
      console.error("[OrphanCleanup] ⚠️ Erro durante limpeza (não crítico):", err?.message ?? err);
    }
  });
}
