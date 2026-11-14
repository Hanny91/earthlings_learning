# Aerial photos

Organisations upload aerial photos of the places they work, line them up with the map, and see them as a layer under their pins.

The aim is "clearly better than satellite", not every leaf: about 10–20 cm per pixel. A drone photo resized to 4000px across covers roughly 400–800 m at that detail and comes out at 1–3 MB as a JPEG.

## Decisions

- **Storage:** Neon for now. The design keeps a later move to Cloudflare R2 small: photos have their own table, all reads go through one function, and there's an empty `storage_key` column ready.
- **Who can see photos:** only members of the photo's organisation.
- **Who can add, re-align or delete photos:** the organisation's owners and admins (the same people `my_managed_org_ids()` returns).
- **Limit:** 10 photos per organisation.
- **Aerial layer:** off by default. Each viewer's on/off choice is remembered on their own device.

## The `map_images` table

| Field | Type | What it's for |
|---|---|---|
| `id` | bigint | The photo's unique number, used to fetch, re-align or delete it. |
| `organisation_id` | text, required | The organisation it belongs to. The security rules use it to decide who can see and change it. |
| `created_by` | text | Who uploaded it, filled in from the signed-in user as with pins. A record only, not used for permissions. |
| `title` | text | Label in the organisation's photo list, e.g. "Trelissick east meadow". |
| `captured_on` | date, optional | When the photo was taken. Aerial views change a lot with the seasons and over the years, so this tells people how current it is. |
| `data` | bytea | The compressed JPEG. Emptied when the photo moves to R2. |
| `content_type` | text | The file type, `image/jpeg` for now. Sent with downloads so the browser knows it's an image, and carried over to R2. |
| `byte_size` | integer | File size, so the photo list and size check don't need to read the image. A normal column, not calculated from `data`, so it stays right after `data` is emptied. |
| `width`, `height` | integer | Size in pixels. Needed for the alignment maths and to check control points fall inside the photo. |
| `control_points` | jsonb | The pairs of clicks from the alignment screen, each `{px, py, lng, lat}`. The master copy of the alignment, so one point can be fixed later. |
| `corners` | jsonb | The four corners worked out from the control points, as lng/lat in the order top-left, top-right, bottom-right, bottom-left. The map draws the photo from these. Empty until aligned, and unaligned photos aren't shown on the map. |
| `footprint` | geometry (polygon) | The corners as a map shape with a spatial index, so "which photos are in view?" is quick. Set automatically from `corners`, so the two can't disagree. |
| `storage_key` | text, empty for now | The photo's location in R2 once it moves there. |
| `created_at` | timestamptz | When it was uploaded. |
| `updated_at` | timestamptz | When it last changed, e.g. after re-aligning. The photo's bytes never change, so downloads don't depend on it. |

**Rules on the table:**
- Each row has either `data` or a `storage_key`, so a photo is always stored somewhere.
- The file is 4 MB or less, and JPEG only.
- At least 3 control points before `corners` can be set.
- At most 10 photos per organisation.
- Owners and admins only for adding, changing and deleting, in the style of the pin rules in `007` (using `current_user_id()`, `my_org_ids()` and `my_managed_org_ids()`).

## Phase 1: Database and upload test

**Migration `008_map_images.sql`:** the table, rules, indexes, row-level security, grants and three functions:
- `upload_map_image(org_id, title, captured_on, image_base64, width, height)`. Base64 makes the upload about a third bigger, but it's ordinary JSON and avoids custom headers the Data API's CORS settings might block. Uploads are occasional, so the extra size doesn't matter.
- `map_images_in_bbox(min_lng, min_lat, max_lng, max_lat)`. Returns details and corners for the aligned photos in view, without the image data.
- `map_image_base64(id)` (added in `009`). Returns the photo as base64 text and sets `Cache-Control: private`. `008` first tried returning raw bytes through a `"*/*"` type, but Neon's Data API doesn't pass them through intact.

**Test before building anything else.** Upload real compressed photos of about 1, 2 and 4 MB, then download them again. Neon doesn't publish a maximum request size. If larger uploads are rejected, the fallback is splitting uploads into pieces in a `map_image_chunks` table. That's more work for the upload, but the rest of this plan stays the same.

## Phase 2: Compression in the browser (`map-app/src/imageCompress.ts`)

- Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })` so photos come out the right way up.
- Shrink to at most **4000px on the longest side** (also under iPhone canvas limits) and save as **JPEG at quality 0.82**.
- If it's still over 3 MB, try quality 0.7, then reduce to 3200px.
- JPEG, not WebP: Safari quietly saves a PNG when asked for WebP, which would be bigger.
- Redrawing strips EXIF data, including the drone's GPS position, which is good for privacy.
- Show the before and after size ("18.4 MB → 2.1 MB") before uploading.
- **Upload form, brought forward from phase 5:** an "Aerial photos" section on an organisation's page in the Organisations dialog, for owners and admins. It has a file picker, title (started from the file name), optional date taken, the before/after size with a preview, and a list of the organisation's photos with Delete and how many of the 10 are used. Re-align buttons come with phase 4.

## Phase 3: API module (`map-app/src/imagesApi.ts`)

- The only file that touches image storage, as `pinsApi.ts` is for pins. Request and error handling are shared through `dataApi.ts`.
- `getImageUrl(id)` downloads the image with the login token (an `<img src>` can't send one), turns the base64 back into a JPEG and then into a temporary browser link, and keeps it in memory so panning the map doesn't re-download it. Moving to R2 later only changes this function.
- `getImageAlignment(id)` loads a photo's saved control points, width and height, so re-aligning starts from the earlier points.
- `saveAlignment(id, controlPoints, corners)` saves both. If the database refuses because the corners cross over, the user is told the points don't agree and to look for a misplaced one.
- `mapImagesInBbox(bbox)` lists the aligned photos in view, for phase 5.
- Shared types: a control point `{px, py, lng, lat}` and a corner `{lng, lat}`.

## Phase 4: Alignment screen (`AlignPhotoDialog.tsx`, `map-app/src/georef.ts`)

**Decisions:** align against the Landscape map only for now (an aerial imagery toggle can come later if aligning proves hard); the fit is chosen automatically; the maths gets Vitest tests; uploading a photo goes straight to aligning it.

**Getting there**
- Each photo in the organisation's list has **Line up** (not aligned yet) or **Re-align**. Uploading a photo opens the screen straight away; closing it leaves the photo unaligned to do later.
- The screen is full-screen. Closing it returns to the same organisation's page, and asks first if there are unsaved changes.

**Layout**
- Computer and tablet: photo on the left, map on the right, and a strip along the bottom with instructions, the points list, an opacity slider and Save.
- Phone: Photo and Map tabs. After clicking a spot on one, it switches to the other automatically.
- The photo side is a second Leaflet view (`L.CRS.Simple`), so zooming and panning work the same as the map.
- The map side starts where the main map was, or on the photo's current position when re-aligning.

**Clicking pairs**
- Click a spot on either side, then the same spot on the other, in either order. The instruction line says what's next.
- Each pair has a numbered marker, the same number on both sides. The unfinished pair is highlighted. Markers can be dragged.
- The points list shows each pair's number, its error in metres, and a delete button. Under 2 m is fine, 2–5 m amber, over 5 m red, plus an overall average.

**The fit (`georef.ts`, no new libraries)**
- Works in the projection Leaflet draws with (Web Mercator), so what's calculated is what's drawn. Errors are converted to ground metres.
- Affine (move, rotate, scale, skew) by default, right for straight-down shots. From 6 points, perspective is also tried, and used only if it predicts the points at least 20% better than affine. (The original plan switched at 5 points; testing showed a perspective fit with 5 points bends the photo to swallow a 10 m mistake, leaving errors under 1 m.)
- Each point's error is measured against a fit made from the *other* points ("leave one out"), so a mistake shows at its real size instead of being shared out. With exactly 3 points there's nothing spare to check against, so errors only appear from the 4th point and the screen says "Add a 4th point to check the accuracy."
- Limit found in testing: with 4–6 points, a misplaced point reads at its real size, but a neighbour can read as high too, so the screen asks for more points to pinpoint it rather than promising the worst one is the culprit.
- Least squares, with coordinates centred and scaled first so rounding doesn't creep in. Tested with Vitest (`georef.test.ts`).

**Preview**
- From 3 pairs, the photo appears on the map side, bent onto its fitted corners, updating live as points are added or dragged. Opacity slider, default 60%.
- This uses the four-corner photo layer (`AerialImageLayer.ts`), brought forward from phase 5.

**Saving**
- Needs at least 3 complete pairs; a half-finished pair is ignored, with a note.
- Saves the points and corners, shows "Photo lined up." and returns to the organisation's page.

## Phase 5: Showing photos on the map

- `AerialImageLayer.ts` already exists from phase 4: it places the `<img>` by its four corners with a CSS `matrix3d` transform, recalculated on zoom.
- A new **`aerial` pane at z 220**, between the base map (200) and the geology layer (250), so pins and data layers stay on top. It's in the layer list in `layers.ts`.
- An **"Aerial photos" switch** under the Pins filter, with an opacity slider (default 80%). It's off by default, and both settings are remembered per device. It only appears for signed-in users who are in at least one organisation, since nobody else can see any photos.
- **Loading** happens with the pins, through `mapImagesInBbox`, for the photos in view. Photos already drawn stay put when panning, and each photo is downloaded once per visit.
- **Only from zoom 14** (park scale). Photos are a few MB each, so zoomed further out the switch says "Zoom in to see photos" instead of downloading every photo in the county.
- **Re-aligning or deleting** a photo redraws the map straight away.

## Things to tell users

- From above you see the treetop, not the trunk, and on a tall or leaning tree the trunk can be a few metres from the centre of the canopy. Say whether a pin should mark the trunk or the canopy.
- Spread control points across the whole photo, not bunched in the middle.

## Add to `assumptions.md` as we go

- Neon's maximum request size for uploads.
- ~~`"*/*"` binary downloads work on Neon's Data API.~~ They don't; downloads use base64 instead (`009`).
- ~~Neon's Data API honours the `Cache-Control` header.~~ Confirmed.
- `NOTIFY pgrst, 'reload schema'` is needed after the migration.
- Safari's `canvas.toBlob('image/jpeg')` produces a JPEG at the requested quality.
- The 10-per-organisation limit is enforced even when two uploads happen at once.

## Later: moving to R2

1. Set up an R2 bucket and a small server function (or Cloudflare Worker) that creates short-lived upload links.
2. A one-off script copies each photo's `data` to R2, fills in `storage_key` and empties `data`.
3. `getImageUrl()` returns an R2 link for rows with a `storage_key`.
4. Uploads go straight to R2. Nothing else changes.
