import { lazy, type ComponentType } from "react";
import { isMissingAssetError, reloadForMissingAsset } from "./asset-recovery";

/**
 * Utilitário de lazy loading com retry automático e auto-reload para chunks desatualizados pós-deploy.
 * Quando um novo deploy ocorre na nuvem (Railway/Vercel/Cloudflare), os hashes de chunks dos arquivos .js
 * mudam. Se a aba do navegador estiver aberta em uma sessão anterior, dynamic imports para módulos não
 * visitados retornam HTTP 404 (TypeError: Failed to fetch dynamically imported module).
 *
 * Este wrapper intercepta esse erro e executa um reload forçado e transparente da página, trazendo
 * a versão mais recente em produção sem quebrar o app nem derrubar para a ErrorBoundary.
 */
export function lazyWithRetry(factory: () => Promise<Record<string, unknown>>, exportName: string) {
  return lazy(async () => {
    try {
      const module = await factory();
      const component = module[exportName] ?? module.default;
      if (!component) {
        throw new Error(`Componente ${exportName} não encontrado no módulo.`);
      }
      return { default: component as ComponentType };
    } catch (error) {
      console.warn("[lazyWithRetry] Falha ao importar módulo dinâmico:", error);

      if (isMissingAssetError(error) && reloadForMissingAsset()) {
        // Mantém o Suspense até a navegação. Se a tentativa já ocorreu, o erro
        // segue para a boundary, que oferece uma recarga manual.
        return new Promise<never>(() => {});
      }

      throw error;
    }
  });
}
