import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time codes (RFC 6238: HMAC-SHA1, 30 seconds, 6 digits), the kind every
// authenticator app shows. Used as the optional second step of the admin sign-in.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function base32Encode(buf: Buffer): string {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const num = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(num % 1_000_000).padStart(6, "0");
}

// Accepts the current code and the ones just before and after (clocks drift a little).
export function verifyTotp(secret: string, given: unknown, atMs: number = Date.now()): boolean {
  if (typeof given !== "string") return false;
  const code = given.replace(/\D/g, "");
  if (code.length !== 6 || base32Decode(secret).length < 10) return false;
  let ok = false;
  for (const step of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, atMs + step * 30000));
    if (timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

export function totpUri(secret: string, label = "ParentDesk admin"): string {
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=ParentDesk`;
}
