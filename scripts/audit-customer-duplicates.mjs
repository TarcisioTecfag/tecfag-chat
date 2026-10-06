import postgres from "postgres";

const tenantId = process.argv.find((arg) => arg.startsWith("--tenant="))?.slice(9);
if (!tenantId || !process.env.DATABASE_URL) {
  console.error("Uso: DATABASE_URL=... node scripts/audit-customer-duplicates.mjs --tenant=<tenant-id>");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, readonly: true });
try {
  const [contacts, accounts] = await Promise.all([
    sql`SELECT id, name, phone, account_id, cnpj, cpf FROM contacts WHERE tenant_id = ${tenantId}`,
    sql`SELECT id, name, document, type, archived_at FROM crm_accounts WHERE tenant_id = ${tenantId}`,
  ]);
  const groupByDigits = (rows, field, minimum) => {
    const groups = new Map();
    for (const row of rows) {
      const digits = String(row[field] || "").replace(/\D/g, "");
      if (digits.length < minimum) continue;
      const list = groups.get(digits) || [];
      list.push(row);
      groups.set(digits, list);
    }
    return [...groups.entries()].filter(([, list]) => list.length > 1)
      .map(([digits, list]) => ({ digits, records: list }));
  };
  const report = {
    tenantId,
    generatedAt: new Date().toISOString(),
    duplicateContactPhones: groupByDigits(contacts, "phone", 8),
    duplicateAccountDocuments: groupByDigits(accounts, "document", 11),
    unlinkedContactsWithCnpj: contacts.filter((c) => !c.account_id && c.cnpj),
    linkedContactsWithLegacyDocument: contacts.filter((c) => c.account_id && (c.cnpj || c.cpf)),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await sql.end();
}
