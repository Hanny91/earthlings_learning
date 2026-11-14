-- Aerial photos that organisations line up with the map (see photos.md).
--
-- Photos are stored in Neon for now. storage_key is reserved for a later move
-- to Cloudflare R2: a row has either data or a storage_key, never neither.
--
-- Only members of a photo's organisation can see it, and only its owners and
-- admins can add, re-align or delete it. Clients upload through
-- upload_map_image(), list through map_images_in_bbox() and download the bytes
-- through map_image_file().
--
-- ASSUMPTION (verify): the Data API serves map_image_file()'s "*/*" result as
-- raw bytes, with the Content-Type and Cache-Control headers it sets.

create table public.map_images (
    id              bigint generated always as identity primary key,
    organisation_id text not null,
    created_by      text not null default app_private.current_user_id(),
    title           text not null,
    captured_on     date,

    -- The photo, or where it lives once moved out of Neon.
    data            bytea,
    storage_key     text,
    content_type    text not null default 'image/jpeg',
    -- Set by the trigger from data, and kept when data is emptied.
    byte_size       integer not null,
    width           integer not null,
    height          integer not null,

    -- Alignment. control_points is the master copy: [{px, py, lng, lat}, ...]
    -- with px/py in photo pixels from the top-left. corners is worked out from
    -- them on the client: [{lng, lat} x 4] as top-left, top-right,
    -- bottom-right, bottom-left. footprint is set from corners by the trigger.
    control_points  jsonb,
    corners         jsonb,
    footprint       geometry(Polygon, 4326),

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint map_images_stored_once
        check ((data is null) <> (storage_key is null)),
    constraint map_images_jpeg_only
        check (content_type = 'image/jpeg'),
    constraint map_images_data_is_jpeg
        check (data is null or substring(data from 1 for 3) = '\xffd8ff'::bytea),
    constraint map_images_byte_size_range
        check (byte_size between 1 and 4194304),
    constraint map_images_dimensions_range
        check (width between 1 and 8000 and height between 1 and 8000),
    constraint map_images_title_length
        check (char_length(title) between 1 and 120),
    constraint map_images_captured_on_range
        check (captured_on is null or captured_on >= '1900-01-01'),
    constraint map_images_corners_need_points
        check (corners is null or (control_points is not null and jsonb_array_length(control_points) >= 3)),
    constraint map_images_storage_key_length
        check (storage_key is null or char_length(storage_key) <= 512),
    constraint map_images_created_by_length
        check (char_length(created_by) <= 64),
    constraint map_images_organisation_id_length
        check (char_length(organisation_id) <= 64)
);

create index map_images_footprint_idx on public.map_images using gist (footprint);
create index map_images_organisation_id_idx on public.map_images (organisation_id);

-- Checks the alignment JSON, sets byte_size and footprint, and on update keeps
-- ownership and creation time fixed and stamps updated_at.
create function app_private.map_images_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    point  jsonb;
    ring   public.geometry[] := '{}';
begin
    if tg_op = 'UPDATE' then
        new.organisation_id := old.organisation_id;
        new.created_by := old.created_by;
        new.created_at := old.created_at;
        new.updated_at := now();
    end if;

    if new.data is not null then
        new.byte_size := octet_length(new.data);
    end if;

    if new.control_points is not null then
        if jsonb_typeof(new.control_points) <> 'array'
           or jsonb_array_length(new.control_points) > 50 then
            raise exception 'control_points must be an array of at most 50 points'
                using errcode = '23514';
        end if;
        for point in select * from jsonb_array_elements(new.control_points) loop
            -- Types first, so the casts below can't fail on a non-number.
            if jsonb_typeof(point -> 'px') is distinct from 'number'
               or jsonb_typeof(point -> 'py') is distinct from 'number'
               or jsonb_typeof(point -> 'lng') is distinct from 'number'
               or jsonb_typeof(point -> 'lat') is distinct from 'number' then
                raise exception 'Invalid control point: %', point
                    using errcode = '23514';
            end if;
            if (point ->> 'px')::double precision not between 0 and new.width
               or (point ->> 'py')::double precision not between 0 and new.height
               or (point ->> 'lng')::double precision not between -180 and 180
               or (point ->> 'lat')::double precision not between -90 and 90 then
                raise exception 'Control point out of range: %', point
                    using errcode = '23514';
            end if;
        end loop;
    end if;

    if new.corners is null then
        new.footprint := null;
    else
        if jsonb_typeof(new.corners) <> 'array' or jsonb_array_length(new.corners) <> 4 then
            raise exception 'corners must be an array of 4 points'
                using errcode = '23514';
        end if;
        for point in select * from jsonb_array_elements(new.corners) loop
            if jsonb_typeof(point -> 'lng') is distinct from 'number'
               or jsonb_typeof(point -> 'lat') is distinct from 'number' then
                raise exception 'Invalid corner: %', point
                    using errcode = '23514';
            end if;
            if (point ->> 'lng')::double precision not between -180 and 180
               or (point ->> 'lat')::double precision not between -90 and 90 then
                raise exception 'Corner out of range: %', point
                    using errcode = '23514';
            end if;
            ring := ring || public.ST_MakePoint((point ->> 'lng')::double precision, (point ->> 'lat')::double precision);
        end loop;
        -- Close the ring back to the top-left corner.
        new.footprint := public.ST_SetSRID(public.ST_MakePolygon(public.ST_MakeLine(ring || ring[1])), 4326);
        -- A crossed-over shape means the alignment went wrong.
        if not public.ST_IsValid(new.footprint) then
            raise exception 'The corners cross over each other'
                using errcode = '23514';
        end if;
    end if;

    return new;
end;
$$;

revoke execute on function app_private.map_images_before_write() from public;

create trigger map_images_before_write
    before insert or update on public.map_images
    for each row execute function app_private.map_images_before_write();

-- At most 10 photos per organisation.
create function app_private.map_images_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    max_per_org constant integer := 10;
    existing integer;
begin
    -- Serialise concurrent uploads to the same organisation so the count is reliable.
    perform pg_advisory_xact_lock(hashtext('map_images_limit:' || new.organisation_id));

    select count(*) into existing
    from public.map_images m
    where m.organisation_id = new.organisation_id;

    if existing >= max_per_org then
        raise exception 'Photo limit reached: at most % photos per organisation', max_per_org
            using errcode = 'P0001', hint = 'photo_limit';
    end if;

    return new;
end;
$$;

revoke execute on function app_private.map_images_limit() from public;

create trigger map_images_limit
    before insert on public.map_images
    for each row execute function app_private.map_images_limit();

-- Row-level security. Photos are never public, so anonymous gets nothing.

alter table public.map_images enable row level security;

-- Column lists stop clients setting ownership, sizes, footprint or timestamps,
-- and stop them replacing a photo's bytes after upload.
revoke all on public.map_images from public, anonymous, authenticated;

grant select on public.map_images to authenticated;
grant insert (organisation_id, title, captured_on, data, width, height)
    on public.map_images to authenticated;
grant update (title, captured_on, control_points, corners)
    on public.map_images to authenticated;
grant delete on public.map_images to authenticated;

-- Read: members of the photo's organisation.
create policy map_images_select on public.map_images
    for select
    to authenticated
    using (organisation_id = any ((select app_private.my_org_ids())::text[]));

-- Add: owners and admins, as themselves.
create policy map_images_insert on public.map_images
    for insert
    to authenticated
    with check (
        created_by = (select app_private.current_user_id())
        and organisation_id = any ((select app_private.my_managed_org_ids())::text[])
    );

-- Edit and delete: owners and admins of the photo's organisation.
create policy map_images_update on public.map_images
    for update
    to authenticated
    using (organisation_id = any ((select app_private.my_managed_org_ids())::text[]))
    with check (organisation_id = any ((select app_private.my_managed_org_ids())::text[]));

create policy map_images_delete on public.map_images
    for delete
    to authenticated
    using (organisation_id = any ((select app_private.my_managed_org_ids())::text[]));

-- Upload. The image arrives as base64 in a JSON body, which is about a third
-- bigger than the raw file but needs no custom headers. Returns the new ID.
create function public.upload_map_image(
    org_id       text,
    title        text,
    captured_on  date,
    image_base64 text,
    width        integer,
    height       integer
)
returns bigint
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
    insert into public.map_images (organisation_id, title, captured_on, data, width, height)
    values (org_id, title, captured_on, decode(image_base64, 'base64'), width, height)
    returning id;
$$;

-- The aligned photos in view, without their bytes. can_edit tells the client
-- whether to show re-align and delete. Placeholder row cap: 50.
create function public.map_images_in_bbox(
    min_lng double precision,
    min_lat double precision,
    max_lng double precision,
    max_lat double precision
)
returns table (
    id              bigint,
    organisation_id text,
    title           text,
    captured_on     date,
    width           integer,
    height          integer,
    corners         jsonb,
    can_edit        boolean,
    updated_at      timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select
        m.id,
        m.organisation_id,
        m.title,
        m.captured_on,
        m.width,
        m.height,
        m.corners,
        m.organisation_id = any ((select app_private.my_managed_org_ids())::text[]),
        m.updated_at
    from public.map_images m
    where m.footprint && ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)
    order by m.captured_on desc nulls last, m.created_at desc
    limit 50;
$$;

-- The photo's bytes. A domain named "*/*" tells the Data API to send the
-- result as-is rather than as JSON, with the headers set below. A photo's
-- bytes never change after upload, so browsers may keep it for a long time.
create domain "*/*" as bytea;

create function public.map_image_file(image_id bigint)
returns "*/*"
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
    photo record;
begin
    select m.data, m.content_type into photo
    from public.map_images m
    where m.id = image_id;

    -- Missing, not visible to this user, or already moved to R2.
    if not found then
        raise exception 'Photo not found' using errcode = 'P0002';
    end if;
    if photo.data is null then
        raise exception 'Photo not found' using errcode = 'P0002';
    end if;

    perform set_config('response.headers', json_build_array(
        json_build_object('Content-Type', photo.content_type),
        json_build_object('Cache-Control', 'private, max-age=31536000, immutable')
    )::text, true);

    return photo.data;
end;
$$;

revoke execute on function
    public.upload_map_image(text, text, date, text, integer, integer),
    public.map_images_in_bbox(double precision, double precision, double precision, double precision),
    public.map_image_file(bigint)
from public;
grant execute on function
    public.upload_map_image(text, text, date, text, integer, integer),
    public.map_images_in_bbox(double precision, double precision, double precision, double precision),
    public.map_image_file(bigint)
to authenticated;

-- Tell the Data API about the new table and functions.
notify pgrst, 'reload schema';
