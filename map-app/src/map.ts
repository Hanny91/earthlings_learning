// The shared survey map: base layer, overlay panes, pins loaded for the
// current view with a single pins_in_bbox call, and (for organisation members
// who switch them on) aerial photos loaded the same way. What the viewer can
// see is decided by RLS; this module only draws what comes back.

import L from 'leaflet';
import { AerialImageLayer } from './AerialImageLayer';
import { getImageUrl, mapImagesInBbox } from './imagesApi';
import { createBaseLayer, createOverlayPanes } from './layers';
import { pinsInBbox, type Bbox, type Pin } from './pinsApi';

const INDIVIDUAL_KEY = 'individual';
const INDIVIDUAL_LABEL = 'Individual';
const INDIVIDUAL_COLOUR = '#7b6649';
const ORG_COLOURS = ['#2e7d6b', '#b5562f', '#3f6fb5', '#8e4f9e', '#c79a1e', '#4f8a2e', '#b23a5a', '#2f8fb0'];

const LOAD_DELAY_MS = 300;

// Photos are a few MB each, so they only load once zoomed in to park scale.
const AERIAL_MIN_ZOOM = 14;
const AERIAL_DEFAULT_OPACITY = 0.8;
// Remembered per device; see readSetting.
const AERIAL_VISIBLE_KEY = 'survey-map:aerial-visible';
const AERIAL_OPACITY_KEY = 'survey-map:aerial-opacity';

export interface SurveyMapOptions {
  /** Called when the map background is clicked, e.g. to start adding a pin. */
  onMapClick?: (latlng: L.LatLng) => void;
  /** Called when loading pins fails. */
  onLoadError?: (error: Error) => void;
  /** Called when loading aerial photos fails. */
  onAerialLoadError?: (error: Error) => void;
}

interface FilterEntry {
  key: string;
  label: string;
  colour: string;
  visible: boolean;
}

export class SurveyMap {
  readonly map: L.Map;
  private readonly pinLayer = L.layerGroup();
  private readonly filter: PinFilterControl;
  private pins: Pin[] = [];
  private pinsById = new Map<number, Pin>();
  private readonly markers = new Map<number, L.CircleMarker>();
  private readonly popupPinIds = new WeakMap<L.Popup, number>();
  // Every organisation seen so far, so filter entries don't vanish as the view moves.
  private readonly orgNames = new Map<string, string>();
  private readonly hidden = new Set<string>();
  private loadTimer: number | undefined;
  private inFlight: AbortController | undefined;

  // Aerial photos show when the viewer has switched them on and is in an organisation.
  private readonly aerialControl: AerialPhotosControl;
  private aerialAvailable = false;
  private aerialSwitchedOn = readSetting(AERIAL_VISIBLE_KEY) === 'true';
  private aerialOpacity = readOpacity();
  private readonly aerialLayers = new Map<number, { layer: AerialImageLayer; updatedAt: string }>();
  private aerialInFlight: AbortController | undefined;

  constructor(container: HTMLElement, private readonly options: SurveyMapOptions = {}) {
    // Opens on Cornwall.
    this.map = L.map(container, { center: [50.4, -4.9], zoom: 9 });
    createOverlayPanes(this.map);
    createBaseLayer().addTo(this.map);
    this.pinLayer.addTo(this.map);

    this.filter = new PinFilterControl((key, visible) => {
      if (visible) this.hidden.delete(key);
      else this.hidden.add(key);
      this.render();
    });
    this.filter.addTo(this.map);

    // Added to the map by setAerialAvailable, once the viewer is known to be in an organisation.
    this.aerialControl = new AerialPhotosControl(this.aerialSwitchedOn, this.aerialOpacity, (on, opacity) => {
      if (on !== this.aerialSwitchedOn) {
        this.aerialSwitchedOn = on;
        writeSetting(AERIAL_VISIBLE_KEY, String(on));
        void this.loadAerial();
      }
      this.aerialOpacity = opacity;
      writeSetting(AERIAL_OPACITY_KEY, String(opacity));
      for (const { layer } of this.aerialLayers.values()) layer.setOpacity(opacity);
    });
    const updateZoomHint = () => this.aerialControl.setZoomedIn(this.map.getZoom() >= AERIAL_MIN_ZOOM);
    this.map.on('zoomend', updateZoomHint);
    updateZoomHint();

    this.map.on('moveend', () => this.scheduleLoad());
    this.map.on('click', (event: L.LeafletMouseEvent) => this.options.onMapClick?.(event.latlng));

    void this.reload();
  }

  /** Reloads pins and aerial photos for the current view now, e.g. after adding a pin or signing in. */
  async reload(): Promise<void> {
    window.clearTimeout(this.loadTimer);
    void this.loadAerial();
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    try {
      this.pins = await pinsInBbox(this.viewBbox(), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.options.onLoadError?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    for (const pin of this.pins) {
      if (pin.organisationId) {
        this.orgNames.set(pin.organisationId, pin.organisationName ?? 'Unnamed organisation');
      }
    }
    this.render();
  }

  /**
   * Whether the viewer may see aerial photos: signed in and in at least one
   * organisation. Shows or hides the switch, and loads or clears the photos.
   */
  setAerialAvailable(available: boolean): void {
    if (available === this.aerialAvailable) return;
    this.aerialAvailable = available;
    if (available) this.aerialControl.addTo(this.map);
    else this.aerialControl.remove();
    void this.loadAerial();
  }

  private viewBbox(): Bbox {
    const bounds = this.map.getBounds();
    return {
      minLng: Math.max(bounds.getWest(), -180),
      minLat: Math.max(bounds.getSouth(), -90),
      maxLng: Math.min(bounds.getEast(), 180),
      maxLat: Math.min(bounds.getNorth(), 90),
    };
  }

  // Photos already on the map stay put; only new ones are downloaded, and
  // getImageUrl keeps each photo's bytes for the rest of the visit.
  private async loadAerial(): Promise<void> {
    this.aerialInFlight?.abort();
    if (!this.aerialAvailable || !this.aerialSwitchedOn || this.map.getZoom() < AERIAL_MIN_ZOOM) {
      this.clearAerial();
      return;
    }
    const controller = new AbortController();
    this.aerialInFlight = controller;

    let photos;
    try {
      photos = await mapImagesInBbox(this.viewBbox(), controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.options.onAerialLoadError?.(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const inView = new Set(photos.map((photo) => photo.id));
    for (const [id, { layer }] of this.aerialLayers) {
      if (!inView.has(id)) {
        layer.remove();
        this.aerialLayers.delete(id);
      }
    }

    for (const photo of photos) {
      const existing = this.aerialLayers.get(photo.id);
      if (existing) {
        // Re-aligned since it was drawn.
        if (existing.updatedAt !== photo.updatedAt) {
          existing.layer.setCorners(photo.corners);
          existing.updatedAt = photo.updatedAt;
        }
        continue;
      }
      const layer = new AerialImageLayer('', photo.corners, photo.width, photo.height, {
        pane: 'aerial',
        opacity: this.aerialOpacity,
      });
      this.aerialLayers.set(photo.id, { layer, updatedAt: photo.updatedAt });
      getImageUrl(photo.id).then(
        (url) => {
          // Skip it if it was cleared or replaced while downloading.
          if (this.aerialLayers.get(photo.id)?.layer === layer) layer.setUrl(url).addTo(this.map);
        },
        (error: unknown) => {
          if (this.aerialLayers.get(photo.id)?.layer === layer) this.aerialLayers.delete(photo.id);
          this.options.onAerialLoadError?.(error instanceof Error ? error : new Error(String(error)));
        },
      );
    }
  }

  private clearAerial(): void {
    for (const { layer } of this.aerialLayers.values()) layer.remove();
    this.aerialLayers.clear();
  }

  private scheduleLoad(): void {
    window.clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(() => void this.reload(), LOAD_DELAY_MS);
  }

  /**
   * The pin a popup belongs to, with its latest data, or undefined for other
   * popups. Its content element (popup.getContent()) is where to render it.
   */
  pinForPopup(popup: L.Popup): Pin | undefined {
    const id = this.popupPinIds.get(popup);
    return id === undefined ? undefined : this.pinsById.get(id);
  }

  /** Stops loading and removes the map, e.g. when its React component unmounts. */
  destroy(): void {
    window.clearTimeout(this.loadTimer);
    this.inFlight?.abort();
    this.aerialInFlight?.abort();
    this.map.remove();
  }

  // Markers are kept by pin ID and only added or removed when the set changes,
  // so an open popup survives reloads (e.g. the reload after a popup pans the map).
  private render(): void {
    const visible = new Map<number, Pin>();
    for (const pin of this.pins) {
      if (!this.hidden.has(pin.organisationId ?? INDIVIDUAL_KEY)) visible.set(pin.id, pin);
    }

    for (const [id, marker] of this.markers) {
      if (!visible.has(id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }

    for (const pin of visible.values()) {
      const style = markerStyle(pin);
      const existing = this.markers.get(pin.id);
      if (existing) {
        existing.setLatLng([pin.lat, pin.lng]).setStyle(style);
        continue;
      }
      const marker = L.circleMarker([pin.lat, pin.lng], {
        ...style,
        radius: 7,
        // Stop pin clicks also counting as map clicks (which start adding a pin).
        bubblingMouseEvents: false,
      });
      // Each pin's popup holds one fixed, empty element for the UI to render into
      // (see pinForPopup). Not a builder function: Leaflet re-runs those on
      // popup.update(), swapping in a new element.
      marker.bindPopup(document.createElement('div'));
      this.popupPinIds.set(marker.getPopup()!, pin.id);
      marker.addTo(this.pinLayer);
      this.markers.set(pin.id, marker);
    }

    this.pinsById = new Map(this.pins.map((pin) => [pin.id, pin]));
    this.filter.update(this.filterEntries());
  }

  private filterEntries(): FilterEntry[] {
    const orgs = [...this.orgNames]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([id, name]) => ({ key: id, label: name, colour: colourFor(id) }));
    return [{ key: INDIVIDUAL_KEY, label: INDIVIDUAL_LABEL, colour: INDIVIDUAL_COLOUR }, ...orgs].map(
      (entry) => ({ ...entry, visible: !this.hidden.has(entry.key) }),
    );
  }
}

function markerStyle(pin: Pin): L.PathOptions {
  return {
    color: '#ffffff',
    weight: 2,
    fillColor: colourFor(pin.organisationId),
    fillOpacity: 0.9,
    // Dashed outline marks pins only the organisation's members can see.
    dashArray: pin.visibility === 'org_only' ? '3 2' : undefined,
  };
}

/** Same organisation, same colour, on every load and for every viewer. */
function colourFor(organisationId: string | null): string {
  if (!organisationId) return INDIVIDUAL_COLOUR;
  let hash = 0;
  for (const char of organisationId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ORG_COLOURS[Math.abs(hash) % ORG_COLOURS.length];
}

/** Checkbox list for showing or hiding pins by organisation. */
class PinFilterControl extends L.Control {
  private readonly list = L.DomUtil.create('div', 'pin-filter__list');

  constructor(private readonly onToggle: (key: string, visible: boolean) => void) {
    super({ position: 'topright' });
  }

  onAdd(): HTMLElement {
    const container = L.DomUtil.create('div', 'leaflet-bar pin-filter');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    const title = L.DomUtil.create('div', 'pin-filter__title', container);
    title.textContent = 'Pins';
    container.appendChild(this.list);
    return container;
  }

  update(entries: FilterEntry[]): void {
    this.list.replaceChildren(
      ...entries.map((entry) => {
        const label = document.createElement('label');
        label.className = 'pin-filter__item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = entry.visible;
        checkbox.addEventListener('change', () => this.onToggle(entry.key, checkbox.checked));

        const swatch = document.createElement('span');
        swatch.className = 'pin-filter__swatch';
        swatch.style.backgroundColor = entry.colour;

        label.append(checkbox, swatch, entry.label);
        return label;
      }),
    );
  }
}

/** On/off switch and opacity slider for aerial photos, with a hint when zoomed out too far. */
class AerialPhotosControl extends L.Control {
  private readonly checkbox = document.createElement('input');
  private readonly slider = document.createElement('input');
  private readonly hint = L.DomUtil.create('div', 'aerial-control__hint');
  private zoomedIn = false;

  constructor(
    on: boolean,
    opacity: number,
    private readonly onChange: (on: boolean, opacity: number) => void,
  ) {
    super({ position: 'topright' });
    this.checkbox.type = 'checkbox';
    this.checkbox.checked = on;
    this.slider.type = 'range';
    this.slider.min = '10';
    this.slider.max = '100';
    this.slider.value = String(Math.round(opacity * 100));
    this.slider.className = 'aerial-control__opacity';
    this.slider.setAttribute('aria-label', 'Aerial photo opacity');
    this.hint.textContent = 'Zoom in to see photos';
    const changed = () => {
      this.refresh();
      this.onChange(this.checkbox.checked, Number(this.slider.value) / 100);
    };
    this.checkbox.addEventListener('change', changed);
    this.slider.addEventListener('input', changed);
  }

  onAdd(): HTMLElement {
    const container = L.DomUtil.create('div', 'leaflet-bar pin-filter aerial-control');
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    const label = L.DomUtil.create('label', 'pin-filter__item', container);
    label.append(this.checkbox, 'Aerial photos');
    container.append(this.slider, this.hint);
    this.refresh();
    return container;
  }

  setZoomedIn(zoomedIn: boolean): void {
    this.zoomedIn = zoomedIn;
    this.refresh();
  }

  private refresh(): void {
    this.slider.hidden = !this.checkbox.checked;
    this.hint.hidden = !this.checkbox.checked || this.zoomedIn;
  }
}

/** The remembered opacity, or the default if there isn't a sensible one. */
function readOpacity(): number {
  const saved = Number(readSetting(AERIAL_OPACITY_KEY));
  return saved >= 0.1 && saved <= 1 ? saved : AERIAL_DEFAULT_OPACITY;
}

/** localStorage can be unavailable (private browsing, blocked storage); the map then just uses defaults. */
function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
