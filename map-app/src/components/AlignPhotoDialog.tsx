// The alignment screen (see photos.md, phase 4): click a spot on the photo and
// the same spot on the map, a few times over, and the photo is fitted onto the
// map from those pairs. Leaflet runs both views; React holds the list of pairs
// and redraws the markers and preview from it.

import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AerialImageLayer } from '../AerialImageLayer';
import { errorMessage } from '../errors';
import { fitPhoto, MIN_POINTS } from '../georef';
import {
  getImageAlignment,
  getImageUrl,
  saveAlignment,
  type ControlPoint,
  type ImageAlignment,
  type LngLat,
} from '../imagesApi';
import { createBaseLayer } from '../layers';
import { Dialog } from './Dialog';

/** Where the main map was, so lining up a new photo starts in the right place. */
export interface MapViewState {
  lat: number;
  lng: number;
  zoom: number;
}

interface PhotoPoint {
  px: number;
  py: number;
}

/** One numbered pair. While being placed it has only one side. */
interface Pair {
  id: number;
  photo?: PhotoPoint;
  map?: LngLat;
}

type Side = 'photo' | 'map';

// Same as the main map's opening view (map.ts).
const DEFAULT_VIEW: MapViewState = { lat: 50.4, lng: -4.9, zoom: 9 };
const PHONE_QUERY = '(max-width: 767px)';
/** Error colours, in ground metres. */
const WARN_METRES = 2;
const BAD_METRES = 5;

interface AlignPhotoDialogProps {
  imageId: number;
  title: string;
  startView: MapViewState | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AlignPhotoDialog({ imageId, title, startView, onClose, onSaved }: AlignPhotoDialogProps) {
  const [loaded, setLoaded] = useState<{ alignment: ImageAlignment; url: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const dirty = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getImageAlignment(imageId), getImageUrl(imageId)])
      .then(([alignment, url]) => {
        if (!cancelled) setLoaded({ alignment, url });
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  return (
    <Dialog
      title={`Line up “${title}”`}
      fullScreen
      onClose={onClose}
      confirmClose={() => !dirty.current || window.confirm('Leave without saving your points?')}
    >
      {loadError && <p className="form-error" role="alert">{loadError}</p>}
      {!loaded && !loadError && <p>Loading photo…</p>}
      {loaded && (
        <AlignWorkspace
          imageId={imageId}
          alignment={loaded.alignment}
          url={loaded.url}
          startView={startView}
          onChange={() => {
            dirty.current = true;
          }}
          onSaved={() => {
            dirty.current = false;
            onSaved();
          }}
        />
      )}
    </Dialog>
  );
}

interface AlignWorkspaceProps {
  imageId: number;
  alignment: ImageAlignment;
  url: string;
  startView: MapViewState | null;
  onChange: () => void;
  onSaved: () => void;
}

function AlignWorkspace({ imageId, alignment, url, startView, onChange, onSaved }: AlignWorkspaceProps) {
  const { width, height } = alignment;
  const [pairs, setPairs] = useState<Pair[]>(() =>
    alignment.controlPoints.map((p, i) => ({ id: i + 1, photo: { px: p.px, py: p.py }, map: { lng: p.lng, lat: p.lat } })),
  );
  const nextId = useRef(alignment.controlPoints.length + 1);
  const [tab, setTab] = useState<Side>('photo');
  const [opacity, setOpacity] = useState(0.6);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const photoElement = useRef<HTMLDivElement>(null);
  const mapElement = useRef<HTMLDivElement>(null);
  const photoMap = useRef<L.Map | null>(null);
  const map = useRef<L.Map | null>(null);
  const photoMarkers = useRef(L.layerGroup());
  const mapMarkers = useRef(L.layerGroup());
  const preview = useRef<AerialImageLayer | null>(null);

  const { complete, controlPoints, fit } = useMemo(() => {
    const complete = pairs.filter((pair): pair is Required<Pair> => Boolean(pair.photo && pair.map));
    const controlPoints: ControlPoint[] = complete.map((pair) => ({ ...pair.photo, ...pair.map }));
    return { complete, controlPoints, fit: fitPhoto(controlPoints, width, height) };
  }, [pairs, width, height]);
  const errorsById = new Map<number, number>();
  complete.forEach((pair, i) => {
    if (fit?.errors) errorsById.set(pair.id, fit.errors[i]);
  });
  const pending = pairs.find((pair) => !(pair.photo && pair.map));

  function updatePairs(next: Pair[]) {
    setPairs(next);
    onChange();
  }

  // Clicking fills the unfinished pair's missing side (or moves its point on
  // this side, if that was clicked again), otherwise starts a new pair.
  function placePoint(side: Side, point: PhotoPoint | LngLat) {
    const last = pairs[pairs.length - 1];
    if (last && !(last.photo && last.map)) {
      updatePairs([...pairs.slice(0, -1), { ...last, [side]: point }]);
    } else {
      updatePairs([...pairs, { id: nextId.current++, [side]: point }]);
    }
    // On a phone only one side shows at a time, so move to the other one.
    if (window.matchMedia(PHONE_QUERY).matches) setTab(side === 'photo' ? 'map' : 'photo');
  }

  function movePoint(id: number, side: Side, point: PhotoPoint | LngLat) {
    updatePairs(pairs.map((pair) => (pair.id === id ? { ...pair, [side]: point } : pair)));
  }

  function deletePair(id: number) {
    updatePairs(pairs.filter((pair) => pair.id !== id));
  }

  // Leaflet is set up once and calls back through this ref to reach the latest state.
  const handlers = useRef({ placePoint, movePoint });
  handlers.current = { placePoint, movePoint };

  useEffect(() => {
    const bounds = L.latLngBounds([-height, 0], [0, width]);
    // The photo view uses plain pixel coordinates: lng = x, lat = -y (Leaflet's y points up).
    const photo = L.map(photoElement.current!, {
      crs: L.CRS.Simple,
      minZoom: -8,
      maxZoom: 4,
      zoomSnap: 0.25,
      attributionControl: false,
    });
    L.imageOverlay(url, bounds).addTo(photo);
    photo.setMaxBounds(bounds.pad(0.5));
    photo.on('click', (event: L.LeafletMouseEvent) => {
      const px = event.latlng.lng;
      const py = -event.latlng.lat;
      if (px < 0 || py < 0 || px > width || py > height) return;
      handlers.current.placePoint('photo', { px, py });
    });
    photoMarkers.current.addTo(photo);

    const ground = L.map(mapElement.current!, { maxZoom: 22 });
    createBaseLayer().addTo(ground);
    ground.on('click', (event: L.LeafletMouseEvent) =>
      handlers.current.placePoint('map', { lng: event.latlng.lng, lat: event.latlng.lat }),
    );
    mapMarkers.current.addTo(ground);

    photoMap.current = photo;
    map.current = ground;

    // A view hidden behind a tab has no size yet, so each one is fitted the first
    // time it has room, and resized whenever its pane changes size.
    const fitPhotoView = () => photo.fitBounds(bounds);
    const fitMapView = () => {
      if (alignment.corners) ground.fitBounds(L.latLngBounds(alignment.corners.map((c) => [c.lat, c.lng])));
      else {
        const view = startView ?? DEFAULT_VIEW;
        ground.setView([view.lat, view.lng], view.zoom);
      }
    };
    const stopPhoto = fitWhenSized(photo, photoElement.current!, fitPhotoView);
    const stopMap = fitWhenSized(ground, mapElement.current!, fitMapView);

    return () => {
      stopPhoto();
      stopMap();
      photo.remove();
      ground.remove();
      photoMap.current = null;
      map.current = null;
      preview.current = null;
    };
  }, []);

  // Redraw the numbered markers whenever the pairs or their errors change.
  useEffect(() => {
    photoMarkers.current.clearLayers();
    mapMarkers.current.clearLayers();
    pairs.forEach((pair, index) => {
      const icon = markerIcon(index + 1, pair === pending, errorsById.get(pair.id));
      if (pair.photo) {
        L.marker([-pair.photo.py, pair.photo.px], { icon, draggable: true })
          .on('dragend', (event) => {
            const latlng = (event.target as L.Marker).getLatLng();
            handlers.current.movePoint(pair.id, 'photo', {
              px: clamp(latlng.lng, 0, width),
              py: clamp(-latlng.lat, 0, height),
            });
          })
          .addTo(photoMarkers.current);
      }
      if (pair.map) {
        L.marker([pair.map.lat, pair.map.lng], { icon, draggable: true })
          .on('dragend', (event) => {
            const latlng = (event.target as L.Marker).getLatLng();
            handlers.current.movePoint(pair.id, 'map', { lng: latlng.lng, lat: latlng.lat });
          })
          .addTo(mapMarkers.current);
      }
    });
  }, [pairs, fit]);

  // The preview: the photo bent onto the fitted corners, under the markers.
  useEffect(() => {
    const ground = map.current;
    if (!ground) return;
    if (fit?.valid) {
      if (preview.current) preview.current.setCorners(fit.corners).setOpacity(opacity);
      else preview.current = new AerialImageLayer(url, fit.corners, width, height, { opacity }).addTo(ground);
    } else if (preview.current) {
      preview.current.remove();
      preview.current = null;
    }
  }, [fit, opacity]);

  // Switching tabs on a phone shows a pane that had no size; let Leaflet re-measure.
  useEffect(() => {
    photoMap.current?.invalidateSize();
    map.current?.invalidateSize();
  }, [tab]);

  async function handleSave() {
    if (!fit?.valid) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveAlignment(imageId, controlPoints, fit.corners);
      onSaved();
    } catch (error) {
      setSaveError(errorMessage(error));
      setSaving(false);
    }
  }

  const pendingNumber = pending ? pairs.indexOf(pending) + 1 : 0;
  let instruction: string;
  if (pending && !pending.map) instruction = `Now click the same spot on the map for point ${pendingNumber}.`;
  else if (pending && !pending.photo) instruction = `Now click the same spot on the photo for point ${pendingNumber}.`;
  else {
    instruction =
      'Click a spot you can recognise on both, such as a path junction, building corner or wall end. 4–6 points spread across the photo work best.';
  }

  let status: string;
  if (complete.length < MIN_POINTS) {
    const needed = MIN_POINTS - complete.length;
    status = `Add ${needed} more point${needed === 1 ? '' : 's'} to see the photo on the map.`;
  } else if (!fit) {
    status = 'These points are in a line or on top of each other. Add points spread across the photo.';
  } else if (!fit.valid) {
    status = "The points don't agree with each other, so the photo would come out twisted. Check for a misplaced point.";
  } else if (fit.rmsError === null) {
    status = 'Add a 4th point to check the accuracy.';
  } else {
    const worst = Math.max(...fit.errors!);
    status = `Average error ${fit.rmsError.toFixed(1)} m${fit.kind === 'perspective' ? ' (fitted as an angled photo)' : ''}.`;
    if (worst > BAD_METRES) {
      status +=
        ' Some points are off by more than 5 m: check the red ones. With only a few points, one misplaced point can make others look off too, so adding points helps pinpoint it.';
    }
  }

  const canSave = complete.length >= MIN_POINTS && Boolean(fit?.valid) && !saving;

  return (
    <div className="align">
      <div className="align__tabs" role="tablist">
        {(['photo', 'map'] as const).map((side) => (
          <button
            key={side}
            type="button"
            role="tab"
            aria-selected={tab === side}
            className={tab === side ? 'align__tab align__tab--active' : 'align__tab'}
            onClick={() => setTab(side)}
          >
            {side === 'photo' ? 'Photo' : 'Map'}
          </button>
        ))}
      </div>

      <div className="align__panes">
        <div className={tab === 'photo' ? 'align__pane align__pane--active' : 'align__pane'}>
          <div ref={photoElement} className="align__view" aria-label="Photo" />
        </div>
        <div className={tab === 'map' ? 'align__pane align__pane--active' : 'align__pane'}>
          <div ref={mapElement} className="align__view" aria-label="Map" />
        </div>
      </div>

      <div className="align__panel">
        <p className="align__instruction">{instruction}</p>
        <p className="align__status">{status}</p>

        {pairs.length > 0 && (
          <ol className="align__points">
            {pairs.map((pair, index) => {
              const error = errorsById.get(pair.id);
              return (
                <li key={pair.id} className="align__point">
                  <span className={`align__number ${errorClass(error)}`}>{index + 1}</span>
                  <span className="align__point-text">
                    {pair === pending
                      ? `Waiting for the ${pair.photo ? 'map' : 'photo'} point`
                      : error === undefined
                        ? 'Placed'
                        : `${error.toFixed(1)} m`}
                  </span>
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Delete point ${index + 1}`}
                    onClick={() => deletePair(pair.id)}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <div className="align__controls">
          <label className="align__opacity">
            Photo on map
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(opacity * 100)}
              onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            />
          </label>
          <button type="button" className="button" disabled={!canSave} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {pending && complete.length >= MIN_POINTS && (
          <p className="align__note">Point {pendingNumber} isn’t finished and won’t be saved.</p>
        )}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
      </div>
    </div>
  );
}

/** Runs fit() the first time the element has a size, and keeps Leaflet's idea of the size current. */
function fitWhenSized(leafletMap: L.Map, element: HTMLElement, fit: () => void): () => void {
  let fitted = false;
  const observer = new ResizeObserver(() => {
    if (element.clientWidth === 0 || element.clientHeight === 0) return;
    leafletMap.invalidateSize();
    if (!fitted) {
      fitted = true;
      fit();
    }
  });
  observer.observe(element);
  return () => observer.disconnect();
}

function markerIcon(number: number, isPending: boolean, error: number | undefined): L.DivIcon {
  const classes = ['align-marker', isPending ? 'align-marker--pending' : errorClass(error)].join(' ');
  return L.divIcon({
    className: classes,
    html: `<span>${number}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function errorClass(error: number | undefined): string {
  if (error === undefined) return '';
  if (error > BAD_METRES) return 'align-error--bad';
  if (error > WARN_METRES) return 'align-error--warn';
  return 'align-error--ok';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
