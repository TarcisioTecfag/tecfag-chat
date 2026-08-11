import WebSocket from "ws";
import { streamElevenLabsTts, MARIANNE_VOICE_ID } from "./elevenlabs-tts";
import { vertexAi } from "../vertex-ai";
import { buildVoicePrompt, cleanVoiceResponse } from "../valentina/voice-engine";
import { sttService } from "./stt-service";
import { calculateRms, decodeMulaw } from "./audio-utils";
import type { VoiceMessage } from "../valentina/voice-types";
import { db } from "../../db";
import { voiceCalls, voiceCallMessages } from "../../db/schema";
import { eq } from "drizzle-orm";

export class MediaStreamHandler {
  private ws: WebSocket;
  private streamSid: string = "";
  private callSid: string = "";
  private dbCallId: string = "";
  private history: VoiceMessage[] = [];
  private isProcessing: boolean = false;
  private startTime: Date = new Date();

  // Buffer de áudio do cliente para VAD e STT
  private audioBufferChunks: string[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private hasSpoken: boolean = false;

  // Fila de áudio de saída com pacing de 20ms
  private outputQueue: Buffer[] = [];
  private outputTimer: NodeJS.Timeout | null = null;
  private isSpeaking: boolean = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.startOutputPacing();
    this.setupListeners();
  }

  private startOutputPacing() {
    if (this.outputTimer) return;
    // Dispara 1 pacote de 160 bytes a cada 20ms (ritmo exato da telefonia 8kHz mu-law)
    this.outputTimer = setInterval(() => {
      if (this.outputQueue.length === 0) return;
      const chunk = this.outputQueue.shift();
      if (chunk && this.streamSid && this.ws.readyState === WebSocket.OPEN) {
        const payload = chunk.toString("base64");
        this.ws.send(
          JSON.stringify({
            event: "media",
            streamSid: this.streamSid,
            media: { payload },
          })
        );
      }
    }, 20);
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

            console.log(`[MediaStream] ✅ Sessão iniciada. StreamSid=${this.streamSid} | CallSid=${this.callSid}`);

            // Regras Invioláveis: Fire & Forget — salva registro inicial da chamada no banco sem bloquear latência
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

            await this.sendInitialGreeting();
            break;

          case "media":
            // Recebe pacotes de microfone do cliente (8kHz Mu-law)
            this.handleIncomingAudioChunk(msg.media.payload);
            break;

          case "stop":
            console.log(`[MediaStream] Chamada encerrada. StreamSid=${this.streamSid}`);
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
      console.log(`[MediaStream] Conexão fechada para ${this.callSid} — code=${code} reason=${reason?.toString() || '(none)'}`);
      this.finalizeCallRecord();
    });

    this.ws.on("error", (err) => {
      console.error(`[MediaStream] Erro no WebSocket:`, err.message);
    });
  }

  private cleanup() {
    this.clearSilenceTimer();
    if (this.outputTimer) {
      clearInterval(this.outputTimer);
      this.outputTimer = null;
    }
    this.outputQueue = [];
    this.audioBufferChunks = [];
    this.isSpeaking = false;
    this.hasSpoken = false;
    this.isProcessing = false;
  }

  /**
   * Processa chunks de áudio em tempo real e detecta pausas de voz (VAD 600ms)
   */
  private handleIncomingAudioChunk(base64Payload: string) {
    // Ignora áudio de entrada enquanto a IA estiver falando ou processando (evita auto-eco)
    if (this.isProcessing || this.isSpeaking || this.outputQueue.length > 0) return;

    const mulawBuffer = Buffer.from(base64Payload, "base64");
    const pcmSamples = decodeMulaw(mulawBuffer);
    const rms = calculateRms(pcmSamples);

    // Limiar de detecção de voz humana em telefonia 8kHz (RMS > 80)
    if (rms > 80) {
      this.hasSpoken = true;
      this.audioBufferChunks.push(base64Payload);
      this.resetSilenceTimer();
    } else if (this.hasSpoken) {
      // Continua acumulando pequenos silêncios entre palavras
      this.audioBufferChunks.push(base64Payload);
    }
  }

  private resetSilenceTimer() {
    this.clearSilenceTimer();
    // Após 600ms de silêncio contínuo depois da fala, dispara o STT e processa
    this.silenceTimer = setTimeout(() => {
      this.processAccumulatedAudio();
    }, 600);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Envia o buffer de áudio acumulado para o Google STT e dispara o ciclo da IA
   */
  private async processAccumulatedAudio() {
    // Exige pelo menos 10 pacotes (~200ms de áudio acumulado) para evitar disparar STT com ruídos isolados
    if (this.audioBufferChunks.length < 10 || this.isProcessing) {
      this.audioBufferChunks = [];
      this.hasSpoken = false;
      return;
    }

    this.isProcessing = true;
    this.hasSpoken = false;

    // Converte cada string Base64 em Buffer binário e depois concatena para gerar um Base64 contínuo e válido
    const rawBuffers = this.audioBufferChunks.map(chunk => Buffer.from(chunk, "base64"));
    const combinedBuffer = Buffer.concat(rawBuffers);
    const combinedBase64 = combinedBuffer.toString("base64");

    const chunkCount = this.audioBufferChunks.length;
    this.audioBufferChunks = [];

    try {
      console.log(`[MediaStream] Transcrevendo ${chunkCount} pacotes de áudio do cliente (${chunkCount * 20}ms)...`);
      const transcription = await sttService.transcribeAudioBuffer(combinedBase64);

      if (!transcription || transcription.trim().length < 2) {
        console.log(`[MediaStream] Nenhuma fala clara detectada no segmento de ${chunkCount * 20}ms.`);
        this.isProcessing = false;
        return;
      }

      console.log(`[MediaStream] 🎙️ Cliente disse: "${transcription.trim()}"`);
      await this.handleUserSpeech(transcription.trim());
    } catch (err: any) {
      console.error("[MediaStream] Erro ao processar áudio acumulado:", err?.message || err);
      this.isProcessing = false;
    }
  }

  /**
   * Envia a fala da Valentina para a fila de pacing do WebSocket via ElevenLabs TTS
   */
  public async speakText(text: string) {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`[MediaStream] speakText ABORTADO — streamSid=${this.streamSid} | wsState=${this.ws.readyState}`);
      return;
    }

    this.isSpeaking = true;

    try {
      console.log(`[MediaStream] 🎤 Streaming ElevenLabs para: "${text.slice(0, 60)}..."`);
      const audioStream = streamElevenLabsTts(text, MARIANNE_VOICE_ID);

      let chunkCount = 0;
      for await (const chunk of audioStream) {
        if (this.ws.readyState !== WebSocket.OPEN) {
          console.error(`[MediaStream] WebSocket fechou durante streaming de áudio! chunkCount=${chunkCount}`);
          break;
        }

        // Empurra os pacotes de 160 bytes na fila com pacing de 20ms
        this.outputQueue.push(chunk);
        chunkCount++;
      }
      console.log(`[MediaStream] ✅ ${chunkCount} chunks adicionados à fila de pacing.`);

      // Aguarda a fila de pacing ser drenada completamente antes de permitir novo VAD
      while (this.outputQueue.length > 0 && this.ws.readyState === WebSocket.OPEN) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (err: any) {
      console.error("[MediaStream] ❌ Erro ElevenLabs TTS:", err?.message || err);
    } finally {
      this.isSpeaking = false;
    }
  }

  private async sendInitialGreeting() {
    const greeting =
      "Olá, boa tarde! Aqui é a Valentina da Valem Válvulas e Embalagens. Tudo bem com você?";
    this.history.push({ role: "assistant", content: greeting });

    if (this.dbCallId) {
      void db.insert(voiceCallMessages).values({
        id: `vmsg_${Date.now()}_0`,
        tenantId: "valem",
        callId: this.dbCallId,
        role: "assistant",
        content: greeting,
        timestamp: new Date(),
      }).catch(err => console.error("[MediaStream DB] Erro ao salvar mensagem de saudação:", err?.message || err));
    }

    await this.speakText(greeting);
  }

  public async handleUserSpeech(speechText: string) {
    try {
      this.history.push({ role: "user", content: speechText });

      if (this.dbCallId) {
        void db.insert(voiceCallMessages).values({
          id: `vmsg_${Date.now()}_u`,
          tenantId: "valem",
          callId: this.dbCallId,
          role: "user",
          content: speechText,
          timestamp: new Date(),
        }).catch(err => console.error("[MediaStream DB] Erro ao salvar fala do usuário:", err?.message || err));
      }

      const prompt = buildVoicePrompt(this.history, "valem");

      let fullResponse = "";
      console.log(`[MediaStream] Gerando resposta Gemini Flash (thinkingBudget: 0)...`);

      const textStream = vertexAi.generateTextStream(
        prompt,
        "gemini-2.5-flash",
        undefined,
        { tenantId: "valem", feature: "sdr_agent", metadata: { channel: "voice_media_stream" } }
      );

      for await (const chunk of textStream) {
        fullResponse += chunk;
      }

      const cleanedText = cleanVoiceResponse(fullResponse);
      this.history.push({ role: "assistant", content: cleanedText });

      if (this.dbCallId) {
        void db.insert(voiceCallMessages).values({
          id: `vmsg_${Date.now()}_a`,
          tenantId: "valem",
          callId: this.dbCallId,
          role: "assistant",
          content: cleanedText,
          timestamp: new Date(),
        }).catch(err => console.error("[MediaStream DB] Erro ao salvar fala da IA:", err?.message || err));
      }

      await this.speakText(cleanedText);
    } catch (err: any) {
      console.error("[MediaStream] Erro na geração de resposta:", err?.message || err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Finaliza o registro da chamada após o encerramento da conexão (fire-and-forget)
   * Roda análise pós-ligação com Gemini para extrair sentimentos e dados do cliente
   */
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

        if (this.history.length > 1) {
          const transcriptText = this.history
            .map(m => `${m.role === "assistant" ? "Valentina" : "Cliente"}: ${m.content}`)
            .join("\n");

          const prompt = `Analise a transcrição de chamada abaixo entre a IA Valentina e um cliente da Valem Válvulas.
Retorne APENAS um JSON no seguinte formato (sem marcações markdown):
{
  "sentiment": "positive" | "neutral" | "negative",
  "summary": "Resumo de 2 frases da ligação",
  "extractedInfo": {
    "nome": "nome do cliente se mencionado",
    "empresa": "empresa se mencionada",
    "interesse": "produto de interesse detectado",
    "objecoes": "objeções mencionadas",
    "proximo_passo": "próxima ação acordada"
  }
}

Transcrição:
${transcriptText}`;

          const analysis = await vertexAi.generateStructuredJson<{
            sentiment: "positive" | "neutral" | "negative";
            summary: string;
            extractedInfo: any;
          }>(prompt, "gemini-2.5-flash", undefined, {
            tenantId: "valem",
            feature: "conversation_audit",
            metadata: { callId: this.dbCallId },
          }).catch(() => null);

          if (analysis) {
            await db.update(voiceCalls).set({
              sentiment: analysis.sentiment || "neutral",
              summary: analysis.summary || "Ligação finalizada com sucesso.",
              extractedInfo: analysis.extractedInfo || {},
            }).where(eq(voiceCalls.id, this.dbCallId));
          }
        }
      } catch (err: any) {
        console.error("[MediaStream DB] Erro no encerramento da chamada:", err?.message || err);
      }
    })();
  }
}
