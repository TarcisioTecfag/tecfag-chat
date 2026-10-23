// src/routes/api/voice-objectives.ts
// CRUD para Objetivos da Valentina — sem emojis, 100% icones lucide-react

import { createFileRoute } from "@tanstack/react-router";
import { db } from "../../db";
import { voiceObjectives } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { objectiveUpdateSchema } from "../../lib/access-control/voice-input";
import { requirePermission } from "../../lib/auth-session";
import { requireSession } from "../../lib/auth-session";
import { recordCrmAction } from "../../lib/crm/action-history";

const corsHeaders = { "Content-Type": "application/json" };
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export const Route = createFileRoute("/api/voice-objectives")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireSession(request);
        if ("response" in auth) return auth.response;
        const { session } = auth;
        const tenantId = session.tenantId;
        const denied = requirePermission(session, (p) => p.views?.ligacoes === true && p.ligacoes?.canManageObjectives === true);
        if (denied) return denied;
        const list = await db
          .select()
          .from(voiceObjectives)
          .where(eq(voiceObjectives.tenantId, tenantId));
        return json({ objectives: list });
      },

      POST: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const denied = requirePermission(session, (p) => p.views?.ligacoes === true && p.ligacoes?.canManageObjectives === true);
          if (denied) return denied;
          const body = await request.json();
          const { tenantId: _ignoredTenant, icon, isTemplate: _ignoredTemplate, ...input } = body;
          const parsed = objectiveUpdateSchema.safeParse({ ...input, ...(icon !== undefined && input.emoji === undefined ? { emoji: icon } : {}) });
          if (!parsed.success) return json({ error: "Campos de objetivo inválidos." }, 400);
          const data = parsed.data;
          if (!data.name || !data.prompt) return json({ error: "name e prompt sao obrigatorios" }, 400);
          const row = {
            id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            tenantId,
            name: data.name,
            description: data.description || null,
            emoji: data.emoji || "target",
            prompt: data.prompt,
            collectFields: (data.collectFields || []) as any,
            actions: (data.actions || []) as any,
            isActive: data.isActive !== false,
            isTemplate: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          const [inserted] = await db.insert(voiceObjectives).values(row).returning();
          return json({ success: true, objective: inserted }, 201);
        } catch (err: any) {
          return json({ error: err?.message ?? "Erro ao criar objetivo" }, 500);
        }
      },

      PUT: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const tenantId = session.tenantId;
          const denied = requirePermission(session, (p) => p.views?.ligacoes === true && p.ligacoes?.canManageObjectives === true);
          if (denied) return denied;
          const body = await request.json();
          const { tenantId: _ignoredTenant, id, ...input } = body;
          const parsed = objectiveUpdateSchema.safeParse(input);
          if (!parsed.success) return json({ error: "Campos de objetivo inválidos." }, 400);
          const updates = parsed.data;
          if (!id) return json({ error: "id e obrigatorio" }, 400);
          await db
            .update(voiceObjectives)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(eq(voiceObjectives.id, id), eq(voiceObjectives.tenantId, tenantId)));
          return json({ success: true });
        } catch (err: any) {
          return json({ error: err?.message ?? "Erro ao atualizar" }, 500);
        }
      },

      DELETE: async ({ request }) => {
        try {
          const auth = await requireSession(request);
          if ("response" in auth) return auth.response;
          const { session } = auth;
          const url = new URL(request.url);
          const tenantId = session.tenantId;
          const denied = requirePermission(session, (p) => p.views?.ligacoes === true && p.ligacoes?.canManageObjectives === true);
          if (denied) return denied;
          const id = url.searchParams.get("id");
          if (!id) return json({ error: "id e obrigatorio" }, 400);
          const [deleted] = await db
            .delete(voiceObjectives)
            .where(and(eq(voiceObjectives.id, id), eq(voiceObjectives.tenantId, tenantId)))
            .returning({ id: voiceObjectives.id, name: voiceObjectives.name });
          if (!deleted) return json({ error: "Objetivo não encontrado." }, 404);
          await recordCrmAction({ tenantId, operatorId: session.operator.id, operatorName: session.operator.name,
            action: "delete_voice_objective", entityType: "voice_objective", itemCount: 1,
            details: { id: deleted.id, name: deleted.name } });
          return json({ success: true });
        } catch (err: any) {
          return json({ error: err?.message ?? "Erro ao remover" }, 500);
        }
      },
    },
  },
});
