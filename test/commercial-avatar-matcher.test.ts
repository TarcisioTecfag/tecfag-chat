import { describe, expect, it } from "bun:test";
import {
  cleanConsultantName,
  matchConsultantNames,
  buildConsultantAvatarResolver,
} from "@/lib/commercial/avatar-matcher";

describe("Commercial Avatar Matcher & Resolver (Espelhamento Global)", () => {
  describe("cleanConsultantName", () => {
    it("deve normalizar acentos e converter para minúsculas", () => {
      expect(cleanConsultantName("José Álvares")).toBe("jose alvares");
      expect(cleanConsultantName("Andréia")).toBe("andreia");
    });

    it("deve remover sufixos de ramal do CRM como '- 96', '- 95', '- 102'", () => {
      expect(cleanConsultantName("Beatriz Ribeiro - 96")).toBe("beatriz ribeiro");
      expect(cleanConsultantName("Victor Goes - 95")).toBe("victor goes");
      expect(cleanConsultantName("Jhordan Rueda - 102")).toBe("jhordan rueda");
      expect(cleanConsultantName("Rosenvaldo Lucas - 121")).toBe("rosenvaldo lucas");
      expect(cleanConsultantName("Marcelo Nardelli - 110")).toBe("marcelo nardelli");
    });

    it("deve remover sufixo (inativo) e espaços extras", () => {
      expect(cleanConsultantName("Carlos Silva (inativo)")).toBe("carlos silva");
      expect(cleanConsultantName("  Diana   Gimenes   ")).toBe("diana gimenes");
    });

    it("deve tratar strings vazias ou nulas com segurança", () => {
      expect(cleanConsultantName("")).toBe("");
    });
  });

  describe("matchConsultantNames", () => {
    it("deve corresponder nome limpo com nome com ramal", () => {
      expect(matchConsultantNames("Beatriz Ribeiro", "Beatriz Ribeiro - 96")).toBe(true);
      expect(matchConsultantNames("Victor Goes - 95", "Victor Goes")).toBe(true);
      expect(matchConsultantNames("Jhordan Rueda", "Jhordan Rueda - 102")).toBe(true);
    });

    it("deve corresponder nomes com inversão de prenome e sobrenome", () => {
      expect(matchConsultantNames("Rosenvaldo Lucas", "Lucas Rosenvaldo - 121")).toBe(true);
    });

    it("não deve corresponder consultores diferentes", () => {
      expect(matchConsultantNames("Beatriz Ribeiro", "Diana Gimenes")).toBe(false);
      expect(matchConsultantNames("Victor Goes", "Marcelo Nardelli")).toBe(false);
    });
  });

  describe("buildConsultantAvatarResolver", () => {
    const mockConsultants = [
      {
        operatorId: "op-1791-beatriz",
        name: "Beatriz Ribeiro",
        avatar: "https://valem.com/avatars/beatriz.png",
      },
      {
        operatorId: "op-1791-victor",
        name: "Victor Goes",
        avatarUrl: "https://valem.com/avatars/victor.jpg",
      },
      {
        id: "op-1791-jhordan",
        name: "Jhordan Rueda",
        avatar: "https://valem.com/avatars/jhordan.webp",
      },
      {
        operatorId: "op-1791-rosenvaldo",
        name: "Rosenvaldo Lucas",
        avatar: "https://valem.com/avatars/rosenvaldo.png",
      },
    ];

    it("deve instanciar com array vazio sem erros", () => {
      const resolver = buildConsultantAvatarResolver();
      expect(resolver.getAvatar("op-inexistente")).toBeUndefined();
    });

    it("deve resolver foto por ID exato de operador", () => {
      const resolver = buildConsultantAvatarResolver([mockConsultants]);
      expect(resolver.getAvatar("op-1791-beatriz")).toBe("https://valem.com/avatars/beatriz.png");
      expect(resolver.getAvatar("op-1791-victor")).toBe("https://valem.com/avatars/victor.jpg");
    });

    it("deve resolver foto por nome quando ID vier de outro sistema ou nulo", () => {
      const resolver = buildConsultantAvatarResolver([mockConsultants]);
      expect(resolver.getAvatar(null, "Beatriz Ribeiro")).toBe("https://valem.com/avatars/beatriz.png");
    });

    it("deve resolver foto com sucesso quando nome do CRM contiver sufixo de ramal (- 96, - 102)", () => {
      const resolver = buildConsultantAvatarResolver([mockConsultants]);
      expect(resolver.getAvatar("crm-user-96", "Beatriz Ribeiro - 96")).toBe(
        "https://valem.com/avatars/beatriz.png",
      );
      expect(resolver.getAvatar(undefined, "Victor Goes - 95")).toBe(
        "https://valem.com/avatars/victor.jpg",
      );
      expect(resolver.getAvatar(null, "Jhordan Rueda - 102")).toBe(
        "https://valem.com/avatars/jhordan.webp",
      );
    });

    it("deve resolver foto com inversão de nome (Rosenvaldo Lucas vs Lucas Rosenvaldo - 121)", () => {
      const resolver = buildConsultantAvatarResolver([mockConsultants]);
      expect(resolver.getAvatar(undefined, "Lucas Rosenvaldo - 121")).toBe(
        "https://valem.com/avatars/rosenvaldo.png",
      );
    });

    it("deve retornar undefined se o consultor não tiver foto cadastrada", () => {
      const resolver = buildConsultantAvatarResolver([mockConsultants]);
      expect(resolver.getAvatar("op-desconhecido", "Consultor Fantasma")).toBeUndefined();
    });
  });
});
