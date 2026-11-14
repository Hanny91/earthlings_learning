-- Show who added each pin: pins_in_bbox gains the creator's name and email.
--
-- Shown on every pin the viewer can see, so anyone who can see a pin can see
-- its creator's name and email address (decided 2026-11-14). It also makes a
-- pin whose created_by matches no account easy to spot: both come back null.
--
-- ASSUMPTION (verify): Neon Auth stores users in neon_auth."user" with "id"
-- (uuid), "name" and "email" columns, as Better Auth does by default.
--
-- The lookup is SECURITY DEFINER, like org_name(), so callers don't need
-- access to the auth schema.

create function app_private.user_info(user_id text)
returns table (name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
    select u.name, u.email
    from neon_auth."user" u
    where u.id::text = user_id;
$$;

revoke execute on function app_private.user_info(text) from public;
grant execute on function app_private.user_info(text) to anonymous, authenticated;

-- pins_in_bbox: same as 007, plus created_by_name and created_by_email.
-- Its result columns change, so it has to be dropped rather than replaced.

drop function public.pins_in_bbox(double precision, double precision, double precision, double precision);

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
    created_by_name   text,
    created_by_email  text,
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
        creator.name,
        creator.email,
        coalesce(
            p.created_by = (select app_private.current_user_id())
            or p.organisation_id = any ((select app_private.my_managed_org_ids())::text[]),
            false
        ),
        p.created_at,
        p.updated_at
    from public.pins p
    left join lateral app_private.user_info(p.created_by) creator on true
    where p.geom && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    order by p.created_at desc
    limit 500;
$$;

revoke execute on function public.pins_in_bbox(double precision, double precision, double precision, double precision) from public;
grant execute on function public.pins_in_bbox(double precision, double precision, double precision, double precision)
    to anonymous, authenticated;

-- Tell the Data API about the changed function.
notify pgrst, 'reload schema';
