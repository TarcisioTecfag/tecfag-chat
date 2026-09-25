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

      console.log("[OrphanCleanup] 🔍 Verificando registros órfãos por tenant...");
      const { tenants } = await import("../../src/db/schema.js");
      const { eq, inArray, and } = await import("drizzle-orm");

      const allTenants = await db.select({ id: tenants.id }).from(tenants);

      for (const tenant of allTenants) {
        const tenantId = tenant.id;

        // 1. Buscar operadores deste tenant
        const tenantOps = await db
          .select({ id: operators.id })
          .from(operators)
          .where(eq(operators.tenantId, tenantId));

        const tenantOpIds = tenantOps.map((o) => o.id);

        // 2. Conversas deste tenant com operatorId não pertencente a este tenant
        const orphanedConvs = await db
          .select({ id: conversations.id, operatorId: conversations.operatorId })
          .from(conversations)
          .where(
            and(
              eq(conversations.tenantId, tenantId),
              isNotNull(conversations.operatorId as any)
            )
          );

        const realOrphans = orphanedConvs.filter(
          (c) => c.operatorId && !tenantOpIds.includes(c.operatorId)
        );

        if (realOrphans.length > 0) {
          const orphanConvIds = realOrphans.map((c) => c.id);
          await db
            .update(conversations)
            .set({
              operatorId: null,
              queueState: "fila",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(conversations.tenantId, tenantId),
                inArray(conversations.id, orphanConvIds)
              )
            );

          console.log(
            `[OrphanCleanup][${tenantId}] ✅ ${realOrphans.length} conversa(s) órfãs devolvidas à fila.`
          );
        }

        // 3. Contatos deste tenant com walletOperatorId não pertencente a este tenant
        const allContacts = await db
          .select({ id: contacts.id, walletOperatorId: contacts.walletOperatorId })
          .from(contacts)
          .where(
            and(
              eq(contacts.tenantId, tenantId),
              isNotNull(contacts.walletOperatorId)
            )
          );

        const orphanWallets = allContacts.filter(
          (c) => c.walletOperatorId && !tenantOpIds.includes(c.walletOperatorId)
        );

        if (orphanWallets.length > 0) {
          const orphanContactIds = orphanWallets.map((c) => c.id);
          await db
            .update(contacts)
            .set({ walletOperatorId: null })
            .where(
              and(
                eq(contacts.tenantId, tenantId),
                inArray(contacts.id, orphanContactIds)
              )
            );

          console.log(
            `[OrphanCleanup][${tenantId}] ✅ ${orphanWallets.length} contato(s) com carteira órfã limpos.`
          );
        }
      }

      console.log("[OrphanCleanup] 🏁 Limpeza concluída.");
    } catch (err: any) {
      // Erros de cleanup nunca devem derrubar o servidor
      console.error("[OrphanCleanup] ⚠️ Erro durante limpeza (não crítico):", err?.message ?? err);
    }
  });
}
