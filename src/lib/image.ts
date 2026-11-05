// Browser-only helper. Phone photos are 3-12 MB, the server accepts 4 MB per file and the
// model reads nothing above ~1600 px on the long edge anyway, so photos are re-encoded as
// JPEG with the long edge capped at MAX_SIDE before upload. PDFs, GIFs and images that are
// already small pass through untouched. Any failure returns the original file.

export const MAX_SIDE = 2000;
const KEEP_BELOW_BYTES = 1.5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

export async function shrinkImage(file: File, maxSide = MAX_SIDE): Promise<File> {
  if (typeof document === "undefined") return file;
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return file;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    if (scale === 1 && file.size <= KEEP_BELOW_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
