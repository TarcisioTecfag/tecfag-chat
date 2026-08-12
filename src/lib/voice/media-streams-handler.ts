import WebSocket from "ws";
import type { VoiceMessage } from "../valentina/voice-types";
import { db } from "../../db";
import { voiceCalls, voiceCallMessages } from "../../db/schema";
import { eq } from "drizzle-orm";

export class MediaStreamHandler {
  private ws: WebSocket;
  private elevenLabsWs: WebSocket | null = null;
  private streamSid: string = "";
  private callSid: string = "";
  private dbCallId: string = "";
  private history: VoiceMessage[] = [];
  private startTime: Date = new Date();

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupListeners();
  }

  private setupListeners() {
    console.log(`[MediaStream] ✅ WebSocket conectado! Aguardando evento 'start' do Twilio...`);

    this.ws.on("message", async (data: string) => {
      try {
        const msg = JSON.parse(data);

        switch (msg.event) {
          case "start":
            this.streamSid = msg.start.streamSid;
            this.callSid = msg.start.callSid;
            this.startTime = new Date();
            this.dbCallId = `call_${Date.now()}`;

            console.log(`[MediaStream] ✅ Sessão Twilio iniciada. StreamSid=${this.streamSid} | CallSid=${this.callSid}`);

            // Salva registro inicial da chamada no banco (Fire & Forget)
            void db.insert(voiceCalls).values({
              id: this.dbCallId,
              tenantId: "valem",
              callSid: this.callSid,
              fromNumber: msg.start.customParameters?.from || msg.start.from || "Desconhecido",
              toNumber: msg.start.customParameters?.to || msg.start.to || "Valem Line",
              direction: "inbound",
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
    const agentId = process.env.ELEVENLABS_AGENT_ID || "agent_0201kztttybmejx8x9ex01jhdfdv";
    const apiKey = process.env.ELEVENLABS_API_KEY || "sk_78e73bd4e14dc41a256b44797f742dda9db5fdba2cc65c8a";

    const elevenLabsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
    console.log(`[MediaStream] 🔌 Conectando ao Agente Conversacional ElevenLabs: ${agentId}...`);

    this.elevenLabsWs = new WebSocket(elevenLabsUrl, {
      headers: { "xi-api-key": apiKey }
    });

    this.elevenLabsWs.on("open", () => {
      console.log(`[MediaStream] 🤖 Agente Conversacional ElevenLabs CONECTADO COM SUCESSO!`);
    });

    this.elevenLabsWs.on("message", (data: any) => {
      try {
        const msg = JSON.parse(data.toString());

        // 1. Áudio gerado pela Valentina (8kHz mu-law -> repassado ao Twilio)
        if (msg.type === "audio" && msg.audio_event?.audio_base_64) {
          if (this.ws.readyState === WebSocket.OPEN && this.streamSid) {
            this.ws.send(JSON.stringify({
              event: "media",
              streamSid: this.streamSid,
              media: { payload: msg.audio_event.audio_base_64 }
            }));
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

    this.elevenLabsWs.on("close", (code) => {
      console.log(`[MediaStream] Conexão ElevenLabs fechada. Code: ${code}`);
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
