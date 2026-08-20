/**
 * The credential vault — each user's API keys, encrypted at rest.
 *
 * Replaces the single shared `.env.local` file, which held ONE value per key
 * name. On a multi-user install that file is not merely limiting, it is
 * dangerous: the second user to save a Stripe key overwrote the first user's,
 * and until they did, their agents ran against someone else's account.
 *
 * AES-256-GCM from node:crypto — no new dependency, and GCM is authenticated,
 * so a tampered row fails loudly instead of decrypting to garbage that some
 * connector would then send to a live API.
 *
 * The root key lives in the environment, never in the database: an attacker
 * who walks off with the database file gets ciphertext and nothing else.
 * Without it the vault refuses to store rather than storing in the clear —
 * a broken feature is recoverable, a leaked key is not.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FounderDb } from '@/lib/db';

export const ROOT_KEY_ENV = 'CREDENTIALS_KEY';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is specified for

export type SealedSecret = { ciphertext: string; iv: string; authTag: string };

function rootKey(): Buffer {
  const hex = process.env[ROOT_KEY_ENV];
  if (!hex) {
    throw new Error(
      `${ROOT_KEY_ENV} is not set — the credential vault has no root key. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(`${ROOT_KEY_ENV} must be 32 bytes as hex (64 characters); got ${key.length}`);
  }
  return key;
}

/** True when a usable root key is configured. Never throws — for status UI. */
export function vaultReady(): boolean {
  try {
    rootKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plaintext: string): SealedSecret {
  const iv = randomBytes(IV_BYTES); // fresh per write: never reuse an IV with GCM
  const cipher = createCipheriv(ALGORITHM, rootKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

/** Throws if the row was tampered with or the root key changed. */
export function decryptSecret(sealed: SealedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, rootKey(), Buffer.from(sealed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

export function putSecret(db: FounderDb, userId: string, name: string, value: string): void {
  db.userCredentials.put(userId, name, encryptSecret(value));
}

/** The plaintext for one key, or undefined. Never log the return value. */
export function getSecret(db: FounderDb, userId: string, name: string): string | undefined {
  const row = db.userCredentials.get(userId, name);
  if (!row) return undefined;
  try {
    return decryptSecret(row);
  } catch {
    // A row we cannot decrypt is treated as absent rather than crashing the
    // request: the honest outcome is "this connector is not configured".
    return undefined;
  }
}

/** Key NAMES this user has stored. The board renders set / not set from this. */
export function listSecretNames(db: FounderDb, userId: string): string[] {
  return db.userCredentials.names(userId);
}

export function removeSecret(db: FounderDb, userId: string, name: string): void {
  db.userCredentials.remove(userId, name);
}

/**
 * One user's whole vault, decrypted, shaped to overlay onto process.env.
 * Undecryptable rows are dropped — see getSecret.
 */
export function secretsFor(db: FounderDb, userId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { name, sealed } of db.userCredentials.all(userId)) {
    try {
      out[name] = decryptSecret(sealed);
    } catch {
      /* skip */
    }
  }
  return out;
}
