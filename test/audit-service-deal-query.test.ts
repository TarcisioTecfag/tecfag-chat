import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("audit-service enqueueDealConversationsForAudit SQL", () => {
  it("includes ORDER BY c.updated_at in SELECT DISTINCT projection and enforces tenant isolation", () => {
    const code = readFileSync(resolve("src/lib/audit-service.ts"), "utf-8");
    const methodStart = code.indexOf("async enqueueDealConversationsForAudit(");
    expect(methodStart).toBeGreaterThan(-1);

    const methodEnd = code.indexOf("async scanAndEnqueueEligibleConversations(", methodStart);
    expect(methodEnd).toBeGreaterThan(methodStart);

    const methodBody = code.slice(methodStart, methodEnd);
    const selectDistinctMatch = methodBody.match(
      /SELECT\s+DISTINCT([\s\S]*?)FROM\s+conversations\s+c/i,
    );
    expect(selectDistinctMatch).not.toBeNull();

    const projection = selectDistinctMatch?.[1] ?? "";
    expect(projection).toContain("c.updated_at");
    expect(methodBody).toContain("ORDER BY c.updated_at DESC");
    expect(methodBody).toContain("WHERE c.tenant_id =");
  });
});
