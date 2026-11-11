import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { buildPhoneQueryPlan, type PhoneQueryPlan } from "./utils";

/**
 * Constrói condição SQL parametrizada para buscar um número de telefone em uma coluna textual,
 * cobrindo automaticamente variações com/sem o 9º dígito móvel brasileiro, com/sem DDI 55,
 * sufixos locais de 8/9 dígitos (quando buscado sem DDD) e prefixos em digitação.
 */
export function buildPhoneColumnSearchSql(
  columnExpr: AnyColumn | SQL,
  rawSearchOrPlan: string | PhoneQueryPlan,
): SQL | undefined {
  const plan =
    typeof rawSearchOrPlan === "string" ? buildPhoneQueryPlan(rawSearchOrPlan) : rawSearchOrPlan;

  if (plan.digits.length < 4) {
    return undefined;
  }

  const cleanExpr = sql`regexp_replace(coalesce(${columnExpr}, ''), '[^0-9]', '', 'g')`;
  const clauses: SQL[] = [sql`${cleanExpr} LIKE ${`%${plan.digits}%`}`];

  for (const term of plan.exactTerms) {
    clauses.push(sql`${cleanExpr} = ${term}`);
  }

  for (const suffix of plan.localSuffixTerms) {
    clauses.push(sql`right(${cleanExpr}, ${suffix.length}) = ${suffix}`);
  }

  for (const prefix of plan.prefixTerms) {
    clauses.push(sql`${cleanExpr} LIKE ${`${prefix}%`}`);
  }

  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

/**
 * Constrói cláusula `EXISTS` estritamente isolada por `tenantId` na tabela `contact_phones`
 * (telefones principais e secundários do contato), aproveitando o índice `phone_identity`
 * e as variantes completas/parciais do número pesquisado.
 */
export function buildContactPhonesExistsSearchSql(
  tenantId: string,
  contactIdExpr: AnyColumn | SQL,
  rawSearch: string,
  precomputedPlan?: PhoneQueryPlan,
): SQL {
  const plan = precomputedPlan ?? buildPhoneQueryPlan(rawSearch);
  const escaped = rawSearch.trim().replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;

  const innerClauses: SQL[] = [
    sql`cp.phone ILIKE ${pattern}`,
    sql`cp.label ILIKE ${pattern}`,
  ];

  if (plan.phoneIdentity) {
    innerClauses.push(sql`cp.phone_identity = ${plan.phoneIdentity}`);
  }

  const cpDigitsMatch = buildPhoneColumnSearchSql(sql`cp.phone`, plan);
  if (cpDigitsMatch) {
    innerClauses.push(cpDigitsMatch);
  }

  return sql`EXISTS (
    SELECT 1 FROM contact_phones cp
    WHERE cp.tenant_id = ${tenantId}
      AND cp.contact_id = ${contactIdExpr}
      AND (${or(...innerClauses)})
  )`;
}
