import type { AuthSessionContext } from "../auth-session";
import type { ContactDealInput } from "./contact-deal-input";
import { crmService } from "./crm-service";
import { DealRequiredError, linkContactToDeal, type DealTransaction } from "./deal-associations";
import { requireCrmPermission } from "../rbac";
import { and, eq } from "drizzle-orm";
import { contacts } from "../../db/schema";

export function contactDealPermission(
  session: AuthSessionContext,
  body: ContactDealInput,
): Response | null {
  if (typeof body.dealId === "string" && body.dealId.trim() && !body.newDeal)
    return requireCrmPermission(session, "canEditDeals");
  if (body.newDeal && !body.dealId) return requireCrmPermission(session, "canCreateDeals");
  return Response.json(
    { error: new DealRequiredError().message, code: "DEAL_REQUIRED" },
    { status: 409 },
  );
}

export async function registerContactDeal(
  tx: DealTransaction,
  session: AuthSessionContext,
  contactId: string,
  accountId: string | null,
  input: ContactDealInput,
): Promise<string> {
  if (input.dealId) {
    const deal = await linkContactToDeal(
      tx,
      session.tenantId,
      contactId,
      input.dealId.trim(),
      session.operator.id,
    );
    if (!accountId && deal?.accountId) {
      await tx
        .update(contacts)
        .set({ accountId: deal.accountId })
        .where(and(eq(contacts.tenantId, session.tenantId), eq(contacts.id, contactId)));
    }
    return input.dealId.trim();
  }
  if (!input.newDeal || typeof input.newDeal !== "object") throw new DealRequiredError();
  const { title, pipelineId, stageId, customFields, accountId: newDealAccountId } = input.newDeal;
  if (typeof title !== "string" || typeof pipelineId !== "string" || typeof stageId !== "string")
    throw new DealRequiredError();
  if (!accountId && typeof newDealAccountId === "string" && newDealAccountId.trim()) {
    accountId = newDealAccountId.trim();
  }
  if (!accountId) {
    const [contact] = await tx
      .select({ accountId: contacts.accountId })
      .from(contacts)
      .where(and(eq(contacts.tenantId, session.tenantId), eq(contacts.id, contactId)))
      .limit(1);
    accountId = contact?.accountId || null;
  } else {
    await tx
      .update(contacts)
      .set({ accountId })
      .where(and(eq(contacts.tenantId, session.tenantId), eq(contacts.id, contactId)));
  }
  const deal = await crmService.createDeal(
    session.tenantId,
    session.operator.id,
    {
      title,
      pipelineId,
      stageId,
      customFields,
      contactId,
      accountId,
      source: "manual",
    },
    tx,
  );
  return deal.id;
}
