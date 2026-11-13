import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pgContactPhoneIdentity } from "../scripts/import-tecfag-suporte-rd-crm.mjs";

const SEED_PATH = path.resolve(
  "scripts/data/tecfag-suporte-rd-crm-2026-11-13.json.gz",
);

describe("Migração RD Station CRM — Funil de Suporte Técnico (Tecfag)", () => {
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

  it("garante match exato por e-mail oficial para a equipe de Suporte Técnico, Pós-Venda e Vinicius", () => {
    const specs = payload.operatorSpecs as Array<{
      key: string;
      id: string;
      email: string;
      name: string;
      rdNames: string[];
    }>;

    const raiane = specs.find((s) => s.key === "raiane_aguiar");
    const mariaVitoria = specs.find((s) => s.key === "maria_vitoria");
    const matheus = specs.find((s) => s.key === "matheus_henrique");
    const lucimara = specs.find((s) => s.key === "lucimara_dal_mora");
    const melissaBueno = specs.find((s) => s.key === "melissa_bueno");
    const vinicius = specs.find((s) => s.key === "vinicius");

    expect(raiane?.email).toBe("assistencia@tecfag.com.br");
    expect(raiane?.id).toBe("op-1791377346185");

    expect(mariaVitoria?.email).toBe("assistencia4@tecfag.com.br");
    expect(mariaVitoria?.id).toBe("op-1791377303454");

    expect(matheus?.email).toBe("assistencia7@tecfag.com.br");
    expect(matheus?.id).toBe("op-1791377324588");

    expect(lucimara?.email).toBe("sac@tecfag.com.br");
    expect(lucimara?.id).toBe("op-1791377140738");

    expect(melissaBueno?.email).toBe("posvenda@tecfag.com.br");
    expect(melissaBueno?.id).toBe("op-1791377157191");

    expect(vinicius?.email).toBe("vendas9@tecfag.com.br");
    expect(vinicius?.id).toBe("op-1793048671367");
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
      const phones = Array.isArray(c.phones) ? [...c.phones] : [];
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

  it("contém as 6.411 negociações únicas de Suporte Técnico nas 12 etapas oficiais (incluindo o delta das 13:29 + 1.288 ex-colaboradores em Testes/Anteriores) e 1.500 tarefas 100% vinculadas", () => {
    expect(payload.tenantId).toBe("tecfag");
    expect(payload.deals.length).toBe(6411);

    const activeDeals = payload.deals.filter(
      (d: any) => d.pipeline_id === "pipe-tecfag-suporte-tecnico",
    );
    const legacyDeals = payload.deals.filter(
      (d: any) => d.pipeline_id === "pipe-tecfag-testes",
    );
    expect(activeDeals.length).toBe(5123);
    expect(legacyDeals.length).toBe(1288);

    // Garante presença explícita dos 5 cards criados entre 11:08 e 13:29 (Nova pasta 70)
    const deltaIds = [
      "deal-rd-6af71a9579ca4f001f06f358", // TIAGO LEITE PERES
      "deal-rd-6af71ad69f72000021f2db95", // TRILHA CERVEJARIA LTDA
      "deal-rd-6af71c9bad1871001f62dd7e", // OTACE ATACADO DE AMENDOIM LTDA
      "deal-rd-6af7206c27606f001d19c148", // BELMA INDUSTRIAL DE GENEROS ALIMENTICIOS LTDA
      "deal-rd-6af73671e205500022986fce", // ASSISTEC MAQUINAS AUTOMATICAS LTDA
    ];
    for (const deltaId of deltaIds) {
      const found = payload.deals.find((d: any) => d.id === deltaId);
      expect(found).toBeDefined();
      expect(found.account_id).toBeTruthy();
    }

    for (const ld of legacyDeals) {
      expect(ld.stage_id).toBe("stg-tf-testes-anteriores");
      expect(ld.operator_key).toBe("vinicius");
      expect(ld.custom_fields?.responsavel_original_rd).toBeTruthy();
      expect(ld.custom_fields?.funil_original_rd).toBeTruthy();
      expect(ld.custom_fields?.etapa_original_rd).toBeTruthy();
    }

    for (const d of payload.deals) {
      expect(String(d.loss_reason || "").toLowerCase()).not.toBe("nada");
    }

    const suporteStages = payload.stages
      .filter((s: any) => s.pipeline_id === "pipe-tecfag-suporte-tecnico")
      .sort((a: any, b: any) => a.order_index - b.order_index);
    expect(suporteStages.length).toBe(12);
    expect(suporteStages.map((s: any) => s.name)).toEqual([
      "TRIAGEM",
      "TROCA EM GARANTIA",
      "SUPORTE",
      "REMESSA DE CONSERTO",
      "RASTREIO",
      "NÃO CONFORME - FRETE",
      "SIMPLES FATURAMENTO",
      "NÃO CONFORME - DEVOLUÇÃO",
      "ASSISTÊNCIA TÉCNICA",
      "VIDEO CHAMADA",
      "DEVOLUÇÃO",
      "FINALIZADOS",
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
    for (const fdc of payload.fallbackDealContacts) {
      expect(allValidDealIds.has(fdc.deal_id)).toBe(true);
      expect(allValidContactIds.has(fdc.contact_id)).toBe(true);
    }

    // 100% das 1.500 tarefas vinculadas (1.247 concluídas + 253 em atraso)
    const tasks = payload.activities.filter((a: any) => a.type !== "note");
    const notes = payload.activities.filter((a: any) => a.type === "note");
    expect(tasks.length).toBe(1500);
    expect(notes.length).toBe(1567);

    const belmaNote = notes.find(
      (n: any) => n.deal_id === "deal-rd-6af7206c27606f001d19c148",
    );
    expect(belmaNote?.description).toContain("POLITAN EQUIPAMENTOS INDUSTRIAIS");

    let completed = 0;
    let open = 0;
    let sharedGuilhermeRaiane = 0;
    for (const t of tasks) {
      expect(allValidDealIds.has(t.deal_id)).toBe(true);
      expect(t.due_date).toBeTruthy();
      if (t.status === "completed") completed++;
      else open++;
      if (
        Array.isArray(t.assignee_keys) &&
        t.assignee_keys.includes("guilherme_bertola") &&
        t.assignee_keys.includes("raiane_aguiar")
      ) {
        sharedGuilhermeRaiane++;
      }
    }
    expect(completed).toBe(1247);
    expect(open).toBe(253);
    expect(sharedGuilhermeRaiane).toBe(11);
  });
});
