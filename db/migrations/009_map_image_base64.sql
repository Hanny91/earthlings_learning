-- Download photos as base64 text instead of raw bytes.
--
-- 008's map_image_file returned bytea through a "*/*" domain, as PostgREST
-- documents. On Neon's Data API the headers it set arrived, but the bytes came
-- back about 2.5 times bigger and no longer a JPEG, so raw binary doesn't
-- survive. Base64 in ordinary JSON is about a third bigger but intact. The
-- client turns it back into a JPEG (getImageUrl in imagesApi.ts).

drop function public.map_image_file(bigint);
drop domain "*/*";

create function public.map_image_base64(image_id bigint)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
    photo record;
begin
    select m.data into photo
    from public.map_images m
    where m.id = image_id;

    -- Missing, not visible to this user, or already moved to R2.
    if not found then
        raise exception 'Photo not found' using errcode = 'P0002';
    end if;
    if photo.data is null then
        raise exception 'Photo not found' using errcode = 'P0002';
    end if;

    -- A photo's bytes never change after upload, so browsers may keep it for a long time.
    perform set_config('response.headers', json_build_array(
        json_build_object('Cache-Control', 'private, max-age=31536000, immutable')
    )::text, true);

    -- encode() breaks base64 into 76-character lines; the newlines are dropped.
    return replace(encode(photo.data, 'base64'), E'\n', '');
end;
$$;

revoke execute on function public.map_image_base64(bigint) from public;
grant execute on function public.map_image_base64(bigint) to authenticated;

-- Tell the Data API about the changed functions.
notify pgrst, 'reload schema';
