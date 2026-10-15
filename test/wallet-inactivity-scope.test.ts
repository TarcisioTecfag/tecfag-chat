import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isAiWalletContact,
  resolveWalletTargetOperatorId,
} from "../src/routes/api/contacts/check-inactivity";

describe("Wallet Inactivity Individual Scope & Real Chat Clients", () => {
  it("isolates targetOperatorId to the logged-in operator by default", () => {
    const operatorSession = {
      operator: { id: "op-tarcisio", role: "operator" },
    };
    const adminSession = {
      operator: { id: "op-admin", role: "admin" },
    };

    expect(
      resolveWalletTargetOperatorId(
        operatorSession,
        new URL("http://localhost/api/contacts/check-inactivity?tenantId=tecfag")
      )
    ).toBe("op-tarcisio");

    // Non-admin cannot inspect another operator's wallet or global scope
    expect(
      resolveWalletTargetOperatorId(
        operatorSession,
        new URL("http://localhost/api/contacts/check-inactivity?operatorId=op-other&scope=global")
      )
    ).toBe("op-tarcisio");

    // Admin defaults to their own wallet on Minha Carteira unless operatorId or scope=global is passed
    expect(
      resolveWalletTargetOperatorId(
        adminSession,
        new URL("http://localhost/api/contacts/check-inactivity?tenantId=tecfag")
      )
    ).toBe("op-admin");

    expect(
      resolveWalletTargetOperatorId(
        adminSession,
        new URL("http://localhost/api/contacts/check-inactivity?operatorId=op-tarcisio")
      )
    ).toBe("op-tarcisio");

    expect(
      resolveWalletTargetOperatorId(
        adminSession,
        new URL("http://localhost/api/contacts/check-inactivity?scope=global")
      )
    ).toBeNull();
  });

  it("identifies AI assistant contacts (Fagner / Valentina) and excludes them from inactivity", () => {
    expect(isAiWalletContact({ id: "fagner", name: "Fagner" }, "tecfag")).toBe(true);
    expect(isAiWalletContact({ id: "ct-1", name: "Fagner IA" }, "tecfag")).toBe(true);
    expect(isAiWalletContact({ id: "valentina", name: "Valentina" }, "valem")).toBe(true);

    expect(isAiWalletContact({ id: "ct-somolas", name: "somolas" }, "tecfag")).toBe(false);
    expect(isAiWalletContact({ id: "ct-leticia", name: "Leticia Frasio" }, "tecfag")).toBe(false);
  });

  it("uses requireSession and innerJoin(conversations) in check-inactivity.ts and passes operatorId in WalletView.tsx", () => {
    const apiSource = readFileSync(
      resolve(process.cwd(), "src/routes/api/contacts/check-inactivity.ts"),
      "utf-8"
    );
    const viewSource = readFileSync(
      resolve(process.cwd(), "src/components/chat/WalletView.tsx"),
      "utf-8"
    );

    expect(apiSource).toContain("requireSession(request)");
    expect(apiSource).toContain(".innerJoin(");
    expect(apiSource).not.toContain(".leftJoin(conversations");
    expect(apiSource).toContain("eq(contacts.walletOperatorId, targetOperatorId)");

    expect(viewSource).toContain("operatorId: currentOperatorId");
    expect(viewSource).toContain("{realWalletClients.length}");
  });
});
