// @ts-expect-error bun:test is provided by Bun runtime
import { describe, expect, test } from "bun:test";
import { createTrainingStore, handleTrainingRequest } from "../../onboarding/frame-store";
import { DEFAULT_ADMIN_PERMISSIONS } from "../../rbac";

function makeStore() {
  return createTrainingStore({
    tenantId: "tecfag",
    operatorId: "op-demo-1",
    operatorName: "Déborah Rayane",
    permissions: DEFAULT_ADMIN_PERMISSIONS,
    role: "admin",
    allowedChannels: ["whatsapp"],
    isCommercialConsultant: true,
  });
}

describe("CRM Task Completion with Optional Annotation (completionNote)", () => {
  test("completes task WITH optional completionNote, persisting note on task and creating commercial note", async () => {
    const store = makeStore();
    const targetTask = store.tasks[0];
    const dealId = targetTask.dealId || targetTask.deal?.id;
    const initialTaskTitle = targetTask.title;

    const res = await handleTrainingRequest(
      store,
      `/api/crm/deals/${encodeURIComponent(dealId)}/activities/${encodeURIComponent(targetTask.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          completionNote: "  Cliente confirmou aprovação do orçamento por telefone.  ",
        }),
      }
    );

    expect(res.status).toBe(200);
    expect(targetTask.status).toBe("completed");
    expect(targetTask.completionNote).toBe(
      "Cliente confirmou aprovação do orçamento por telefone."
    );

    const dealNotes = store.tasks.filter(
      (t) => (t.dealId === dealId || t.deal?.id === dealId) && t.type === "note"
    );
    expect(dealNotes).toHaveLength(1);
    expect(dealNotes[0].title).toBe(`Conclusão da tarefa: ${initialTaskTitle}`);
    expect(dealNotes[0].description).toBe(
      "Cliente confirmou aprovação do orçamento por telefone."
    );

    // Repeating completion on an already completed task must not duplicate the note
    await handleTrainingRequest(
      store,
      `/api/crm/deals/${encodeURIComponent(dealId)}/activities/${encodeURIComponent(targetTask.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          completionNote: "Tentativa duplicada",
        }),
      }
    );
    const dealNotesAfterRetry = store.tasks.filter(
      (t) => (t.dealId === dealId || t.deal?.id === dealId) && t.type === "note"
    );
    expect(dealNotesAfterRetry).toHaveLength(1);
  });

  test("completes task WITHOUT completionNote (left blank) without creating any empty note", async () => {
    const store = makeStore();
    const targetTask = store.tasks[0];
    const dealId = targetTask.dealId || targetTask.deal?.id;

    const res = await handleTrainingRequest(
      store,
      `/api/crm/deals/${encodeURIComponent(dealId)}/activities/${encodeURIComponent(targetTask.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          completionNote: "   ",
        }),
      }
    );

    expect(res.status).toBe(200);
    expect(targetTask.status).toBe("completed");
    expect(targetTask.completionNote).toBeUndefined();

    const dealNotes = store.tasks.filter(
      (t) => (t.dealId === dealId || t.deal?.id === dealId) && t.type === "note"
    );
    expect(dealNotes).toHaveLength(0);
  });
});
