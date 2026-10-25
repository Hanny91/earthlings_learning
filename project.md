# Shared Survey Map

A shared, map-based survey tool added as a tab on [earthlingslearning.co.uk](https://earthlingslearning.co.uk). Anyone can view public survey pins; signed-in users can add pins, either publicly or within an organisation they belong to.

The app lives at the `/map/` subpath of the main site (not a subdomain). The site is hosted on GoDaddy and deployed by a GitHub workflow on push to main.

---

## Stack

| Concern | Choice |
|---|---|
| Database | Neon (free tier) Postgres |
| Geometry | PostGIS |
| Auth | Neon Auth, with the organization plugin |
| Data access | Neon Data API, all calls routed through a single `pinsApi` module |
| Authorisation | Postgres row-level security (RLS), keyed on the signed-in user's ID from the auth token (`auth.user_id()`) |
| Frontend | Vite + TypeScript + React, with Leaflet for the map, built into `/map/` |
| Email | SMTP provider — later, once the app is running |

### Configuration

- Add `https://earthlingslearning.co.uk` to Neon Auth's trusted domains.
- Only three values are exposed to the client as `VITE_` variables, all public by nature:
  - `VITE_DATA_API_URL`
  - `VITE_AUTH_URL`
  - `VITE_THUNDERFOREST_KEY` (appears in every tile request; the map falls back to OpenStreetMap tiles when it is unset)
- `DATABASE_URL` is never shipped to the client. It is stored as a GitHub secret and used only by the migrations workflow.

---

## Auth

- Sign-in via Neon Auth.
- Organisations and memberships are managed by the Neon Auth organization plugin.
- Sign-in is required to add pins, not to view the map.
- Email verification is on, so accounts are tied to real email addresses (which invites depend on). Neon Auth emails a verification code, which the user enters in the app.

> Sign in only via email and password

**Organisations and invites (for the test run):** organisations are created by hand outside the app, and there is no "create organisation" form yet. The owner invites each organisation's first admin from the app's Organisations panel, and that admin invites everyone else. Invites are sent by hand: creating one gives a link (`/map/?invite=<id>`) that the inviter copies and sends themselves (e.g. WhatsApp or their own email). The invitee opens it, signs in or creates an account with the invited email address, and joins. Neon Auth can also email invites; once we've seen where its email link points, the app can accept that format too, with copy-link kept as a backup.

---

## Data model

### Users
- `username`, `email` (managed by Neon Auth), `organisations`.

### Organisations and memberships
- Provided by the organization plugin.
- A user can belong to many organisations.
- Membership role is one of `owner`, `admin`, `member` (the organization plugin's built-in roles). Admins can edit any of the organisation's pins and manage its members.

### Pins

| Field | Notes |
|---|---|
| `id` | Primary key |
| `created_by` | Required. Defaults to `auth.user_id()` |
| `organisation_id` | Optional. Null means an "individual" pin |
| `visibility` | `public` or `org_only` |
| `geom` | PostGIS point (SRID 4326). Points only for now — no polygons yet |
| survey fields | To be defined |
| `created_at` / `updated_at` | Timestamps |

**Constraints**
- `org_only` pins must have an `organisation_id`.
- Length limits on all text fields.
- Per-user rate check on inserts.

### Functions
- `pins_in_bbox(...)` — returns pins inside a bounding box.
  - `SECURITY INVOKER`, so RLS applies to the caller.
  - Caps the number of rows returned.

### Policies
- Membership lookups for organisations are handled by policies (or helper functions) so pin policies can ask "is the current user a member / owner / admin of this organisation?"

---

## Access rules

- **Read:** anyone, including logged-out visitors, sees public pins. Members of an organisation also see its `org_only` pins.
- **Add:** any signed-in user can add a public pin anywhere. Only members can add pins to an organisation.
- **Edit and delete:** the creator can change their own pins. An organisation's owners and admins can change any of its pins.
- **Moderation:** deferred.

These are enforced in RLS, not in the client. The client should never be the thing that decides who sees what.

---

## Map

- One shared base map.
- Pins load with a single bounding-box query (`pins_in_bbox`). RLS silently filters out anything the viewer isn't allowed to see.
- Pins can be filtered or coloured by organisation, with "Individual" covering pins that have no organisation.

### Layer order (bottom to top)

1. Thunderforest Landscape base map
2. Soil parent material and hydrogeology (regional, faded)
3. Rivers
4. Defra / MAGIC layers, as needed
5. Pins

---

## UX

- The add-pin form shows guidance about not recording private property without permission. This is advisory only, with no enforcement.
- Map is viewable without signing in; adding a pin prompts sign-in.

---

## Build and deploy

- Vite `base` set to `/map/`; build output goes into the site's `/map/` directory.
- If client-side routes are used, add an `.htaccess` fallback in `/map/` that routes unknown paths to `/map/index.html`.
- Deploys with the existing site's GitHub workflow on push.

### Migrations

- SQL migrations are kept in the repo.
- Applied by a GitHub workflow using `DATABASE_URL` from GitHub secrets.

---

## Backups

- Periodic `pg_dump` of the Neon database to preserve data.

> **TODO:** decide where dumps are stored and how often they run.

---

## Out of scope for now

- Moderation
- Polygons / non-point geometry
- SMTP / transactional email (added once running)

## Open questions

- Which survey fields does a pin carry?
- Auth methods and organisation invite flow.
- Rate-limit thresholds (pins per user per hour/day).
- Row cap for `pins_in_bbox`.
- Which MAGIC layers to include first.
- Backup schedule and storage location.
