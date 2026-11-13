// A Leaflet layer that draws a photo bent onto four corners on the map (see
// photos.md). The <img> keeps its own pixel size and a CSS matrix3d transform
// maps those pixels onto the corners' screen positions, which covers both
// straight-down (affine) and angled (perspective) fits.
//
// Leaflet moves the whole pane when the map pans, so the transform only needs
// recalculating after a zoom. During the zoom animation the image is hidden
// (leaflet-zoom-hide), like Leaflet's own canvas layers.

import L from 'leaflet';
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
    super({ pane: layerOptions.pane ?? 'overlayPane' });
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
    this.image.style.transform = rectToQuad(this.width, this.height, points);
  }
}

/**
 * The CSS matrix3d that maps a width × height rectangle onto four points
 * (top-left, top-right, bottom-right, bottom-left), after Heckbert's
 * square-to-quad formula.
 */
function rectToQuad(width: number, height: number, [p0, p1, p2, p3]: L.Point[]): string {
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;

  // Unit square -> quad: X = (a·u + b·v + c) / (g·u + h·v + 1), and likewise Y with d, e, f.
  let g = 0;
  let h = 0;
  if (dx3 !== 0 || dy3 !== 0) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const c = p0.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const f = p0.y;

  // Photo pixels -> unit square is u = x / width, v = y / height. matrix3d is column by column.
  return `matrix3d(${a / width}, ${d / width}, 0, ${g / width}, ${b / height}, ${e / height}, 0, ${h / height}, 0, 0, 1, 0, ${c}, ${f}, 0, 1)`;
}
