// Shrinks aerial photos in the browser before upload.
//
// Every photo is re-saved, even one that's already small, because redrawing
// drops EXIF data such as the drone's GPS position.
//
// ASSUMPTION (verify): Safari's canvas.toBlob('image/jpeg', quality) gives a
// real JPEG at that quality. The type check below catches it if not.

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  originalBytes: number;
}

const MiB = 1024 * 1024;
/** What we aim for: keeps uploads and downloads quick. */
const TARGET_BYTES = 3 * MiB;
/** The map_images table's own limit (008_map_images.sql). */
const MAX_BYTES = 4 * MiB;

// Tried in order until one comes in under TARGET_BYTES. 4000px also stays
// under iPhone canvas limits.
const ATTEMPTS = [
  { maxSide: 4000, quality: 0.82 },
  { maxSide: 4000, quality: 0.7 },
  { maxSide: 3200, quality: 0.7 },
];

/** A JPEG of at most 4000px on its longest side, normally 3 MB or less. Throws with a readable message. */
export async function compressImage(file: File): Promise<CompressedImage> {
  let bitmap: ImageBitmap;
  try {
    // from-image follows the camera's orientation data, so photos come out the right way up.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Usually an iPhone HEIC photo in a browser other than Safari.
    throw new Error("This browser can't read that photo. Save it as a JPEG and try again.");
  }

  try {
    let encoded: Blob | null = null;
    let size = { width: 0, height: 0 };
    for (const attempt of ATTEMPTS) {
      size = fitWithin(bitmap.width, bitmap.height, attempt.maxSide);
      encoded = await encodeJpeg(bitmap, size.width, size.height, attempt.quality);
      if (encoded.size <= TARGET_BYTES) break;
    }
    if (!encoded || encoded.size > MAX_BYTES) {
      throw new Error('That photo is still too big after shrinking it. Try a smaller or less detailed photo.');
    }
    return { blob: encoded, ...size, originalBytes: file.size };
  } finally {
    bitmap.close();
  }
}

/** Scales down to fit maxSide on the longest side. Never scales up. */
function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This photo is too large for this device to process.');
    // JPEG can't store transparency, so transparent areas of a PNG come out white rather than black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob || blob.type !== 'image/jpeg') {
      throw new Error("This browser couldn't save the photo as a JPEG.");
    }
    return blob;
  } finally {
    // Frees the canvas memory straight away rather than waiting for garbage collection.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** "18.4 MB" style sizes for showing to users. */
export function formatBytes(bytes: number): string {
  return bytes < MiB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MiB).toFixed(1)} MB`;
}
