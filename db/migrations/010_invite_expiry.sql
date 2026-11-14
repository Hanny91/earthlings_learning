-- Make organisation invites last 30 days instead of Neon Auth's 48 hours.
--
-- Invite links are sent by hand (WhatsApp, own email), so 48 hours is often
-- too short. The expiry is set on Neon Auth's server and the client can't
-- change it, so this trigger overwrites "expiresAt" whenever an invite is
-- created. Better Auth compares "expiresAt" with the current time when an
-- invite is opened or accepted, so the later date is what counts.
--
-- ASSUMPTION (verify): the organization plugin stores invites in
-- neon_auth.invitation with camelCase "expiresAt" and "status" columns, and
-- the migration role is allowed to create a trigger on it. 006 showed the
-- owner can't grant on Neon's auth schema, so this may fail the same way.
-- Neon could also drop the trigger when it updates Neon Auth.

create function app_private.extend_invite_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new."expiresAt" := now() + interval '30 days';
    return new;
end;
$$;

create trigger extend_invite_expiry
before insert on neon_auth.invitation
for each row
execute function app_private.extend_invite_expiry();

-- Give invites that are still pending the same 30 days.
update neon_auth.invitation
set "expiresAt" = now() + interval '30 days'
where status = 'pending';
