# Survey Map

The shared survey map served at [earthlingslearning.co.uk/map/](https://earthlingslearning.co.uk/map/). Anyone can view public pins; signed-in users add pins, either on their own or for an organisation they belong to.

- **Design and decisions:** [project.md](../project.md)
- **Things to check once Neon is running:** [assumptions.md](../assumptions.md)

---

## How it fits together

| Part | Where | Notes |
|---|---|---|
| Frontend | `map-app/` | Vite + TypeScript + React, with Leaflet for the map. Builds into `../map/`. |
| Database | Neon Postgres + PostGIS | Schema and security rules in `db/migrations/`. |
| Auth | Neon Auth with the organization plugin | Wrapped by `src/auth.ts`. |
| Data access | Neon Data API | Wrapped by `src/pinsApi.ts`. Row-level security in Postgres decides who sees and changes what. |

The client never decides access. `auth.ts` and `pinsApi.ts` are the only files that talk to Neon, so a change to Neon's SDK or API stays in those two files.

```
map-app/
  src/
    auth.ts          Neon Auth: session, sign-in, organisations, invites
    pinsApi.ts       Data API: pins_in_bbox, create/update/delete pin
    map.ts           Leaflet map, pin loading and organisation filter
    layers.ts        Base map and reserved overlay panes
    config.ts        The VITE_ values shipped to the browser
    hooks/           useAuth, useOrganisations
    components/      React UI (App, MapView, dialogs, header)
db/
  migrations/        Numbered .sql files, applied in order
  migrate.sh         Applies pending migrations
```

---

## Running locally

Needs Node 20 or newer (CI uses Node 22).

```bash
cd map-app
npm install
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:5173/map/`.

Fill in `.env.local`:

| Variable | What it is |
|---|---|
| `VITE_DATA_API_URL` | The Data API's base URL from the Neon console, with no trailing slash. |
| `VITE_AUTH_URL` | The Neon Auth URL from the Neon console. |
| `VITE_THUNDERFOREST_KEY` | Thunderforest API key. Leave empty to use OpenStreetMap tiles while developing. |

All three are public: they end up in the browser bundle. **Never put `DATABASE_URL` in `.env.local`**, or in any `VITE_` variable.

Without the Neon values, the map and header load, but pins, sign-in and organisations won't work.

### Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server with hot reload. |
| `npm run build` | Type-checks, then builds into `../map/`. |
| `npm run preview` | Serves the built `../map/` locally. |

---

## Neon setup (first time)

The order matters, because the migrations depend on the first two steps.

1. **Turn on the Data API** for the database. It provides `auth.user_id()` and the `anonymous` / `authenticated` roles.
2. **Turn on Neon Auth with the organization plugin.** Migration `002` reads its `neon_auth` tables.
3. **Make the Data API trust Neon Auth tokens.**
4. **Add `https://earthlingslearning.co.uk`** to Neon Auth's trusted domains, and `http://localhost:5173` while developing.
5. **Run the migrations** (see below).
6. **Work through [assumptions.md](../assumptions.md).**

---

## Database migrations

Migrations are plain SQL files in `db/migrations/`, named `NNN_description.sql`, for example `006_survey_fields.sql`. They run in filename order. `db/migrate.sh` records each applied file in `app_private.schema_migrations` and skips files it has already run. Each file runs in its own transaction, so one that fails leaves nothing behind.

**To add a migration:** create the next numbered file. Don't edit a file that has already been applied; write a new one that changes it.

**Running them:**

- **From GitHub:** the *Apply database migrations* workflow runs on pushes to `master` that change `db/`. You can also start it by hand from the Actions tab (*Run workflow*), for example on the `maps` branch.
- **Locally**, with `psql` installed:

  ```bash
  DATABASE_URL='postgres://…' bash db/migrate.sh
  ```

---

## Deploying

Pushing to `master` runs *Deploy to GoDaddy*. It builds the map into `map/`, then uploads the site by FTP. `map-app/`, `db/` and the markdown docs are left out of the upload.

**GitHub settings** (Settings → Secrets and variables → Actions):

| Name | Type | Used by |
|---|---|---|
| `VITE_DATA_API_URL` | Variable | Deploy (build) |
| `VITE_AUTH_URL` | Variable | Deploy (build) |
| `VITE_THUNDERFOREST_KEY` | Variable | Deploy (build) |
| `DATABASE_URL` | Secret | Migrations |
| `FTP_HOST`, `FTP_USERNAME`, `FTP_PASSWORD` | Secrets | Deploy (upload) |

---

## Organisations and invites

Roles are `owner`, `admin` and `member`. Owners and admins can change any of an organisation's pins and manage its members. Members can add pins for the organisation and see its members-only pins.

During testing:

1. Organisations are created by hand outside the app. There's no create form yet.
2. The owner opens **Organisations** in the app and invites the first admin by email. This creates a link like `https://earthlingslearning.co.uk/map/?invite=<id>`.
3. The owner copies the link and sends it themselves. Neon Auth may also email the invite; the app doesn't accept Neon's own invite links yet.
4. The invitee opens the link and signs in or creates an account **with the invited email address**, then joins.
5. That admin can invite everyone else the same way.

---

## Not built yet

- Overlay layers: soil parent material/hydrogeology, rivers and Defra/MAGIC. Panes are reserved in `src/layers.ts`.
- The "Map" link in the site's nav. It's waiting for the nav bar update on `master`.
- Real survey fields. `title` and `notes` are placeholders.
- Creating organisations in the app, emailed invites (SMTP), moderation, and backups.
