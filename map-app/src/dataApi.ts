// Shared request handling for the Neon Data API. pinsApi.ts and imagesApi.ts
// build on this; nothing else should call the Data API directly.
//
// ASSUMPTION (verify once the Data API is set up): it is PostgREST-compatible,
// with tables at {VITE_DATA_API_URL}/<table> and functions at /rpc/<name>, and
// requests without an Authorization header run as the "anonymous" role.

import { getAccessToken } from './auth';
import { config } from './config';

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

interface PostgrestError {
  code?: string;
  message?: string;
  hint?: string | null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  body?: unknown;
  returnRows?: boolean;
  signal?: AbortSignal;
}

/** A JSON request. Errors come back as ApiError with a readable message. */
export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(method, path, 'application/json', options);
  return (response.status === 204 ? [] : await response.json()) as T;
}

/** A request whose response is a file rather than JSON. */
export async function requestBlob(path: string, accept: string, signal?: AbortSignal): Promise<Blob> {
  const response = await send('GET', path, accept, { signal });
  return response.blob();
}

async function send(method: Method, path: string, accept: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
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
  return response;
}

function toApiError(status: number, body: PostgrestError): ApiError {
  // The friendly messages below hide the database's own wording, which is what's needed for debugging.
  console.warn(`Data API error (${status}):`, body);
  if (body.hint === 'rate_limit') {
    return new ApiError("You've added a lot of pins recently. Please wait a while before adding more.", body.code);
  }
  if (body.hint === 'photo_limit') {
    return new ApiError('This organisation already has the most photos allowed. Delete one to add another.', body.code);
  }
  switch (body.code) {
    case '42501':
      return new ApiError("You don't have permission to do that.", body.code);
    case '23514':
      return new ApiError('Some of the details are invalid. Please check them and try again.', body.code);
  }
  if (status === 401) {
    return new ApiError('Your session has expired. Please sign in again.', body.code);
  }
  if (status === 413) {
    return new ApiError('That file is too big for the map server.', body.code);
  }
  return new ApiError(body.message ?? `The map server returned an error (${status}).`, body.code);
}
