import { outboundQueue } from "./outbound";
import { inboundProcessor } from "./inbound";
import { baileysAdapter } from "./adapters/baileys";
import { metaAdapter } from "./adapters/meta";
import {
  UniversalOutboundMessage,
  UniversalOutboundResult,
  WhatsAppProviderType,
} from "./types";
import { db } from "../../db";
import { channelConfigs } from "../../db/schema";
import { eq } from "drizzle-orm";

export class WhatsAppService {
  private static instance: WhatsAppService;

  private constructor() {}

  static getInstance(): WhatsAppService {
    if (!WhatsAppService.instance) {
      WhatsAppService.instance = new WhatsAppService();
    }
    return WhatsAppService.instance;
  }

  /**
   * Envio universal de mensagens pelo canal WhatsApp do tenant
   */
  async sendMessage(message: UniversalOutboundMessage): Promise<UniversalOutboundResult> {
    return outboundQueue.enqueueAndSend(message);
  }

  /**
   * Consulta o status atual do canal para o tenant
   */
  async getChannelStatus(tenantId: string): Promise<{
    activeProvider: WhatsAppProviderType;
    status: string;
    phone?: string;
    details?: any;
  }> {
    const [cfg] = await db
      .select()
      .from(channelConfigs)
      .where(eq(channelConfigs.tenantId, tenantId));

    const activeProvider = (cfg?.activeProvider as WhatsAppProviderType) || "baileys";

    if (activeProvider === "meta") {
      const status = await metaAdapter.getStatus(tenantId);
      return { activeProvider, ...status };
    } else {
      const status = await baileysAdapter.getStatus(tenantId);
      return { activeProvider, ...status };
    }
  }

  /**
   * Processamento de mensagens recebidas
   */
  get inbound() {
    return inboundProcessor;
  }

  /**
   * Fila de saída
   */
  get outbound() {
    return outboundQueue;
  }
}

export async function getActiveProvider(tenantId: string): Promise<WhatsAppProviderType> {
  const [cfg] = await db
    .select({ activeProvider: channelConfigs.activeProvider })
    .from(channelConfigs)
    .where(eq(channelConfigs.tenantId, tenantId));

  return (cfg?.activeProvider as WhatsAppProviderType) || "baileys";
}

export const whatsAppService = WhatsAppService.getInstance();
