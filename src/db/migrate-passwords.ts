import { db } from "./index.ts";
import { operators } from "./schema.ts";
import { hashPassword, needsPasswordMigration } from "../lib/auth-crypto.ts";
import { eq } from "drizzle-orm";

export async function migrateExistingPasswords(): Promise<void> {
  console.log("[PasswordMigration] Verificando operadores com senhas legadas...");

  const allOps = await db.select().from(operators);
  let migratedCount = 0;

  for (const op of allOps) {
    if (needsPasswordMigration(op.passwordHash)) {
      const newHash = hashPassword(op.passwordHash);
      await db
        .update(operators)
        .set({ passwordHash: newHash })
        .where(eq(operators.id, op.id));
      migratedCount++;
      console.log(`[PasswordMigration] ✓ Senha migrada para scrypt: ${op.id} (${op.email}) [Tenant: ${op.tenantId}]`);
    }
  }

  console.log(`[PasswordMigration] Concluído! Total de senhas migradas: ${migratedCount}`);
}

if (process.argv[1]?.includes("migrate-passwords")) {
  migrateExistingPasswords()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[PasswordMigration] Erro fatal:", err);
      process.exit(1);
    });
}
