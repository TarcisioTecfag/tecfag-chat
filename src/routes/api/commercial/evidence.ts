import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { commercialDirectives, commercialEvidence, commercialEvidenceMessages, crmDealEmails, crmDeals, messages, operators, voiceCalls } from "../../../db/schema";
import { requireSession } from "../../../lib/auth-session";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/evidence")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        if (session.operator.role !== "admin") return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        try {
          const evidence = await db.select({
            id: commercialEvidence.id,
            directiveId: commercialEvidence.directiveId,
            dealId: commercialEvidence.dealId,
            dealTitle: crmDeals.title,
            operatorName: operators.name,
            channel: commercialEvidence.channel,
            source: commercialEvidence.source,
            summary: commercialEvidence.summary,
            emailContent: commercialEvidence.emailContent,
            callId: commercialEvidence.callId,
            emailId: commercialEvidence.emailId,
            emailSubject: crmDealEmails.subject,
            internalEmailContent: crmDealEmails.bodyText,
            callSummary: voiceCalls.summary,
            metadata: commercialEvidence.metadata,
            createdAt: commercialEvidence.createdAt,
            instruction: commercialDirectives.instruction,
          })
            .from(commercialEvidence)
            .innerJoin(commercialDirectives, and(eq(commercialDirectives.id, commercialEvidence.directiveId), eq(commercialDirectives.tenantId, tenantId)))
            .innerJoin(crmDeals, and(eq(crmDeals.id, commercialEvidence.dealId), eq(crmDeals.tenantId, tenantId)))
            .leftJoin(crmDealEmails, and(eq(crmDealEmails.id, commercialEvidence.emailId), eq(crmDealEmails.tenantId, tenantId)))
            .leftJoin(voiceCalls, and(eq(voiceCalls.id, commercialEvidence.callId), eq(voiceCalls.tenantId, tenantId)))
            .leftJoin(operators, and(eq(operators.id, commercialEvidence.operatorId), eq(operators.tenantId, tenantId)))
            .where(eq(commercialEvidence.tenantId, tenantId))
            .orderBy(desc(commercialEvidence.createdAt))
            .limit(100);
          const linkedMessages = evidence.length ? await db.select({ evidenceId: commercialEvidenceMessages.evidenceId, content: messages.content, senderName: messages.senderName, sentAt: messages.sentAt })
            .from(commercialEvidenceMessages)
            .innerJoin(messages, and(eq(messages.id, commercialEvidenceMessages.messageId), eq(messages.tenantId, tenantId)))
            .where(and(eq(commercialEvidenceMessages.tenantId, tenantId), inArray(commercialEvidenceMessages.evidenceId, evidence.map((item) => item.id))))
            .orderBy(messages.sentAt) : [];
          const messageMap = new Map<string, typeof linkedMessages>();
          for (const message of linkedMessages) messageMap.set(message.evidenceId, [...(messageMap.get(message.evidenceId) || []), message]);
          return json({ evidence: evidence.map((item) => ({ ...item, messages: messageMap.get(item.id) || [] })) });
        } catch (error) {
          console.error("[commercial/evidence] GET:", error);
          return json({ error: "Falha ao listar evidências comerciais." }, 500);
        }
      },
    },
  },
});
