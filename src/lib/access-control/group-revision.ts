import { createHash } from "node:crypto";
import { canonicalJson } from "./group-settings";

/** Content revision works with the existing schema; no destructive migration is needed. */
export function groupRevision(group: Record<string, unknown>): string {
  const { revision: _revision, expectedRevision: _expectedRevision, ...stored } = group;
  return createHash("sha256").update(canonicalJson(stored)).digest("hex");
}

export function withGroupRevision<T extends Record<string, unknown>>(group: T) {
  return { ...group, revision: groupRevision(group) };
}
