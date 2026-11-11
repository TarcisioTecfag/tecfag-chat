import { describe, it, expect } from "bun:test";
import { and } from "drizzle-orm";
import {
  normalizeCanonicalPhone,
  buildPhoneSearchTerms,
  buildPhoneQueryPlan,
  matchesPhoneSearchQuery,
  formatPhoneNumber,
  maskPhone,
  localPhoneSearchTerms,
  phoneRegistrationError,
  isNanpPhoneNumber,
  isCorruptedNanpWith55,
  detectPhoneCountry,
} from "../src/lib/utils";
import {
  buildContactPhonesExistsSearchSql,
  buildPhoneColumnSearchSql,
} from "../src/lib/phone-search-sql";
import { buildDealFilterConditions } from "../src/lib/crm/crm-service";
import { db } from "../src/db";
import { contacts, crmDeals } from "../src/db/schema";

describe("Normalização Canônica de Telefones e Variantes E.164 (DDI 55 e Internacional)", () => {
  it("normaliza números brasileiros de 11 dígitos (DDD + 9 dígitos) para E.164 com DDI 55", () => {
    expect(normalizeCanonicalPhone("14998364338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("(14) 99836-4338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("+14998364338")).toBe("14998364338"); // DDI internacional explícito
  });

  it("normaliza números brasileiros de 10 dígitos (DDD + 8 dígitos) para E.164 com DDI 55", () => {
    expect(normalizeCanonicalPhone("1434567890")).toBe("551434567890");
    expect(normalizeCanonicalPhone("(14) 3456-7890")).toBe("551434567890");
  });

  it("preserva números que já possuem o DDI 55 canônico", () => {
    expect(normalizeCanonicalPhone("5514998364338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("+55 (14) 99836-4338")).toBe("5514998364338");
    expect(normalizeCanonicalPhone("551434567890")).toBe("551434567890");
  });

  it("gera variantes completas de busca com e sem DDI 55 e com/sem o 9º dígito", () => {
    // Número enviado pelo WhatsApp (13 dígitos com 55 e com 9)
    const terms1 = buildPhoneSearchTerms("5514998364338");
    expect(terms1).toContain("5514998364338"); // Canônico com 55
    expect(terms1).toContain("14998364338");   // Sem 55
    expect(terms1).toContain("1498364338");    // Sem 55 e sem o 9
    expect(terms1).toContain("551498364338");  // Com 55 e sem o 9

    // Número cadastrado manualmente (11 dígitos sem 55)
    const terms2 = buildPhoneSearchTerms("14998364338");
    expect(terms2).toContain("14998364338");
    expect(terms2).toContain("5514998364338");
  });

  it("aplica máscara visual correta com maskPhone e formatPhoneNumber", () => {
    expect(maskPhone("14998364338")).toBe("(14) 99836-4338");
    expect(maskPhone("5514998364338")).toBe("(14) 99836-4338");
    expect(formatPhoneNumber("5514998364338")).toBe("+55 (14) 99836-4338");
    expect(formatPhoneNumber("14998364338")).toBe("+55 (14) 99836-4338");
  });

  it("reconhece o celular com e sem 55/nono dígito, preservando o DDD", () => {
    const variants = ["14998364338", "5514998364338", "1498364338", "551498364338"];
    for (const number of variants) for (const other of variants) expect(buildPhoneSearchTerms(number)).toContain(other);
    expect(buildPhoneSearchTerms("5514998364338")).not.toContain("5511998364338");
    expect(buildPhoneSearchTerms("5514998364338")).not.toContain("998364338");
    expect(buildPhoneSearchTerms("5514998364338")).not.toContain("98364338");
  });

  it("DDD 55 não se confunde com o DDI e fixos não ganham um nono dígito", () => {
    expect(buildPhoneSearchTerms("55998364338")).toContain("5555998364338");
    expect(buildPhoneSearchTerms("5555998364338")).toContain("5598364338");
    expect(buildPhoneSearchTerms("1434567890")).not.toContain("14934567890");
    expect(buildPhoneSearchTerms("+14155552671")).toEqual(["14155552671"]);
  });

  it("exige DDD para cadastrar e usa números locais somente em sugestões", () => {
    for (const number of ["998364338", "98364338", "(20) 99836-4338", "123"]) expect(phoneRegistrationError(number)).not.toBeNull();
    for (const number of ["(14) 99836-4338", "+55 (14) 9836-4338", "(55) 99836-4338", "+1 415 555 2671"]) expect(phoneRegistrationError(number)).toBeNull();
    expect(phoneRegistrationError("")).toBeNull();
    expect(buildPhoneSearchTerms("98364338")).toEqual(["98364338"]);
    expect(localPhoneSearchTerms("998364338")).toContain("98364338");
    expect(localPhoneSearchTerms("98364338")).toContain("998364338");
    expect(localPhoneSearchTerms("(11) 99836-4338")).toEqual(localPhoneSearchTerms("(14) 99836-4338"));
  });

  it("preserva números dos EUA/Canadá (+1 NANP) e auto-cura números corrompidos com 551", () => {
    // Miami (+1 305) e Fort Lauderdale (+1 954, cujo início '19' coincidiria com DDD de Campinas se não houvesse proteção)
    expect(isNanpPhoneNumber("13055551234")).toBe(true);
    expect(isNanpPhoneNumber("19545551234")).toBe(true);
    expect(isNanpPhoneNumber("14998364338")).toBe(false); // Celular BR jamais é confundido com NANP

    expect(normalizeCanonicalPhone("13055551234")).toBe("13055551234");
    expect(normalizeCanonicalPhone("19545551234")).toBe("19545551234");
    expect(normalizeCanonicalPhone("+1 (305) 555-1234")).toBe("13055551234");

    // Auto-cura de número americano salvo anteriormente com prefixo 55 indevido
    expect(isCorruptedNanpWith55("5513055551234")).toBe(true);
    expect(normalizeCanonicalPhone("5513055551234")).toBe("13055551234");

    // Termos de busca encontram tanto o canônico 1... quanto o legado 551... sem adulterar 9º dígito
    expect(buildPhoneSearchTerms("13055551234")).toEqual(["13055551234", "5513055551234"]);
    expect(phoneRegistrationError("13055551234")).toBeNull();
    expect(phoneRegistrationError("+1 (305) 555-1234")).toBeNull();

    // Formatação visual correta para EUA e outros países
    expect(formatPhoneNumber("13055551234")).toBe("+1 (305) 555-1234");
    expect(formatPhoneNumber("5513055551234")).toBe("+1 (305) 555-1234");
    expect(detectPhoneCountry("+595 981 123 456").country.code).toBe("PY");
  });

  it("busca bidirecional com/sem 9º dígito na Base de Clientes, Chat e CRM (caso real 557488041686 <-> 5574988041686)", () => {
    const storedWithout9 = "557488041686"; // Identificador wa_id Meta de 12 dígitos
    const storedWith9 = "5574988041686";    // Formato ANATEL de 13 dígitos

    // Todas estas buscas DEVEM encontrar tanto o número salvo sem o 9 quanto o salvo com o 9
    const queries = [
      "5574988041686",
      "557488041686",
      "+55 (74) 98804-1686",
      "+55 (74) 8804-1686",
      "(74) 98804-1686",
      "(74) 8804-1686",
      "74988041686",
      "7488041686",
      "074988041686",
      "07488041686",
      "988041686",
      "98804-1686",
      "88041686",
      "8804-1686",
    ];

    for (const q of queries) {
      expect(matchesPhoneSearchQuery(storedWithout9, q)).toBe(true);
      expect(matchesPhoneSearchQuery(storedWith9, q)).toBe(true);
    }

    // Digitação progressiva com debounce (ex: digitando 55749880... até o 13º dígito) nunca perde o contato sem 9
    for (let len = 4; len <= storedWith9.length; len++) {
      const partial = storedWith9.slice(0, len);
      expect(matchesPhoneSearchQuery(storedWithout9, partial)).toBe(true);
      expect(matchesPhoneSearchQuery(storedWith9, partial)).toBe(true);
    }

    // Isolamento entre DDDs distintos quando o usuário informa o DDD explicitamente
    expect(matchesPhoneSearchQuery("5511988041686", "5574988041686")).toBe(false);
    expect(matchesPhoneSearchQuery("5511988041686", "(74) 98804-1686")).toBe(false);
    // Proteção contra colisão de borda DDD 19 vs DDD 11 (55 + 11 + 988041686 contém '1988041686' bruto apenas como substring, mas variantes exatas não vazam)
    expect(buildPhoneQueryPlan("(19) 98804-1686").exactTerms).not.toContain("5511988041686");

    // Proteção de telefone fixo (não inventa 9º dígito em números [2-5]XXX-XXXX)
    expect(matchesPhoneSearchQuery("557434567890", "5574934567890")).toBe(false);
  });

  it("gera SQL parametrizado seguro e isolado por tenant para contacts, contact_phones e crm_deals", () => {
    const plan = buildPhoneQueryPlan("5574988041686");
    expect(plan.phoneIdentity).toBe("557488041686");
    expect(plan.exactTerms).toContain("557488041686");
    expect(plan.exactTerms).toContain("7488041686");

    const contactsQuery = db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          buildPhoneColumnSearchSql(contacts.phone, plan),
          buildContactPhonesExistsSearchSql("tecfag", contacts.id, "5574988041686", plan),
        ),
      )
      .toSQL();

    expect(contactsQuery.sql).toContain("contact_phones cp");
    expect(contactsQuery.sql).toContain("cp.tenant_id = $");
    expect(contactsQuery.sql).toContain("cp.phone_identity = $");
    expect(contactsQuery.sql).not.toContain(" in $");
    expect(contactsQuery.params).toContain("tecfag");
    expect(contactsQuery.params).toContain("557488041686");

    const dealConditions = buildDealFilterConditions("tecfag", {
      search: "5574988041686",
    });
    const dealsQuery = db
      .select({ id: crmDeals.id })
      .from(crmDeals)
      .where(and(...dealConditions))
      .toSQL();

    expect(dealsQuery.params).toContain("tecfag");
    expect(dealsQuery.params).toContain("557488041686");
    expect(dealsQuery.sql).not.toContain(" in $");
  });

  it("executa busca real em PostgreSQL (PGlite) encontrando Johnatan (557488041686) ao buscar 5574988041686 e vice-versa com isolamento multi-tenant", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { eq, or } = await import("drizzle-orm");

    const pg = new PGlite();
    await pg.exec(`
      CREATE TABLE contacts (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        name text NOT NULL,
        phone text,
        whatsapp_username text,
        email text,
        cnpj text,
        cpf text,
        account_id text,
        avatar text,
        tags jsonb DEFAULT '[]'::jsonb,
        main_channel text NOT NULL DEFAULT 'whatsapp',
        wallet_operator_id text,
        responsible_name text,
        custom_fields jsonb DEFAULT '{}'::jsonb,
        whatsapp_jid text,
        whatsapp_user_id text,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE contact_phones (
        id text PRIMARY KEY,
        tenant_id text NOT NULL,
        contact_id text NOT NULL,
        phone text NOT NULL,
        phone_identity text NOT NULL,
        type text NOT NULL DEFAULT 'commercial',
        label text,
        is_primary boolean NOT NULL DEFAULT true,
        has_whatsapp boolean NOT NULL DEFAULT true,
        whatsapp_jid text,
        whatsapp_user_id text,
        position integer NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await pg.exec(`
      INSERT INTO contacts (id, tenant_id, name, phone, email) VALUES
        ('cont-johnatan', 'tecfag', 'Johnatan', '557488041686', 'natanzabulon@gmail.com'),
        ('cont-com9', 'tecfag', 'Cliente Com Nove', '5574991112222', 'com9@example.com'),
        ('cont-sec-only', 'tecfag', 'Cliente Secundario', '551133334444', 'sec@example.com'),
        ('cont-other-tenant', 'valem', 'Johnatan Outro Tenant', '557488041686', 'valem@example.com');

      INSERT INTO contact_phones (id, tenant_id, contact_id, phone, phone_identity, is_primary) VALUES
        ('cph-1', 'tecfag', 'cont-johnatan', '557488041686', '557488041686', true),
        ('cph-2', 'tecfag', 'cont-com9', '5574991112222', '557491112222', true),
        ('cph-3a', 'tecfag', 'cont-sec-only', '551133334444', '551133334444', true),
        ('cph-3b', 'tecfag', 'cont-sec-only', '557588223344', '557588223344', false),
        ('cph-4', 'valem', 'cont-other-tenant', '557488041686', '557488041686', true);
    `);

    const memDb = drizzle(pg);
    const runSearch = async (tenantId: string, search: string) => {
      const plan = buildPhoneQueryPlan(search);
      return memDb
        .select({ id: contacts.id, name: contacts.name })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, tenantId),
            or(
              buildContactPhonesExistsSearchSql(tenantId, contacts.id, search, plan),
              buildPhoneColumnSearchSql(contacts.phone, plan),
            ),
          ),
        );
    };

    try {
      // 1. Exatamente o caso dos prints: salvo sem "9" (557488041686), buscado com "9" (5574988041686)
      const resWith9 = await runSearch("tecfag", "5574988041686");
      expect(resWith9.map((r) => r.id)).toEqual(["cont-johnatan"]);

      // 2. Buscado sem "9" (557488041686) continua encontrando normalmente e NUNCA vaza o outro tenant ("valem")
      const resWithout9 = await runSearch("tecfag", "557488041686");
      expect(resWithout9.map((r) => r.id)).toEqual(["cont-johnatan"]);

      // 3. Inverso: salvo COM "9" (5574991112222), buscado SEM "9" (557491112222 ou 7491112222)
      const resInverse1 = await runSearch("tecfag", "557491112222");
      expect(resInverse1.map((r) => r.id)).toEqual(["cont-com9"]);
      const resInverse2 = await runSearch("tecfag", "(74) 9111-2222");
      expect(resInverse2.map((r) => r.id)).toEqual(["cont-com9"]);

      // 4. Telefone secundário em contact_phones salvo sem "9" (557588223344), buscado com "9" (5575988223344)
      const resSecondary = await runSearch("tecfag", "5575988223344");
      expect(resSecondary.map((r) => r.id)).toEqual(["cont-sec-only"]);
    } finally {
      await pg.close();
    }
  });
});
