import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../../db";
import { operators, conversations, contacts, messages } from "../../../db/schema";
import { eq, and, ne, desc, inArray, gte } from "drizzle-orm";
import { requireSession } from "../../../lib/auth-session";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const Route = createFileRoute("/api/gestao/live")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders }),

      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;

        if (session.operator.role !== "admin" && session.operator.role !== "supervisor") {
          return new Response(
            JSON.stringify({ error: "Permissão insuficiente. Apenas administradores e supervisores podem visualizar o painel ao vivo.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const url = new URL(request.url);
        const queryTenantId = url.searchParams.get("tenantId");
        if (queryTenantId && queryTenantId !== tenantId) {
          return new Response(
            JSON.stringify({ error: "Acesso negado ao tenant especificado.", code: "FORBIDDEN" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const dateFilter = url.searchParams.get("date");      // YYYY-MM-DD opcional
        const opIdFilter = url.searchParams.get("opId");      // operatorId opcional
        const search = url.searchParams.get("search");        // busca por nome/telefone

        try {
          const now = new Date();

          // 1. Buscar TODOS os operadores do tenant (sem filtro de setor)
          // Nota: o filtro de setor Comercial é exclusivo da aba Operadores (overview.ts)
          const opList = await db
            .select()
            .from(operators)
            .where(eq(operators.tenantId, tenantId));

          // 2. Filtro de data: usa lastMessageTime >= início do dia selecionado
          const dateCondition = dateFilter
            ? gte(conversations.lastMessageTime, new Date(dateFilter + "T00:00:00.000Z"))
            : undefined;

          // 3. Buscar TODAS as conversas ativas (não finalizadas) do tenant
          const baseWhere = and(
            eq(conversations.tenantId, tenantId),
            ne(conversations.queueState, "finalizados"),
            ...(dateCondition ? [dateCondition] : [])
          );

          const allActiveConvs = await db
            .select({
              id: conversations.id,
              operatorId: conversations.operatorId,
              contactId: conversations.contactId,
              queueState: conversations.queueState,
              contactName: contacts.name,
              contactPhone: contacts.phone,
              contactAvatar: contacts.avatar,
              lastMessageTime: conversations.lastMessageTime,
              lastMessageText: conversations.lastMessageText,
            })
            .from(conversations)
            .leftJoin(contacts, eq(conversations.contactId, contacts.id))
            .where(baseWhere)
            .orderBy(desc(conversations.lastMessageTime));

          // 4. Filtro por busca (nome ou telefone)
          const searchLower = search?.toLowerCase().trim() ?? "";
          const filteredConvs = searchLower
            ? allActiveConvs.filter((c) =>
                (c.contactName?.toLowerCase().includes(searchLower)) ||
                (c.contactPhone?.includes(searchLower))
              )
            : allActiveConvs;

          // 5. Separar por categoria
          const opIds = opList.map((o) => o.id);

          // Log de diagnóstico: detecta operatorIds nas conversas que não existem na tabela operators
          const uniqueConvOpIds = [...new Set(
            allActiveConvs.map((c) => c.operatorId).filter(Boolean)
          )];
          const missingIds = uniqueConvOpIds.filter((id) => !opIds.includes(id!));
          if (missingIds.length > 0) {
            console.warn(
              `[live.ts] Tenant ${tenantId}: ${missingIds.length} operatorId(s) nas conversas sem registro em operators:`,
              missingIds
            );
          }

          // Conversas com qualquer operador atribuído (todos os setores)
          const operatorConvs = filteredConvs.filter((c) =>
            c.operatorId &&
            c.queueState !== "automacao" &&
            (opIdFilter ? c.operatorId === opIdFilter : true)
          );

          // Na fila sem operador
          const unassignedConvs = filteredConvs.filter(
            (c) => !c.operatorId && c.queueState === "fila"
          );

          // Com Valentina (automação)
          const automationConvs = filteredConvs.filter(
            (c) => c.queueState === "automacao"
          );

          // 6. Coletar todas as conversas para buscar mensagens
          const allRelevantIds = [
            ...operatorConvs.map((c) => c.id),
            ...unassignedConvs.map((c) => c.id),
            // NÃO carrega mensagens das conversas de automação (ficam bloqueadas na UI)
          ];

          let allMessagesMap: Record<string, any[]> = {};

          if (allRelevantIds.length > 0) {
            const rawMsgs = await db
              .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderType: messages.senderType,
                senderName: messages.senderName,
                content: messages.content,
                sentAt: messages.sentAt,
                isInternalNote: messages.isInternalNote,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.tenantId, tenantId),
                  inArray(messages.conversationId, allRelevantIds)
                )
              )
              .orderBy(desc(messages.sentAt))
              .limit(1000); // limite alto para cobrir 50 msgs * 20 conversas

            // Agrupa por conversa (reverso = cronológico mais antigo → recente)
            for (const msg of rawMsgs.reverse()) {
              if (!allMessagesMap[msg.conversationId]) {
                allMessagesMap[msg.conversationId] = [];
              }
              if (allMessagesMap[msg.conversationId].length < 50) {
                allMessagesMap[msg.conversationId].push({
                  id: msg.id,
                  senderType: msg.senderType,
                  senderName: msg.senderName,
                  content: msg.content,
                  sentAt: msg.sentAt instanceof Date
                    ? msg.sentAt.toISOString()
                    : String(msg.sentAt),
                  isInternalNote: msg.isInternalNote,
                });
              }
            }
          }

          // Função helper para montar LiveConversation
          const buildLiveConv = (c: typeof filteredConvs[0]) => {
            const msgs = allMessagesMap[c.id] || [];
            const lastMsg = msgs[msgs.length - 1];

            let waitingMinutes = 0;
            let isUnanswered = false;

            if (lastMsg && lastMsg.senderType === "client") {
              const msgTime = new Date(lastMsg.sentAt).getTime();
              waitingMinutes = Math.floor((now.getTime() - msgTime) / 60000);
              isUnanswered = true;
            }

            return {
              id: c.id,
              contactName: c.contactName || "Cliente sem Nome",
              contactPhone: c.contactPhone || "",
              contactAvatar: c.contactAvatar || null,
              queueState: c.queueState,
              lastMessage: c.lastMessageText || lastMsg?.content || "Nenhuma mensagem recente",
              lastMessageTime: c.lastMessageTime instanceof Date
                ? c.lastMessageTime.toISOString()
                : String(c.lastMessageTime),
              waitingMinutes,
              isUnanswered,
              operatorId: c.operatorId || null,
              operatorName: null as string | null,
              messages: msgs,
            };
          };

          // 7. Montar resposta: operadores + fila + automação
          const operatorResult = opList
            .filter((op) => opIdFilter ? op.id === opIdFilter : true)
            .map((op) => {
              const opConvs = operatorConvs.filter((c) => c.operatorId === op.id);
              return {
                operatorId: op.id,
                operatorName: op.name,
                operatorAvatar: op.avatar || null,
                status: op.status || "disponivel",
                conversations: opConvs.map(buildLiveConv),
              };
            });

          // Operadores "fantasmas": têm conversas mas não estão na tabela operators
          // (ex: admin ou usuário externo que atendeu diretamente)
          const knownOpIds = new Set(opList.map((o) => o.id));
          const ghostConvs = operatorConvs.filter(
            (c) => c.operatorId && !knownOpIds.has(c.operatorId)
          );
          const ghostGroups = new Map<string, typeof filteredConvs>();
          for (const c of ghostConvs) {
            const key = c.operatorId!;
            if (!ghostGroups.has(key)) ghostGroups.set(key, []);
            ghostGroups.get(key)!.push(c);
          }
          for (const [opId, convs] of ghostGroups) {
            if (opIdFilter && opId !== opIdFilter) continue;
            operatorResult.push({
              operatorId: opId,
              operatorName: `Operador (${opId})`,
              operatorAvatar: null,
              status: "disponivel",
              conversations: convs.map(buildLiveConv),
            });
          }

          const unassignedResult = unassignedConvs.map(buildLiveConv);
          const automationResult = automationConvs.map((c) => ({
            id: c.id,
            contactName: c.contactName || "Cliente sem Nome",
            contactPhone: c.contactPhone || "",
            contactAvatar: c.contactAvatar || null,
            queueState: c.queueState,
            lastMessage: c.lastMessageText || "Em triagem com Valentina",
            lastMessageTime: c.lastMessageTime instanceof Date
              ? c.lastMessageTime.toISOString()
              : String(c.lastMessageTime),
            waitingMinutes: Math.floor(
              (now.getTime() - new Date(c.lastMessageTime).getTime()) / 60000
            ),
            isUnanswered: false,
            operatorId: null,
            operatorName: null,
            messages: [], // Bloqueado — redirecionado para módulo Valentina SDR
          }));

          return new Response(
            JSON.stringify({
              operators: operatorResult,
              unassigned: unassignedResult,
              automation: automationResult,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e: any) {
          console.error("[gestao/live] Erro ao buscar conversas ao vivo:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
