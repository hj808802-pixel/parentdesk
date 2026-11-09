import { describe, expect, it } from "vitest";
import { qrSvg } from "@/lib/qr";

describe("qr", () => {
  it("renders an SVG for a room link and refuses junk", async () => {
    const svg = await qrSvg("https://parentdesk-app.vercel.app/ko/join?r=0123456789ab.0123456789abcdef");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("<path");
    await expect(qrSvg("")).rejects.toThrow();
    await expect(qrSvg("x".repeat(501))).rejects.toThrow();
  });
});
