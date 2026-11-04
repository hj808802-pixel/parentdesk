// Cloudflare Email Worker: turns e-mails sent to <familyId>-<code>@<your domain> into a
// POST to ParentDesk's /api/inbound. Free with Cloudflare Email Routing.
//
// Setup (one time, with a domain on Cloudflare):
// 1. Cloudflare dashboard → Email → Email Routing → enable for the domain.
// 2. Workers & Pages → Create → paste this file. Set two variables (Settings → Variables):
//      PARENTDESK_URL    = https://parentdesk-app.vercel.app/api/inbound
//      INBOUND_SECRET    = the same value as INBOUND_SECRET on Vercel
// 3. Email Routing → Routing rules → Catch-all → Send to a Worker → this worker.
// 4. On Vercel set INBOUND_DOMAIN to the domain (e.g. in.example.com) and INBOUND_SECRET.
//
// The worker keeps the text part, falls back to HTML, and attaches images and PDFs
// (up to 5, 4 MB each). Nothing is stored on Cloudflare.

import PostalMime from "postal-mime";

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function toBase64(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 0x8000) bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(bin);
}

const worker = {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const parsed = await new PostalMime().parse(raw);

    const attachments = [];
    for (const a of parsed.attachments ?? []) {
      if (attachments.length >= MAX_ATTACHMENTS) break;
      const type = (a.mimeType ?? "").toLowerCase();
      if (!/^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(type)) continue;
      const bytes = a.content instanceof ArrayBuffer ? a.content : new TextEncoder().encode(String(a.content)).buffer;
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
      attachments.push({ filename: a.filename ?? "attachment", contentType: type, content: toBase64(bytes) });
    }

    const body = {
      to: message.to,
      from: parsed.from?.address ?? message.from,
      subject: parsed.subject ?? "",
      text: parsed.text ?? "",
      html: parsed.html ?? "",
      attachments,
    };

    const res = await fetch(env.PARENTDESK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.INBOUND_SECRET}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Bounce so the sender sees that nothing was added (unknown address, limit reached).
      message.setReject(`ParentDesk could not add this e-mail (${res.status})`);
    }
  },
};

export default worker;
