export type PendingWidgetMessage = {
  id: string;
  createdAt: number;
  displayText: string;
  state: "pending" | "failed";
  payload: { type: "CHAT_MESSAGE" | "PRODUCT_INQUIRY"; messageId: string; [key: string]: unknown };
};
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Persist before send; only persistence ACK removes an intent. Retries keep the same ID. */
export class WidgetMessageOutbox {
  private attempted = new Map<string, number>();
  private acknowledged = new Set<string>();
  private prefix: string;

  constructor(
    private storage: Storage,
    private key: string,
    now = Date.now(),
  ) {
    this.prefix = `${key}:`;
    // One key per intent: different tabs never overwrite the whole visitor queue.
    for (const entry of this.snapshot())
      if (now - entry.createdAt > MAX_AGE_MS) this.fail(entry.id);
  }
  snapshot(): PendingWidgetMessage[] {
    const entries: PendingWidgetMessage[] = [];
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(this.prefix)) continue;
      let value: PendingWidgetMessage;
      try {
        value = JSON.parse(this.storage.getItem(key) || "null");
      } catch {
        continue;
      }
      if (
        value &&
        typeof value.id === "string" &&
        value.id.length <= 200 &&
        key === this.entryKey(value.id) &&
        !this.acknowledged.has(value.id) &&
        typeof value.displayText === "string" &&
        Number.isFinite(value.createdAt) &&
        ["pending", "failed"].includes(value.state) &&
        value.payload?.messageId === value.id &&
        ["CHAT_MESSAGE", "PRODUCT_INQUIRY"].includes(value.payload?.type)
      )
        entries.push(value);
    }
    return entries.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  private entryKey(id: string) {
    return `${this.prefix}${encodeURIComponent(id)}`;
  }
  private save(entry: PendingWidgetMessage) {
    this.storage.setItem(this.entryKey(entry.id), JSON.stringify(entry));
  }
  enqueue(input: Omit<PendingWidgetMessage, "state">) {
    const entries = this.snapshot();
    if (entries.some((entry) => entry.id === input.id))
      throw new Error("Mensagem já está na fila.");
    if (entries.length >= 100)
      throw new Error("Confirme ou descarte as mensagens pendentes antes de continuar.");
    this.save({ ...input, state: "pending" });
  }
  acknowledge(id: string) {
    if (!this.snapshot().some((entry) => entry.id === id)) return false;
    // If local storage fails after an ACK, a reload may replay the same ID safely.
    try {
      this.storage.removeItem(this.entryKey(id));
    } catch {
      this.acknowledged.add(id);
    }
    this.attempted.delete(id);
    return true;
  }
  fail(id: string) {
    const entry = this.snapshot().find((entry) => entry.id === id);
    if (entry) this.save({ ...entry, state: "failed" });
  }
  retry(id: string, now = Date.now()) {
    const entry = this.snapshot().find((entry) => entry.id === id);
    if (entry) this.save({ ...entry, state: "pending", createdAt: now });
    this.attempted.delete(id);
  }
  clear() {
    for (const entry of this.snapshot()) this.storage.removeItem(this.entryKey(entry.id));
    this.attempted.clear();
    this.acknowledged.clear();
  }
  sendNext(
    send: (payload: PendingWidgetMessage["payload"]) => void,
    now = Date.now(),
    force = false,
  ) {
    const entry = this.snapshot().find((value) => value.state === "pending");
    if (!entry) return false;
    if (now - entry.createdAt > MAX_AGE_MS) {
      this.fail(entry.id);
      return false;
    }
    const last = this.attempted.get(entry.id);
    if (!force && last !== undefined && now - last < 10_000) return false;
    this.attempted.set(entry.id, now);
    try {
      send(entry.payload);
      return true;
    } catch {
      return false;
    }
  }
}
