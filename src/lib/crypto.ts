import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Secrets at rest (the Gmail refresh token) are sealed with AES-256-GCM under
// TOKEN_ENCRYPTION_KEY (64 hex characters). The same key signs short-lived values such as
// the OAuth state. Without the key the Gmail connector stays off.

function key(): Buffer | null {
  const hex = (process.env.TOKEN_ENCRYPTION_KEY ?? "").trim();
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}

export function cryptoReady(): boolean {
  return key() !== null;
}

export function encrypt(plain: string): string {
  const k = key();
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function decrypt(sealed: string): string {
  const k = key();
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("bad sealed value");
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  const k = key();
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  return createHmac("sha256", k).update(value).digest("base64url");
}

export function verifySignature(value: string, signature: string): boolean {
  const a = Buffer.from(sign(value));
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
