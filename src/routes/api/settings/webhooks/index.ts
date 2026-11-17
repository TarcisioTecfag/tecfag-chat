import { db } from "@/db";
import { webhookSubscriptions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireSession } from "@/lib/auth/session";
import crypto from 'crypto';

export async function GET(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  
  const { tenantId } = auth.session;
  const subs = await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.tenantId, tenantId));
  
  return new Response(JSON.stringify(subs), { status: 200, headers: { "Content-Type": "application/json" } });
}

export async function POST(request: Request) {
  const auth = await requireSession(request);
  if ("response" in auth) return auth.response;
  
  const { tenantId } = auth.session;
  const { name, url, events } = await request.json();
  
  const secret = crypto.randomBytes(32).toString('hex');
  
  const [newSub] = await db.insert(webhookSubscriptions).values({
    tenantId,
    name,
    url,
    secret,
    events,
    isActive: true
  }).returning();
  
  return new Response(JSON.stringify({ ...newSub, secret }), { status: 201, headers: { "Content-Type": "application/json" } });
}
