import { createFileRoute } from "@tanstack/react-router";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
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
          const [dealRows, dealContacts, emails, calls, evidence, tasks] = await Promise.all([
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

          // Busca conversa ativa vinculada ao deal
          const convDeals = await db
            .select({
              conversationId: crmConversationDeals.conversationId,
            })
            .from(crmConversationDeals)
            .where(
              and(
                eq(crmConversationDeals.tenantId, tenantId),
                eq(crmConversationDeals.dealId, directive.dealId),
                eq(crmConversationDeals.isActive, true),
              ),
            )
            .limit(1);

          let activeConversationId = convDeals[0]?.conversationId;

          // Se não houver conversa em crmConversationDeals, procura por conversa dos contatos
          if (!activeConversationId && dealContacts.length > 0) {
            const contactIds = dealContacts.map((c) => c.id);
            const [contactConv] = await db
              .select({ id: conversations.id })
              .from(conversations)
              .where(
                and(
                  eq(conversations.tenantId, tenantId),
                  inArray(conversations.contactId, contactIds),
                ),
              )
              .orderBy(desc(conversations.updatedAt))
              .limit(1);
            if (contactConv) activeConversationId = contactConv.id;
          }

          // Busca mensagens das últimas 24h na conversa (ou as últimas 20 mensagens)
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          let whatsappMessages: Array<{
            id: string;
            content: string;
            createdAt: Date | string | null;
            senderName: string;
            senderType: string;
          }> = [];

          if (activeConversationId) {
            whatsappMessages = await db
              .selectDistinct({
                id: messages.id,
                content: messages.content,
                createdAt: messages.sentAt,
                senderName: messages.senderName,
                senderType: messages.senderType,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  eq(messages.conversationId, activeConversationId),
                  eq(messages.isInternalNote, false),
                  ne(messages.status, "failed"),
                  gte(messages.sentAt, twentyFourHoursAgo),
                ),
              )
              .orderBy(desc(messages.sentAt))
              .limit(40);

            // Fallback caso não haja nas últimas 24h exatas, traz as últimas 15 mensagens da conversa
            if (whatsappMessages.length === 0) {
              whatsappMessages = await db
                .selectDistinct({
                  id: messages.id,
                  content: messages.content,
                  createdAt: messages.sentAt,
                  senderName: messages.senderName,
                  senderType: messages.senderType,
                })
                .from(messages)
                .where(
                  and(
                    eq(messages.tenantId, tenantId),
                    eq(messages.conversationId, activeConversationId),
                    eq(messages.isInternalNote, false),
                    ne(messages.status, "failed"),
                  ),
                )
                .orderBy(desc(messages.sentAt))
                .limit(15);
            }
          }

          return json({
            directive,
            deal: dealRows[0] || null,
            contacts: dealContacts,
            activeConversationId: activeConversationId || null,
            whatsapp: whatsappMessages,
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
          const messageIds: string[] = Array.isArray(body.messageIds)
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

            // 2. Localizar conversa vinculada para registrar anotação no card do atendimento
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

            let conversationId = convDeals[0]?.conversationId;
            if (!conversationId) {
              const [contactConv] = await tx
                .select({ id: conversations.id })
                .from(conversations)
                .innerJoin(
                  crmDealContacts,
                  and(
                    eq(crmDealContacts.contactId, conversations.contactId),
                    eq(crmDealContacts.tenantId, tenantId),
                    eq(crmDealContacts.dealId, directive.dealId),
                  ),
                )
                .where(eq(conversations.tenantId, tenantId))
                .limit(1);
              if (contactConv) conversationId = contactConv.id;
            }

            const channelName =
              channel === "call" ? "Ligação" : channel === "whatsapp" ? "WhatsApp" : "E-mail";
            const outcomeName =
              nextAction === "won"
                ? "Vendido (Negociação Ganha)"
                : nextAction === "lost"
                  ? `Perdido — Motivo: ${lossReason || summary}`
                  : `Em Andamento — Próxima ação agendada: "${nextTaskTitle || "Retorno"}" para ${nextTaskDueAt ? nextTaskDueAt.toLocaleString("pt-BR") : "data futura"}`;

            // 3. Registrar Nota Interna no Card do Atendimento (Chat)
            if (conversationId) {
              const internalNoteText = `Tratativa Comercial Concluída\nCanal: ${channelName}\nRelato: ${summary}${emailContent ? `\nEmail registrado: ${emailContent.slice(0, 300)}...` : ""}\nDesfecho: ${outcomeName}`;

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

            // 4. Registrar Anotação no Card da Negociação no CRM
            await tx.insert(crmDealActivities).values({
              id: crypto.randomUUID(),
              tenantId,
              dealId: directive.dealId,
              type: "note",
              title: `Tratativa Comercial: ${channelName}`,
              description: `${summary}${emailContent ? `\n\nConteúdo do E-mail:\n${emailContent}` : ""}\n\nDesfecho no CRM: ${outcomeName}`,
              status: "completed",
              completedAt: now,
              operatorId: session.operator.id,
              assignedToOperatorId: directive.assignedToOperatorId,
              createdAt: now,
              updatedAt: now,
            });

            // 5. Salvar Evidência em commercialEvidence
            const resolvedSource =
              source ||
              (channel === "whatsapp" && messageIds.length > 0
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
                  nextAction,
                  nextActionActivityId: resolvedNextActionActivityId || null,
                  wonValue,
                  lossReason,
                  nextTaskTitle,
                  nextTaskDueAt: nextTaskDueAt ? nextTaskDueAt.toISOString() : null,
                },
              })
              .returning();

            if (messageIds.length > 0) {
              await tx.insert(commercialEvidenceMessages).values(
                messageIds.map((messageId) => ({
                  id: crypto.randomUUID(),
                  tenantId,
                  evidenceId: evidence.id,
                  messageId,
                })),
              );
            }

            // 6. Concluir Diretriz Comercial
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
