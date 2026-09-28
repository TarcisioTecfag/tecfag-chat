import { eq, and, sql } from "drizzle-orm";
import { db } from "../../db";
import { contacts, conversations, tasks } from "../../db/schema";
import { normalizeDocument } from "./crm-service";

export interface TenantInventoryReport {
  tenantId: string;
  generatedAt: string;
  contacts: {
    total: number;
    withCnpj: number;
    withCpf: number;
    withoutDocument: number;
    withRdDeal: number;
    duplicateCnpjsCount: number;
    duplicateCpfsCount: number;
  };
  conversations: {
    total: number;
    byQueueState: Record<string, number>;
  };
  tasks: {
    total: number;
    byStatus: Record<string, number>;
  };
}

/**
 * Realiza inventário estritamente somente-leitura dos dados legados por tenant.
 * Nunca altera ou insere registros.
 */
export async function getTenantLegacyInventory(tenantId: string): Promise<TenantInventoryReport> {
  // 1. Contatos
  const allContacts = await db
    .select({
      id: contacts.id,
      cnpj: contacts.cnpj,
      cpf: contacts.cpf,
      rdCrmDealId: contacts.rdCrmDealId,
    })
    .from(contacts)
    .where(eq(contacts.tenantId, tenantId));

  let withCnpj = 0;
  let withCpf = 0;
  let withoutDocument = 0;
  let withRdDeal = 0;

  const cnpjMap = new Map<string, number>();
  const cpfMap = new Map<string, number>();

  for (const c of allContacts) {
    const cleanCnpj = normalizeDocument(c.cnpj);
    const cleanCpf = normalizeDocument(c.cpf);

    if (cleanCnpj) {
      withCnpj++;
      cnpjMap.set(cleanCnpj, (cnpjMap.get(cleanCnpj) || 0) + 1);
    }
    if (cleanCpf) {
      withCpf++;
      cpfMap.set(cleanCpf, (cpfMap.get(cleanCpf) || 0) + 1);
    }
    if (!cleanCnpj && !cleanCpf) {
      withoutDocument++;
    }
    if (c.rdCrmDealId) {
      withRdDeal++;
    }
  }

  let duplicateCnpjsCount = 0;
  for (const count of cnpjMap.values()) {
    if (count > 1) duplicateCnpjsCount++;
  }

  let duplicateCpfsCount = 0;
  for (const count of cpfMap.values()) {
    if (count > 1) duplicateCpfsCount++;
  }

  // 2. Conversas
  const convRows = await db
    .select({
      queueState: conversations.queueState,
      count: sql<number>`count(*)::int`,
    })
    .from(conversations)
    .where(eq(conversations.tenantId, tenantId))
    .groupBy(conversations.queueState);

  const byQueueState: Record<string, number> = {};
  let totalConversations = 0;
  for (const r of convRows) {
    byQueueState[r.queueState] = r.count;
    totalConversations += r.count;
  }

  // 3. Tarefas
  const taskRows = await db
    .select({
      status: tasks.status,
      count: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId))
    .groupBy(tasks.status);

  const byStatus: Record<string, number> = {};
  let totalTasks = 0;
  for (const r of taskRows) {
    byStatus[r.status] = r.count;
    totalTasks += r.count;
  }

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    contacts: {
      total: allContacts.length,
      withCnpj,
      withCpf,
      withoutDocument,
      withRdDeal,
      duplicateCnpjsCount,
      duplicateCpfsCount,
    },
    conversations: {
      total: totalConversations,
      byQueueState,
    },
    tasks: {
      total: totalTasks,
      byStatus,
    },
  };
}
