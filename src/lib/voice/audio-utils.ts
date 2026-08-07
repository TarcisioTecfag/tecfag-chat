/**
 * Utilities for encoding/decoding mulaw audio used by Twilio Media Streams (8kHz 8-bit mulaw)
 */

// Tabela de decodificação Mu-law para Linear PCM 16-bit
const MULAW_TO_PCM = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i;
  let sign = mu & 0x80;
  let exponent = (mu >> 4) & 0x07;
  let mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_TO_PCM[i] = sign ? -sample : sample;
}

/**
 * Converte um buffer Mu-law 8kHz 8-bit para PCM 16-bit
 */
export function decodeMulaw(mulawBuffer: Buffer): Int16Array {
  const pcm = new Int16Array(mulawBuffer.length);
  for (let i = 0; i < mulawBuffer.length; i++) {
    pcm[i] = MULAW_TO_PCM[mulawBuffer[i]];
  }
  return pcm;
}

/**
 * Converte PCM 16-bit para Mu-law 8-bit (Twilio format)
 */
export function encodeMulawSample(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;

  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }

  let mantissa = (sample >> (exponent + 3)) & 0x0f;
  let mulaw = ~(sign | (exponent << 4) | mantissa);
  return mulaw & 0xff;
}

export function encodeMulaw(pcmBuffer: Int16Array): Buffer {
  const mulaw = Buffer.alloc(pcmBuffer.length);
  for (let i = 0; i < pcmBuffer.length; i++) {
    mulaw[i] = encodeMulawSample(pcmBuffer[i]);
  }
  return mulaw;
}

/**
 * Calcula a energia RMS do sinal PCM para Voice Activity Detection (VAD) simples
 */
export function calculateRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    sum += pcm[i] * pcm[i];
  }
  return Math.sqrt(sum / pcm.length);
}
