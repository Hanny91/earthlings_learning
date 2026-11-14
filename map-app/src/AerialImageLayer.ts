// A Leaflet layer that draws a photo bent onto four corners on the map (see
// photos.md). The <img> keeps its own pixel size and a CSS matrix3d transform
// maps those pixels onto the corners' screen positions, which covers both
// straight-down (affine) and angled (perspective) fits.
//
// Leaflet moves the whole pane when the map pans, so the transform only needs
// recalculating after a zoom. During the zoom animation the image is hidden
// (leaflet-zoom-hide), like Leaflet's own canvas layers.

import L from 'leaflet';
import { rectToQuadMatrix } from './georef';
import type { Corners } from './imagesApi';

export interface AerialImageOptions {
  pane?: string;
  opacity?: number;
}

export class AerialImageLayer extends L.Layer {
  private image: HTMLImageElement | null = null;

  constructor(
    private url: string,
    private corners: Corners,
    private readonly width: number,
    private readonly height: number,
    private readonly layerOptions: AerialImageOptions = {},
  ) {
    super();
    // L.Layer has no initialize(), so options passed to super() are dropped; set them directly.
    L.setOptions(this, { pane: layerOptions.pane ?? 'overlayPane' });
  }

  onAdd(map: L.Map): this {
    const image = L.DomUtil.create('img', 'aerial-image leaflet-zoom-hide') as HTMLImageElement;
    image.alt = '';
    image.src = this.url;
    // The transform works in the photo's own pixels, so lay it out at full size.
    image.style.width = `${this.width}px`;
    image.style.height = `${this.height}px`;
    image.style.opacity = String(this.layerOptions.opacity ?? 1);
    this.getPane()!.appendChild(image);
    this.image = image;

    map.on('zoomend viewreset', this.update, this);
    this.update();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off('zoomend viewreset', this.update, this);
    this.image?.remove();
    this.image = null;
    return this;
  }

  setCorners(corners: Corners): this {
    this.corners = corners;
    this.update();
    return this;
  }

  setOpacity(opacity: number): this {
    this.layerOptions.opacity = opacity;
    if (this.image) this.image.style.opacity = String(opacity);
    return this;
  }

  setUrl(url: string): this {
    this.url = url;
    if (this.image) this.image.src = url;
    return this;
  }

  private update(): void {
    if (!this.image || !this._map) return;
    const map = this._map;
    const points = this.corners.map((c) => map.latLngToLayerPoint([c.lat, c.lng]));
    this.image.style.transform = `matrix3d(${rectToQuadMatrix(this.width, this.height, points).join(', ')})`;
  }
}
