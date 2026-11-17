import { db } from "@/db";
import { webhookSubscriptions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  
  const { tenantId } = auth.session;
  
  await db.delete(webhookSubscriptions).where(
    and(
      eq(webhookSubscriptions.id, params.id),
      eq(webhookSubscriptions.tenantId, tenantId)
    )
  );
  
  return new Response(null, { status: 204 });
}
