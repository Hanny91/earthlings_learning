// Map layers, bottom to top (see project.md):
//   1. Thunderforest Landscape base map  -> Leaflet's tilePane (z 200)
//   2. Soil parent material/hydrogeology -> "geology" pane     (z 250)
//   3. Rivers                            -> "rivers" pane      (z 300)
//   4. Defra / MAGIC layers              -> "magic" pane       (z 350)
//   5. Pins                              -> Leaflet's overlayPane (z 400)
//
// The overlay layers (2-4) are a later job. The panes exist now so each layer
// only needs `pane: '<name>'` to land in the right place.

import L from 'leaflet';
import { config } from './config';

export const OVERLAY_PANES = {
  geology: 250,
  rivers: 300,
  magic: 350,
} as const;

export type OverlayPane = keyof typeof OVERLAY_PANES;

export function createOverlayPanes(map: L.Map): void {
  for (const [name, zIndex] of Object.entries(OVERLAY_PANES)) {
    map.createPane(name).style.zIndex = String(zIndex);
  }
}

/** Thunderforest Landscape, or OpenStreetMap when no key is configured (e.g. local dev). */
export function createBaseLayer(): L.TileLayer {
  if (config.thunderforestKey) {
    return L.tileLayer(
      'https://{s}.tile.thunderforest.com/landscape/{z}/{x}/{y}{r}.png?apikey={apikey}',
      {
        apikey: config.thunderforestKey,
        maxZoom: 22,
        attribution:
          'Maps &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, ' +
          'Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      } as L.TileLayerOptions,
    );
  }
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  });
}
