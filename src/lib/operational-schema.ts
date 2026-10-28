/** Structural requirements of chat/access/delivery. Does not read tenant records or secrets. */
export const REQUIRED_OPERATIONAL_COLUMNS = [
  ["messages", "id"],
  ["messages", "tenant_id"],
  ["messages", "lease_token"],
  ["messages", "provider"],
  ["messages", "idempotency_key"],
  ["pending_inbounds", "id"],
  ["pending_inbounds", "tenant_id"],
  ["pending_inbounds", "external_event_id"],
  ["rd_marketing_events", "id"],
  ["conversations", "tenant_id"],
  ["conversations", "whatsapp_connection_id"],
  ["conversations", "version"],
  ["whatsapp_connections", "tenant_id"],
  ["whatsapp_connections", "enabled"],
  ["whatsapp_connections", "lease_token"],
  ["whatsapp_connections", "lease_until"],
  ["whatsapp_connection_group_access", "tenant_id"],
  ["contact_channel_identities", "tenant_id"],
  ["contact_channel_identities", "connection_id"],
  ["conversation_deal_contexts", "tenant_id"],
  ["conversation_deal_contexts", "version"],
  ["access_groups", "permissions"],
  ["lc_visitors", "tenant_id"],
  ["lc_chats", "visitor_id"],
  ["lc_messages", "tenant_id"],
] as const;

// All identifiers come from the constant above; never interpolate request input here.
export const OPERATIONAL_READINESS_SQL = `SELECT current_database() AS db_name,
  NOT EXISTS (
    SELECT 1 FROM (VALUES ${REQUIRED_OPERATIONAL_COLUMNS.map(([table, column]) => `('${table}', '${column}')`).join(",")}) AS required(table_name, column_name)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns actual
      WHERE actual.table_schema = 'public' AND actual.table_name = required.table_name AND actual.column_name = required.column_name)
  ) AND NOT EXISTS (
    SELECT 1 FROM (VALUES
      ('idx_messages_tenant_idempotency_uniq', 'messages', ARRAY['tenant_id','idempotency_key']::text[], 'idempotency_keyISNOTNULL'),
      ('idx_pending_inbounds_tenant_event_uniq', 'pending_inbounds', ARRAY['tenant_id','external_event_id']::text[], 'external_event_idISNOTNULL')
    ) AS required(index_name, table_name, column_names, predicate)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_index idx
      WHERE idx.indexrelid = to_regclass('public.' || required.index_name)
        AND idx.indrelid = to_regclass('public.' || required.table_name)
        AND idx.indisunique AND idx.indisvalid
        AND ARRAY(SELECT attribute.attname::text
          FROM unnest(idx.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute attribute ON attribute.attrelid = idx.indrelid AND attribute.attnum = key.attnum
          WHERE key.position <= idx.indnkeyatts ORDER BY key.position) = required.column_names
        AND (idx.indpred IS NULL OR upper(regexp_replace(pg_get_expr(idx.indpred, idx.indrelid), '[[:space:]()]', '', 'g')) = upper(required.predicate))
    )
  ) AS ready`;
