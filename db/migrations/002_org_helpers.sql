-- Organisation membership helpers used by the pin policies.
--
-- Each returns the current user's organisation IDs as an array. Policies call
-- them as `(select app_private.my_org_ids())` so Postgres evaluates them once
-- per query rather than once per row.
--
-- ASSUMPTION (verify once Neon Auth is set up): the organization plugin stores
-- memberships in neon_auth.member with camelCase columns "organizationId",
-- "userId" and "role", and organisations in neon_auth.organization with "id"
-- and "name". IDs are compared as text so this works whether they are text or uuid.
--
-- The plugin's default roles are owner/admin/member; project.md uses
-- owner/editor/member, so "editor" needs adding as a custom role, or "admin"
-- treated as editor (both are accepted below).
--
-- These are SECURITY DEFINER so callers don't need direct access to the auth
-- schema. They live in app_private, which the Data API doesn't expose.

create schema if not exists app_private;

-- Every organisation the current user belongs to. Empty when logged out.
create function app_private.my_org_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(m."organizationId"::text), '{}')
    from neon_auth.member m
    where m."userId"::text = auth.user_id();
$$;

-- Organisations where the current user can change any pin (owner or editor).
create function app_private.my_managed_org_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(array_agg(m."organizationId"::text), '{}')
    from neon_auth.member m
    where m."userId"::text = auth.user_id()
      and m.role in ('owner', 'editor', 'admin');
$$;

-- Organisation display name, so the map can label public pins for any viewer.
create function app_private.org_name(org_id text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select o.name
    from neon_auth.organization o
    where o.id::text = org_id;
$$;

revoke all on schema app_private from public;
revoke execute on all functions in schema app_private from public;

grant usage on schema app_private to anonymous, authenticated;
grant execute on function
    app_private.my_org_ids(),
    app_private.my_managed_org_ids(),
    app_private.org_name(text)
to anonymous, authenticated;
