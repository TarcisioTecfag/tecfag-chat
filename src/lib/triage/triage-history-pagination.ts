import { Buffer } from "node:buffer";
import { journalIso } from "./industrial-triage-journal.ts";
export type HistoryMode = "conversations" | "cycles" | "events";
export class HistoryInputError extends Error {}
export interface HistoryCursor {
  version: 1;
  mode: HistoryMode;
  scope: string;
  asOf: string;
  time: string;
  id: string;
}
export function historyPageInput(
  mode: HistoryMode,
  scope: string,
  cursor: string | null,
  rawLimit: string | null,
) {
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new HistoryInputError("Limite inválido; use de 1 a 50.");
  let decoded: HistoryCursor | null = null;
  if (cursor) {
    try {
      if (cursor.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (
        value.version !== 1 ||
        value.mode !== mode ||
        value.scope !== scope ||
        journalIso(value.asOf) !== value.asOf ||
        journalIso(value.time) !== value.time ||
        typeof value.id !== "string" ||
        !value.id ||
        value.id.length > 600 ||
        Date.parse(value.asOf) > Date.now() + 30_000
      )
        throw new Error();
      decoded = value;
    } catch {
      throw new HistoryInputError("Cursor inválido ou de outra consulta.");
    }
  }
  return { limit, cursor: decoded, asOf: decoded?.asOf || new Date().toISOString() };
}
export function historyNextCursor(
  mode: HistoryMode,
  scope: string,
  asOf: string,
  point: { time: string; id: string },
) {
  return Buffer.from(JSON.stringify({ version: 1, mode, scope, asOf, ...point })).toString(
    "base64url",
  );
}
