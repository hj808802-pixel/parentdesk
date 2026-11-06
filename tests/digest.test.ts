import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDigest, digestLocale, parseUnsubscribeToken, sendEmail, unsubscribeToken } from "@/lib/digest";
import { createFamily, type Item } from "@/lib/store";

const KEY = "a".repeat(64);

function item(over: Partial<Item>): Item {
  return {
    id: Math.random().toString(16).slice(2, 7),
    sourceId: "src",
    type: "event",
    title: "Thing",
    description: "",
    date: null,
    end_date: null,
    time: null,
    end_time: null,
    all_day: true,
    location: null,
    amount: null,
    currency: null,
    bring: [],
    requires_action: false,
    action_text: null,
    confidence: "high",
    quote: null,
    childIds: [],
    status: "open",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

describe("digest", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.DIGEST_FROM;
  });

  it("sorts the open items into the week's sections in the family's language", () => {
    const { record } = createFamily({ locale: "ko", timezone: "Asia/Seoul" });
    record.settings.familyName = "김";
    record.children = [{ id: "c1", name: "민준", color: "#000000" }];
    record.items = [
      item({ title: "Late form", type: "consent", date: "2026-11-03", requires_action: true }),
      item({ title: "Field trip", date: "2026-11-10", time: "09:00", childIds: ["c1"], bring: ["lunch"] }),
      item({ title: "Lunch money", type: "payment", date: "2026-11-12", amount: 25000 }),
      item({ title: "Concert", date: "2026-11-18" }),
      item({ title: "Far away", date: "2027-02-01" }),
      item({ title: "Done thing", date: "2026-11-11", status: "done" }),
      item({ title: "Sign up sheet", type: "todo", requires_action: true }),
    ];
    const d = buildDigest(record, "2026-11-08", { origin: "https://pd.test", unsubscribeUrl: "https://pd.test/u" });
    expect(d.count).toBe(4); // late form, field trip, lunch money, concert
    expect(d.subject).toContain("김");
    expect(d.subject).toContain("4");
    expect(d.text).toContain("Late form");
    expect(d.text).toContain("Field trip");
    expect(d.text).toContain("민준");
    expect(d.text).toContain("lunch");
    expect(d.text).toContain("Concert");
    expect(d.text).not.toContain("Far away");
    expect(d.text).not.toContain("Done thing");
    expect(d.text).toContain("Sign up sheet");
    expect(d.text).toContain("https://pd.test/ko");
    expect(d.text).toContain("https://pd.test/u");
    expect(d.html).toContain("<html");
    expect(d.html).toContain("Lunch money");
    expect(d.html).toContain("₩25,000");
    // Korean section headings from the dictionary
    expect(d.text).toContain("낼 돈");
  });

  it("falls back to the result language, then the caller's locale", () => {
    const { record } = createFamily();
    record.settings.locale = "";
    record.settings.language = "ja";
    expect(digestLocale(record)).toBe("ja");
    record.settings.language = "ar";
    expect(digestLocale(record, "fr")).toBe("fr");
    expect(digestLocale(record)).toBe("en");
    record.settings.locale = "vi";
    expect(digestLocale(record, "fr")).toBe("vi");
  });

  it("says when nothing is due and escapes html", () => {
    const { record } = createFamily({ locale: "en" });
    record.items = [item({ title: "<b>Later</b>", date: "2027-01-01" })];
    const d = buildDigest(record, "2026-11-08", { origin: "https://pd.test" });
    expect(d.count).toBe(0);
    expect(d.subject).toBe("This week: nothing due");
    expect(d.text).toContain("Nothing is due");
    expect(d.html).not.toContain("<b>Later</b>");
  });

  it("signs and checks unsubscribe tokens", () => {
    const { record } = createFamily();
    const tok = unsubscribeToken(record.id)!;
    expect(tok.startsWith(`${record.id}.`)).toBe(true);
    expect(parseUnsubscribeToken(tok)).toBe(record.id);
    expect(parseUnsubscribeToken(`${record.id}.${"x".repeat(43)}`)).toBeNull();
    expect(parseUnsubscribeToken(tok.replace(record.id, "0".repeat(12)))).toBeNull();
    expect(parseUnsubscribeToken(42)).toBeNull();
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(unsubscribeToken(record.id)).toBeNull();
  });

  it("sends through Resend with unsubscribe headers", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.DIGEST_FROM = "ParentDesk <digest@example.com>";
    let seen: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)), auth: (init?.headers as Record<string, string>)?.authorization ?? null };
      return new Response(JSON.stringify({ id: "em_1" }), { status: 200 });
    }) as typeof fetch;
    const r = await sendEmail({ to: "p@example.com", subject: "S", text: "T", html: "<p>H</p>", unsubscribeUrl: "https://pd.test/u" }, fetchImpl);
    expect(r.id).toBe("em_1");
    expect(seen!.url).toBe("https://api.resend.com/emails");
    expect(seen!.auth).toBe("Bearer re_test");
    expect(seen!.body.to).toEqual(["p@example.com"]);
    expect((seen!.body.headers as Record<string, string>)["List-Unsubscribe"]).toBe("<https://pd.test/u>");

    const failing = (async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 })) as typeof fetch;
    await expect(sendEmail({ to: "p@example.com", subject: "S", text: "T", html: "" }, failing)).rejects.toThrow("domain not verified");
    delete process.env.RESEND_API_KEY;
    await expect(sendEmail({ to: "p@example.com", subject: "S", text: "T", html: "" }, fetchImpl)).rejects.toThrow(/not set/);
  });
});
