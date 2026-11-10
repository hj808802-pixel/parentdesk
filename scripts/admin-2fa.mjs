// Prints a new secret for the admin console's second sign-in step, and the address an
// authenticator app (Google Authenticator, Authy, 1Password…) can add.
//
//   node scripts/admin-2fa.mjs
//
// 1. Add the secret to your authenticator app (type it in, or turn the otpauth:// address
//    into a QR code on your own machine).
// 2. Store it as ADMIN_TOTP_SECRET in Vercel:  npx vercel env add ADMIN_TOTP_SECRET production
// 3. Redeploy. From then on the admin sign-in asks for the 6-digit code as well.
// Keep the secret private: with the token and this secret, anyone can sign in.
import { randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let bits = "";
for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, "0");
let secret = "";
for (let i = 0; i < bits.length; i += 5) secret += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`otpauth://totp/ParentDesk%20admin?secret=${secret}&issuer=ParentDesk`);
