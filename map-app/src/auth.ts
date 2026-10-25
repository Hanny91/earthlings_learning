// The only module that talks to Neon Auth.
//
// ASSUMPTION (verify once Neon Auth is set up): Neon Auth is Better Auth under
// the hood, so the stock Better Auth client works against VITE_AUTH_URL with
// the organization and jwt plugins, and the jwt plugin's token is what the
// Data API accepts as a bearer token. If Neon's own SDK turns out to be
// required, swap the client here and keep the exported functions the same.
//
// Sign-in method is email/password for now; see the TODO in project.md.
// Email verification is on: Neon Auth sends the emails.

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

/** The organisation plugin's built-in roles. Owners and admins can change any of the organisation's pins and manage members. */
export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrgMember {
  /** Membership ID, used to change roles or remove the member. */
  id: string;
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
}

export interface OrganisationDetails extends Organisation {
  members: OrgMember[];
  /** Pending invites only. */
  invites: OrgInvite[];
}

/** What an invitee sees before accepting. */
export interface InviteSummary {
  id: string;
  organisationName: string;
  inviterEmail: string;
  email: string;
  role: OrgRole;
}

export class AuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** Better Auth's error code for signing in before verifying the email address. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

/** Email verification is on, so sign-up waits for the emailed link unless Neon signs the user straight in. */
export type SignUpResult = { status: 'signedIn'; user: AuthUser } | { status: 'verifyEmail' };

type AuthListener = (user: AuthUser | null) => void;

const client = createAuthClient({
  baseURL: config.authUrl,
  fetchOptions: { credentials: 'include' },
  plugins: [organizationClient(), jwtClient()],
});

let currentUser: AuthUser | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;
const listeners = new Set<AuthListener>();
const organisationListeners = new Set<() => void>();

function setUser(user: AuthUser | null): void {
  currentUser = user;
  cachedToken = null;
  listeners.forEach((listener) => listener(user));
}

function unwrap<T>(result: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (result.error || result.data === null) {
    throw new AuthError(result.error?.message ?? 'Something went wrong. Please try again.', result.error?.code);
  }
  return result.data;
}

// Where links in verification emails send people back to: this page, keeping
// any ?invite= so an invitee lands back on their invite.
function returnUrl(): string {
  return window.location.href;
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

/** Fails with code EMAIL_NOT_VERIFIED if the account's email hasn't been verified yet. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  try {
    unwrap(await client.signIn.email({ email, password, callbackURL: returnUrl() }));
  } catch (error) {
    if (error instanceof AuthError && error.code === EMAIL_NOT_VERIFIED) {
      throw new AuthError('Please verify your email address first, using the link we emailed you.', EMAIL_NOT_VERIFIED);
    }
    throw error;
  }
  const user = await loadSession();
  if (!user) throw new AuthError('Signed in, but the session could not be loaded.');
  return user;
}

/**
 * Creates an account. With email verification on, the user is usually not
 * signed in yet: they follow the emailed link, which brings them back here.
 */
export async function signUp(name: string, email: string, password: string): Promise<SignUpResult> {
  unwrap(await client.signUp.email({ name, email, password, callbackURL: returnUrl() }));
  const user = await loadSession();
  return user ? { status: 'signedIn', user } : { status: 'verifyEmail' };
}

export async function resendVerificationEmail(email: string): Promise<void> {
  unwrap(await client.sendVerificationEmail({ email, callbackURL: returnUrl() }));
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

// Organisations are created by hand while testing, so there's no createOrganisation here yet.
//
// ASSUMPTION (verify once Neon Auth is set up): the organization plugin's
// client methods and response shapes below match Better Auth's defaults, and
// the server lets owners and admins invite, change roles and remove members.

/** Called after anything that changes the signed-in user's memberships. Returns an unsubscribe function. */
export function onOrganisationsChange(listener: () => void): () => void {
  organisationListeners.add(listener);
  return () => organisationListeners.delete(listener);
}

function organisationsChanged(): void {
  organisationListeners.forEach((listener) => listener());
}

/** Members and pending invites for one organisation. */
export async function getOrganisationDetails(organisationId: string): Promise<OrganisationDetails> {
  const org = unwrap(await client.organization.getFullOrganization({ query: { organizationId: organisationId } }));
  return {
    id: org.id,
    name: org.name,
    members: org.members.map((member) => ({
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role as OrgRole,
    })),
    invites: org.invitations
      .filter((invite) => invite.status === 'pending')
      .map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role as OrgRole,
        expiresAt: new Date(invite.expiresAt).toISOString(),
      })),
  };
}

/**
 * Creates an invite and returns its ID. Neon Auth may also email it; the
 * inviter can always copy the link from inviteLink() and send it themselves.
 */
export async function createInvite(organisationId: string, email: string, role: 'admin' | 'member'): Promise<string> {
  const invite = unwrap(await client.organization.inviteMember({ organizationId: organisationId, email, role }));
  return invite.id;
}

/** The link an invitee opens to accept, e.g. https://earthlingslearning.co.uk/map/?invite=abc. */
export function inviteLink(inviteId: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?invite=${encodeURIComponent(inviteId)}`;
}

export async function cancelInvite(inviteId: string): Promise<void> {
  unwrap(await client.organization.cancelInvitation({ invitationId: inviteId }));
}

/** Invite details for the signed-in invitee. Fails if it was sent to a different email or has expired. */
export async function getInvite(inviteId: string): Promise<InviteSummary> {
  const invite = unwrap(await client.organization.getInvitation({ query: { id: inviteId } }));
  return {
    id: invite.id,
    organisationName: invite.organizationName,
    inviterEmail: invite.inviterEmail,
    email: invite.email,
    role: invite.role as OrgRole,
  };
}

export async function acceptInvite(inviteId: string): Promise<void> {
  unwrap(await client.organization.acceptInvitation({ invitationId: inviteId }));
  organisationsChanged();
}

export async function declineInvite(inviteId: string): Promise<void> {
  unwrap(await client.organization.rejectInvitation({ invitationId: inviteId }));
}

export async function updateMemberRole(organisationId: string, memberId: string, role: 'admin' | 'member'): Promise<void> {
  unwrap(await client.organization.updateMemberRole({ organizationId: organisationId, memberId, role }));
}

export async function removeMember(organisationId: string, memberId: string): Promise<void> {
  unwrap(await client.organization.removeMember({ organizationId: organisationId, memberIdOrEmail: memberId }));
}

export async function leaveOrganisation(organisationId: string): Promise<void> {
  unwrap(await client.organization.leave({ organizationId: organisationId }));
  organisationsChanged();
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
