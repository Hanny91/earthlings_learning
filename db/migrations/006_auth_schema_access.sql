-- Let the Data API roles call auth.user_id(), which the pin policies and
-- pins_in_bbox use to identify the caller. Without this, every request fails
-- with "permission denied for schema auth".
--
-- Only the schema and this one function are granted, not anything else in auth.

grant usage on schema auth to anonymous, authenticated;
grant execute on function auth.user_id() to anonymous, authenticated;
