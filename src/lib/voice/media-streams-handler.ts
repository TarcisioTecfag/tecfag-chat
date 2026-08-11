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

  // Contador de fala alta contínua para autorizar interrupção ("barge-in")
  private loudFramesCount: number = 0;

  // Fila de áudio de saída com pacing de 40ms (2 chunks por tick = 320 bytes)
  private outputQueue: Buffer[] = [];
  private outputTimer: NodeJS.Timeout | null = null;
  private isSpeaking: boolean = false;

  private lastSpokeTime: number = 0;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.startOutputPacing();
    this.setupListeners();
  }

  private startOutputPacing() {
    if (this.outputTimer) return;
    // Dispara a cada 40ms enviando 2 pacotes de 160 bytes (320 bytes/tick), prevenindo o jitter do Event Loop
    this.outputTimer = setInterval(() => {
      if (this.outputQueue.length === 0) return;
      for (let i = 0; i < 2; i++) {
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
      }
    }, 40);
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
    this.loudFramesCount = 0;
  }

  /**
   * Envia evento 'clear' para o Twilio cortar imediatamente a fala atual da Valentina no celular
   */
  private interruptValentina() {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;
    console.log(`[MediaStream] 🛑 Interrupção detectada! Limpando fila de áudio no Twilio...`);
    this.outputQueue = [];
    this.isSpeaking = false;
    this.ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
  }

  /**
   * Processa chunks de áudio em tempo real e detecta pausas de voz (VAD Inteligente)
   */
  private handleIncomingAudioChunk(base64Payload: string) {
    const mulawBuffer = Buffer.from(base64Payload, "base64");
    const pcmSamples = decodeMulaw(mulawBuffer);
    const rms = calculateRms(pcmSamples);

    const isBotActive = this.isProcessing || this.isSpeaking || this.outputQueue.length > 0;

    // REGRA DE TESTE: Desativa interrupção (barge-in) completamente. 
    // Enquanto a Valentina estiver gerando ou falando (pacotes na fila), o microfone é ignorado para ela concluir 100% da frase sem cortes.
    if (isBotActive) {
      return;
    }

    // Cooldown de eco: ignora microfone nos primeiros 1200ms logo após a Valentina terminar de falar
    if (Date.now() - this.lastSpokeTime < 1200) {
      return;
    }

    // Limiar VAD de voz humana normal quando a IA está em silêncio (RMS > 120)
    if (rms > 120) {
      this.hasSpoken = true;
      this.audioBufferChunks.push(base64Payload);
      this.resetSilenceTimer();
    } else if (this.hasSpoken) {
      // Continua acumulando pequenos silêncios naturais entre palavras
      this.audioBufferChunks.push(base64Payload);
    }
  }

  private resetSilenceTimer() {
    this.clearSilenceTimer();
    // Após 700ms de silêncio contínuo após a fala do cliente, dispara o STT
    this.silenceTimer = setTimeout(() => {
      this.processAccumulatedAudio();
    }, 700);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Envia o buffer de áudio acumulado para o Groq Whisper e dispara o ciclo da IA
   */
  private async processAccumulatedAudio() {
    if (this.audioBufferChunks.length < 10 || this.isProcessing) {
      this.audioBufferChunks = [];
      this.hasSpoken = false;
      return;
    }

    this.isProcessing = true;
    this.hasSpoken = false;

    const rawBuffers = this.audioBufferChunks.map(chunk => Buffer.from(chunk, "base64"));
    const combinedBuffer = Buffer.concat(rawBuffers);
    const combinedBase64 = combinedBuffer.toString("base64");

    const chunkCount = this.audioBufferChunks.length;
    this.audioBufferChunks = [];

    try {
      console.log(`[MediaStream] Transcrevendo ${chunkCount} pacotes de áudio (${chunkCount * 20}ms) via Groq Whisper...`);
      const transcription = await sttService.transcribeAudioBuffer(combinedBase64);
      const clean = transcription ? transcription.trim() : "";

      // Descarta falas vazias, ruídos isolados ou apenas interjeições curtas ("É...", "Hum", "A")
      const isNoiseOrFiller = !clean || clean.length < 2 || /^([ÉéEhHumAaSsTtaÁáOo\.\s]+)$/i.test(clean);

      if (isNoiseOrFiller) {
        console.log(`[MediaStream] Interjeição/ruído ignorado ("${clean}") no segmento de ${chunkCount * 20}ms.`);
        this.isProcessing = false;
        return;
      }

      console.log(`[MediaStream] 🎙️ Cliente disse: "${clean}"`);
      await this.handleUserSpeech(clean);
    } catch (err: any) {
      console.error("[MediaStream] Erro ao processar áudio acumulado:", err?.message || err);
      this.isProcessing = false;
    }
  }

  /**
   * Envia a fala da Valentina para a fila de pacing do WebSocket via ElevenLabs TTS
   */
  public async speakText(text: string) {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;

    this.isSpeaking = true;

    try {
      console.log(`[MediaStream] 🎤 Streaming ElevenLabs TTS para: "${text.slice(0, 60)}..."`);
      const audioStream = streamElevenLabsTts(text, MARIANNE_VOICE_ID);

      let chunkCount = 0;
      for await (const chunk of audioStream) {
        if (this.ws.readyState !== WebSocket.OPEN || !this.isSpeaking) break;
        this.outputQueue.push(chunk);
        chunkCount++;
      }

      // Aguarda a fila ser consumida antes de marcar a conclusão da frase
      while (this.outputQueue.length > 0 && this.ws.readyState === WebSocket.OPEN && this.isSpeaking) {
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
    } catch (err: any) {
      console.error("[MediaStream] ❌ Erro ElevenLabs TTS:", err?.message || err);
    } finally {
      this.isSpeaking = false;
      this.lastSpokeTime = Date.now();
    }
  }

  private async sendInitialGreeting() {
    const greeting =
      "Olá, boa tarde! Aqui é a Valentina da Valem Válvulas e Embalagens. Como posso te ajudar hoje?";
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

  /**
   * Responde ao cliente com Streaming por Frase (Latência < 500ms)
   */
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
      let sentenceBuffer = "";
      console.log(`[MediaStream] ⚡ Streaming de resposta Gemini Flash em tempo real...`);

      const textStream = vertexAi.generateTextStream(
        prompt,
        "gemini-2.5-flash",
        undefined,
        { tenantId: "valem", feature: "sdr_agent", metadata: { channel: "voice_media_stream" } }
      );

      for await (const chunk of textStream) {
        fullResponse += chunk;
        sentenceBuffer += chunk;

        // Dispara a fala na ElevenLabs imediatamente na primeira frase finalizada (. ! ? \n)
        const match = sentenceBuffer.match(/([^.!?\n]+[.!?\n]+)/);
        if (match) {
          const sentence = match[1].trim();
          sentenceBuffer = sentenceBuffer.slice(match[1].length);

          const cleanedSentence = cleanVoiceResponse(sentence);
          if (cleanedSentence.length >= 2) {
            console.log(`[MediaStream] 🗣️ Sintetizando frase em tempo real (~400ms): "${cleanedSentence}"`);
            await this.speakText(cleanedSentence);
          }
        }
      }

      // Sintetiza qualquer trecho final sem pontuação
      const remaining = sentenceBuffer.trim();
      if (remaining.length >= 2) {
        const cleanedRemaining = cleanVoiceResponse(remaining);
        if (cleanedRemaining.length >= 2) {
          await this.speakText(cleanedRemaining);
        }
      }

      const cleanedFullText = cleanVoiceResponse(fullResponse);
      if (cleanedFullText) {
        this.history.push({ role: "assistant", content: cleanedFullText });

        if (this.dbCallId) {
          void db.insert(voiceCallMessages).values({
            id: `vmsg_${Date.now()}_a`,
            tenantId: "valem",
            callId: this.dbCallId,
            role: "assistant",
            content: cleanedFullText,
            timestamp: new Date(),
          }).catch(err => console.error("[MediaStream DB] Erro ao salvar fala da IA:", err?.message || err));
        }
      }
    } catch (err: any) {
      console.error("[MediaStream] Erro na geração de resposta:", err?.message || err);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Finaliza o registro da chamada após o encerramento da conexão (fire-and-forget)
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
