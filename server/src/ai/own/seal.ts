import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/*
 * An account's own API keys are kept sealed (AES-256-GCM), with a key made from KEYS_SECRET, so the
 * database alone never gives them away. A sealed key reads `v1.<iv>.<tag>.<sealed>`, in base64url.
 */

const VERSION = 'v1';

/** The key keys are sealed with, made from KEYS_SECRET. */
export function sealingKey(secret: string): Buffer {
  const made = hkdfSync('sha256', secret, 'breader-writer', 'own ai keys', 32);
  return Buffer.from(made);
}

export function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const parts = [VERSION, iv.toString('base64url'), tag.toString('base64url'), sealed.toString('base64url')];
  return parts.join('.');
}

/** The key a seal holds, or null when it can't be opened: sealed with another secret, or not a seal. */
export function unseal(key: Buffer, sealed: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    return null;
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    return null;
  }
}
