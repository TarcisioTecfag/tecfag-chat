type SelectionStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): SelectionStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

const selectionKey = (tenantId: string) => `rd-marketing:selected-flow:${tenantId}`;

// Guarda somente a preferência de seleção. Configuração e segredo pertencem ao servidor.
export function rememberRdMarketingFlow(
  tenantId: string,
  flowId: string,
  storage: SelectionStorage | undefined = browserStorage(),
) {
  if (!flowId) return;
  try {
    storage?.setItem(selectionKey(tenantId), flowId);
  } catch {
    // O painel continua funcionando quando o navegador bloqueia armazenamento local.
  }
}

export function restoreRdMarketingFlow<T extends { id: string }>(
  tenantId: string,
  flows: T[],
  storage: SelectionStorage | undefined = browserStorage(),
): T | null {
  try {
    const preferredId = storage?.getItem(selectionKey(tenantId));
    return flows.find((flow) => flow.id === preferredId) ?? flows[0] ?? null;
  } catch {
    return flows[0] ?? null;
  }
}
