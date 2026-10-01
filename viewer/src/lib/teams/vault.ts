import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Key material comes only from server configuration. Never generate/save it here. */
function keyFromBase64(key: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('Teams vault unavailable');
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('Teams vault unavailable');
  return bytes;
}

export function encryptTeamsValue(value: unknown, key: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromBase64(key), iv);
  cipher.setAAD(Buffer.from(`uttu:teams:v1:${context}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')].join('.');
}

export function decryptTeamsValue(value: string, key: string, context: string): unknown {
  try {
    if (typeof value !== 'string' || value.length > 100_000) throw new Error();
    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1'
      || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', keyFromBase64(key), iv);
    decipher.setAAD(Buffer.from(`uttu:teams:v1:${context}`, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch { throw new Error('Teams vault unavailable'); }
}
