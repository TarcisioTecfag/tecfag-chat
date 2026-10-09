import { createFileRoute } from "@tanstack/react-router";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db } from "../../../../../db";
import {
  commercialDirectives,
  commercialEvidence,
  commercialEvidenceMessages,
  contacts,
  conversations,
  crmConversationDeals,
  crmDealActivities,
  crmDealContacts,
  crmDealEmails,
  crmDealEvents,
  crmDeals,
  crmStages,
  messages,
  voiceCalls,
} from "../../../../../db/schema";
import { requireSession } from "../../../../../lib/auth-session";
import { requireCrmPermission } from "../../../../../lib/rbac";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/commercial/directives/$directiveId/evidence")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permError = requireCrmPermission(session, "canViewCrm");
        if (permError) return permError;

        const [directive] = await db
          .select({
            id: commercialDirectives.id,
            status: commercialDirectives.status,
            dealId: commercialDirectives.dealId,
            instruction: commercialDirectives.instruction,
            priority: commercialDirectives.priority,
            assignedDate: commercialDirectives.assignedDate,
            assignedToOperatorId: commercialDirectives.assignedToOperatorId,
            dueAt: commercialDirectives.dueAt,
          })
          .from(commercialDirectives)
          .where(
            and(
              eq(commercialDirectives.tenantId, tenantId),
              eq(commercialDirectives.id, params.directiveId),
            ),
          )
          .limit(1);

        if (!directive) return json({ error: "Diretriz não encontrada." }, 404);
        if (
          session.operator.role !== "admin" &&
          directive.assignedToOperatorId !== session.operator.id
        ) {
          return json({ error: "Permissão insuficiente.", code: "FORBIDDEN" }, 403);
        }

        try {
          const [dealRows, primaryDealContacts, convDealContacts, emails, calls, evidence, tasks] =
            await Promise.all([
              db
                .select({
                  id: crmDeals.id,
                  title: crmDeals.title,
                  value: crmDeals.value,
                  status: crmDeals.status,
                  lossReason: crmDeals.lossReason,
                  stageId: crmDeals.stageId,
                  stageName: crmStages.name,
                })
                .from(crmDeals)
                .leftJoin(
                  crmStages,
                  and(eq(crmStages.id, crmDeals.stageId), eq(crmStages.tenantId, tenantId)),
                )
                .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, directive.dealId)))
                .limit(1),

              db
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                  email: contacts.email,
                })
                .from(crmDealContacts)
                .innerJoin(
                  contacts,
                  and(eq(contacts.id, crmDealContacts.contactId), eq(contacts.tenantId, tenantId)),
                )
                .where(
                  and(
                    eq(crmDealContacts.tenantId, tenantId),
                    eq(crmDealContacts.dealId, directive.dealId),
                  ),
                ),

              db
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                  email: contacts.email,
                })
                .from(crmConversationDeals)
                .innerJoin(
                  conversations,
                  and(
                    eq(conversations.id, crmConversationDeals.conversationId),
                    eq(conversations.tenantId, tenantId),
                  ),
                )
                .innerJoin(
                  contacts,
                  and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)),
                )
                .where(
                  and(
                    eq(crmConversationDeals.tenantId, tenantId),
                    eq(crmConversationDeals.dealId, directive.dealId),
                    eq(crmConversationDeals.isActive, true),
                  ),
                ),

              db
                .select({
                  id: crmDealEmails.id,
                  subject: crmDealEmails.subject,
                  sentAt: crmDealEmails.sentAt,
                  direction: crmDealEmails.direction,
                  isVerified: crmDealEmails.isVerified,
                  metadata: crmDealEmails.metadata,
                })
                .from(crmDealEmails)
                .where(
                  and(
                    eq(crmDealEmails.tenantId, tenantId),
                    eq(crmDealEmails.dealId, directive.dealId),
                  ),
                )
                .orderBy(desc(crmDealEmails.sentAt))
                .limit(30),

              db
                .selectDistinct({
                  id: voiceCalls.id,
                  startedAt: voiceCalls.startedAt,
                  direction: voiceCalls.direction,
                  status: voiceCalls.status,
                  durationSeconds: voiceCalls.durationSeconds,
                })
                .from(voiceCalls)
                .innerJoin(
                  crmDealContacts,
                  and(
                    eq(crmDealContacts.contactId, voiceCalls.contactId),
                    eq(crmDealContacts.tenantId, tenantId),
                    eq(crmDealContacts.dealId, directive.dealId),
                  ),
                )
                .where(and(eq(voiceCalls.tenantId, tenantId), eq(voiceCalls.status, "completed")))
                .orderBy(desc(voiceCalls.startedAt))
                .limit(30),

              db
                .select()
                .from(commercialEvidence)
                .where(
                  and(
                    eq(commercialEvidence.tenantId, tenantId),
                    eq(commercialEvidence.directiveId, directive.id),
                  ),
                )
                .orderBy(desc(commercialEvidence.createdAt)),

              db
                .select({
                  id: crmDealActivities.id,
                  title: crmDealActivities.title,
                  dueDate: crmDealActivities.dueDate,
                })
                .from(crmDealActivities)
                .where(
                  and(
                    eq(crmDealActivities.tenantId, tenantId),
                    eq(crmDealActivities.dealId, directive.dealId),
                    eq(crmDealActivities.status, "pending"),
                    gte(crmDealActivities.dueDate, new Date()),
                    ne(crmDealActivities.type, "note"),
                  ),
                )
                .orderBy(desc(crmDealActivities.createdAt))
                .limit(30),
            ]);

          // Consolida contatos únicos vinculados à negociação
          const contactsMap = new Map<
            string,
            { id: string; name: string; phone: string | null; email: string | null }
          >();
          for (const c of [...primaryDealContacts, ...convDealContacts]) {
            if (!contactsMap.has(c.id)) {
              contactsMap.set(c.id, c);
            }
          }
          const uniqueDealContacts = Array.from(contactsMap.values());
          const contactIds = uniqueDealContacts.map((c) => c.id);

          // Localiza conversas e estatísticas de histórico integral (100% da conversa) para cada contato
          const contactsEnriched: Array<{
            id: string;
            name: string;
            phone: string | null;
            email: string | null;
            conversationId: string | null;
            totalMessages: number;
            totalMedia: number;
            lastMessageAt: string | null;
          }> = [];

          let activeConversationId: string | null = null;

          if (contactIds.length > 0) {
            const convRows = await db
              .select({
                id: conversations.id,
                contactId: conversations.contactId,
                lastMessageTime: conversations.lastMessageTime,
              })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  inArray(conversations.contactId, contactIds),
                ),
              )
              .orderBy(desc(conversations.updatedAt));

            const convByContactId = new Map<string, (typeof convRows)[0]>();
            const convIds: string[] = [];
            for (const conv of convRows) {
              if (!convByContactId.has(conv.contactId)) {
                convByContactId.set(conv.contactId, conv);
                convIds.push(conv.id);
              }
            }

            if (convIds.length > 0) {
              activeConversationId = convIds[0];
            }

            // Conta 100% das mensagens e mídias de cada conversa
            const statsMap = new Map<string, { total: number; mediaTotal: number }>();
            if (convIds.length > 0) {
              const statsRows = await db
                .select({
                  conversationId: messages.conversationId,
                  total: sql<number>`count(${messages.id})::int`,
                  mediaTotal: sql<number>`count(case when ${messages.content} like '%[MEDIA:%' or ${messages.content} like '%[LOCAL_MEDIA:%' then 1 else null end)::int`,
                })
                .from(messages)
                .where(
                  and(
                    eq(messages.tenantId, tenantId),
                    inArray(messages.conversationId, convIds),
                    eq(messages.isInternalNote, false),
                    ne(messages.status, "failed"),
                  ),
                )
                .groupBy(messages.conversationId);

              for (const row of statsRows) {
                statsMap.set(row.conversationId, {
                  total: Number(row.total || 0),
                  mediaTotal: Number(row.mediaTotal || 0),
                });
              }
            }

            for (const c of uniqueDealContacts) {
              const conv = convByContactId.get(c.id);
              const stats = conv ? statsMap.get(conv.id) : undefined;
              contactsEnriched.push({
                id: c.id,
                name: c.name,
                phone: c.phone,
                email: c.email,
                conversationId: conv ? conv.id : null,
                totalMessages: stats?.total || 0,
                totalMedia: stats?.mediaTotal || 0,
                lastMessageAt: conv?.lastMessageTime ? new Date(conv.lastMessageTime).toISOString() : null,
              });
            }
          }

          return json({
            directive,
            deal: dealRows[0] || null,
            contacts: contactsEnriched,
            activeConversationId: activeConversationId || null,
            emails,
            calls,
            evidence,
            tasks,
          });
        } catch (error) {
          console.error("[commercial/evidence] GET:", error);
          return json({ error: "Falha ao carregar evidências da negociação." }, 500);
        }
      },

      POST: async ({ request, params }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const permError = requireCrmPermission(session, "canEditDeals");
        if (permError) return permError;

        try {
          const body = await request.json();
          const channel = body.channel as "call" | "email" | "whatsapp";
          const source = body.source as "internal_record" | "manual_report" | undefined;
          const summary = typeof body.summary === "string" ? body.summary.trim() : "";
          const emailContent =
            typeof body.emailContent === "string" ? body.emailContent.trim() : "";
          const nextAction = body.nextAction as "won" | "lost" | "continue";
          const nextActionActivityId =
            typeof body.nextActionActivityId === "string" ? body.nextActionActivityId.trim() : "";
          const nextActionTask =
            body.nextActionTask && typeof body.nextActionTask === "object"
              ? (body.nextActionTask as Record<string, unknown>)
              : null;
          const nextTaskTitle =
            typeof nextActionTask?.title === "string"
              ? nextActionTask.title.trim()
              : typeof body.nextTaskTitle === "string"
                ? body.nextTaskTitle.trim()
                : "";
          const nextTaskDescription =
            typeof nextActionTask?.description === "string"
              ? nextActionTask.description.trim()
              : typeof body.nextTaskDescription === "string"
                ? body.nextTaskDescription.trim()
                : "";
          const rawDueAt = nextActionTask?.dueAt || body.nextTaskDueAt;
          const nextTaskDueAt = typeof rawDueAt === "string" && rawDueAt ? new Date(rawDueAt) : null;
          const wonValue =
            body.wonValue != null && !isNaN(Number(body.wonValue))
              ? Number(body.wonValue)
              : undefined;
          const lossReason =
            typeof body.lossReason === "string" && body.lossReason.trim()
              ? body.lossReason.trim()
              : "";
          const callId = typeof body.callId === "string" ? body.callId.trim() : "";
          const emailId = typeof body.emailId === "string" ? body.emailId.trim() : "";
          const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
          const requestedMessageIds: string[] = Array.isArray(body.messageIds)
            ? [
                ...new Set(
                  (body.messageIds as unknown[]).filter(
                    (item): item is string => typeof item === "string" && Boolean(item.trim()),
                  ),
                ),
              ]
            : [];

          if (
            !["call", "email", "whatsapp"].includes(channel) ||
            !["won", "lost", "continue"].includes(nextAction) ||
            summary.length < 2 ||
            (nextAction === "continue" && !nextActionActivityId && !nextTaskTitle) ||
            (nextAction === "continue" && nextTaskTitle && (!nextTaskDueAt || isNaN(nextTaskDueAt.getTime()))) ||
            (nextAction === "lost" && !lossReason && summary.length < 3)
          ) {
            return json(
              {
                error:
                  "Por favor, preencha todos os campos obrigatórios da evidência e da próxima ação comercial.",
              },
              400,
            );
          }

          const result = await db.transaction(async (tx) => {
            const [directive] = await tx
              .select()
              .from(commercialDirectives)
              .where(
                and(
                  eq(commercialDirectives.tenantId, tenantId),
                  eq(commercialDirectives.id, params.directiveId),
                ),
              )
              .for("update")
              .limit(1);

            if (!directive) return { status: 404, error: "Diretriz não encontrada." };
            if (
              session.operator.role !== "admin" &&
              directive.assignedToOperatorId !== session.operator.id
            ) {
              return { status: 403, error: "Permissão insuficiente." };
            }
            if (directive.status !== "pending") {
              return { status: 409, error: "Diretriz já foi concluída ou cancelada anteriormente." };
            }

            const [deal] = await tx
              .select({
                id: crmDeals.id,
                title: crmDeals.title,
                status: crmDeals.status,
                value: crmDeals.value,
                lossReason: crmDeals.lossReason,
              })
              .from(crmDeals)
              .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, directive.dealId)))
              .for("update")
              .limit(1);

            if (!deal) return { status: 404, error: "Negociação não encontrada neste tenant." };

            const now = new Date();
            let resolvedNextActionActivityId = nextActionActivityId;

            // 1. Ação Real no CRM conforme o Desfecho
            if (nextAction === "won") {
              const updatedValue = wonValue != null ? String(wonValue) : deal.value;
              await tx
                .update(crmDeals)
                .set({
                  status: "won",
                  value: updatedValue,
                  closedAt: now,
                  updatedAt: now,
                })
                .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, directive.dealId)));

              await tx.insert(crmDealEvents).values({
                id: crypto.randomUUID(),
                tenantId,
                dealId: directive.dealId,
                eventType: "status_changed",
                fromStatus: deal.status,
                toStatus: "won",
                operatorId: session.operator.id,
                metadata: {
                  source: "directive_completion",
                  directiveId: directive.id,
                  wonValue: updatedValue,
                  note: summary,
                },
                createdAt: now,
              });
            } else if (nextAction === "lost") {
              const finalLossReason = lossReason || summary || "Perda informada na tratativa";
              await tx
                .update(crmDeals)
                .set({
                  status: "lost",
                  lossReason: finalLossReason,
                  closedAt: now,
                  updatedAt: now,
                })
                .where(and(eq(crmDeals.tenantId, tenantId), eq(crmDeals.id, directive.dealId)));

              await tx.insert(crmDealEvents).values({
                id: crypto.randomUUID(),
                tenantId,
                dealId: directive.dealId,
                eventType: "status_changed",
                fromStatus: deal.status,
                toStatus: "lost",
                operatorId: session.operator.id,
                metadata: {
                  source: "directive_completion",
                  directiveId: directive.id,
                  lossReason: finalLossReason,
                  note: summary,
                },
                createdAt: now,
              });
            } else if (nextAction === "continue") {
              if (nextTaskTitle && nextTaskDueAt) {
                const taskId = crypto.randomUUID();
                await tx.insert(crmDealActivities).values({
                  id: taskId,
                  tenantId,
                  dealId: directive.dealId,
                  type: "task",
                  title: nextTaskTitle,
                  description: nextTaskDescription || null,
                  status: "pending",
                  dueDate: nextTaskDueAt,
                  operatorId: session.operator.id,
                  assignedToOperatorId: directive.assignedToOperatorId,
                  createdAt: now,
                  updatedAt: now,
                });

                await tx.insert(crmDealEvents).values({
                  id: crypto.randomUUID(),
                  tenantId,
                  dealId: directive.dealId,
                  eventType: "activity_created",
                  operatorId: session.operator.id,
                  metadata: {
                    activityId: taskId,
                    directiveId: directive.id,
                    type: "task",
                    title: nextTaskTitle,
                    dueDate: nextTaskDueAt.toISOString(),
                  },
                  createdAt: now,
                });
                resolvedNextActionActivityId = taskId;
              }
            }

            // 2. Identificação do Contato Vinculado & Conversa Integral no WhatsApp
            let targetContact: {
              id: string;
              name: string;
              phone: string | null;
              email: string | null;
            } | null = null;

            if (contactId) {
              const [foundContact] = await tx
                .select({
                  id: contacts.id,
                  name: contacts.name,
                  phone: contacts.phone,
                  email: contacts.email,
                })
                .from(contacts)
                .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
                .limit(1);
              if (foundContact) targetContact = foundContact;
            }

            let conversationId: string | null = null;
            if (targetContact) {
              const [conv] = await tx
                .select({ id: conversations.id })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.tenantId, tenantId),
                    eq(conversations.contactId, targetContact.id),
                  ),
                )
                .orderBy(desc(conversations.updatedAt))
                .limit(1);
              if (conv) conversationId = conv.id;
            }

            if (!conversationId) {
              const convDeals = await tx
                .select({ conversationId: crmConversationDeals.conversationId })
                .from(crmConversationDeals)
                .where(
                  and(
                    eq(crmConversationDeals.tenantId, tenantId),
                    eq(crmConversationDeals.dealId, directive.dealId),
                    eq(crmConversationDeals.isActive, true),
                  ),
                )
                .limit(1);
              if (convDeals[0]?.conversationId) {
                conversationId = convDeals[0].conversationId;
              }
            }

            if (!conversationId) {
              const [contactConv] = await tx
                .select({
                  id: conversations.id,
                  contactId: contacts.id,
                  contactName: contacts.name,
                  contactPhone: contacts.phone,
                  contactEmail: contacts.email,
                })
                .from(conversations)
                .innerJoin(
                  crmDealContacts,
                  and(
                    eq(crmDealContacts.contactId, conversations.contactId),
                    eq(crmDealContacts.tenantId, tenantId),
                    eq(crmDealContacts.dealId, directive.dealId),
                  ),
                )
                .innerJoin(
                  contacts,
                  and(eq(contacts.id, conversations.contactId), eq(contacts.tenantId, tenantId)),
                )
                .where(eq(conversations.tenantId, tenantId))
                .limit(1);
              if (contactConv) {
                conversationId = contactConv.id;
                if (!targetContact) {
                  targetContact = {
                    id: contactConv.contactId,
                    name: contactConv.contactName,
                    phone: contactConv.contactPhone,
                    email: contactConv.contactEmail,
                  };
                }
              }
            }

            // 3. Captura Integral de 100% da Conversa e Preservação de Mídias Reais
            let allArchivedMessages: Array<{
              id: string;
              content: string;
              senderType: string;
              senderName: string;
              sentAt: Date | string | null;
              metaDetails: unknown;
              mediaInterpretation: string | null;
            }> = [];

            const preservedMedia: Array<{
              messageId: string;
              mediaType: string;
              mediaIdentifier: string;
              fileName?: string;
              downloadUrl: string;
              caption?: string;
              mediaInterpretation?: string;
              sentAt: string | null;
              senderName: string;
              senderType: string;
              metaDetails?: Record<string, unknown>;
            }> = [];

            if (channel === "whatsapp" && conversationId) {
              allArchivedMessages = await tx
                .select({
                  id: messages.id,
                  content: messages.content,
                  senderType: messages.senderType,
                  senderName: messages.senderName,
                  sentAt: messages.sentAt,
                  metaDetails: messages.metaDetails,
                  mediaInterpretation: messages.mediaInterpretation,
                })
                .from(messages)
                .where(
                  and(
                    eq(messages.tenantId, tenantId),
                    eq(messages.conversationId, conversationId),
                    eq(messages.isInternalNote, false),
                    ne(messages.status, "failed"),
                  ),
                )
                .orderBy(asc(messages.sentAt));

              for (const m of allArchivedMessages) {
                const mediaMatch = m.content.match(
                  /^\[MEDIA:(image|video|audio|document|sticker)\]([^:\n]+)(?::([^\n]+))?/,
                );
                if (mediaMatch) {
                  const [, type, idVal, fileName] = mediaMatch;
                  preservedMedia.push({
                    messageId: m.id,
                    mediaType: type,
                    mediaIdentifier: idVal,
                    fileName: fileName ? fileName.trim() : undefined,
                    downloadUrl: `/api/baileys/media?messageId=${encodeURIComponent(idVal)}`,
                    caption: m.content.split("\n").slice(1).join("\n").trim() || undefined,
                    mediaInterpretation: m.mediaInterpretation || undefined,
                    sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : null,
                    senderName: m.senderName,
                    senderType: m.senderType,
                    metaDetails: m.metaDetails as Record<string, unknown>,
                  });
                  continue;
                }

                const localMatch = m.content.match(
                  /^\[LOCAL_MEDIA:([^:]+):(.+?):([^\]\n]+)\]/,
                );
                if (localMatch) {
                  const [, type, urlVal, fileName] = localMatch;
                  preservedMedia.push({
                    messageId: m.id,
                    mediaType: type,
                    mediaIdentifier: m.id,
                    fileName: fileName ? fileName.trim() : undefined,
                    downloadUrl: urlVal,
                    sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : null,
                    senderName: m.senderName,
                    senderType: m.senderType,
                    metaDetails: m.metaDetails as Record<string, unknown>,
                  });
                  continue;
                }

                if (m.metaDetails && typeof m.metaDetails === "object") {
                  const meta = m.metaDetails as Record<string, unknown>;
                  if (meta.mediaUrl || meta.fileId || meta.mimetype || meta.mediaType) {
                    preservedMedia.push({
                      messageId: m.id,
                      mediaType: (meta.mediaType as string) || "document",
                      mediaIdentifier: (meta.fileId as string) || m.id,
                      fileName: (meta.fileName as string) || undefined,
                      downloadUrl:
                        (meta.mediaUrl as string) ||
                        `/api/baileys/media?messageId=${encodeURIComponent(m.id)}`,
                      mediaInterpretation: m.mediaInterpretation || undefined,
                      sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : null,
                      senderName: m.senderName,
                      senderType: m.senderType,
                      metaDetails: meta,
                    });
                  }
                }
              }
            }

            const channelName =
              channel === "call" ? "Ligação" : channel === "whatsapp" ? "WhatsApp" : "E-mail";
            const outcomeName =
              nextAction === "won"
                ? "Vendido (Negociação Ganha)"
                : nextAction === "lost"
                  ? `Perdido — Motivo: ${lossReason || summary}`
                  : `Em Andamento — Próxima ação agendada: "${nextTaskTitle || "Retorno"}" para ${nextTaskDueAt ? nextTaskDueAt.toLocaleString("pt-BR") : "data futura"}`;

            // 4. Registrar Nota Interna no Card do Atendimento (Chat)
            if (conversationId) {
              const contactRef = targetContact
                ? `\nContato: ${targetContact.name}${targetContact.phone ? ` (${targetContact.phone})` : ""}`
                : "";
              const auditRef =
                channel === "whatsapp" && allArchivedMessages.length > 0
                  ? `\nEvidência: Histórico integral de ${allArchivedMessages.length} mensagem(ns) e ${preservedMedia.length} arquivo(s) de mídia vinculado(s) à negociação.`
                  : "";

              const internalNoteText = `Tratativa Comercial Concluída\nCanal: ${channelName}${contactRef}${auditRef}\nRelato: ${summary}${emailContent ? `\nEmail registrado: ${emailContent.slice(0, 300)}...` : ""}\nDesfecho: ${outcomeName}`;

              await tx.insert(messages).values({
                id: crypto.randomUUID(),
                tenantId,
                conversationId,
                senderType: "system",
                senderName: session.operator.name || "Sistema",
                content: internalNoteText,
                isInternalNote: true, // Renderiza como nota interna oficial amarela
                sentAt: now,
              });
            }

            // 5. Registrar Anotação no Card da Negociação no CRM
            const crmContactHeader = targetContact
              ? `Contato Vinculado: ${targetContact.name}${targetContact.phone ? ` (${targetContact.phone})` : ""}\n`
              : "";
            const crmAuditSummary =
              channel === "whatsapp" && allArchivedMessages.length > 0
                ? `Histórico integral de ${allArchivedMessages.length} mensagem(ns) arquivado como evidência (${preservedMedia.length} mídias preservadas).\n\n`
                : "";

            await tx.insert(crmDealActivities).values({
              id: crypto.randomUUID(),
              tenantId,
              dealId: directive.dealId,
              type: "note",
              title: `Tratativa Comercial: ${channelName}${targetContact ? ` — ${targetContact.name}` : ""}`,
              description: `${crmContactHeader}${crmAuditSummary}${summary}${emailContent ? `\n\nConteúdo do E-mail:\n${emailContent}` : ""}\n\nDesfecho no CRM: ${outcomeName}`,
              status: "completed",
              completedAt: now,
              operatorId: session.operator.id,
              assignedToOperatorId: directive.assignedToOperatorId,
              createdAt: now,
              updatedAt: now,
            });

            // 6. Salvar Evidência em commercialEvidence com Metadados Ricos
            const resolvedSource =
              source ||
              (channel === "whatsapp" && (allArchivedMessages.length > 0 || requestedMessageIds.length > 0)
                ? "internal_record"
                : channel === "call" && callId
                  ? "internal_record"
                  : channel === "email" && emailId
                    ? "internal_record"
                    : "manual_report");

            const [evidence] = await tx
              .insert(commercialEvidence)
              .values({
                id: crypto.randomUUID(),
                tenantId,
                directiveId: directive.id,
                dealId: directive.dealId,
                operatorId: session.operator.id,
                channel,
                source: resolvedSource,
                summary,
                emailContent: channel === "email" ? emailContent || null : null,
                callId: channel === "call" ? callId || null : null,
                emailId: channel === "email" ? emailId || null : null,
                metadata: {
                  recordOrigin: resolvedSource,
                  contactId: targetContact?.id || contactId || null,
                  contactName: targetContact?.name || null,
                  contactPhone: targetContact?.phone || null,
                  conversationId: conversationId || null,
                  totalMessagesArchived: allArchivedMessages.length,
                  totalMediaPreserved: preservedMedia.length,
                  mediaFiles: preservedMedia, // Preservação integral das mídias reais
                  nextAction,
                  nextActionActivityId: resolvedNextActionActivityId || null,
                  wonValue,
                  lossReason,
                  nextTaskTitle,
                  nextTaskDueAt: nextTaskDueAt ? nextTaskDueAt.toISOString() : null,
                },
              })
              .returning();

            // 7. Salvar Vínculos de Mensagens em commercialEvidenceMessages
            const finalMessageIdsToLink =
              allArchivedMessages.length > 0
                ? allArchivedMessages.map((m) => m.id)
                : requestedMessageIds;

            if (finalMessageIdsToLink.length > 0) {
              await tx.insert(commercialEvidenceMessages).values(
                finalMessageIdsToLink.map((messageId) => ({
                  id: crypto.randomUUID(),
                  tenantId,
                  evidenceId: evidence.id,
                  messageId,
                })),
              );
            }

            // 8. Concluir Diretriz Comercial
            await tx
              .update(commercialDirectives)
              .set({
                status: "completed",
                completionNote: summary,
                completedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(commercialDirectives.tenantId, tenantId),
                  eq(commercialDirectives.id, directive.id),
                ),
              );

            return { status: 201, evidence };
          });

          return "error" in result
            ? json({ error: result.error }, result.status)
            : json({ evidence: result.evidence }, 201);
        } catch (error) {
          console.error("[commercial/evidence] POST:", error);
          return json({ error: "Falha ao concluir diretriz com evidência." }, 500);
        }
      },
    },
  },
});
