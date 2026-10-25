import type { OrgRole } from './auth';

/** How organisation roles are shown in the app. */
export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};
