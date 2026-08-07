import WebSocket from "ws";
import { streamElevenLabsTts, MARIANNE_VOICE_ID } from "./elevenlabs-tts";
import { vertexAi } from "../vertex-ai";
import { buildVoicePrompt, cleanVoiceResponse } from "../valentina/voice-engine";
import { sttService } from "./stt-service";
import { calculateRms, decodeMulaw } from "./audio-utils";
import type { VoiceMessage } from "../valentina/voice-types";

export class MediaStreamHandler {
  private ws: WebSocket;
  private streamSid: string = "";
  private callSid: string = "";
  private history: VoiceMessage[] = [];
  private isProcessing: boolean = false;

  // Buffer de áudio do cliente para VAD e STT
  private audioBufferChunks: string[] = [];
  private silenceTimer: NodeJS.Timeout | null = null;
  private hasSpoken: boolean = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this.setupListeners();
  }

  private setupListeners() {
    this.ws.on("message", async (data: string) => {
      try {
        const msg = JSON.parse(data);

        switch (msg.event) {
          case "start":
            this.streamSid = msg.start.streamSid;
            this.callSid = msg.start.callSid;
            console.log(`[MediaStream] Sessão iniciada. StreamSid=${this.streamSid} | CallSid=${this.callSid}`);
            await this.sendInitialGreeting();
            break;

          case "media":
            // Recebe pacotes de microfone do cliente (8kHz Mu-law)
            this.handleIncomingAudioChunk(msg.media.payload);
            break;

          case "stop":
            console.log(`[MediaStream] Chamada encerrada. StreamSid=${this.streamSid}`);
            this.clearSilenceTimer();
            break;
        }
      } catch (err: any) {
        console.error("[MediaStream] Erro ao processar mensagem do Twilio:", err?.message || err);
      }
    });

    this.ws.on("close", () => {
      this.clearSilenceTimer();
      console.log(`[MediaStream] Conexão fechada para ${this.callSid}`);
    });
  }

  /**
   * Processa chunks de áudio em tempo real e detecta pausas de voz (VAD 600ms)
   */
  private handleIncomingAudioChunk(base64Payload: string) {
    if (this.isProcessing) return;

    const mulawBuffer = Buffer.from(base64Payload, "base64");
    const pcmSamples = decodeMulaw(mulawBuffer);
    const rms = calculateRms(pcmSamples);

    // Limiar de detecção de voz humana (RMS > 300)
    if (rms > 300) {
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
    // Após 700ms de silêncio contínuo depois da fala, dispara o STT e processa
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
   * Envia o buffer de áudio acumulado para o Google STT e dispara o ciclo da IA
   */
  private async processAccumulatedAudio() {
    if (this.audioBufferChunks.length === 0 || this.isProcessing) return;

    this.isProcessing = true;
    this.hasSpoken = false;
    const combinedBase64 = this.audioBufferChunks.join("");
    this.audioBufferChunks = [];

    try {
      console.log(`[MediaStream] Transcrevendo áudio do cliente...`);
      const transcription = await sttService.transcribeAudioBuffer(combinedBase64);

      if (!transcription || transcription.length < 2) {
        console.log(`[MediaStream] Nenhuma fala clara detectada.`);
        this.isProcessing = false;
        return;
      }

      console.log(`[MediaStream] Cliente disse: "${transcription}"`);
      await this.handleUserSpeech(transcription);
    } catch (err: any) {
      console.error("[MediaStream] Erro ao processar áudio acumulado:", err?.message || err);
      this.isProcessing = false;
    }
  }

  /**
   * Envia a fala da Valentina para o Twilio via ElevenLabs TTS (formato ulaw_8000)
   */
  public async speakText(text: string) {
    if (!this.streamSid || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      console.log(`[MediaStream] Gerando fala ElevenLabs (Marianne): "${text}"`);
      const audioStream = streamElevenLabsTts(text, MARIANNE_VOICE_ID);

      for await (const chunk of audioStream) {
        if (this.ws.readyState !== WebSocket.OPEN) break;

        const payload = chunk.toString("base64");
        const mediaMsg = JSON.stringify({
          event: "media",
          streamSid: this.streamSid,
          media: {
            payload,
          },
        });

        this.ws.send(mediaMsg);
      }
    } catch (err: any) {
      console.error("[MediaStream] Erro ao sintetizar áudio ElevenLabs:", err?.message || err);
    }
  }

  private async sendInitialGreeting() {
    const greeting =
      "Olá, boa tarde! Aqui é a Valentina da Valem Válvulas e Embalagens. Tudo bem com você?";
    this.history.push({ role: "assistant", content: greeting });
    await this.speakText(greeting);
  }

  public async handleUserSpeech(speechText: string) {
    try {
      this.history.push({ role: "user", content: speechText });
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

      await this.speakText(cleanedText);
    } catch (err: any) {
      console.error("[MediaStream] Erro na geração de resposta:", err?.message || err);
    } finally {
      this.isProcessing = false;
    }
  }
}
