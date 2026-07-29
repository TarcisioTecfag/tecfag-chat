/**
 * gestao-filter.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Helper compartilhado para o Módulo de Monitoramento da Operação.
 *
 * REGRA DE NEGÓCIO: Apenas operadores cadastrados no setor "Comercial"
 * (nome contendo "comercial", case-insensitive) devem aparecer e ser
 * contabilizados no painel de Monitoramento da Operação.
 *
 * Se o tenant não tiver nenhum setor "Comercial" configurado, retorna
 * uma string vazia (`null`) para indicar que não há filtro disponível e o
 * chamador deve decidir como tratar (retornar lista vazia ou sem filtro).
 */

import { db } from "../db";
import { sectors } from "../db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Retorna os IDs dos operadores que pertencem ao setor "Comercial" do tenant.
 * - Busca TODOS os setores do tenant cujo nome contenha "comercial" (ILIKE).
 * - Une os arrays `operatorIds` de todos os setores encontrados.
 * - Retorna `null` se nenhum setor "Comercial" for encontrado (sem restrição).
 */
export async function getComercialOperatorIds(tenantId: string): Promise<string[] | null> {
  try {
    // ILIKE case-insensitive via sql`` do Drizzle
    const comercialSectors = await db
      .select({ operatorIds: sectors.operatorIds })
      .from(sectors)
      .where(
        sql`${sectors.tenantId} = ${tenantId}
        AND LOWER(${sectors.name}) LIKE '%comercial%'`
      );

    if (comercialSectors.length === 0) {
      // Nenhum setor Comercial cadastrado → sem filtro (retorna null)
      return null;
    }

    // Une e deduplica os IDs de todos os setores Comerciais encontrados
    const allIds = comercialSectors.flatMap((s) => s.operatorIds ?? []);
    const uniqueIds = [...new Set(allIds)];

    return uniqueIds;
  } catch (e) {
    console.warn("[gestao-filter] Erro ao buscar setor Comercial:", e);
    return null;
  }
}
