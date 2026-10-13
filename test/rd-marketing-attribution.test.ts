import { describe, expect, test } from "bun:test";
import { conversionAttribution } from "../src/lib/rd-marketing/attribution";
import {
  attributionForLead,
  defaultMappings,
  mapLead,
  type FlowSettings,
} from "../src/lib/rd-marketing/mapping";
import { parseRdEventPage } from "../src/lib/rd-marketing/api-client";

const settings: FlowSettings = {
  name: "Fluxo de teste",
  enabled: true,
  pipelineId: "pipeline-test",
  stageId: "stage-test",
  operatorId: null,
  deduplication: "event",
  eventIdPath: "rd_conversion.id",
  mappings: defaultMappings,
};
const encoded = (value: unknown) =>
  `encoded_${Buffer.from(JSON.stringify(value)).toString("base64")}`;
const traffic = encoded({
  first_session: {
    value: "utm_source=google&utm_medium=cpc&utm_campaign=primeiro-acesso",
    extra_params: {},
  },
  current_session: {
    value: "utm_source=linktree&utm_medium=social&utm_campaign=site-home",
    extra_params: {},
  },
  created_at: 1700000000000,
});

describe("RD Marketing: atribuição da conversão", () => {
  test("formato real CDP lê cf_utm do evento e preserva o JSON original", () => {
    const raw = [
      {
        event_type: "CONVERSION",
        event_family: "CDP",
        event_identifier: "botao-exemplo",
        event_timestamp: "2026-10-13T15:52:56.000-03:00",
        payload: {
          event_timestamp: "2026-10-13T18:52:56Z",
          traffic_source: traffic,
          cf_utm_source: "linktree",
          cf_utm_medium: "social",
          cf_utm_campaign: "site-home",
        },
      },
    ];
    const original = JSON.stringify(raw);
    const event = parseRdEventPage(raw, "CONVERSION", 1).events[0];
    expect(event.source).toBe("linktree");
    expect(event.campaign).toBe("site-home");
    expect(event.medium).toBe("social");
    expect(event.identifier).toBe("botao-exemplo");
    expect(event.id).toBeNull();
    expect(event.date).toBe(raw[0].event_timestamp);
    expect(event.links).toEqual([]);
    expect(JSON.stringify(event.raw)).toBe(JSON.stringify(raw[0]));
    expect(JSON.stringify(raw)).toBe(original);
  });
  test("sem cf_utm decodifica somente a sessão atual do traffic_source", () => {
    expect(conversionAttribution({ traffic_source: traffic })).toEqual({
      source: "linktree",
      campaign: "site-home",
      medium: "social",
    });
    const incomplete = encoded({
      first_session: { value: "utm_source=google&utm_campaign=anterior" },
      current_session: { value: "utm_source=linktree" },
    });
    expect(conversionAttribution({ traffic_source: incomplete })).toEqual({
      source: "linktree",
      campaign: null,
      medium: null,
    });
    expect(
      conversionAttribution({
        traffic_source: encoded({ first_session: { value: "utm_campaign=anterior" } }),
      }).campaign,
    ).toBeNull();
  });
  test("campos explícitos e origem estruturada prevalecem sobre tracking codificado", () => {
    expect(
      conversionAttribution({
        traffic_source: traffic,
        cf_utm_source: "newsletter",
        cf_utm_campaign: "Campanha explícita",
      }),
    ).toEqual({ source: "newsletter", campaign: "Campanha explícita", medium: "social" });
    expect(
      conversionAttribution({
        conversion_origin: { source: "Origem registrada", campaign: "Campanha registrada" },
        cf_utm_source: "linktree",
        cf_utm_campaign: "site-home",
      }).source,
    ).toBe("Origem registrada");
    expect(
      conversionAttribution({
        traffic_source: "google",
        traffic_campaign: "oferta",
        traffic_medium: "cpc",
      }),
    ).toEqual({ source: "google", campaign: "oferta", medium: "cpc" });
  });
  test("não utiliza UTMs do perfil nem de outra conversão para completar o evento", () => {
    const page = parseRdEventPage(
      [
        {
          event_type: "OPPORTUNITY",
          event_identifier: "default",
          event_timestamp: "2026-10-13T15:53:24.573-03:00",
          payload: { funnel_name: "default" },
        },
      ],
      "OPPORTUNITY",
      1,
    );
    expect(page.events[0].source).toBeNull();
    expect(page.events[0].campaign).toBeNull();
    expect(page.events[0].funnelName).toBe("default");
    const lead = {
      name: "Contato de teste",
      email: "lead@example.com",
      cf_utm_source: "perfil-atual",
      cf_utm_campaign: "perfil-atual",
      first_conversion: { content: { cf_utm_source: "google", cf_utm_campaign: "antes" } },
      last_conversion: { content: { cf_utm_source: "linktree" } },
    };
    expect(attributionForLead(lead, { ...settings, attributionConversion: "last" })).toEqual({
      source: "linktree",
      campaign: "",
    });
    expect(() =>
      mapLead(lead, { ...settings, attributionConversion: "last", requireAttribution: true }),
    ).toThrow("Fonte e Campanha");
    expect(attributionForLead(lead, { ...settings, attributionConversion: "first" })).toEqual({
      source: "google",
      campaign: "antes",
    });
    expect(
      attributionForLead(
        {
          ...lead,
          funnel: { origin: "Origem do perfil atual" },
          first_conversion: {
            conversion_origin: { source: "unknown", campaign: "Campanha histórica" },
          },
        },
        settings,
      ),
    ).toEqual({ source: "", campaign: "Campanha histórica" });
  });
  test("webhook usa UTMs no conteúdo da conversão selecionada e mantém campanha configurada", () => {
    const lead = {
      name: "Contato de teste",
      first_conversion: { content: { traffic_source: traffic } },
    };
    expect(mapLead(lead, settings).deal).toMatchObject({
      source: "linktree",
      campaign: "site-home",
    });
    expect(mapLead(lead, { ...settings, campaignFromFlow: true }).deal.campaign).toBe(
      settings.name,
    );
  });
  test("tracking inválido, excessivo ou sem UTMs não vira uma fonte codificada", () => {
    for (const value of [
      "encoded_%invalid%",
      "encoded_e30=",
      "encoded_" + "A".repeat(20000),
      encoded("not an object"),
      encoded({ current_session: { value: "not-utms" } }),
    ]) {
      expect(conversionAttribution({ traffic_source: value })).toEqual({
        source: null,
        campaign: null,
        medium: null,
      });
    }
    expect(
      conversionAttribution({
        traffic_source: "encoded_%invalid%",
        cf_utm_source: "linktree",
        cf_utm_campaign: "site-home",
      }).campaign,
    ).toBe("site-home");
    expect(() =>
      mapLead(
        {
          name: "Contato de teste",
          raw_source: "encoded_%invalid%",
          campaign: "Campanha de teste",
        },
        {
          ...settings,
          requireAttribution: true,
          mappings: defaultMappings.map((mapping) =>
            mapping.target === "deal.source"
              ? { ...mapping, source: "raw_source" }
              : mapping.target === "deal.campaign"
                ? { ...mapping, source: "campaign" }
                : mapping,
          ),
        },
      ),
    ).toThrow("Fonte e Campanha");
  });
  test("UTMs percent-encoded e texto UTF-8 são lidos sem herdar propriedades", () => {
    expect(
      conversionAttribution({
        traffic_source: encoded({
          current_session: {
            value: "utm_source=busca&utm_campaign=Promo%C3%A7%C3%A3o+outubro",
            extra_params: { utm_medium: "orgânico" },
          },
        }),
      }),
    ).toEqual({ source: "busca", campaign: "Promoção outubro", medium: "orgânico" });
    expect(conversionAttribution(Object.create({ cf_utm_source: "inherited" })).source).toBeNull();
  });
  test("data do evento prevalece sobre data de cadastro/ingestão", () => {
    const raw = [
      {
        event_timestamp: "2026-10-13T15:52:56-03:00",
        created_at: "2026-10-13T19:00:00Z",
        payload: { event_timestamp: "2026-10-13T18:52:56Z" },
      },
    ];
    expect(parseRdEventPage(raw, "CONVERSION", 1).events[0].date).toBe(raw[0].event_timestamp);
    expect(
      parseRdEventPage(
        [{ created_at: raw[0].created_at, payload: raw[0].payload }],
        "CONVERSION",
        1,
      ).events[0].date,
    ).toBe(raw[0].payload.event_timestamp);
  });
});
