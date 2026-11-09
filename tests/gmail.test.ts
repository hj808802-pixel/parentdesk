import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cryptoReady, decrypt, encrypt, sign, verifySignature } from "@/lib/crypto";
import { authUrl, emailFromIdToken, headOf, looksLikeSchool, newState, parsePayload, parseState, searchQuery, senderAddress, toStandardBase64, type Message } from "@/lib/gmail";
import { htmlToText } from "@/lib/html";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("crypto", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("seals and opens a token, and rejects a tampered one", () => {
    expect(cryptoReady()).toBe(true);
    const sealed = encrypt("1//refresh-token-value");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("refresh-token");
    expect(decrypt(sealed)).toBe("1//refresh-token-value");
    const parts = sealed.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA"); // always a different tag (plain "AA" matched the real tag about once in 4000 runs)
    expect(() => decrypt(parts.join("."))).toThrow();
    expect(encrypt("a")).not.toBe(encrypt("a")); // fresh iv each time
  });

  it("signs and verifies values", () => {
    const sig = sign("abc");
    expect(verifySignature("abc", sig)).toBe(true);
    expect(verifySignature("abd", sig)).toBe(false);
  });

  it("is off without a valid key", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "short";
    expect(cryptoReady()).toBe(false);
    expect(() => encrypt("x")).toThrow();
  });
});

describe("gmail", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  });
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
  });

  it("builds a signed state bound to the family and a consent url", () => {
    const state = newState("0123456789ab");
    expect(parseState(state)).toEqual({ familyId: "0123456789ab" });
    expect(parseState(state.slice(0, -1) + "x")).toBeNull();
    expect(parseState("nope")).toBeNull();
    const url = new URL(authUrl("https://parentdesk-app.vercel.app", state));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe("https://parentdesk-app.vercel.app/api/google/callback");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("reads the e-mail from an id token and addresses from From headers", () => {
    const idToken = `${b64('{"alg":"RS256"}')}.${b64('{"email":"Parent@Example.com","sub":"1"}')}.sig`;
    expect(emailFromIdToken(idToken)).toBe("parent@example.com");
    expect(emailFromIdToken("garbage")).toBeNull();
    expect(senderAddress("Ms Rivera <Rivera@OakStreet.k12.ca.us>")).toBe("rivera@oakstreet.k12.ca.us");
    expect(senderAddress("rivera@oakstreet.k12.ca.us")).toBe("rivera@oakstreet.k12.ca.us");
  });

  it("parses a multipart message into text, html and attachments", () => {
    const msg: Message = {
      id: "m1",
      snippet: "Field trip Friday",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "Ms Rivera <rivera@oakstreet.k12.ca.us>" },
          { name: "Subject", value: "Room 12 news" },
          { name: "Date", value: "Thu, 05 Nov 2026 09:00:00 -0500" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("Field trip Friday.\nBring lunch.") } },
              { mimeType: "text/html", body: { data: b64("<p>Field trip <b>Friday</b>.</p><p>Bring lunch.</p>") } },
            ],
          },
          { mimeType: "application/pdf", filename: "slip.pdf", body: { attachmentId: "att1", size: 1234 } },
          { mimeType: "image/jpeg", filename: "flyer.jpg", body: { attachmentId: "att2", size: 99999 } },
        ],
      },
    };
    const head = headOf(msg);
    expect(head).toEqual({ id: "m1", from: "Ms Rivera <rivera@oakstreet.k12.ca.us>", subject: "Room 12 news", date: "Thu, 05 Nov 2026 09:00:00 -0500", snippet: "Field trip Friday" });
    const parsed = parsePayload(msg.payload);
    expect(parsed.text).toBe("Field trip Friday.\nBring lunch.");
    expect(htmlToText(parsed.html)).toBe("Field trip Friday.\nBring lunch.");
    expect(parsed.attachments.map((a) => [a.attachmentId, a.mimeType, a.size])).toEqual([
      ["att1", "application/pdf", 1234],
      ["att2", "image/jpeg", 99999],
    ]);
    expect(toStandardBase64("a-b_c")).toBe("a+b/c===".slice(0, 8));
    expect(searchQuery(7)).toContain("newer_than:7d");
  });

  it("recognises school mail by sender and words in demo mode", () => {
    expect(looksLikeSchool({ from: "noreply@classdojo.com", subject: "New message", snippet: "" })).toBe(true);
    expect(looksLikeSchool({ from: "teacher@gmail.com", subject: "가정통신문: 현장체험학습 안내", snippet: "" })).toBe(true);
    expect(looksLikeSchool({ from: "deals@shop.example", subject: "50% off everything", snippet: "Sale ends Sunday" })).toBe(false);
  });
});
