type Fields = Record<string, unknown>;
const record = (value: unknown): Fields =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : Object.create(null);

// Only values recorded in this event/conversion are considered. Never use a contact profile.
const text = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (
      !trimmed ||
      /^encoded_/i.test(trimmed) ||
      /^(unknown|undefined|null|n[aã]o informad[oa]|desconhecid[oa])$/i.test(trimmed)
    )
      continue;
    return trimmed;
  }
  return null;
};

function currentTrafficSession(value: unknown): Fields {
  if (typeof value !== "string" || !value.startsWith("encoded_") || value.length > 16384)
    return record(null);
  const base64 = value.slice(8);
  if (!base64 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(base64) || base64.length % 4 === 1)
    return record(null);
  try {
    const bytes = Uint8Array.from(atob(base64.replace(/-/g, "+").replace(/_/g, "/")), (character) =>
      character.charCodeAt(0),
    );
    const tracking = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    // first_session describes an earlier acquisition session; it must not fill gaps here.
    const session = record(tracking.current_session);
    if (typeof session.value !== "string" || session.value.length > 8192) return record(null);
    const params = new URLSearchParams(session.value);
    const extra = record(session.extra_params);
    return {
      source: text(params.get("utm_source"), extra.utm_source),
      campaign: text(params.get("utm_campaign"), extra.utm_campaign),
      medium: text(params.get("utm_medium"), extra.utm_medium),
    };
  } catch {
    return record(null);
  }
}

export function conversionAttribution(value: unknown) {
  const conversion = record(value);
  const payload = Object.hasOwn(conversion, "payload") ? record(conversion.payload) : conversion;
  const origin = record(payload.conversion_origin ?? conversion.conversion_origin);
  const content = record(payload.content);
  const session = currentTrafficSession(payload.traffic_source ?? content.traffic_source);
  return {
    source: text(
      origin.source,
      payload.traffic_source,
      payload.source,
      conversion.source,
      payload.cf_utm_source,
      payload.utm_source,
      content.cf_utm_source,
      content.utm_source,
      session.source,
    ),
    campaign: text(
      origin.campaign,
      payload.traffic_campaign,
      payload.campaign,
      conversion.campaign,
      payload.cf_utm_campaign,
      payload.utm_campaign,
      content.cf_utm_campaign,
      content.utm_campaign,
      session.campaign,
    ),
    medium: text(
      origin.medium,
      payload.traffic_medium,
      payload.medium,
      payload.cf_utm_medium,
      payload.utm_medium,
      content.cf_utm_medium,
      content.utm_medium,
      session.medium,
    ),
  };
}
