import { AuthenticationState, initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import { db } from "../../db";
import { channelConfigs } from "../../db/schema";
import { eq } from "drizzle-orm";

export async function useDrizzleAuthState(
  tenantId: string
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  // Garantir que existe registro no banco para este tenant
  let config = await db.query.channelConfigs.findFirst({
    where: eq(channelConfigs.tenantId, tenantId),
  });

  if (!config) {
    throw new Error(`[drizzle-auth] Nenhum channelConfig encontrado para tenant ${tenantId}. Verifique se a seed foi executada corretamente.`);
  }

  // Estado de autenticação em memória — será persistido via saveState()
  const authData: { creds: any; keys: { [key: string]: any } } = {
    creds: null,
    keys: {},
  };

  // Tentar carregar chaves existentes do banco
  if (config.baileysAuthKeys) {
    try {
      const rawStr = JSON.stringify(config.baileysAuthKeys);
      const parsed = JSON.parse(rawStr, BufferJSON.reviver);
      if (parsed?.creds) {
        authData.creds = parsed.creds;
        authData.keys = parsed.keys || {};
        console.log(`[drizzle-auth] Chaves de autenticação carregadas do banco para tenant ${tenantId}`);
      } else {
        console.warn(`[drizzle-auth] Chaves no banco estão em formato inválido para tenant ${tenantId} — iniciando limpas`);
      }
    } catch (e) {
      console.error(`[drizzle-auth] Erro ao parsear chaves do banco para tenant ${tenantId}:`, e);
    }
  }

  // Se não há credenciais válidas, iniciar do zero (vai gerar QR)
  if (!authData.creds) {
    console.log(`[drizzle-auth] Nenhuma credencial encontrada — iniciando sessão limpa para tenant ${tenantId}`);
    authData.creds = initAuthCreds();
  }

  const saveState = async () => {
    try {
      const rawStr = JSON.stringify(authData, BufferJSON.replacer);
      const jsonbData = JSON.parse(rawStr);
      await db
        .update(channelConfigs)
        .set({ baileysAuthKeys: jsonbData, updatedAt: new Date() })
        .where(eq(channelConfigs.tenantId, tenantId));
    } catch (e) {
      console.error(`[drizzle-auth] Erro ao salvar estado de autenticação para tenant ${tenantId}:`, e);
    }
  };

  return {
    state: {
      creds: authData.creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const result: { [id: string]: any } = {};
          for (const id of ids) {
            const val = authData.keys[`${type}:${id}`];
            if (val !== undefined) result[id] = val;
          }
          return result;
        },
        set: async (data: any) => {
          for (const category in data) {
            for (const id in data[category]) {
              const key = `${category}:${id}`;
              if (data[category][id] !== null && data[category][id] !== undefined) {
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
