import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Aceleração Global de UI & CSS Hardware Compositing (Fase 4)", () => {
  it("garante que styles.css possui utilities de GPU e content-visibility", () => {
    const cssPath = resolve(__dirname, "../src/styles.css");
    const cssCode = readFileSync(cssPath, "utf-8");

    expect(cssCode).toContain("@utility gpu-layer");
    expect(cssCode).toContain("transform: translateZ(0);");
    expect(cssCode).toContain("@utility gpu-transform");
    expect(cssCode).toContain("transform: translate3d(0, 0, 0);");
    expect(cssCode).toContain("@utility content-visibility-auto");
    expect(cssCode).toContain("content-visibility: auto;");
    expect(cssCode).toContain("@utility contain-paint");
    expect(cssCode).toContain("contain: layout paint style;");
  });

  it("garante que DialogOverlay e DialogContent possuem will-change para compositing", () => {
    const dialogPath = resolve(__dirname, "../src/components/ui/dialog.tsx");
    const dialogCode = readFileSync(dialogPath, "utf-8");

    expect(dialogCode).toContain("will-change-[opacity]");
    expect(dialogCode).toContain("will-change-[transform,opacity]");
  });

  it("garante que Sheet e SheetOverlay possuem will-change para compositing suave", () => {
    const sheetPath = resolve(__dirname, "../src/components/ui/sheet.tsx");
    const sheetCode = readFileSync(sheetPath, "utf-8");

    expect(sheetCode).toContain("will-change-[opacity]");
    expect(sheetCode).toContain("will-change-[transform,opacity]");
  });

  it("garante que TooltipContent possui will-change para evitar engasgos ao passar o mouse", () => {
    const tooltipPath = resolve(__dirname, "../src/components/ui/tooltip.tsx");
    const tooltipCode = readFileSync(tooltipPath, "utf-8");

    expect(tooltipCode).toContain("will-change-[transform,opacity]");
  });

  it("garante que PopoverContent possui will-change para animações fluidas na GPU", () => {
    const popoverPath = resolve(__dirname, "../src/components/ui/popover.tsx");
    const popoverCode = readFileSync(popoverPath, "utf-8");

    expect(popoverCode).toContain("will-change-[transform,opacity]");
  });

  it("garante que ChatList e DealList usam content-visibility-auto para alívio de CPU", () => {
    const chatListPath = resolve(__dirname, "../src/components/chat/ChatList.tsx");
    const dealListPath = resolve(__dirname, "../src/components/crm/DealList.tsx");

    const chatListCode = readFileSync(chatListPath, "utf-8");
    const dealListCode = readFileSync(dealListPath, "utf-8");

    expect(chatListCode).toContain("content-visibility-auto");
    expect(dealListCode).toContain("content-visibility-auto");
  });
});
