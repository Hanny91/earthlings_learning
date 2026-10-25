// The shared survey map: base layer, overlay panes, and pins loaded for the
// current view with a single pins_in_bbox call. What the viewer can see is
// decided by RLS; this module only draws what comes back.

import L from 'leaflet';
import { createBaseLayer, createOverlayPanes } from './layers';
import { pinsInBbox, type Pin } from './pinsApi';

const INDIVIDUAL_KEY = 'individual';
const INDIVIDUAL_LABEL = 'Individual';
const INDIVIDUAL_COLOUR = '#7b6649';
const ORG_COLOURS = ['#2e7d6b', '#b5562f', '#3f6fb5', '#8e4f9e', '#c79a1e', '#4f8a2e', '#b23a5a', '#2f8fb0'];

const LOAD_DELAY_MS = 300;

export interface SurveyMapOptions {
  /** Called when the map background is clicked, e.g. to start adding a pin. */
  onMapClick?: (latlng: L.LatLng) => void;
  /** Builds the popup shown when a pin is clicked. */
  renderPopup?: (pin: Pin) => HTMLElement | string;
  /** Called when loading pins fails. */
  onLoadError?: (error: Error) => void;
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
  // Every organisation seen so far, so filter entries don't vanish as the view moves.
  private readonly orgNames = new Map<string, string>();
  private readonly hidden = new Set<string>();
  private loadTimer: number | undefined;
  private inFlight: AbortController | undefined;

  constructor(container: HTMLElement, private readonly options: SurveyMapOptions = {}) {
    this.map = L.map(container, { center: [54.5, -3], zoom: 6 });
    createOverlayPanes(this.map);
    createBaseLayer().addTo(this.map);
    this.pinLayer.addTo(this.map);

    this.filter = new PinFilterControl((key, visible) => {
      if (visible) this.hidden.delete(key);
      else this.hidden.add(key);
      this.render();
    });
    this.filter.addTo(this.map);

    this.map.on('moveend', () => this.scheduleLoad());
    this.map.on('click', (event: L.LeafletMouseEvent) => this.options.onMapClick?.(event.latlng));

    void this.reload();
  }

  /** Reloads pins for the current view now, e.g. after adding a pin or signing in. */
  async reload(): Promise<void> {
    window.clearTimeout(this.loadTimer);
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    const bounds = this.map.getBounds();
    try {
      this.pins = await pinsInBbox(
        {
          minLng: Math.max(bounds.getWest(), -180),
          minLat: Math.max(bounds.getSouth(), -90),
          maxLng: Math.min(bounds.getEast(), 180),
          maxLat: Math.min(bounds.getNorth(), 90),
        },
        controller.signal,
      );
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

  private scheduleLoad(): void {
    window.clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(() => void this.reload(), LOAD_DELAY_MS);
  }

  /** Stops loading and removes the map, e.g. when its React component unmounts. */
  destroy(): void {
    window.clearTimeout(this.loadTimer);
    this.inFlight?.abort();
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
      const renderPopup = this.options.renderPopup;
      // Looks the pin up on open, so the popup shows its latest data.
      if (renderPopup) marker.bindPopup(() => renderPopup(this.pinsById.get(pin.id) ?? pin));
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
