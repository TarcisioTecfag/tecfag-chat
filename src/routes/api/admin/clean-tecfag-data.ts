import { createFileRoute } from "@tanstack/react-router";
import { client } from "../../../db";

const TABLES_TO_CLEAN = [
  "crm_activity_messages",
  "crm_deal_activities",
  "crm_deal_contacts",
  "crm_conversation_deals",
  "crm_deal_products",
  "crm_proposals",
  "crm_deal_files",
  "crm_deal_questionnaires",
  "crm_deal_emails",
  "crm_deal_events",
  "tasks",
  "messages",
  "media_files",
  "call_sessions",
  "response_time_logs",
  "ai_conversation_audits",
  "operator_daily_metrics",
  "ai_report_feedback",
  "ai_report_versions",
  "ai_reports",
  "agent_flow_states",
  "round_robin_state",
  "internal_messages",
  "pending_inbounds",
  "ai_usage_logs",
  "push_subscriptions",
  "voice_call_messages",
  "voice_campaign_leads",
  "voice_agenda",
  "voice_calls",
  "voice_campaigns",
  "voice_objectives",
  "crm_deals",
  "crm_account_conversations",
  "conversations",
  "crm_contact_account_history",
  "contacts",
  "crm_accounts",
  "crm_stage_settings",
  "crm_stages",
  "crm_pipelines",
  "crm_custom_field_definitions",
  "crm_catalog_items",
  "crm_catalog_policies",
  "crm_products",
  "crm_action_history",
  "crm_migration_runs",
  "quick_responses",
  "operator_templates",
  "lc_messages",
  "lc_chats",
  "lc_pageviews",
  "lc_click_events",
  "lc_visitors",
  "lc_tray_config",
];

export const Route = createFileRoute("/api/admin/clean-tecfag-data")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const authKey = request.headers.get("x-maintenance-key");
        if (authKey !== "tecfag-purge-confirmed-2026") {
          return new Response(JSON.stringify({ error: "Acesso negado." }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        const targetTenant = "tecfag";
        const deletedCounts: Record<string, number> = {};

        try {
          await client.begin(async (tx) => {
            for (const table of TABLES_TO_CLEAN) {
              try {
                const res = await tx.unsafe(
                  `DELETE FROM ${table} WHERE tenant_id = $1`,
                  [targetTenant]
                );
                deletedCounts[table] = res.count ?? 0;
              } catch (tblErr: any) {
                console.warn(`[clean-tecfag-data] Aviso ao limpar ${table}:`, tblErr?.message);
              }
            }
          });

          return new Response(
            JSON.stringify({
              ok: true,
              tenant: targetTenant,
              message: "Base do tenant tecfag limpa com sucesso. Operadores e Meta preservados.",
              deletedCounts,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (err: any) {
          console.error("[clean-tecfag-data] Erro ao limpar:", err);
          return new Response(
            JSON.stringify({ ok: false, error: err?.message || "Erro interno." }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
