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
 * Converte um buffer Mu-law 8kHz em um arquivo WAV 16-bit 8kHz válido com cabeçalho RIFF (audio/wav)
 */
export function mulawToWavBuffer(mulawBuffer: Buffer): Buffer {
  const pcmSamples = decodeMulaw(mulawBuffer);
  const dataLen = pcmSamples.length * 2;
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);

  // fmt sub-chunk
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size = 16 para PCM
  header.writeUInt16LE(1, 20);  // AudioFormat = 1 (PCM 16-bit)
  header.writeUInt16LE(1, 22);  // NumChannels = 1 (mono)
  header.writeUInt32LE(8000, 24); // SampleRate = 8000 Hz
  header.writeUInt32LE(16000, 28); // ByteRate = 8000 * 1 * 2 = 16000 B/s
  header.writeUInt16LE(2, 32);  // BlockAlign = 2
  header.writeUInt16LE(16, 34); // BitsPerSample = 16 bits

  // data sub-chunk
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);

  const pcmBuffer = Buffer.alloc(dataLen);
  for (let i = 0; i < pcmSamples.length; i++) {
    pcmBuffer.writeInt16LE(pcmSamples[i], i * 2);
  }

  return Buffer.concat([header, pcmBuffer]);
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
