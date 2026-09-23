export type ImageFormat = "jpeg" | "png" | "webp";

export interface ProcessResult {
  blob: Blob;
  width: number;
  height: number;
}

const MIME_TYPES: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Resizes (optionally) and re-encodes an image entirely client-side via
 * the Canvas API — no Rust image-processing crate needed for this. */
export async function processImage(
  file: File,
  format: ImageFormat,
  quality: number,
  maxWidth: number,
): Promise<ProcessResult> {
  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;
  if (maxWidth > 0 && width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D não disponível neste WebView2.");
  }

  // JPEG has no alpha channel — without a background fill first,
  // transparent PNG areas would flatten to black instead of the expected
  // white once re-encoded.
  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, MIME_TYPES[format], quality),
  );
  if (!blob) throw new Error("Falha ao gerar a imagem processada.");
  return { blob, width, height };
}

/** Triggers a normal browser-style download (WebView2/Edge saves it to the
 * user's Downloads folder), same technique as any web page — no native
 * save dialog plugin needed. */
export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function swapExtension(filename: string, format: ImageFormat): string {
  const ext = format === "jpeg" ? "jpg" : format;
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}-comprimido.${ext}`;
}
