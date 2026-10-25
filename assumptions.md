# Assumptions to check

Things the survey map code assumes but that couldn't be confirmed while building, because Neon wasn't set up yet. Work through these once the Neon project, Auth and Data API are running. Tick each one off or note what changed.

---

## Neon setup

- [ ] **Data API is enabled** on the database, so `auth.user_id()` and the `anonymous` / `authenticated` roles exist. `auth.user_id()` is confirmed, because migration `001` applied; the roles are confirmed once `003` applies.
- [x] **The caller's ID reaches the security rules.** Confirmed: pins load signed in and out after `007`. The Data API roles can't use Neon's `auth` schema, and `006`'s grants were ignored ("no privileges were granted"). Migration `007` adds `app_private.current_user_id()`, a SECURITY DEFINER wrapper around `auth.user_id()`, and switches the column default, policies and `pins_in_bbox` to it. To check: pins load signed in and out, a new pin's popup shows Edit/Delete for its creator, and not for anyone else.
- [ ] **Data API trusts Neon Auth tokens**, so a signed-in request runs as `authenticated` with `auth.user_id()` set to the user's ID.
- [x] **Neon Auth is enabled with the organization plugin** before the first migration run. Migration `002` reads its tables, and Postgres checks they exist when it creates the functions.
- [ ] **`https://earthlingslearning.co.uk` is in Neon Auth's trusted domains.**
- [ ] **Cross-site sign-in works.** The auth server is on a Neon domain and the site is on earthlingslearning.co.uk, so the session cookie has to work across the two (`credentials: 'include'` in [auth.ts](map-app/src/auth.ts)). Check this in Safari as well, which blocks cross-site cookies by default.

## Auth tables (`db/migrations/002_org_helpers.sql`)

- [x] Memberships are in **`neon_auth.member`**, with columns **`"organizationId"`**, **`"userId"`** and **`"role"`**. Confirmed: migration `002` applied.
- [x] Organisations are in **`neon_auth.organization`**, with columns **`id`** and **`name`**. Confirmed: migration `002` applied.
- [ ] IDs are compared as text (`::text`). That's fine whether they're text or uuid, but if they're uuid, consider storing `pins.created_by` / `organisation_id` as uuid too.
- [ ] **Roles** are stored as the plugin's `owner`, `admin` and `member` strings in `neon_auth.member.role`. `my_managed_org_ids()` treats `owner` and `admin` as able to change any of the organisation's pins.

## Auth client (`map-app/src/auth.ts`)

- [x] **The stock Better Auth client works against `VITE_AUTH_URL`**, using `better-auth/client` with the `organizationClient` and `jwtClient` plugins. If Neon requires its own SDK instead, only this file changes.
- [x] **`client.token()` (jwt plugin) returns the token the Data API accepts** as `Authorization: Bearer …`. Confirmed: the token comes from `/token`. An early "no token" error came from pins loading before the session was restored; `getAccessToken()` now waits for the first session check.
- [ ] **The token has an `exp` claim.** If it doesn't, the cache simply fetches a fresh token on every request, which still works but is slower.
- [x] **Email verification by code.** Neon Auth is set to *Verification code*; confirmed that the email contains a code, not a link.
  - Neon's code option is Better Auth's email-OTP plugin, so `emailOTPClient` with `client.emailOtp.verifyEmail({ email, otp })` and `client.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })` work.
  - Sign-up doesn't sign the user in. The dialog switches to "Check your email" with a code box.
  - After a correct code, the user is signed in. If verifying doesn't start a session, the dialog signs in with the password just typed, so either way should work.
  - Signing in before verifying fails with code `EMAIL_NOT_VERIFIED`. The dialog then sends a new code and shows the code box.
- [ ] **Neon's built-in email** has acceptable sending limits and sender address for the test run, or an SMTP provider is needed sooner.
- [ ] **`client.organization.list()` returns the user's organisations** with `id` and `name`.

## Organisations and invites (`map-app/src/auth.ts`, `OrganisationsDialog.tsx`, `AcceptInviteDialog.tsx`)

- [ ] **You can create an organisation outside the app and be its owner**, through the Neon Auth console if it has one, or another route. There's no create form in the app yet.
- [ ] **The organisation plugin's client methods exist with these names and shapes:** `getFullOrganization` (returning `members[].user.name/email` and `invitations[]`), `inviteMember`, `cancelInvitation`, `getInvitation`, `acceptInvitation`, `rejectInvitation`, `updateMemberRole`, `removeMember` and `leave`.
- [ ] **`inviteMember` works with no email sending configured**: it creates the invite and returns its ID, rather than failing because there's no email sender set up.
- [ ] **The server lets owners and admins** invite people, change roles and remove members, but not ordinary members.
- [ ] **`getInvitation` only works for the signed-in invitee** whose email matches the invite. The accept screen relies on this and explains it when it fails.
- [ ] **Invite expiry:** Better Auth's default is 48 hours. Check whether that's long enough for sending links by hand.
- [ ] **The invite link** `https://earthlingslearning.co.uk/map/?invite=<id>` opens the app, and the `?invite=` part is removed from the address bar after accepting, declining or closing.

## Data API client (`map-app/src/pinsApi.ts`)

- [ ] **`VITE_DATA_API_URL` is the full base URL Neon gives you** (including any path such as `/rest/v1`) with no trailing slash, so `/pins` and `/rpc/pins_in_bbox` can be appended directly.
- [ ] **The PostgREST features the code uses are supported:** `Prefer: return=representation` and `?select=id` on writes.
- [ ] **Requests without an `Authorization` header run as `anonymous`**, so logged-out visitors can load public pins. **Failed on first test** ("missing authentication credentials: required authorization bearer token in JWT format") because the Data API's **Anonymous role** setting (under *Show advanced*) was empty. Set it to `anonymous`, then re-check while signed out.
- [ ] **The Data API sends CORS headers** for `https://earthlingslearning.co.uk` (and `http://localhost:5173` for development). Set these in the Data API's *CORS allowed origins* (under *Show advanced*).
- [ ] **`geom` accepts EWKT text** (`SRID=4326;POINT(lng lat)`) in insert and update bodies.
- [ ] **Error bodies have PostgREST's shape** (`code`, `message`, `hint`), which is what the friendly error messages rely on.
- [ ] **An update or delete the user isn't allowed to make returns an empty list**, not an error. RLS hides the row, and the client turns the empty list into a "no permission" message.

## Map (`map-app/src/map.ts`, `map-app/src/layers.ts`)

- [ ] **The Thunderforest Landscape URL and key parameter are correct**: `https://{s}.tile.thunderforest.com/landscape/{z}/{x}/{y}{r}.png?apikey=…`. Also check whether the key should be restricted to `earthlingslearning.co.uk` in the Thunderforest dashboard.
- [ ] **The OpenStreetMap fallback is acceptable for development only.** OSM's tile policy doesn't allow heavy production use, so set `VITE_THUNDERFOREST_KEY` before going live.
- [ ] **Default view** (centre 50.4, -4.9, zoom 9, showing Cornwall) frames the county the way you want.
- [ ] **Overlay layers are still to do.** Soil parent material/hydrogeology, rivers and MAGIC have empty panes reserved in `layers.ts`; each needs a WMS URL and layer name.

## UI (`map-app/src/components/`)

- [ ] **The 8-character minimum password** in the sign-up form matches Neon Auth's own rule. If Neon's minimum is different, its error message will show instead.
- [ ] **The private-property advice wording** in the add-pin form ([PinForm.tsx](map-app/src/components/PinForm.tsx)) says what you want.
- [ ] **Pin popups size correctly.** React renders popup content into Leaflet's popup after Leaflet has sized it, so [MapView.tsx](map-app/src/components/MapView.tsx) calls `popup.update()` once the content is there. Check that popups aren't narrow or clipped on first open.
- [ ] **An open pin popup stays open** when the map pans to fit it, which triggers a reload. Markers are now kept by pin ID ([map.ts](map-app/src/map.ts)), so a reload shouldn't close it.
- [ ] **`<dialog>` support** covers the browsers your users have. All current browsers support it.

## Database behaviour

- [ ] **Identity column inserts work** for the `authenticated` role, which has no separate sequence grant.
- [ ] **The rate-limit error reaches the client readably** (message "Rate limit reached…", hint `rate_limit`) through the Data API.
- [ ] **Policy checks in `(select …)` run once per query**, not once per row. You can confirm with `EXPLAIN` on a `pins_in_bbox` call: the plan should show an InitPlan.

## Build and deploy

- [ ] **GitHub repository variables** `VITE_DATA_API_URL`, `VITE_AUTH_URL` and `VITE_THUNDERFOREST_KEY` are set (as variables, not secrets).
- [ ] **GitHub secret** `DATABASE_URL` is set for the migrations workflow.
- [ ] **`psql` is available on `ubuntu-latest`** for [db/migrate.sh](db/migrate.sh). It's normally pre-installed.
- [ ] **The FTP upload excludes** `map-app/`, `db/` and the markdown docs, and uploads the built `map/` folder.
- [ ] **The dev server still loads the app with the narrowed allow list** (`server.fs.allow: ['.', '../assets/images']` in [vite.config.ts](map-app/vite.config.ts)). Vite should resolve both entries from `map-app/`. If the page or Leaflet's CSS returns 403 in `npm run dev`, that resolution is the cause.
- [ ] **Node 22 builds cleanly.** Locally you're on Node 20.12, which only gives engine warnings for some of `better-auth`'s dependencies.

## Placeholders to replace

- [ ] **Survey fields:** `title` and `notes` stand in for the real ones.
- [ ] **Rate limit:** 30 pins per user per hour ([004](db/migrations/004_pins_rate_limit.sql)).
- [ ] **Row cap:** `pins_in_bbox` returns at most 500 rows ([005](db/migrations/005_pins_in_bbox.sql)).
- [ ] **Sign-in methods:** email/password only.
