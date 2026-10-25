-- Pins table: one surveyed point per row.
-- created_by and organisation_id are text because they hold Neon Auth IDs;
-- see 002 for the assumption about the auth schema's column types.

create extension if not exists postgis;

create table public.pins (
    id              bigint generated always as identity primary key,
    created_by      text not null default auth.user_id(),
    organisation_id text,
    visibility      text not null default 'public',
    geom            geometry(Point, 4326) not null,

    -- Placeholder survey fields until the real ones are decided.
    title           text not null,
    notes           text,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint pins_visibility_valid
        check (visibility in ('public', 'org_only')),
    constraint pins_org_only_needs_org
        check (visibility <> 'org_only' or organisation_id is not null),
    constraint pins_geom_in_range
        check (ST_X(geom) between -180 and 180 and ST_Y(geom) between -90 and 90),
    constraint pins_title_length
        check (char_length(title) between 1 and 120),
    constraint pins_notes_length
        check (notes is null or char_length(notes) <= 2000),
    constraint pins_created_by_length
        check (char_length(created_by) <= 64),
    constraint pins_organisation_id_length
        check (organisation_id is null or char_length(organisation_id) <= 64)
);

create index pins_geom_idx on public.pins using gist (geom);
create index pins_organisation_id_idx on public.pins (organisation_id);
create index pins_created_by_created_at_idx on public.pins (created_by, created_at);

-- Keep ownership and creation time fixed, and stamp updated_at on every change.
create function public.pins_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
end;
$$;

create trigger pins_before_update
    before update on public.pins
    for each row execute function public.pins_before_update();
