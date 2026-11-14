// All pin reads and writes go through here; RLS decides what each call is
// allowed to see or change. Request handling is shared with photos in dataApi.ts.

import { ApiError, request } from './dataApi';

export type Visibility = 'public' | 'org_only';

export interface Pin {
  id: number;
  organisationId: string | null;
  organisationName: string | null;
  visibility: Visibility;
  lng: number;
  lat: number;
  title: string;
  notes: string | null;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PinInput {
  lng: number;
  lat: number;
  title: string;
  notes: string | null;
  organisationId: string | null;
  visibility: Visibility;
}

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

// Row shape returned by pins_in_bbox (see db/migrations/005_pins_in_bbox.sql).
interface PinRow {
  id: number;
  organisation_id: string | null;
  organisation_name: string | null;
  visibility: Visibility;
  lng: number;
  lat: number;
  title: string;
  notes: string | null;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
}

/** Pins inside the box that the current viewer may see, newest first, capped by the database. */
export async function pinsInBbox(bbox: Bbox, signal?: AbortSignal): Promise<Pin[]> {
  const rows = await request<PinRow[]>('POST', '/rpc/pins_in_bbox', {
    body: {
      min_lng: bbox.minLng,
      min_lat: bbox.minLat,
      max_lng: bbox.maxLng,
      max_lat: bbox.maxLat,
    },
    signal,
  });
  return rows.map(toPin);
}

/** Adds a pin as the signed-in user and returns its ID. */
export async function createPin(input: PinInput): Promise<number> {
  const rows = await request<{ id: number }[]>('POST', '/pins?select=id', {
    body: toRow(input),
    returnRows: true,
  });
  return rows[0].id;
}

/** Updates a pin. Fails if it doesn't exist or the user may not edit it. */
export async function updatePin(id: number, input: PinInput): Promise<void> {
  const rows = await request<{ id: number }[]>('PATCH', `/pins?id=eq.${id}&select=id`, {
    body: toRow(input),
    returnRows: true,
  });
  if (rows.length === 0) throw notAllowed();
}

/** Deletes a pin. Fails if it doesn't exist or the user may not delete it. */
export async function deletePin(id: number): Promise<void> {
  const rows = await request<{ id: number }[]>('DELETE', `/pins?id=eq.${id}&select=id`, {
    returnRows: true,
  });
  if (rows.length === 0) throw notAllowed();
}

function toPin(row: PinRow): Pin {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    organisationName: row.organisation_name,
    visibility: row.visibility,
    lng: row.lng,
    lat: row.lat,
    title: row.title,
    notes: row.notes,
    canEdit: row.can_edit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Only the columns RLS lets clients write (see 003_pins_policies.sql).
// geom is sent as EWKT, which PostGIS parses on input.
function toRow(input: PinInput) {
  return {
    organisation_id: input.organisationId,
    visibility: input.visibility,
    geom: `SRID=4326;POINT(${input.lng} ${input.lat})`,
    title: input.title,
    notes: input.notes,
  };
}

// RLS hides rows the user can't change, so an update or delete that matches
// nothing looks the same as one on a pin that doesn't exist.
function notAllowed(): ApiError {
  return new ApiError("That pin doesn't exist or you don't have permission to change it.", '42501');
}
