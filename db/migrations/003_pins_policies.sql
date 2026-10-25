-- Row-level security for pins. These policies are the only access control;
-- the client just reflects what they allow.
--
-- Data API roles: "anonymous" for logged-out requests, "authenticated" for
-- requests carrying a Neon Auth token. auth.user_id() is null for anonymous.
--
-- Function calls are wrapped in (select ...) so each is evaluated once per
-- query, not once per row. A null organisation_id never matches `= any`.

alter table public.pins enable row level security;

-- Table privileges. Column lists stop clients setting created_by, timestamps
-- or id directly; created_by comes from its auth.user_id() default.
revoke all on public.pins from public, anonymous, authenticated;

grant select on public.pins to anonymous, authenticated;
grant insert (organisation_id, visibility, geom, title, notes)
    on public.pins to authenticated;
grant update (organisation_id, visibility, geom, title, notes)
    on public.pins to authenticated;
grant delete on public.pins to authenticated;

-- Read: public pins for everyone; org_only pins for that organisation's
-- members; and creators always see their own pins.
create policy pins_select on public.pins
    for select
    to anonymous, authenticated
    using (
        visibility = 'public'
        or created_by = (select auth.user_id())
        or organisation_id = any ((select app_private.my_org_ids()))
    );

-- Add: any signed-in user, as themselves. Organisation pins need membership.
create policy pins_insert on public.pins
    for insert
    to authenticated
    with check (
        created_by = (select auth.user_id())
        and (
            organisation_id is null
            or organisation_id = any ((select app_private.my_org_ids()))
        )
    );

-- Edit: the creator, or an owner/editor of the pin's organisation.
-- The check also applies to the new row, so a pin can only be moved into an
-- organisation the user belongs to.
create policy pins_update on public.pins
    for update
    to authenticated
    using (
        created_by = (select auth.user_id())
        or organisation_id = any ((select app_private.my_managed_org_ids()))
    )
    with check (
        (
            organisation_id is null
            or organisation_id = any ((select app_private.my_org_ids()))
        )
        and (
            created_by = (select auth.user_id())
            or organisation_id = any ((select app_private.my_managed_org_ids()))
        )
    );

-- Delete: same people who can edit.
create policy pins_delete on public.pins
    for delete
    to authenticated
    using (
        created_by = (select auth.user_id())
        or organisation_id = any ((select app_private.my_managed_org_ids()))
    );
