-- The map's single read query: pins inside a bounding box.
-- SECURITY INVOKER, so the pins RLS policies filter rows for the caller.
-- Returns lng/lat rather than raw geometry, plus a can_edit flag so the client
-- can decide which buttons to show without knowing anyone's user ID.
-- Placeholder row cap: 500.

create function public.pins_in_bbox(
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
            p.created_by = (select auth.user_id())
            or p.organisation_id = any ((select app_private.my_managed_org_ids())),
            false
        ),
        p.created_at,
        p.updated_at
    from public.pins p
    where p.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    order by p.created_at desc
    limit 500;
$$;

revoke execute on function public.pins_in_bbox(double precision, double precision, double precision, double precision) from public;
grant execute on function public.pins_in_bbox(double precision, double precision, double precision, double precision)
    to anonymous, authenticated;
