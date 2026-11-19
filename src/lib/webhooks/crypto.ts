import crypto from 'crypto';

export function signPayload(payload: any, secret: string): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return hmac.digest('hex');
}

export function verifySignature(payload: any, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = signPayload(payload, secret);
  const a = Buffer.from(signature.trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
