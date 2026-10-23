/** Pure compatibility helpers. Never discard stored fields when editing a group. */
export const PERMISSION_KEY_ALIASES = {
  views: { wallets: "wallet" },
  chat: { canChangeWalletOperator: "canChangeWallet" },
  ligacoes: {
    canAccessHistorico: "canAccessHistory",
    canAccessClientes: "canAccessClients",
    canManageCampanhas: "canManageCampaigns",
    canManageObjetivos: "canManageObjectives",
  },
  monitor: { canAccessOperators: "canAccessRanking", canAccessSite: "canAccessSiteVisitors" },
  analytics: { canAccessReports: "canAccessAiReports" },
  security: { canManageGroups: "canManageAccessGroups" },
  settings: {
    canAccessWhatsappSettings: "canManageWhatsapp",
    canAccessVozSettings: "canManageVoiceSettings",
    canAccessRdSettings: "canManageRdCrmSettings",
    canAccessEmailSettings: "canManageEmailSmtp",
    canAccessLiveChatSettings: "canManageLiveChatSettings",
  },
} as const;

export function isPlainRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Explicit canonical values always win, including false. Alias values remain in storage. */
export function resolvePermissionAliases(value: unknown): Record<string, any> {
  if (!isPlainRecord(value)) return {};
  const result = structuredClone(value);
  for (const [category, aliases] of Object.entries(PERMISSION_KEY_ALIASES)) {
    if (!isPlainRecord(result[category])) continue;
    for (const [alias, canonical] of Object.entries(aliases)) {
      if (result[category][canonical] === undefined && typeof result[category][alias] === "boolean") {
        result[category][canonical] = result[category][alias];
      }
    }
  }
  return result;
}

/** Merge only the submitted categories/keys; preserve unknown, legacy and future settings. */
export function mergeGroupPermissions(current: unknown, patch: unknown): Record<string, any> {
  if (!isPlainRecord(patch)) throw new Error("Permissões devem ser um objeto.");
  const merged = isPlainRecord(current) ? structuredClone(current) : {};
  for (const [category, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(category)) throw new Error("Categoria inválida.");
    if (!isPlainRecord(value)) {
      if (Object.hasOwn(merged, category) && canonicalJson(merged[category]) === canonicalJson(value)) continue;
      throw new Error(`Categoria de permissão inválida: ${category}.`);
    }
    const previous = isPlainRecord(merged[category]) ? merged[category] : {};
    for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Permissão inválida.");
    }
    merged[category] = { ...previous, ...structuredClone(value) };
  }
  return merged;
}

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
