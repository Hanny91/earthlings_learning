-- Per-user insert rate limit. Placeholder threshold: 30 pins per rolling hour.
-- Change the constant below (in a new migration) once the real limit is decided.

create function app_private.pins_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    max_per_hour constant integer := 30;
    recent integer;
begin
    -- Serialise concurrent inserts by the same user so the count is reliable.
    perform pg_advisory_xact_lock(hashtext('pins_rate_limit:' || new.created_by));

    select count(*) into recent
    from public.pins p
    where p.created_by = new.created_by
      and p.created_at > now() - interval '1 hour';

    if recent >= max_per_hour then
        raise exception 'Rate limit reached: at most % pins per hour', max_per_hour
            using errcode = 'P0001', hint = 'rate_limit';
    end if;

    return new;
end;
$$;

revoke execute on function app_private.pins_rate_limit() from public;

create trigger pins_rate_limit
    before insert on public.pins
    for each row execute function app_private.pins_rate_limit();
