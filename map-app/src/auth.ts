// The only module that talks to Neon Auth.
//
// ASSUMPTION (verify once Neon Auth is set up): Neon Auth is Better Auth under
// the hood, so the stock Better Auth client works against VITE_AUTH_URL with
// the organization and jwt plugins, and the jwt plugin's token is what the
// Data API accepts as a bearer token. If Neon's own SDK turns out to be
// required, swap the client here and keep the exported functions the same.
//
// Sign-in method is email/password for now; see the TODO in project.md.

import { createAuthClient } from 'better-auth/client';
import { jwtClient, organizationClient } from 'better-auth/client/plugins';
import { config } from './config';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface Organisation {
  id: string;
  name: string;
}

export class AuthError extends Error {}

type AuthListener = (user: AuthUser | null) => void;

const client = createAuthClient({
  baseURL: config.authUrl,
  fetchOptions: { credentials: 'include' },
  plugins: [organizationClient(), jwtClient()],
});

let currentUser: AuthUser | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;
const listeners = new Set<AuthListener>();

function setUser(user: AuthUser | null): void {
  currentUser = user;
  cachedToken = null;
  listeners.forEach((listener) => listener(user));
}

function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error || result.data === null) {
    throw new AuthError(result.error?.message ?? 'Something went wrong. Please try again.');
  }
  return result.data;
}

/** Calls the listener now and on every sign-in or sign-out. Returns an unsubscribe function. */
export function onAuthChange(listener: AuthListener): () => void {
  listeners.add(listener);
  listener(currentUser);
  return () => listeners.delete(listener);
}

export function getUser(): AuthUser | null {
  return currentUser;
}

/** Restores an existing session on page load. Logged-out visitors resolve to null. */
export async function loadSession(): Promise<AuthUser | null> {
  const { data } = await client.getSession();
  const user = data?.user;
  setUser(user ? { id: user.id, name: user.name, email: user.email } : null);
  return currentUser;
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  unwrap(await client.signIn.email({ email, password }));
  const user = await loadSession();
  if (!user) throw new AuthError('Signed in, but the session could not be loaded.');
  return user;
}

export async function signUp(name: string, email: string, password: string): Promise<AuthUser> {
  unwrap(await client.signUp.email({ name, email, password }));
  const user = await loadSession();
  if (!user) throw new AuthError('Account created. Check your email to finish signing in.');
  return user;
}

export async function signOut(): Promise<void> {
  await client.signOut();
  setUser(null);
}

/** Organisations the signed-in user belongs to; empty when logged out. */
export async function listMyOrganisations(): Promise<Organisation[]> {
  if (!currentUser) return [];
  const orgs = unwrap(await client.organization.list());
  return orgs.map((org) => ({ id: org.id, name: org.name }));
}

/**
 * A JWT for the Data API's Authorization header, or null when logged out.
 * Cached until shortly before it expires.
 */
export async function getAccessToken(): Promise<string | null> {
  if (!currentUser) return null;
  if (cachedToken && cachedToken.expiresAt - 30_000 > Date.now()) {
    return cachedToken.value;
  }
  const { token } = unwrap(await client.token());
  cachedToken = { value: token, expiresAt: tokenExpiry(token) };
  return token;
}

// Reads the exp claim without verifying; the Data API does the verification.
function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}
