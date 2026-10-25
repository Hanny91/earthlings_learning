// The only module that talks to the Neon Data API. All pin reads and writes
// go through here; RLS decides what each call is allowed to see or change.
//
// ASSUMPTION (verify once the Data API is set up): it is PostgREST-compatible,
// with tables at {VITE_DATA_API_URL}/pins and functions at /rpc/<name>, and
// requests without an Authorization header run as the "anonymous" role.

import { getAccessToken } from './auth';
import { config } from './config';

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

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
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

interface PostgrestError {
  code?: string;
  message?: string;
  hint?: string | null;
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

async function request<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; returnRows?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.returnRows) headers.Prefer = 'return=representation';

  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${config.dataApiUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError("Couldn't reach the map server. Check your connection and try again.");
  }

  if (!response.ok) {
    const body: PostgrestError = await response.json().catch(() => ({}));
    throw toApiError(response.status, body);
  }

  return (response.status === 204 ? [] : await response.json()) as T;
}

function toApiError(status: number, body: PostgrestError): ApiError {
  // The friendly messages below hide the database's own wording, which is what's needed for debugging.
  console.warn(`Data API error (${status}):`, body);
  if (body.hint === 'rate_limit') {
    return new ApiError("You've added a lot of pins recently. Please wait a while before adding more.", body.code);
  }
  switch (body.code) {
    case '42501':
      return new ApiError("You don't have permission to do that.", body.code);
    case '23514':
      return new ApiError('Some of the pin details are invalid. Please check them and try again.', body.code);
  }
  if (status === 401) {
    return new ApiError('Your session has expired. Please sign in again.', body.code);
  }
  return new ApiError(body.message ?? `The map server returned an error (${status}).`, body.code);
}
