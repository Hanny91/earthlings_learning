// Works out where a photo sits on the map from pairs of clicked points (see
// photos.md, phase 4). Pure maths with no Leaflet, so it can be tested on its own.
//
// Fits are done in Web Mercator metres, the projection Leaflet draws with, so
// a fitted photo lines up exactly with what's on screen. Errors are reported
// in ground metres.
//
//   Affine (move, rotate, scale, skew), for straight-down shots, by default.
//   Perspective (a homography), which also handles angled shots, from 6 points
//   and only when it clearly predicts the points better than affine.
//
// Both are least-squares fits on coordinates that are first centred and
// scaled, so rounding doesn't creep in with large Mercator values.

import type { ControlPoint, Corners, LngLat } from './imagesApi';

export type FitKind = 'affine' | 'perspective';

export interface Fit {
  kind: FitKind;
  /** Where a photo pixel (from the top-left) lands on the map. */
  toLngLat: (px: number, py: number) => LngLat;
  /** The photo's corners on the map: top-left, top-right, bottom-right, bottom-left. */
  corners: Corners;
  /**
   * For each point, the distance in ground metres between where it was clicked
   * on the map and where the other points put it. A misplaced point stands out.
   * Null with exactly 3 points, where there are none spare to check against.
   */
  errors: number[] | null;
  /** Root-mean-square of errors, or null alongside them. */
  rmsError: number | null;
  /**
   * False when the corners come out twisted or folded, which means the points
   * disagree (usually one is misplaced). The database refuses crossed corners.
   */
  valid: boolean;
}

export const MIN_POINTS = 3;
/** Perspective is only considered from this many points; with fewer it bends to fit mistakes. */
export const PERSPECTIVE_FROM = 6;
/** Perspective must beat affine's checked error by this factor to be used. */
const PERSPECTIVE_GAIN = 0.8;

const FIT_MIN_POINTS: Record<FitKind, number> = { affine: 3, perspective: 4 };

/** The best fit through the points, or null with too few points or points in a line. */
export function fitPhoto(points: ControlPoint[], width: number, height: number): Fit | null {
  if (points.length < MIN_POINTS) return null;

  const affine = fitModel('affine', points);
  if (!affine) return null;
  let chosen = affine;
  if (points.length >= PERSPECTIVE_FROM) {
    // Use perspective only when it predicts each point from the others clearly better,
    // so a misplaced point shows up as an error rather than bending the photo.
    const perspective = fitModel('perspective', points);
    if (
      perspective?.rmsError != null &&
      affine.rmsError != null &&
      perspective.rmsError < affine.rmsError * PERSPECTIVE_GAIN
    ) {
      chosen = perspective;
    }
  }

  const { kind, toMercator, errors, rmsError } = chosen;
  const toLngLat = (px: number, py: number): LngLat => {
    const mapped = toMercator(px, py);
    return mapped ? unproject(mapped) : { lng: NaN, lat: NaN };
  };

  const cornerPixels: XY[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const cornerMercator = cornerPixels.map((c) => toMercator(c.x, c.y));
  const valid =
    cornerMercator.every((c): c is XY => c !== null && Number.isFinite(c.x) && Number.isFinite(c.y)) &&
    isConvex(cornerMercator as XY[]);
  const corners = cornerPixels.map((c) => toLngLat(c.x, c.y)) as Corners;

  return { kind, toLngLat, corners, errors, rmsError, valid };
}

interface ModelFit {
  kind: FitKind;
  toMercator: (px: number, py: number) => XY | null;
  errors: number[] | null;
  rmsError: number | null;
}

/**
 * Fits one kind of transform, and checks each point against a fit made from
 * all the other points ("leave one out"). Checking a point against a fit it
 * helped make hides mistakes, because the fit leans towards the bad point.
 */
function fitModel(kind: FitKind, points: ControlPoint[]): ModelFit | null {
  const toMercator = buildTransform(kind, points);
  if (!toMercator) return null;

  // Leaving one out still has to leave enough to fit.
  if (points.length - 1 < FIT_MIN_POINTS[kind]) return { kind, toMercator, errors: null, rmsError: null };

  const errors = points.map((p, i) => {
    const others = buildTransform(kind, points.filter((_, j) => j !== i));
    const predicted = others?.(p.px, p.py);
    if (!predicted) return Infinity;
    const clicked = project(p);
    // Mercator stretches distances by 1 / cos(latitude).
    return Math.hypot(predicted.x - clicked.x, predicted.y - clicked.y) * Math.cos((p.lat * Math.PI) / 180);
  });
  const rmsError = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length);
  return { kind, toMercator, errors, rmsError };
}

/** Photo pixel -> Mercator metres, fitted through the points, or null if they don't pin it down. */
function buildTransform(kind: FitKind, points: ControlPoint[]): ((px: number, py: number) => XY | null) | null {
  if (points.length < FIT_MIN_POINTS[kind]) return null;
  const source = points.map((p) => ({ x: p.px, y: p.py }));
  const target = points.map((p) => project(p));
  const sourceNorm = normaliser(source);
  const targetNorm = normaliser(target);
  const s = source.map(sourceNorm.apply);
  const t = target.map(targetNorm.apply);
  const transform = kind === 'affine' ? fitAffine(s, t) : fitHomography(s, t);
  if (!transform) return null;
  return (px, py) => {
    const mapped = transform(sourceNorm.apply({ x: px, y: py }));
    return mapped && targetNorm.invert(mapped);
  };
}

// --- Web Mercator (the same sphere Leaflet's EPSG:3857 uses) ---

export interface XY {
  x: number;
  y: number;
}

const EARTH_RADIUS = 6378137;
const MAX_LATITUDE = 85.0511287798;

export function project({ lng, lat }: LngLat): XY {
  const clamped = Math.max(Math.min(MAX_LATITUDE, lat), -MAX_LATITUDE);
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: (EARTH_RADIUS * lng * Math.PI) / 180,
    y: (EARTH_RADIUS * Math.log((1 + sin) / (1 - sin))) / 2,
  };
}

export function unproject({ x, y }: XY): LngLat {
  return {
    lng: (x * 180) / Math.PI / EARTH_RADIUS,
    lat: ((2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * 180) / Math.PI,
  };
}

// --- Normalising: centre on the mean and scale to an average distance of √2 ---

function normaliser(points: XY[]) {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const meanDistance = points.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / points.length;
  // All points in one spot: nothing sensible to fit, and the solver will say so.
  const scale = meanDistance > 0 ? Math.SQRT2 / meanDistance : 1;
  return {
    apply: (p: XY): XY => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }),
    invert: (p: XY): XY => ({ x: p.x / scale + cx, y: p.y / scale + cy }),
  };
}

// --- Fits. Each returns a function on normalised coordinates, or null if the points don't pin it down. ---

type Transform = (p: XY) => XY | null;

/** x' = a·x + b·y + c, y' = d·x + e·y + f */
function fitAffine(source: XY[], target: XY[]): Transform | null {
  const rows = source.map((p) => [p.x, p.y, 1]);
  const xs = leastSquares(rows, target.map((p) => p.x));
  const ys = leastSquares(rows, target.map((p) => p.y));
  if (!xs || !ys) return null;
  const [a, b, c] = xs;
  const [d, e, f] = ys;
  return (p) => ({ x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f });
}

/** x' = (h0·x + h1·y + h2) / (h6·x + h7·y + 1), y' = (h3·x + h4·y + h5) / (h6·x + h7·y + 1) */
function fitHomography(source: XY[], target: XY[]): Transform | null {
  const rows: number[][] = [];
  const values: number[] = [];
  source.forEach((p, i) => {
    const q = target[i];
    rows.push([p.x, p.y, 1, 0, 0, 0, -p.x * q.x, -p.y * q.x]);
    values.push(q.x);
    rows.push([0, 0, 0, p.x, p.y, 1, -p.x * q.y, -p.y * q.y]);
    values.push(q.y);
  });
  const h = leastSquares(rows, values);
  if (!h) return null;
  return (p) => {
    const w = h[6] * p.x + h[7] * p.y + 1;
    // The photo's "horizon". w is 1 at the points' centre, so any pixel where it
    // reaches zero or below is beyond the horizon and has no place on the map.
    // A fit whose horizon crosses the photo gives a null corner, so it's invalid.
    if (w < 1e-9) return null;
    return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
  };
}

/** Solves rows·x ≈ values by the normal equations. Null if the system is singular (e.g. points in a line). */
function leastSquares(rows: number[][], values: number[]): number[] | null {
  const n = rows[0].length;
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);
  rows.forEach((row, r) => {
    for (let i = 0; i < n; i++) {
      atb[i] += row[i] * values[r];
      for (let j = 0; j < n; j++) ata[i][j] += row[i] * row[j];
    }
  });
  return solve(ata, atb);
}

/** Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const m = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    // Coordinates are normalised, so a pivot this small means the points don't pin the fit down.
    if (Math.abs(m[pivot][col]) < 1e-10) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k++) sum -= m[row][k] * x[k];
    x[row] = sum / m[row][row];
  }
  return x;
}

/** True when the four corners, in order, make a convex shape that doesn't cross itself. */
function isConvex(corners: XY[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const c = corners[(i + 2) % corners.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) return false;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/**
 * The 4 × 4 matrix (column by column, as CSS matrix3d takes it) that maps a
 * width × height rectangle onto four points: top-left, top-right,
 * bottom-right, bottom-left. Heckbert's square-to-quad formula, used by
 * AerialImageLayer to draw a photo onto its corners on screen.
 */
export function rectToQuadMatrix(width: number, height: number, [p0, p1, p2, p3]: XY[]): number[] {
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

  // Photo pixels -> unit square is u = x / width, v = y / height.
  return [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, c, f, 0, 1];
}
