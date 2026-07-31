import { AuthenticationState, initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import { db } from "../../db";
import { channelConfigs } from "../../db/schema";
import { eq } from "drizzle-orm";

/**
 * Estado de autenticação Baileys persistido no PostgreSQL (campo baileysAuthKeys).
 * 
 * REGRA SIMPLES:
 * - Se há chaves no banco → carregar e usar (reconectar sem QR)
 * - Se não há chaves → iniciar do zero (vai gerar QR)
 * - NUNCA apagar chaves por causa de status ou de sock.user ser null
 *   (sock.user é null durante a transição QR→autenticado — isso é normal)
 */
export async function useDrizzleAuthState(
  tenantId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const config = await db.query.channelConfigs.findFirst({
    where: eq(channelConfigs.tenantId, tenantId),
  });

  if (!config) {
    throw new Error(
      `[drizzle-auth] Nenhum channelConfig encontrado para tenant "${tenantId}". Execute a seed.`
    );
  }

  // Estado em memória — compartilhado entre get/set/save
  const authData: { creds: any; keys: Record<string, any> } = {
    creds: null,
    keys: {},
  };

  // Carregar do banco se existir
  if (config.baileysAuthKeys) {
    try {
      const raw = JSON.stringify(config.baileysAuthKeys);
      const parsed = JSON.parse(raw, BufferJSON.reviver);
      if (parsed?.creds) {
        authData.creds = parsed.creds;
        authData.keys = parsed.keys || {};
        console.log(`[drizzle-auth] ✅ Credenciais carregadas do banco para tenant "${tenantId}"`);
      } else {
        console.warn(`[drizzle-auth] Chaves no banco mal formadas para "${tenantId}" — iniciando sessão limpa`);
      }
    } catch (e) {
      console.error(`[drizzle-auth] Erro ao parsear chaves do banco para "${tenantId}":`, e);
    }
  }

  // Se não carregou credenciais válidas, iniciar do zero (vai pedir QR)
  if (!authData.creds) {
    console.log(`[drizzle-auth] Nenhuma credencial — sessão nova para tenant "${tenantId}" (QR será gerado)`);
    authData.creds = initAuthCreds();
  }

  const saveState = async () => {
    try {
      const jsonb = JSON.parse(JSON.stringify(authData, BufferJSON.replacer));
      await db
        .update(channelConfigs)
        .set({ baileysAuthKeys: jsonb, updatedAt: new Date() })
        .where(eq(channelConfigs.tenantId, tenantId));
    } catch (e) {
      console.error(`[drizzle-auth] Erro ao salvar credenciais para tenant "${tenantId}":`, e);
    }
  };

  return {
    state: {
      creds: authData.creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: Record<string, any> = {};
          for (const id of ids) {
            const val = authData.keys[`${type}:${id}`];
            if (val !== undefined) result[id] = val;
          }
          return result;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          for (const category in data) {
            for (const id in data[category]) {
              const key = `${category}:${id}`;
              if (data[category][id] != null) {
                authData.keys[key] = data[category][id];
              } else {
                delete authData.keys[key];
              }
            }
          }
          await saveState();
        },
      },
    },
    saveCreds: saveState,
  };
}
