// The only module that touches aerial photo storage (see photos.md). Photos
// live in Neon for now; moving them to R2 later should only change this file.
// RLS decides who can see and change each photo (008_map_images.sql).

import { ApiError, request, requestBlob } from './dataApi';

export interface MapImageUpload {
  organisationId: string;
  title: string;
  /** ISO date (YYYY-MM-DD), or null if unknown. */
  capturedOn: string | null;
  /** An already-compressed JPEG. */
  file: Blob;
  width: number;
  height: number;
}

/** Uploads a photo for an organisation the user manages and returns its ID. */
export async function uploadMapImage(upload: MapImageUpload): Promise<number> {
  return request<number>('POST', '/rpc/upload_map_image', {
    body: {
      org_id: upload.organisationId,
      title: upload.title,
      captured_on: upload.capturedOn,
      image_base64: await toBase64(upload.file),
      width: upload.width,
      height: upload.height,
    },
  });
}

/** Deletes a photo. Fails if it doesn't exist or the user may not delete it. */
export async function deleteMapImage(id: number): Promise<void> {
  const rows = await request<{ id: number }[]>('DELETE', `/map_images?id=eq.${id}&select=id`, {
    returnRows: true,
  });
  if (rows.length === 0) {
    throw new ApiError("That photo doesn't exist or you don't have permission to delete it.", '42501');
  }
}

// A photo's bytes never change after upload, so one download per page load is enough.
const imageUrls = new Map<number, Promise<string>>();

/**
 * A URL for the photo that works in <img> and Leaflet overlays. The download
 * needs the user's token, which an <img src> can't send, so the bytes are
 * fetched here and handed over as a local blob URL.
 */
export function getImageUrl(id: number): Promise<string> {
  let url = imageUrls.get(id);
  if (!url) {
    url = requestBlob(`/rpc/map_image_file?image_id=${id}`, 'image/jpeg').then((blob) => URL.createObjectURL(blob));
    // A failed download shouldn't stick; the next call tries again.
    url.catch(() => imageUrls.delete(id));
    imageUrls.set(id, url);
  }
  return url;
}

/** Frees a photo's blob URL, e.g. after deleting it. */
export function forgetImageUrl(id: number): void {
  imageUrls.get(id)?.then((url) => URL.revokeObjectURL(url), () => {});
  imageUrls.delete(id);
}

// FileReader handles large files without building a huge string by hand.
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new ApiError("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
