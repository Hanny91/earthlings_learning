// The only module that touches aerial photo storage (see photos.md). Photos
// live in Neon for now; moving them to R2 later should only change this file.
// RLS decides who can see and change each photo (008_map_images.sql).

import { ApiError, request } from './dataApi';
import type { Bbox } from './pinsApi';

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

export interface MapImageSummary {
  id: number;
  title: string;
  capturedOn: string | null;
  byteSize: number;
  width: number;
  height: number;
  /** False until the photo has been lined up with the map. */
  aligned: boolean;
  createdAt: string;
}

interface MapImageSummaryRow {
  id: number;
  title: string;
  captured_on: string | null;
  byte_size: number;
  width: number;
  height: number;
  corners: unknown;
  created_at: string;
}

/** An organisation's photos, aligned or not, newest upload first. Members only. */
export async function listOrganisationImages(organisationId: string): Promise<MapImageSummary[]> {
  const params = new URLSearchParams({
    organisation_id: `eq.${organisationId}`,
    select: 'id,title,captured_on,byte_size,width,height,corners,created_at',
    order: 'created_at.desc',
  });
  const rows = await request<MapImageSummaryRow[]>('GET', `/map_images?${params}`);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    capturedOn: row.captured_on,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    aligned: row.corners !== null,
    createdAt: row.created_at,
  }));
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

/** A pair of clicks from the alignment screen: a photo pixel (from the top-left) and the same spot on the map. */
export interface ControlPoint {
  px: number;
  py: number;
  lng: number;
  lat: number;
}

export interface LngLat {
  lng: number;
  lat: number;
}

/** Top-left, top-right, bottom-right, bottom-left, as stored in map_images.corners. */
export type Corners = [LngLat, LngLat, LngLat, LngLat];

export interface ImageAlignment {
  width: number;
  height: number;
  /** Empty for a photo that hasn't been lined up yet. */
  controlPoints: ControlPoint[];
  corners: Corners | null;
}

/** What the alignment screen needs to start: the photo's size and any saved points. */
export async function getImageAlignment(id: number): Promise<ImageAlignment> {
  const rows = await request<{ width: number; height: number; control_points: ControlPoint[] | null; corners: Corners | null }[]>(
    'GET',
    `/map_images?id=eq.${id}&select=width,height,control_points,corners`,
  );
  if (rows.length === 0) throw new ApiError("That photo doesn't exist or you don't have permission to see it.", '42501');
  const row = rows[0];
  return { width: row.width, height: row.height, controlPoints: row.control_points ?? [], corners: row.corners };
}

/** Saves a photo's alignment. The database works out its footprint from the corners. */
export async function saveAlignment(id: number, controlPoints: ControlPoint[], corners: Corners): Promise<void> {
  let rows: { id: number }[];
  try {
    rows = await request<{ id: number }[]>('PATCH', `/map_images?id=eq.${id}&select=id`, {
      body: { control_points: controlPoints, corners },
      returnRows: true,
    });
  } catch (error) {
    // Usually the corners crossing over (see map_images_before_write in 008).
    if (error instanceof ApiError && error.code === '23514') {
      throw new ApiError("The points don't agree with each other. Check for a misplaced point and try again.", error.code);
    }
    throw error;
  }
  if (rows.length === 0) {
    throw new ApiError("That photo doesn't exist or you don't have permission to change it.", '42501');
  }
  imagesChanged();
}

const imageListeners = new Set<() => void>();

/** Called after a photo is re-aligned or deleted, so the map can redraw. Returns an unsubscribe function. */
export function onImagesChange(listener: () => void): () => void {
  imageListeners.add(listener);
  return () => imageListeners.delete(listener);
}

function imagesChanged(): void {
  imageListeners.forEach((listener) => listener());
}

/** An aligned photo in the current map view, without its bytes (see getImageUrl). */
export interface MapImageInView {
  id: number;
  organisationId: string;
  title: string;
  capturedOn: string | null;
  width: number;
  height: number;
  corners: Corners;
  updatedAt: string;
}

interface MapImageInViewRow {
  id: number;
  organisation_id: string;
  title: string;
  captured_on: string | null;
  width: number;
  height: number;
  corners: Corners;
  updated_at: string;
}

/** Aligned photos inside the box that the viewer may see (members of their organisations only). */
export async function mapImagesInBbox(bbox: Bbox, signal?: AbortSignal): Promise<MapImageInView[]> {
  const rows = await request<MapImageInViewRow[]>('POST', '/rpc/map_images_in_bbox', {
    body: { min_lng: bbox.minLng, min_lat: bbox.minLat, max_lng: bbox.maxLng, max_lat: bbox.maxLat },
    signal,
  });
  return rows.map((row) => ({
    id: row.id,
    organisationId: row.organisation_id,
    title: row.title,
    capturedOn: row.captured_on,
    width: row.width,
    height: row.height,
    corners: row.corners,
    updatedAt: row.updated_at,
  }));
}

/** Deletes a photo. Fails if it doesn't exist or the user may not delete it. */
export async function deleteMapImage(id: number): Promise<void> {
  const rows = await request<{ id: number }[]>('DELETE', `/map_images?id=eq.${id}&select=id`, {
    returnRows: true,
  });
  if (rows.length === 0) {
    throw new ApiError("That photo doesn't exist or you don't have permission to delete it.", '42501');
  }
  imagesChanged();
}

// A photo's bytes never change after upload, so one download per page load is enough.
const imageUrls = new Map<number, Promise<string>>();

/**
 * A URL for the photo that works in <img> and Leaflet overlays. The download
 * needs the user's token, which an <img src> can't send, so the photo is
 * fetched here and handed over as a local blob URL.
 *
 * It arrives as base64 because Neon's Data API doesn't pass raw bytes through
 * intact (see 009_map_image_base64.sql).
 */
export function getImageUrl(id: number): Promise<string> {
  let url = imageUrls.get(id);
  if (!url) {
    url = request<string>('GET', `/rpc/map_image_base64?image_id=${id}`)
      .then(fromBase64)
      .then((blob) => URL.createObjectURL(blob));
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

// fetch() decodes a data URL without building the bytes by hand.
async function fromBase64(base64: string): Promise<Blob> {
  const response = await fetch(`data:image/jpeg;base64,${base64}`);
  return response.blob();
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
