// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  extractPendingClientMessageId,
  isOptimisticPendingMessageId,
  reconcileOrRetryMessage,
} from "../src/lib/whatsapp/reconcile-client";

describe("reconcile-pending-message", () => {
  it("extracts clientMessageId from pending-* optimistic ids and explicit fields", () => {
    expect(isOptimisticPendingMessageId("pending-cmsg-123")).toBe(true);
    expect(isOptimisticPendingMessageId("pending-")).toBe(false);
    expect(isOptimisticPendingMessageId("msg-123")).toBe(false);

    expect(extractPendingClientMessageId("pending-uuid-abc", undefined)).toBe("uuid-abc");
    expect(extractPendingClientMessageId("pending-uuid-abc", "explicit-id")).toBe("explicit-id");
    expect(extractPendingClientMessageId("msg-real-1", undefined)).toBeNull();
  });

  it("resends locally with same clientMessageId when pending-* returns 404 from server (Maria Vitoria / Firefox NetworkError case)", async () => {
    const apiCalls: any[] = [];
    const localResends: string[] = [];
    let promptCalls = 0;

    const outcome = await reconcileOrRetryMessage({
      messageId: "pending-intent-999",
      clientMessageId: "intent-999",
      action: "resend",
      uncertain: true,
      confirmPrompt: () => {
        promptCalls++;
        return true;
      },
      callReconcileApi: async (payload) => {
        apiCalls.push(payload);
        return {
          status: 404,
          ok: false,
          body: { error: "Envio não encontrado.", code: "MESSAGE_NOT_FOUND" },
        };
      },
      resendLocally: async (clientId) => {
        localResends.push(clientId);
        return true;
      },
    });

    expect(outcome).toEqual({ outcome: "resent_locally" });
    expect(promptCalls).toBe(0);
    expect(apiCalls).toEqual([
      {
        messageId: "pending-intent-999",
        clientMessageId: "intent-999",
        action: "resend",
        confirmNotDelivered: false,
      },
    ]);
    expect(localResends).toEqual(["intent-999"]);
  });

  it("prevents duplicate send when pending-* actually reached the server and is already accepted", async () => {
    let localResendCalled = false;

    const outcome = await reconcileOrRetryMessage({
      messageId: "pending-intent-already-sent",
      clientMessageId: "intent-already-sent",
      action: "resend",
      uncertain: true,
      confirmPrompt: () => true,
      callReconcileApi: async () => ({
        status: 200,
        ok: true,
        body: { success: true, messageId: "msg-real-777", status: "accepted" },
      }),
      resendLocally: async () => {
        localResendCalled = true;
        return true;
      },
    });

    expect(outcome).toEqual({
      outcome: "reconciled_on_server",
      result: { success: true, messageId: "msg-real-777", status: "accepted" },
    });
    expect(localResendCalled).toBe(false);
  });

  it("asks confirmation only if server found pending-* in uncertain state (409 DELIVERY_CONFIRMATION_REQUIRED)", async () => {
    const apiCalls: any[] = [];
    let promptCalls = 0;

    const outcome = await reconcileOrRetryMessage({
      messageId: "pending-intent-uncertain",
      action: "resend",
      uncertain: true,
      confirmPrompt: () => {
        promptCalls++;
        return true;
      },
      callReconcileApi: async (payload) => {
        apiCalls.push(payload);
        if (!payload.confirmNotDelivered) {
          return {
            status: 409,
            ok: false,
            body: {
              error: "Confira o histórico do WhatsApp antes de reenviar.",
              code: "DELIVERY_CONFIRMATION_REQUIRED",
            },
          };
        }
        return {
          status: 200,
          ok: true,
          body: { success: true, messageId: "msg-real-888", status: "accepted" },
        };
      },
      resendLocally: async () => false,
    });

    expect(promptCalls).toBe(1);
    expect(apiCalls.length).toBe(2);
    expect(apiCalls[0].confirmNotDelivered).toBe(false);
    expect(apiCalls[0].clientMessageId).toBe("intent-uncertain");
    expect(apiCalls[1].confirmNotDelivered).toBe(true);
    expect(outcome).toEqual({
      outcome: "reconciled_on_server",
      result: { success: true, messageId: "msg-real-888", status: "accepted" },
    });
  });

  it("explains clearly instead of 404 when operator clicks 'Já foi enviado' on pending-* that never reached server", async () => {
    let promptCalls = 0;

    const outcome = await reconcileOrRetryMessage({
      messageId: "pending-intent-never-arrived",
      clientMessageId: "intent-never-arrived",
      action: "confirm_sent",
      uncertain: true,
      confirmPrompt: () => {
        promptCalls++;
        return true;
      },
      callReconcileApi: async () => ({
        status: 404,
        ok: false,
        body: { error: "Envio não encontrado.", code: "MESSAGE_NOT_FOUND" },
      }),
      resendLocally: async () => false,
    });

    expect(promptCalls).toBe(1);
    expect(outcome.outcome).toBe("not_found_on_server_for_confirm");
    if (outcome.outcome === "not_found_on_server_for_confirm") {
      expect(outcome.error).toContain("não chegou ao servidor");
      expect(outcome.error).toContain("Reenviar");
    }
  });

  it("preserves confirmation requirement for persisted server messages in uncertain state", async () => {
    let apiCalled = false;

    const outcome = await reconcileOrRetryMessage({
      messageId: "msg-persisted-1",
      action: "resend",
      uncertain: true,
      confirmPrompt: () => false,
      callReconcileApi: async () => {
        apiCalled = true;
        return { status: 200, ok: true, body: { success: true } };
      },
      resendLocally: async () => false,
    });

    expect(outcome).toEqual({ outcome: "cancelled" });
    expect(apiCalled).toBe(false);
  });

  it("enforces multi-tenant isolation and idempotencyKey fallback in reconcile-message route", () => {
    const routeCode = readFileSync(
      resolve("src/routes/api/chats/reconcile-message.ts"),
      "utf-8",
    );
    expect(routeCode).toContain("requireSession(request)");
    expect(routeCode).toContain("eq(messages.tenantId, tenantId)");
    expect(routeCode).toContain("eq(messages.idempotencyKey, fallbackClientMessageId)");
    expect(routeCode).toContain("MESSAGE_NOT_FOUND");
    expect(routeCode).toContain("DELIVERY_CONFIRMATION_REQUIRED");
  });
});
