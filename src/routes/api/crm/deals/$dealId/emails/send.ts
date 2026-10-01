import { createFileRoute } from "@tanstack/react-router";
import { and, eq } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { db } from "../../../../../../db";
import { channelConfigs, contacts, crmDealContacts, crmDeals } from "../../../../../../db/schema";
import { requireSession } from "../../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../../lib/rbac";
import { crmService } from "../../../../../../lib/crm/crm-service";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const maxAttachmentBytes = 10 * 1024 * 1024;
const maxTotalBytes = 20 * 1024 * 1024;

function parseAddresses(value: FormDataEntryValue | null) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return [];
  const addresses = raw.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
  if (addresses.length > 10 || addresses.some((address) => address.length > 254 || !emailPattern.test(address))) {
    throw new Error("Informe endereços de cópia válidos, separados por vírgula.");
  }
  return [...new Set(addresses.map((address) => address.toLowerCase()))];
}

export const Route = createFileRoute("/api/crm/deals/$dealId/emails/send")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permissionError = requireCrmPermission(session, "canEditDeals");
        if (permissionError) return permissionError;

        const dealId = params.dealId;
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > maxTotalBytes + 1024 * 1024) {
          return Response.json({ error: "O tamanho total dos anexos excede 20 MB." }, { status: 413 });
        }
        if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
          return Response.json({ error: "Envie os dados do e-mail como formulário." }, { status: 415 });
        }

        try {
          const form = await request.formData();
          const contactId = String(form.get("contactId") || "").trim();
          const subject = String(form.get("subject") || "").trim();
          const bodyText = String(form.get("bodyText") || "").trim();
          const bodyHtmlInput = String(form.get("bodyHtml") || "");
          const cc = parseAddresses(form.get("cc"));
          const bcc = parseAddresses(form.get("bcc"));
          if (!contactId || !subject || subject.length > 250 || /[\r\n]/.test(subject) || !bodyText || bodyText.length > 100_000 || bodyHtmlInput.length > 200_000) {
            return Response.json({ error: "Selecione um contato e informe assunto e mensagem válidos." }, { status: 400 });
          }

          const [deal] = await db.select({ id: crmDeals.id }).from(crmDeals)
            .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, dealId))).limit(1);
          if (!deal) return Response.json({ error: "Negociação não encontrada." }, { status: 404 });

          const [recipient] = await db.select({ name: contacts.name, email: contacts.email })
            .from(crmDealContacts)
            .innerJoin(contacts, and(eq(crmDealContacts.contactId, contacts.id), eq(contacts.tenantId, tenantId)))
            .where(and(
              eq(crmDealContacts.tenantId, tenantId), eq(crmDealContacts.dealId, dealId),
              eq(crmDealContacts.contactId, contactId), eq(contacts.tenantId, tenantId),
            )).limit(1);
          const toAddress = recipient?.email?.trim().toLowerCase();
          if (!toAddress || !emailPattern.test(toAddress)) {
            return Response.json({ error: "O contato selecionado não possui um e-mail válido nesta negociação." }, { status: 400 });
          }

          const [config] = await db.select({
            smtpHost: channelConfigs.smtpHost, smtpPort: channelConfigs.smtpPort,
            smtpUser: channelConfigs.smtpUser, smtpPass: channelConfigs.smtpPass,
            smtpFrom: channelConfigs.smtpFrom,
          }).from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId)).limit(1);
          const fromAddress = config?.smtpFrom?.trim() || config?.smtpUser?.trim() || "";
          if (!config?.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPass || !fromAddress) {
            return Response.json({ error: "Configure o SMTP deste tenant em Ajustes antes de enviar e-mails.", code: "SMTP_NOT_CONFIGURED" }, { status: 503 });
          }

          const files = form.getAll("attachments").filter((item): item is File => item instanceof File);
          const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
          if (files.length > 5 || totalBytes > maxTotalBytes || files.some((file) => !file.size || file.size > maxAttachmentBytes)) {
            return Response.json({ error: "Anexe até 5 arquivos, com 10 MB por arquivo e 20 MB no total." }, { status: 413 });
          }

          const html = sanitizeHtml(bodyHtmlInput, {
            allowedTags: ["p", "div", "br", "strong", "b", "em", "i", "u", "s", "ol", "ul", "li", "blockquote", "a"],
            allowedAttributes: { a: ["href", "target"] },
            allowedSchemes: ["http", "https", "mailto"],
          });
          const nodemailer = await import("nodemailer");
          const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpPort === 465,
            auth: { user: config.smtpUser, pass: config.smtpPass },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
          });
          const info = await transporter.sendMail({
            from: fromAddress,
            to: { name: recipient.name, address: toAddress },
            cc: cc.length ? cc : undefined,
            bcc: bcc.length ? bcc : undefined,
            subject,
            text: bodyText,
            html: html || undefined,
            attachments: await Promise.all(files.map(async (file) => ({
              filename: file.name, content: Buffer.from(await file.arrayBuffer()), contentType: file.type || undefined,
            }))),
          });
          const accepted = (info.accepted || []).map(String).map((address) => address.toLowerCase());
          if (!accepted.includes(toAddress)) {
            return Response.json({ error: "O servidor SMTP não aceitou o destinatário.", code: "SMTP_REJECTED" }, { status: 502 });
          }

          try {
            const email = await crmService.logDealEmail(tenantId, dealId, session.operator.id, {
              direction: "outbound", fromAddress, toAddress, ccAddresses: cc,
              subject, bodyText, bodyHtml: html,
              sentAt: new Date(),
              verified: true,
              metadata: {
                delivery: "smtp_accepted", messageId: info.messageId,
                rejectedCount: (info.rejected || []).length,
                attachments: files.map((file) => ({ name: file.name, size: file.size })),
              },
            });
            return Response.json({ email, message: "E-mail aceito pelo servidor SMTP.", partial: Boolean(info.rejected?.length) }, { status: 201 });
          } catch (error) {
            console.error("[CRM Email] SMTP aceitou o e-mail, mas o registro falhou:", error);
            return Response.json({ message: "E-mail enviado, mas o histórico não pôde ser atualizado.", messageId: info.messageId, logged: false }, { status: 202 });
          }
        } catch (error) {
          console.error("[CRM Email] Falha ao enviar:", error);
          const message = error instanceof Error ? error.message : "Falha ao enviar e-mail.";
          return message.startsWith("Informe endereços")
            ? Response.json({ error: message }, { status: 400 })
            : Response.json({ error: "O servidor SMTP não conseguiu enviar o e-mail. Verifique a configuração e tente novamente." }, { status: 502 });
        }
      },
    },
  },
});
