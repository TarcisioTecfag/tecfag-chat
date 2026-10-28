import { OPERATIONAL_READINESS_SQL } from "./operational-schema";

/** Endpoint público: consulta apenas infraestrutura, nunca dados de tenants. */
export async function readinessResponse(probe?: () => Promise<boolean>, timeoutMs = 5000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dbName: string | undefined;
  try {
    const ready = await Promise.race([
      (
        probe ||
        (async () => {
          const { client } = await import("../db");
          const query = client.unsafe(OPERATIONAL_READINESS_SQL);
          const cancel = setTimeout(() => query.cancel(), timeoutMs);
          try {
            const [row] = await query;
            dbName = row.db_name;
            return Boolean(row.ready);
          } finally {
            clearTimeout(cancel);
          }
        })
      )(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    return Response.json(
      {
        status: ready ? "ok" : "unavailable",
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV !== "production" && dbName ? { dbName } : {}),
      },
      { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unavailable", timestamp: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}
