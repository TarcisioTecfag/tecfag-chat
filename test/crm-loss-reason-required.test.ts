import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  LOSS_REASON_REQUIRED_CODE,
  LOSS_REASON_REQUIRED_MESSAGE,
  normalizeLossReasonInput,
  resolveRequiredLossReason,
} from "../src/lib/crm/loss-reason-policy";

describe("Obrigatoriedade do motivo de perda no CRM", () => {
  it("normaliza entradas vazias, espaços e placeholder __none__ para null", () => {
    expect(normalizeLossReasonInput(undefined)).toBeNull();
    expect(normalizeLossReasonInput(null)).toBeNull();
    expect(normalizeLossReasonInput("")).toBeNull();
    expect(normalizeLossReasonInput("   ")).toBeNull();
    expect(normalizeLossReasonInput("__none__")).toBeNull();
    expect(normalizeLossReasonInput("  Preço elevado  ")).toBe("Preço elevado");
  });

  it("bloqueia marcar como perdida sem motivo de perda", () => {
    const res = resolveRequiredLossReason({
      currentStatus: "open",
      currentLossReason: null,
      nextStatus: "lost",
      explicitStatus: "lost",
      incomingLossReason: undefined,
    });
    expect(res).toEqual({
      ok: false,
      error: LOSS_REASON_REQUIRED_MESSAGE,
      code: LOSS_REASON_REQUIRED_CODE,
    });
  });

  it("bloqueia marcar como perdida quando motivo vem vazio, espaços ou __none__", () => {
    for (const invalid of ["", "   ", null, "__none__"]) {
      const res = resolveRequiredLossReason({
        currentStatus: "open",
        currentLossReason: null,
        nextStatus: "lost",
        explicitStatus: "lost",
        incomingLossReason: invalid,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe(LOSS_REASON_REQUIRED_CODE);
      }
    }
  });

  it("bloqueia mover para etapa de perda (nextStatus='lost' implícito) sem motivo", () => {
    const res = resolveRequiredLossReason({
      currentStatus: "open",
      currentLossReason: null,
      nextStatus: "lost",
      explicitStatus: undefined,
      incomingLossReason: undefined,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(LOSS_REASON_REQUIRED_CODE);
    }
  });

  it("permite marcar como perdida quando motivo de perda válido é informado", () => {
    const res = resolveRequiredLossReason({
      currentStatus: "open",
      currentLossReason: null,
      nextStatus: "lost",
      explicitStatus: "lost",
      incomingLossReason: "  Fechou com concorrente  ",
    });
    expect(res).toEqual({
      ok: true,
      lossReason: "Fechou com concorrente",
    });
  });

  it("bloqueia limpar motivo de perda enquanto negociação permanece perdida", () => {
    const res = resolveRequiredLossReason({
      currentStatus: "lost",
      currentLossReason: "Fechou com concorrente",
      nextStatus: undefined,
      explicitStatus: undefined,
      incomingLossReason: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe(LOSS_REASON_REQUIRED_CODE);
    }
  });

  it("permite editar outros campos de negociação legada já perdida sem re-enviar status ou limpar motivo", () => {
    const res = resolveRequiredLossReason({
      currentStatus: "lost",
      currentLossReason: null,
      nextStatus: undefined,
      explicitStatus: undefined,
      incomingLossReason: undefined,
    });
    expect(res).toEqual({
      ok: true,
      lossReason: undefined,
    });
  });

  it("permite reabrir negociação perdida limpando lossReason para null", () => {
    const res = resolveRequiredLossReason({
      currentStatus: "lost",
      currentLossReason: "Fechou com concorrente",
      nextStatus: "open",
      explicitStatus: "open",
      incomingLossReason: null,
    });
    expect(res).toEqual({
      ok: true,
      lossReason: null,
    });
  });

  it("garante nos componentes de UI e rotas que não existe fallback silencioso sem motivo de perda", () => {
    const root = path.resolve(import.meta.dir, "..");
    const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

    const dealDetail = read("src/components/crm/DealDetailModal.tsx");
    expect(dealDetail).toContain("disabled={!lossReason.trim()}");
    expect(dealDetail).toContain("if (!trimmedReason)");

    const stageTerminal = read("src/components/crm/StageTerminalConfirmDialog.tsx");
    expect(stageTerminal).not.toContain("Perdido sem motivo informado");
    expect(stageTerminal).toContain("disabled={!isWin && !canConfirmLoss}");

    const bulkSuite = read("src/components/crm/BulkActionsSuite.tsx");
    expect(bulkSuite).not.toContain("Motivo da Perda (Opcional)");
    expect(bulkSuite).toContain("disabled={loading || !lossReasonText.trim()}");
    expect(bulkSuite).toContain("selectedMoveStage?.isLossStage");

    const evidenceDialog = read("src/components/commercial/CommercialEvidenceDialog.tsx");
    expect(evidenceDialog).toContain('const [lossReason, setLossReason] = useState("")');
    expect(evidenceDialog).not.toContain("<select");
    expect(evidenceDialog).toContain("disabled={submitting || !lossReason.trim()}");

    const evidenceRoute = read("src/routes/api/commercial/directives/$directiveId/evidence.ts");
    expect(evidenceRoute).toContain('if (nextAction === "lost" && !lossReason)');
    expect(evidenceRoute).not.toContain("Perda informada na tratativa");
  });
});
