import { z } from "zod";

// All administrative/identity fields are excluded from these schemas.
export const agendaUpdateSchema = z.object({
  clientName: z.string().trim().min(1).max(300).optional(),
  clientPhone: z.string().trim().min(1).max(40).optional(),
  company: z.string().max(300).nullable().optional(),
  scheduledAt: z.coerce.date().optional(),
  type: z.string().min(1).max(80).optional(),
  status: z.enum(["pending", "completed", "rescheduled", "cancelled", "no_answer"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  notes: z.string().max(10000).nullable().optional(),
  campaignName: z.string().max(300).nullable().optional(),
}).strict();

export const objectiveUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  emoji: z.string().max(80).nullable().optional(),
  prompt: z.string().trim().min(1).max(32000).optional(),
  collectFields: z.array(z.object({
    key: z.string().min(1).max(100), label: z.string().min(1).max(300),
    type: z.enum(["number", "text", "boolean"]), required: z.boolean().optional(),
  }).strict()).max(100).optional(),
  actions: z.array(z.string().min(1).max(100)).max(50).optional(),
  isActive: z.boolean().optional(),
}).strict();
