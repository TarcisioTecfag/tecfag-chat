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
    if (typeof session.value === "string" && session.value.length > 8192) return record(null);
    const params = new URLSearchParams(typeof session.value === "string" ? session.value : "");
    const extra = record(session.extra_params);
    return {
      source: text(params.get("utm_source"), session.utm_source, session.source, extra.utm_source),
      campaign: text(
        params.get("utm_campaign"),
        session.utm_campaign,
        session.campaign,
        extra.utm_campaign,
      ),
      medium: text(params.get("utm_medium"), session.utm_medium, session.medium, extra.utm_medium),
    };
  } catch {
    return record(null);
  }
}

export function conversionAttribution(value: unknown) {
  const conversion = record(value);
  const payload = Object.hasOwn(conversion, "payload") ? record(conversion.payload) : conversion;
  const originValue = payload.conversion_origin ?? conversion.conversion_origin;
  const origin = record(originValue);
  const content = record(payload.content);
  const contentOrigin = record(content.conversion_origin);
  const traffic = payload.traffic_source ?? content.traffic_source;
  const structuredTraffic = record(traffic);
  const session = currentTrafficSession(traffic);
  const query =
    typeof traffic === "string" && /(?:^|[?&])utm_(?:source|campaign|medium)=/.test(traffic)
      ? new URLSearchParams(traffic.startsWith("?") ? traffic.slice(1) : traffic)
      : null;
  return {
    source: text(
      origin.source,
      typeof originValue === "string" ? originValue : null,
      structuredTraffic.source,
      structuredTraffic.utm_source,
      query ? query.get("utm_source") : traffic,
      payload.source,
      conversion.source,
      payload.cf_utm_source,
      payload.utm_source,
      content.cf_utm_source,
      content.utm_source,
      contentOrigin.source,
      session.source,
    ),
    campaign: text(
      origin.campaign,
      structuredTraffic.campaign,
      structuredTraffic.utm_campaign,
      query?.get("utm_campaign"),
      payload.traffic_campaign,
      payload.campaign,
      conversion.campaign,
      payload.cf_utm_campaign,
      payload.utm_campaign,
      content.cf_utm_campaign,
      content.utm_campaign,
      contentOrigin.campaign,
      session.campaign,
    ),
    medium: text(
      origin.medium,
      structuredTraffic.medium,
      structuredTraffic.utm_medium,
      query?.get("utm_medium"),
      payload.traffic_medium,
      payload.medium,
      payload.cf_utm_medium,
      payload.utm_medium,
      content.cf_utm_medium,
      content.utm_medium,
      contentOrigin.medium,
      session.medium,
    ),
  };
}

export interface DetailedConversionUtm {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  clickId: string | null;
  landingPage: string | null;
  conversionIdentifier: string | null;
}

export function extractDetailedConversionUtm(value: unknown): DetailedConversionUtm {
  const conversion = record(value);
  const payload = Object.hasOwn(conversion, "payload") ? record(conversion.payload) : conversion;
  const content = record(payload.content);
  const traffic = payload.traffic_source ?? content.traffic_source;
  const structuredTraffic = record(traffic);

  let sessionParams: URLSearchParams | null = null;
  let sessionObj: Fields = record(null);
  let sessionExtra: Fields = record(null);
  if (typeof traffic === "string" && traffic.startsWith("encoded_") && traffic.length <= 16384) {
    const base64 = traffic.slice(8);
    if (base64 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(base64) && base64.length % 4 !== 1) {
      try {
        const bytes = Uint8Array.from(
          atob(base64.replace(/-/g, "+").replace(/_/g, "/")),
          (ch) => ch.charCodeAt(0),
        );
        const tracking = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
        sessionObj = record(tracking.current_session);
        if (typeof sessionObj.value === "string" && sessionObj.value.length <= 8192) {
          sessionParams = new URLSearchParams(sessionObj.value);
        }
        sessionExtra = record(sessionObj.extra_params);
      } catch {
        // ignore invalid encoded tracking
      }
    }
  }

  const query =
    typeof traffic === "string" && /(?:^|[?&])utm_(?:source|campaign|medium|content|term)=/.test(traffic)
      ? new URLSearchParams(traffic.startsWith("?") ? traffic.slice(1) : traffic)
      : null;

  return {
    utmSource: text(
      payload.cf_utm_source,
      payload.utm_source,
      content.cf_utm_source,
      content.utm_source,
      structuredTraffic.utm_source,
      query?.get("utm_source"),
      sessionParams?.get("utm_source"),
      sessionObj.utm_source,
      sessionExtra.utm_source,
    ),
    utmMedium: text(
      payload.cf_utm_medium,
      payload.utm_medium,
      content.cf_utm_medium,
      content.utm_medium,
      structuredTraffic.utm_medium,
      query?.get("utm_medium"),
      sessionParams?.get("utm_medium"),
      sessionObj.utm_medium,
      sessionExtra.utm_medium,
    ),
    utmCampaign: text(
      payload.cf_utm_campaign,
      payload.utm_campaign,
      content.cf_utm_campaign,
      content.utm_campaign,
      structuredTraffic.utm_campaign,
      query?.get("utm_campaign"),
      sessionParams?.get("utm_campaign"),
      sessionObj.utm_campaign,
      sessionExtra.utm_campaign,
    ),
    utmContent: text(
      payload.cf_utm_content,
      payload.utm_content,
      content.cf_utm_content,
      content.utm_content,
      structuredTraffic.utm_content,
      query?.get("utm_content"),
      sessionParams?.get("utm_content"),
      sessionObj.utm_content,
      sessionExtra.utm_content,
    ),
    utmTerm: text(
      payload.cf_utm_term,
      payload.utm_term,
      content.cf_utm_term,
      content.utm_term,
      structuredTraffic.utm_term,
      query?.get("utm_term"),
      sessionParams?.get("utm_term"),
      sessionObj.utm_term,
      sessionExtra.utm_term,
    ),
    clickId: text(
      payload.gclid,
      payload.fbclid,
      content.gclid,
      content.fbclid,
      sessionParams?.get("gclid"),
      sessionParams?.get("fbclid"),
      sessionExtra.gclid,
      sessionExtra.fbclid,
    ),
    landingPage: text(
      content.conversion_url,
      payload.conversion_url,
      content.page_url,
      payload.page_url,
    ),
    conversionIdentifier: text(
      payload.event_identifier,
      conversion.event_identifier,
      content.identificador,
      payload.identificador,
    ),
  };
}
