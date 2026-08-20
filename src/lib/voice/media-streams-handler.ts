import WebSocket from "ws";
import type { VoiceMessage } from "../valentina/voice-types";
import { db } from "../../db";
import { voiceCalls, voiceCallMessages, messages, contacts } from "../../db/schema";
import { eq, asc, and, sql } from "drizzle-orm";
import { getKnowledgeBaseContext } from "../valentina/knowledge-service";

export class MediaStreamHandler {
  private ws: WebSocket;
  private elevenLabsWs: WebSocket | null = null;
  private streamSid: string = "";
  private callSid: string = "";
  private dbCallId: string = "";
  private elevenLabsConvId: string = "";
  private contactId: string | null = null;
  private history: VoiceMessage[] = [];
  private startTime: Date = new Date();

  // Buffer de áudio pré-streamSid: ElevenLabs pode falar antes do Twilio enviar o evento 'start'.
  // Sem isso, os primeiros chunks de áudio são descartados e a ligação fica muda.
  private audioQueue: string[] = [];

  private fromNumber: string = "";
  private toNumber: string = "";

  private setStreamSid(sid: string) {
    this.streamSid = sid;
    // Flush de áudio que chegou antes do streamSid estar disponível
    if (this.audioQueue.length > 0 && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[MediaStream] 🔊 Flushing ${this.audioQueue.length} chunk(s) de áudio que chegaram antes do streamSid...`);
      for (const payload of this.audioQueue) {
        this.ws.send(JSON.stringify({ event: "media", streamSid: sid, media: { payload } }));
      }
      this.audioQueue = [];
    }
  }

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupListeners();
  }

  private async getLatestTriageContext(phone: string) {
    const cleanPhone = phone.replace(/\D/g, "").replace(/^55/, "");
    try {
      const conv = await db.query.conversations.findFirst({
        where: (table, { sql }) => sql`${table.contactId} LIKE ${"%" + cleanPhone + "%"} OR ${table.id} LIKE ${"%" + cleanPhone + "%"}`,
        orderBy: (table, { desc }) => [desc(table.lastMessageTime)],
      });

      let collectedData: Record<string, any> = {};
      let chatHistorySummary = "";

      if (conv) {
        const flowState = await db.query.agentFlowStates.findFirst({
          where: (table, { eq: dEq }) => dEq(table.conversationId, conv.id),
          orderBy: (table, { desc }) => [desc(table.lastInteractionAt)],
        });

        if (flowState?.collectedData) {
          collectedData = flowState.collectedData as Record<string, any>;
        }

        // Buscar últimas 20 mensagens do WhatsApp para montar o contexto real da conversa
        const recentMsgs = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conv.id))
          .orderBy(asc(messages.sentAt))
          .limit(20);

        if (recentMsgs.length > 0) {
          chatHistorySummary = recentMsgs
            .map((m: any) => `${m.senderType === "client" ? "Cliente" : "Valentina"}: ${m.content}`)
            .join(" | ");
        }
      }

      // Função auxiliar para buscar chaves flexíveis no objeto collectedData
      const getVal = (keys: string[]) => {
        for (const [k, item] of Object.entries(collectedData)) {
          for (const targetKey of keys) {
            if (k.toLowerCase().includes(targetKey.toLowerCase())) {
              if (typeof item === "object" && item !== null && "value" in item) {
                return (item as any).value;
              }
              return String(item);
            }
          }
        }
        return null;
      };

      const name = getVal(["nome", "client"]) || "cliente";
      const product = getVal(["produto", "valvula", "frasco", "item"]) || "Válvulas Spray Aerosol";
      const quantity = getVal(["quantidade", "qtd", "volume", "unidades"]) || "25.000 unidades";
      const cnpj = getVal(["cnpj", "cpf"]) || "";
      const company = getVal(["razao_social", "empresa", "razao", "nome da empresa"]) || "sua empresa";

      const knowledgeContext = await getKnowledgeBaseContext("valem");

      const dynamic_variables = {
        user_name: name,
        company_name: company,
        product_name: product,
        quantity: quantity,
        cnpj: cnpj,
        whatsapp_history: chatHistorySummary || `Cotação de ${quantity} de ${product} para ${company}${cnpj ? ` (CNPJ: ${cnpj})` : ""}.`,
        knowledge_base_context: knowledgeContext || "Catálogo geral de válvulas spray, aerosol, frascos PET/PEAD, potes e seladoras da Valem Válvulas.",
      };

      const first_message = `Oii, ${name}! É a Valentina da Valem Válvulas! Peguei aqui os dados da cotação das ${quantity} de ${product} para ${company}!`;

      return { dynamic_variables, first_message };
    } catch (err: any) {
      console.error("[MediaStream] Aviso ao buscar contexto da triagem:", err?.message || err);
      return {
        dynamic_variables: {
          user_name: "cliente",
          company_name: "sua empresa",
          product_name: "Válvulas Spray Aerosol",
          quantity: "",
          cnpj: "",
          whatsapp_history: "Conversa via WhatsApp para cotação de válvulas/embalagens da Valem.",
          knowledge_base_context: "Catálogo geral de válvulas spray, aerosol, frascos PET/PEAD, potes e seladoras da Valem Válvulas.",
        },
        first_message: "Oii! É a Valentina da Valem Válvulas! Estou ligando para dar continuidade à sua cotação!",
      };
    }
  }

  private setupListeners() {
    console.log(`[MediaStream] ✅ WebSocket conectado! Aguardando evento 'start' do Twilio...`);

    this.ws.on("message", async (data: string) => {
      try {
        const msg = JSON.parse(data);

        switch (msg.event) {
          case "start":
            this.callSid = msg.start.callSid;
            this.fromNumber = msg.start.customParameters?.from || msg.start.from || "+551423980186";
            this.toNumber = msg.start.customParameters?.to || msg.start.to || msg.start.customParameters?.phone || "14998364338";
            this.startTime = new Date();
            this.dbCallId = `call_${Date.now()}`;
            // Usa setStreamSid para disparar flush de áudio buffered (resolve ligação muda)
            this.setStreamSid(msg.start.streamSid);

            const targetClientPhone = (this.toNumber && this.toNumber !== "Valem Line") ? this.toNumber : this.fromNumber;
            const cleanDigits = targetClientPhone.replace(/\D/g, "").replace(/^55/, "");
            const suffixDigits = cleanDigits.slice(-8);

            console.log(`[MediaStream] ✅ Sessão Twilio iniciada. StreamSid=${this.streamSid} | CallSid=${this.callSid} | TargetPhone=${targetClientPhone} (suffix: ${suffixDigits})`);

            // Busca contato no banco de dados para vincular a chamada
            try {
              if (suffixDigits) {
                const [matchedContact] = await db
                  .select()
                  .from(contacts)
                  .where(
                    and(
                      eq(contacts.tenantId, "valem"),
                      sql`${contacts.phone} LIKE ${"%" + suffixDigits} OR ${contacts.whatsappJid} LIKE ${"%" + suffixDigits + "%"}`
                    )
                  )
                  .limit(1);
                if (matchedContact) {
                  this.contactId = matchedContact.id;
                  console.log(`[MediaStream] 👤 Contato vinculado à chamada: ${matchedContact.name} (${matchedContact.id})`);
                }
              }
            } catch (err: any) {
              console.warn("[MediaStream] Falha ao buscar contato por telefone:", err?.message || err);
            }

            // Salva registro inicial da chamada no banco (Fire & Forget)
            void db.insert(voiceCalls).values({
              id: this.dbCallId,
              tenantId: "valem",
              callSid: this.callSid,
              contactId: this.contactId,
              fromNumber: this.fromNumber || "Desconhecido",
              toNumber: this.toNumber || "Valem Line",
              direction: "outbound",
              status: "active",
              startedAt: this.startTime,
              createdAt: this.startTime,
            }).catch(err => console.error("[MediaStream DB] Erro ao salvar chamada inicial:", err?.message || err));

            // Conecta ao Agente Nativo ElevenLabs
            this.connectElevenLabsAgent();
            break;


          case "media":
            // Encaminha chunks de áudio (8kHz mu-law) do cliente diretamente ao ElevenLabs
            if (this.elevenLabsWs && this.elevenLabsWs.readyState === WebSocket.OPEN) {
              this.elevenLabsWs.send(JSON.stringify({
                user_audio_chunk: msg.media.payload
              }));
            }
            break;

          case "stop":
            console.log(`[MediaStream] Chamada encerrada pelo Twilio. StreamSid=${this.streamSid}`);
            this.cleanup();
            this.finalizeCallRecord();
            break;
        }
      } catch (err: any) {
        console.error("[MediaStream] Erro ao processar mensagem do Twilio:", err?.message || err);
      }
    });

    this.ws.on("close", (code, reason) => {
      this.cleanup();
      console.log(`[MediaStream] Conexão fechada para ${this.callSid} — code=${code}`);
      this.finalizeCallRecord();
    });

    this.ws.on("error", (err) => {
      console.error(`[MediaStream] Erro no WebSocket Twilio:`, err.message);
      this.cleanup();
    });
  }

  private connectElevenLabsAgent() {
    const agentId = process.env.ELEVENLABS_AGENT_ID || "agent_4401kztzk430fgrv1ac62hbbnymk";
    const apiKey = process.env.ELEVENLABS_API_KEY || "sk_f4b5e613103e040403bf5ca43ffc46a1b08c774d5d9fa2fd";

    // CRÍTICO: audio_format=ulaw_8000 obrigatório para compatibilidade com Twilio MediaStreams (8kHz μ-law)
    // Sem esse parâmetro, o ElevenLabs gera Linear PCM 16kHz que o Twilio reproduz como ruído estático.
    const elevenLabsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}&audio_format=ulaw_8000`;
    console.log(`[MediaStream] 🔌 Conectando ao Agente Conversacional ElevenLabs (ulaw_8000): ${agentId}...`);

    this.elevenLabsWs = new WebSocket(elevenLabsUrl, {
      headers: { "xi-api-key": apiKey }
    });

    this.elevenLabsWs.on("open", async () => {
      console.log(`[MediaStream] 🤖 Agente Conversacional ElevenLabs CONECTADO COM SUCESSO!`);
      try {
        const targetPhone = this.fromNumber || this.toNumber || "";
        const context = await this.getLatestTriageContext(targetPhone);
        console.log(`[MediaStream] 📋 Injetando variáveis dinâmicas de contexto na Valentina:`, context);

        const initPayload = {
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: {
              first_message: context.first_message,
              prompt: {
                prompt: `Você é a Valentina, consultora comercial e especialista técnica em vendas da Valem Válvulas e Embalagens.
${context.dynamic_variables.knowledge_base_context || ""}

INFORMAÇÕES DA COTAÇÃO DO CLIENTE:
- Nome do cliente: ${context.dynamic_variables.user_name || "Cliente"}
- Empresa: ${context.dynamic_variables.company_name || "Empresa do cliente"}
- Produto de interesse: ${context.dynamic_variables.product_name || "Válvulas / Embalagens"}
- Quantidade: ${context.dynamic_variables.quantity || "A definir"}
- CNPJ: ${context.dynamic_variables.cnpj || "A confirmar"}
- Histórico da conversa no WhatsApp: ${context.dynamic_variables.whatsapp_history || ""}

DIRETRIZES DA LIGAÇÃO:
- Fale com simpatia humana natural, tom profissional, ágil e consultivo de vendas.
- Use as informações da BASE DE CONHECIMENTO e CATÁLOGO acima para responder com domínio e autoridade qualquer dúvida do cliente sobre válvulas (Spray, Pump, Gatilho, Espumadora, Recrave, Roscas 24/410, 28/410, etc.), frascos (PET, PEAD, Vidro, Alumínio), volumetrias, quantidades e materiais.
- Confirme se os dados da cotação estão corretos e colete o que estiver faltando para fechar o pedido.
- Fale em frases curtas, naturais e diretas ao telefone.`
              }
            }
          },
          dynamic_variables: context.dynamic_variables,
        };

        if (this.elevenLabsWs && this.elevenLabsWs.readyState === WebSocket.OPEN) {
          this.elevenLabsWs.send(JSON.stringify(initPayload));
        }
      } catch (initErr: any) {
        console.error("[MediaStream] Erro ao enviar conversation_initiation_client_data:", initErr?.message || initErr);
      }
    });

    this.elevenLabsWs.on("message", (data: any) => {
      try {
        const msg = JSON.parse(data.toString());

        // LOG DIAGNÓSTICO — loga todos os tipos de mensagem do ElevenLabs para rastrear silêncio
        const msgType = msg.type || "unknown";
        if (msgType !== "audio") {
          console.log(`[MediaStream] 📨 ElevenLabs msg: type=${msgType}`, msgType === "ping" ? "" : JSON.stringify(msg).slice(0, 200));
        }

        // 0. Captura conversation_id do ElevenLabs para link direto com o histórico
        if (msg.type === "conversation_initiation_metadata" && msg.conversation_initiation_metadata_event?.conversation_id) {
          this.elevenLabsConvId = msg.conversation_initiation_metadata_event.conversation_id;
          console.log(`[MediaStream] 🔗 ElevenLabs conversation_id associado: ${this.elevenLabsConvId}`);
          if (this.dbCallId) {
            void db.update(voiceCalls).set({
              campaignId: this.elevenLabsConvId,
            }).where(eq(voiceCalls.id, this.dbCallId)).catch(() => {});
          }
        }

        // 1. Áudio gerado pela Valentina (8kHz mu-law -> repassado ao Twilio)
        if (msg.type === "audio" && msg.audio_event?.audio_base_64) {
          const payload = msg.audio_event.audio_base_64;
          if (this.streamSid && this.ws.readyState === WebSocket.OPEN) {
            // streamSid disponível — envia direto
            this.ws.send(JSON.stringify({ event: "media", streamSid: this.streamSid, media: { payload } }));
            console.log(`[MediaStream] 🔊 Audio relayado → Twilio (streamSid=${this.streamSid.slice(-8)}, bytes=${payload.length})`);
          } else {
            // streamSid ainda não chegou — faz buffer para não perder o áudio inicial
            this.audioQueue.push(payload);
            console.log(`[MediaStream] 🕐 Audio buffered (streamSid pendente). Queue: ${this.audioQueue.length} chunks.`);
          }
        }

        // 2. Interrupção (Barge-in nativo da ElevenLabs) -> limpa buffer no celular do cliente
        if (msg.type === "interruption") {
          console.log(`[MediaStream] 🛑 Interrupção do cliente detectada pela ElevenLabs! Limpando áudio no Twilio...`);
          if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            this.ws.send(JSON.stringify({
              event: "clear",
              streamSid: this.streamSid
            }));
          }
        }

        // 3. Transcrição do usuário
        if (msg.type === "user_transcript" && msg.user_transcript_event?.user_transcript) {
          const userText = msg.user_transcript_event.user_transcript;
          console.log(`[MediaStream] 🎙️ Cliente disse: "${userText}"`);
          this.history.push({ role: "user", content: userText });

          if (this.dbCallId) {
            void db.insert(voiceCallMessages).values({
              id: `vmsg_${Date.now()}_u`,
              tenantId: "valem",
              callId: this.dbCallId,
              role: "user",
              content: userText,
              timestamp: new Date(),
            }).catch(() => {});
          }
        }

        // 4. Resposta do agente
        if (msg.type === "agent_response" && msg.agent_response_event?.agent_response) {
          const agentText = msg.agent_response_event.agent_response;
          console.log(`[MediaStream] 🤖 Valentina respondeu: "${agentText}"`);
          this.history.push({ role: "assistant", content: agentText });

          if (this.dbCallId) {
            void db.insert(voiceCallMessages).values({
              id: `vmsg_${Date.now()}_a`,
              tenantId: "valem",
              callId: this.dbCallId,
              role: "assistant",
              content: agentText,
              timestamp: new Date(),
            }).catch(() => {});
          }
        }
      } catch (err: any) {
        console.error("[MediaStream] Erro ao processar mensagem do ElevenLabs:", err?.message || err);
      }
    });

    this.elevenLabsWs.on("error", (err) => {
      console.error(`[MediaStream] ❌ Erro no WebSocket ElevenLabs:`, err.message);
    });

    this.elevenLabsWs.on("close", (code, reason) => {
      console.log(`[MediaStream] Conexão ElevenLabs fechada. Code: ${code}, Reason: ${reason ? reason.toString() : "N/A"}`);
    });
  }

  private cleanup() {
    if (this.elevenLabsWs) {
      if (this.elevenLabsWs.readyState === WebSocket.OPEN || this.elevenLabsWs.readyState === WebSocket.CONNECTING) {
        this.elevenLabsWs.close();
      }
      this.elevenLabsWs = null;
    }
  }

  private finalizeCallRecord() {
    if (!this.dbCallId) return;

    const endedAt = new Date();
    const durationSeconds = Math.max(1, Math.round((endedAt.getTime() - this.startTime.getTime()) / 1000));

    void (async () => {
      try {
        await db.update(voiceCalls).set({
          status: "completed",
          endedAt,
          durationSeconds,
          transcriptDone: true,
        }).where(eq(voiceCalls.id, this.dbCallId));

        if (this.history.length > 0) {
          const transcriptText = this.history
            .map(m => `${m.role === "assistant" ? "Valentina" : "Cliente"}: ${m.content}`)
            .join("\n");

          void db.insert(voiceCallMessages).values({
            id: `vmsg_${Date.now()}_summary`,
            tenantId: "valem",
            callId: this.dbCallId,
            role: "system",
            content: `[Resumo do Atendimento]\n${transcriptText}`,
            timestamp: new Date(),
          }).catch(() => {});
        }
      } catch (err: any) {
        console.error("[MediaStream DB] Erro ao finalizar chamada:", err?.message || err);
      }
    })();
  }
}
