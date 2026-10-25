-- Route every "who is calling?" lookup through app_private.current_user_id().
--
-- The Data API roles (anonymous, authenticated) have no access to Neon's auth
-- schema, and the database owner can't grant it (006 only produced
-- "no privileges were granted" warnings). The owner can call auth.user_id(),
-- so this SECURITY DEFINER wrapper calls it on the caller's behalf. The
-- function reads the request's JWT claims, which belong to the session, not to
-- the role, so it still returns the caller's ID.
--
-- my_org_ids() and my_managed_org_ids() are already SECURITY DEFINER, so they
-- keep calling auth.user_id() directly. Everything that runs as the caller
-- (column default, policies, pins_in_bbox) switches to the wrapper.

create function app_private.current_user_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select auth.user_id();
$$;

revoke execute on function app_private.current_user_id() from public;
grant execute on function app_private.current_user_id() to anonymous, authenticated;

alter table public.pins
    alter column created_by set default app_private.current_user_id();

-- Policies: same rules as 003, with the wrapper in place of auth.user_id().

drop policy pins_select on public.pins;
create policy pins_select on public.pins
    for select
    to anonymous, authenticated
    using (
        visibility = 'public'
        or created_by = (select app_private.current_user_id())
        or organisation_id = any ((select app_private.my_org_ids())::text[])
    );

drop policy pins_insert on public.pins;
create policy pins_insert on public.pins
    for insert
    to authenticated
    with check (
        created_by = (select app_private.current_user_id())
        and (
            organisation_id is null
            or organisation_id = any ((select app_private.my_org_ids())::text[])
        )
    );

drop policy pins_update on public.pins;
create policy pins_update on public.pins
    for update
    to authenticated
    using (
        created_by = (select app_private.current_user_id())
        or organisation_id = any ((select app_private.my_managed_org_ids())::text[])
    )
    with check (
        (
            organisation_id is null
            or organisation_id = any ((select app_private.my_org_ids())::text[])
        )
        and (
            created_by = (select app_private.current_user_id())
            or organisation_id = any ((select app_private.my_managed_org_ids())::text[])
        )
    );

drop policy pins_delete on public.pins;
create policy pins_delete on public.pins
    for delete
    to authenticated
    using (
        created_by = (select app_private.current_user_id())
        or organisation_id = any ((select app_private.my_managed_org_ids())::text[])
    );

-- pins_in_bbox: same as 005, with the wrapper in can_edit.

create or replace function public.pins_in_bbox(
    min_lng double precision,
    min_lat double precision,
    max_lng double precision,
    max_lat double precision
)
returns table (
    id                bigint,
    organisation_id   text,
    organisation_name text,
    visibility        text,
    lng               double precision,
    lat               double precision,
    title             text,
    notes             text,
    can_edit          boolean,
    created_at        timestamptz,
    updated_at        timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select
        p.id,
        p.organisation_id,
        app_private.org_name(p.organisation_id),
        p.visibility,
        ST_X(p.geom),
        ST_Y(p.geom),
        p.title,
        p.notes,
        coalesce(
            p.created_by = (select app_private.current_user_id())
            or p.organisation_id = any ((select app_private.my_managed_org_ids())::text[]),
            false
        ),
        p.created_at,
        p.updated_at
    from public.pins p
    where p.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    order by p.created_at desc
    limit 500;
$$;
