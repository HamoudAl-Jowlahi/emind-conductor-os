/**
 * Two-factor authentication — TOTP (RFC 6238), by hand.
 *
 * The algorithm is an HMAC, a counter and a modulo, all of which node:crypto
 * already provides, so a dependency here would buy nothing and add supply
 * chain. What makes hand-rolling safe is the known-answer test: the suite pins
 * this against the RFC's own vector rather than against itself.
 *
 * Two storage decisions worth knowing:
 *
 *  - The shared secret is encrypted with the credential vault. Anyone holding
 *    it can generate valid codes forever, so it is exactly as sensitive as an
 *    API key and is stored the same way.
 *  - Recovery codes are hashed with SHA-256, NOT scrypt. Slow hashing exists
 *    to make low-entropy human passwords expensive to guess; these are 80 bits
 *    of CSPRNG randomness, where brute force is already impossible and the
 *    slowness would only tax the server.
 */
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { encryptSecret, decryptSecret } from '@/lib/vault';
import type { FounderDb } from '@/lib/db';

const STEP_SECONDS = 30;
/** Accept one step either side: phone clocks drift, and users type slowly. */
const DRIFT_STEPS = 1;
const DEFAULT_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 160 bits, the size RFC 4226 specifies for an HMAC-SHA1 key. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('That is not a valid base32 secret.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code for one 30-second step. Exported so the tests can pin the RFC vector. */
export function totpCode(secret: string, counter: number, digits = DEFAULT_DIGITS): string {
  const key = base32Decode(secret);

  // The counter is a 64-bit big-endian integer. JS bitwise ops are 32-bit, so
  // the high half is written separately rather than shifted into place.
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', key).update(buf).digest();

  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks
  // where to read four bytes from, so the output does not always come from the
  // same part of the digest.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** True when `code` is valid now, or one step either side. */
export function verifyTotp(secret: string, code: string, digits = DEFAULT_DIGITS): boolean {
  if (!/^\d+$/.test(code ?? '')) return false;
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const expected = totpCode(secret, now + drift, digits);
    // Constant-time: a length-varying compare would leak how much matched.
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The payload behind the QR code an authenticator app scans. */
export function otpauthUrl(secret: string, account: string, issuer = 'eMind Conductor OS'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ── Enrollment ──────────────────────────────────────────────────────────── */

/**
 * Start enrollment: mint a secret and store it UNCONFIRMED.
 *
 * Switching 2FA on here would be the classic way to lock someone out of their
 * own account — a mistyped secret, a phone with the wrong time, and they can
 * never sign in again. It only becomes active once they prove a code works.
 */
export function enrollTotp(db: FounderDb, userId: string): { secret: string } {
  const secret = generateSecret();
  db.userTotp.put(userId, encryptSecret(secret), false);
  db.userTotp.clearRecoveryCodes(userId);
  return { secret };
}

/** Prove the app works, switch 2FA on, and hand back the recovery codes. */
export function confirmTotp(db: FounderDb, userId: string, code: string): { recoveryCodes: string[] } {
  const row = db.userTotp.get(userId);
  if (!row) throw new Error('Start setup before confirming a code.');

  const secret = decryptSecret(row.sealed);
  if (!verifyTotp(secret, code)) {
    throw new Error('That code is not right. Check your authenticator app and try again.');
  }

  db.userTotp.put(userId, row.sealed, true);

  // Shown once, stored hashed — see the header note on why SHA-256 is right
  // for these and wrong for passwords.
  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
  );
  db.userTotp.putRecoveryCodes(userId, recoveryCodes.map(hashRecoveryCode));
  return { recoveryCodes };
}

export function totpEnabled(db: FounderDb, userId: string): boolean {
  return db.userTotp.get(userId)?.confirmed === true;
}

/** Remove 2FA and every recovery code with it. */
export function disableTotp(db: FounderDb, userId: string): void {
  db.userTotp.remove(userId);
}

/** Verify a live code for a user who has 2FA switched on. */
export function verifyUserTotp(db: FounderDb, userId: string, code: string): boolean {
  const row = db.userTotp.get(userId);
  if (!row?.confirmed) return false;
  try {
    return verifyTotp(decryptSecret(row.sealed), code);
  } catch {
    return false;
  }
}

const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

/**
 * Spend a recovery code. Returns false if it is unknown, belongs to someone
 * else, or has already been used — a reusable recovery code is just a second
 * permanent password.
 */
export function consumeRecoveryCode(db: FounderDb, userId: string, code: string): boolean {
  return db.userTotp.consumeRecoveryCode(userId, hashRecoveryCode(code));
}
