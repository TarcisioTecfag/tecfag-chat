export type BrowserIntent = {
  id: string;
  tenantId: string;
  operatorId: string;
  conversationId: string;
  text: string;
  isInternal: boolean;
  expectedContextVersion?: number;
  noteScope?: "current" | "general";
  attachments?: File[];
  audioBlob?: Blob | null;
  quoted?: { id: string; sender: string; content: string } | null;
  createdAt: number;
};

async function openOutbox() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("chat-pending-intents", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("intents", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operate<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openOutbox();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = database.transaction("intents", mode);
      const request = action(tx.objectStore("intents"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Armazenamento local indisponível."));
    });
  } finally {
    database.close();
  }
}
const trainingIntents = new Map<string, BrowserIntent>();
const inTrainingFrame = () => typeof document !== "undefined" && Boolean(document.documentElement.dataset.trainingInstalled);
export const saveBrowserIntent = (intent: BrowserIntent) => {
  if (inTrainingFrame()) { trainingIntents.set(intent.id, intent); return Promise.resolve<IDBValidKey>(intent.id); }
  return operate("readwrite", (store) => store.put(intent));
};
export const removeBrowserIntent = (id: string) => {
  if (inTrainingFrame()) { trainingIntents.delete(id); return Promise.resolve(); }
  return operate("readwrite", (store) => store.delete(id));
};
export async function readBrowserIntents(tenantId: string, operatorId: string) {
  const rows = inTrainingFrame() ? [...trainingIntents.values()] : (await operate("readonly", (store) => store.getAll())) as BrowserIntent[];
  return rows
    .filter((row) => row.tenantId === tenantId && row.operatorId === operatorId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
