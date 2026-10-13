/** Reset legado bloqueado: não executar operações globais em dados multi-tenant. */
throw new Error(
  "Reset legado desativado. Use scripts/reset-tenant-data.mjs com tenant explícito e revise o banco alvo.",
);
export {};
