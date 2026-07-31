import { AuthenticationState, initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import { db } from "../../db";
import { channelConfigs } from "../../db/schema";
import { eq } from "drizzle-orm";

export async function useDrizzleAuthState(tenantId: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  // Buscar a configuração do canal para este tenant
  let config = await db.query.channelConfigs.findFirst({
    where: eq(channelConfigs.tenantId, tenantId),
  });

  if (!config) {
    console.log(`[drizzle-auth] Configuração de canal não encontrada para o tenant ${tenantId}. Criando registro inicial no banco...`);
    await db.insert(channelConfigs).values({
      tenantId,
      channelType: tenantId === "valem" ? "baileys" : "meta",
      baileysSessionStatus: "disconnected",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    config = await db.query.channelConfigs.findFirst({
      where: eq(channelConfigs.tenantId, tenantId),
    });
  }

  if (!config) {
    throw new Error(`Não foi possível inicializar a configuração de canal para o tenant ${tenantId}`);
  }

  // Carregar os dados salvos anteriormente ou iniciar novos
  let authData: { creds: any; keys: { [key: string]: any } } = {
    creds: null,
    keys: {},
  };

  // Se o status for "disconnected" (sem sessão ativa), forçar credenciais limpas.
  // Isso garante que o Baileys emita um novo QR Code ao iniciar.
  // IMPORTANTE: não limpar quando status for "qr_ready" — as chaves temporárias geradas
  // durante o handshake do QR são necessárias para completar o pareamento no celular.
  // Apagar essas chaves causa o erro "Linking device failed" ao escanear.
  if (config.baileysSessionStatus === "disconnected") {
    authData.creds = initAuthCreds();
  } else if (config.baileysAuthKeys) {
    try {
      // Como o drizzle pode retornar como objeto parseado, passamos por stringify
      // e depois reviver com BufferJSON para recuperar instâncias de Buffer
      const rawStr = JSON.stringify(config.baileysAuthKeys);
      authData = JSON.parse(rawStr, BufferJSON.reviver);
    } catch (e) {
      console.error("Erro ao fazer parse das chaves de autenticação do Baileys:", e);
    }
  }

  // Se não houver credenciais salvas, inicializar uma nova
  if (!authData.creds) {
    authData.creds = initAuthCreds();
  }

  const saveState = async () => {
    // Serializar usando BufferJSON replacer e jogar de volta no formato objeto que o Drizzle aceita
    const rawStr = JSON.stringify(authData, BufferJSON.replacer);
    const jsonbData = JSON.parse(rawStr);

    await db
      .update(channelConfigs)
      .set({
        baileysAuthKeys: jsonbData,
        updatedAt: new Date(),
      })
      .where(eq(channelConfigs.tenantId, tenantId));
  };

  const creds = authData.creds;

  const keys = {
    get: async (type: string, ids: string[]) => {
      const data: { [id: string]: any } = {};
      for (const id of ids) {
        const value = authData.keys[`${type}:${id}`];
        if (value) {
          data[id] = value;
        }
      }
      return data;
    },
    set: async (data: any) => {
      for (const category in data) {
        for (const id in data[category]) {
          const value = data[category][id];
          const key = `${category}:${id}`;
          if (value) {
            authData.keys[key] = value;
          } else {
            delete authData.keys[key];
          }
        }
      }
      await saveState();
    },
  };

  return {
    state: {
      creds,
      keys,
    },
    saveCreds: async () => {
      await saveState();
    },
  };
}
