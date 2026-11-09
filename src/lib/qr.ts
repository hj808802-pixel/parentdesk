import QRCode from "qrcode";

// A QR code as an SVG string, for a room's invite link (the teacher projects it on the
// board or prints it). Rendered on the server for the signed-in teacher only, so the link
// in it never reaches a third-party image service.

const MAX_TEXT = 500;

export async function qrSvg(text: string): Promise<string> {
  if (!text || text.length > MAX_TEXT) throw new Error("qr: text missing or too long");
  return QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}
