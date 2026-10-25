# Assumptions to check

Things the survey map code assumes but that couldn't be confirmed while building, because Neon wasn't set up yet. Work through these once the Neon project, Auth and Data API are running. Tick each one off or note what changed.

---

## Neon setup

- [ ] **Data API is enabled** on the database, so `auth.user_id()` and the `anonymous` / `authenticated` roles exist. Migrations `001` and `003` fail without them.
- [ ] **Data API trusts Neon Auth tokens**, so a signed-in request runs as `authenticated` with `auth.user_id()` set to the user's ID.
- [ ] **Neon Auth is enabled with the organization plugin** before the first migration run. Migration `002` reads its tables, and Postgres checks they exist when it creates the functions.
- [ ] **`https://earthlingslearning.co.uk` is in Neon Auth's trusted domains.**
- [ ] **Cross-site sign-in works.** The auth server is on a Neon domain and the site is on earthlingslearning.co.uk, so the session cookie has to work across the two (`credentials: 'include'` in [auth.ts](map-app/src/auth.ts)). Check this in Safari as well, which blocks cross-site cookies by default.

## Auth tables (`db/migrations/002_org_helpers.sql`)

- [ ] Memberships are in **`neon_auth.member`**, with columns **`"organizationId"`**, **`"userId"`** and **`"role"`**.
- [ ] Organisations are in **`neon_auth.organization`**, with columns **`id`** and **`name`**.
- [ ] IDs are compared as text (`::text`). That's fine whether they're text or uuid, but if they're uuid, consider storing `pins.created_by` / `organisation_id` as uuid too.
- [ ] **Roles:** the plugin's default roles are owner/admin/member, but project.md uses owner/editor/member. `my_managed_org_ids()` currently accepts `owner`, `editor` and `admin`. Decide whether to add a custom "editor" role or treat admin as editor, then remove the one you don't use.

## Auth client (`map-app/src/auth.ts`)

- [ ] **The stock Better Auth client works against `VITE_AUTH_URL`**, using `better-auth/client` with the `organizationClient` and `jwtClient` plugins. If Neon requires its own SDK instead, only this file changes.
- [ ] **`client.token()` (jwt plugin) returns the token the Data API accepts** as `Authorization: Bearer …`.
- [ ] **The token has an `exp` claim.** If it doesn't, the cache simply fetches a fresh token on every request, which still works but is slower.
- [ ] **Email/password sign-up works as expected.** If email verification is turned on, sign-up won't return a session, and the user sees "Check your email to finish signing in".
- [ ] **`client.organization.list()` returns the user's organisations** with `id` and `name`.

## Data API client (`map-app/src/pinsApi.ts`)

- [ ] **`VITE_DATA_API_URL` is the full base URL Neon gives you** (including any path such as `/rest/v1`) with no trailing slash, so `/pins` and `/rpc/pins_in_bbox` can be appended directly.
- [ ] **The PostgREST features the code uses are supported:** `Prefer: return=representation` and `?select=id` on writes.
- [ ] **Requests without an `Authorization` header run as `anonymous`**, so logged-out visitors can load public pins.
- [ ] **The Data API sends CORS headers** for `https://earthlingslearning.co.uk` (and `http://localhost:5173` for development).
- [ ] **`geom` accepts EWKT text** (`SRID=4326;POINT(lng lat)`) in insert and update bodies.
- [ ] **Error bodies have PostgREST's shape** (`code`, `message`, `hint`), which is what the friendly error messages rely on.
- [ ] **An update or delete the user isn't allowed to make returns an empty list**, not an error. RLS hides the row, and the client turns the empty list into a "no permission" message.

## Database behaviour

- [ ] **Identity column inserts work** for the `authenticated` role, which has no separate sequence grant.
- [ ] **The rate-limit error reaches the client readably** (message "Rate limit reached…", hint `rate_limit`) through the Data API.
- [ ] **Policy checks in `(select …)` run once per query**, not once per row. You can confirm with `EXPLAIN` on a `pins_in_bbox` call: the plan should show an InitPlan.

## Build and deploy

- [ ] **GitHub repository variables** `VITE_DATA_API_URL` and `VITE_AUTH_URL` are set (as variables, not secrets).
- [ ] **GitHub secret** `DATABASE_URL` is set for the migrations workflow.
- [ ] **`psql` is available on `ubuntu-latest`** for [db/migrate.sh](db/migrate.sh). It's normally pre-installed.
- [ ] **The FTP upload excludes** `map-app/`, `db/` and the markdown docs, and uploads the built `map/` folder.
- [ ] **Node 22 builds cleanly.** Locally you're on Node 20.12, which only gives engine warnings for some of `better-auth`'s dependencies.

## Placeholders to replace

- [ ] **Survey fields:** `title` and `notes` stand in for the real ones.
- [ ] **Rate limit:** 30 pins per user per hour ([004](db/migrations/004_pins_rate_limit.sql)).
- [ ] **Row cap:** `pins_in_bbox` returns at most 500 rows ([005](db/migrations/005_pins_in_bbox.sql)).
- [ ] **Sign-in methods:** email/password only.
