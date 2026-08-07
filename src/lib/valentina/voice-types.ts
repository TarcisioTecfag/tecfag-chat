/** Tipos compartilhados para o motor de voz da Valentina */

export interface VoiceMessage {
  role: "user" | "assistant" | "system";
  content: string;
}
