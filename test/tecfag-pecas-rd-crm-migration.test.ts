import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pgContactPhoneIdentity } from "../scripts/import-tecfag-pecas-rd-crm.mjs";

const SEED_PATH = path.resolve(
  "scripts/data/tecfag-pecas-rd-crm-2026-11-12.json.gz",
);

describe("Migração RD Station CRM — Setor e Funil de Peças (Keicy & Guilherme)", () => {
  const payload = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(SEED_PATH)).toString("utf8"),
  );

  it("espelha fielmente a função contact_phone_identity(text) do PostgreSQL (0056)", () => {
    // Celular brasileiro com e sem 9º dígito -> mesma identidade canônica de 12 dígitos
    expect(pgContactPhoneIdentity("5514998364338")).toBe("551498364338");
    expect(pgContactPhoneIdentity("551498364338")).toBe("551498364338");
    expect(pgContactPhoneIdentity("(14) 99836-4338")).toBe("551498364338");

    // Fixo brasileiro mantém 12 dígitos sem remover dígito inicial [2-5]
    expect(pgContactPhoneIdentity("(14) 3222-3344")).toBe("551432223344");
    expect(pgContactPhoneIdentity("551432223344")).toBe("551432223344");

    // Números EUA/Canadá (+1 NANP) e autocura de prefixo 551 indevido
    expect(pgContactPhoneIdentity("+1 305 555 1234")).toBe("13055551234");
    expect(pgContactPhoneIdentity("5513055551234")).toBe("13055551234");

    // Internacional explícito não-55
    expect(pgContactPhoneIdentity("+595981234567")).toBe("595981234567");
  });

  it("garante match exato por e-mail para Guilherme Bertola e Keicy Cardoso sem misturar com Leticia Cardoso", () => {
    const specs = payload.operatorSpecs as Array<{
      key: string;
      id: string;
      email: string;
      name: string;
      rdNames: string[];
    }>;

    const guilherme = specs.find((s) => s.key === "guilherme_bertola");
    const keicy = specs.find((s) => s.key === "keicy_cardoso");
    const leticia = specs.find((s) => s.key === "leticia_cardoso");

    expect(guilherme).toBeDefined();
    expect(guilherme?.email).toBe("vendas18@tecfag.com.br");
    expect(guilherme?.id).toBe("op-1791376760659");

    expect(keicy).toBeDefined();
    expect(keicy?.email).toBe("vendas21@tecfag.com.br");
    expect(keicy?.id).toBe("op-1794490464050");

    expect(leticia).toBeDefined();
    expect(leticia?.rdNames).not.toContain("Keicy Cardoso");
    expect(payload.keicyReassignDealIds.length).toBe(42);
  });

  it("preserva zero duplicatas de empresas (CNPJ/CPF) e contatos (identidade telefônica) no payload", () => {
    const seenDocs = new Set<string>();
    for (const acc of payload.accounts) {
      if (acc.document) {
        const cleanDoc = String(acc.document).replace(/\D/g, "");
        expect(seenDocs.has(cleanDoc)).toBe(false);
        seenDocs.add(cleanDoc);
      }
    }

    const ownerByPhoneIdentity = new Map<string, string>();
    for (const c of payload.contacts) {
      const phones = Array.isArray(c.phones) ? c.phones : [];
      if (c.phone) phones.unshift({ phone: c.phone });
      for (const p of phones) {
        const idKey = pgContactPhoneIdentity(p.phone);
        if (!idKey) continue;
        const prevOwner = ownerByPhoneIdentity.get(idKey);
        if (prevOwner) {
          expect(prevOwner).toBe(c.id);
        } else {
          ownerByPhoneIdentity.set(idKey, c.id);
        }
      }
    }
  });

  it("contém as 4.610 negociações únicas de Peças nas 8 etapas oficiais + 3.864 tarefas 100% vinculadas", () => {
    expect(payload.tenantId).toBe("tecfag");
    expect(payload.deals.length).toBe(4610);

    const pecasStages = payload.stages.filter(
      (s: any) => s.pipeline_id === "pipe-tecfag-pecas",
    );
    expect(pecasStages.length).toBe(8);
    expect(pecasStages.map((s: any) => s.name)).toEqual([
      "LEADS RECEBIDOS",
      "ABORDAGEM COMERCIAL",
      "PENDÊNCIA TÉCNICA",
      "PENDÊNCIA COMERCIAL",
      "PROPOSTA ENVIADA",
      "AGUARDANDO IMPORTAÇÃO",
      "FECHAMENTO",
      "REQUALIFICAÇÃO",
    ]);

    const allValidDealIds = new Set<string>([
      ...payload.deals.map((d: any) => d.id),
      ...payload.fallbackTaskDeals.map((d: any) => d.id),
    ]);
    const allValidAccountIds = new Set<string>(
      payload.accounts.map((a: any) => a.id),
    );
    const allValidContactIds = new Set<string>(
      payload.contacts.map((c: any) => c.id),
    );

    // Vínculo Contato -> Empresa válido
    for (const c of payload.contacts) {
      if (c.account_id) {
        expect(allValidAccountIds.has(c.account_id)).toBe(true);
      }
    }

    // Vínculo Negociação -> Empresa e Negociação -> Contatos válido
    for (const d of payload.deals) {
      if (d.account_id) {
        expect(allValidAccountIds.has(d.account_id)).toBe(true);
      }
    }
    for (const dc of payload.dealContacts) {
      expect(allValidDealIds.has(dc.deal_id)).toBe(true);
      expect(allValidContactIds.has(dc.contact_id)).toBe(true);
    }

    // 100% das 3.864 tarefas vinculadas (3.629 concluídas + 235 abertas = 226 atrasadas + 9 pendentes)
    const tasks = payload.activities.filter((a: any) => a.type !== "note");
    expect(tasks.length).toBe(3864);

    let completed = 0;
    let open = 0;
    for (const t of tasks) {
      expect(allValidDealIds.has(t.deal_id)).toBe(true);
      expect(t.due_date).toBeTruthy();
      if (t.status === "completed") completed++;
      else open++;
    }
    expect(completed).toBe(3629);
    expect(open).toBe(235); // 226 atrasadas + 9 pendentes
  });
});
