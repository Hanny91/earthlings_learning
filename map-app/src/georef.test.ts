import { describe, expect, it } from 'vitest';
import { fitPhoto, project, rectToQuadMatrix, unproject, type XY } from './georef';
import type { ControlPoint, LngLat } from './imagesApi';

// A made-up 4000 × 3000 photo of a Cornish park, about 10 cm per pixel.
const WIDTH = 4000;
const HEIGHT = 3000;
const ORIGIN = project({ lng: -5.05, lat: 50.26 });

/** Rotated 30°, 0.15 Mercator metres per pixel, photo y pointing down the map. */
function affinePlace(px: number, py: number): LngLat {
  const angle = Math.PI / 6;
  const scale = 0.15;
  const x = scale * (Math.cos(angle) * px + Math.sin(angle) * py);
  const y = scale * (Math.sin(angle) * px - Math.cos(angle) * py);
  return unproject({ x: ORIGIN.x + x, y: ORIGIN.y + y });
}

/** As above, but taken at an angle: the far (top) edge of the photo is wider on the ground. */
function perspectivePlace(px: number, py: number): LngLat {
  const w = 1 - 0.00008 * (HEIGHT - py) * 0.5;
  const x = (0.15 * px) / w;
  const y = (-0.15 * py) / w;
  return unproject({ x: ORIGIN.x + x, y: ORIGIN.y + y });
}

function pointsFrom(place: (px: number, py: number) => LngLat, pixels: [number, number][]): ControlPoint[] {
  return pixels.map(([px, py]) => ({ px, py, ...place(px, py) }));
}

function expectClose(actual: LngLat, expected: LngLat) {
  // 1e-7 degrees is about a centimetre.
  expect(actual.lng).toBeCloseTo(expected.lng, 7);
  expect(actual.lat).toBeCloseTo(expected.lat, 7);
}

const SPREAD: [number, number][] = [
  [300, 250],
  [3700, 400],
  [3500, 2800],
  [500, 2600],
  [2000, 1500],
  [1200, 900],
];

describe('fitPhoto', () => {
  it('needs at least 3 points', () => {
    expect(fitPhoto(pointsFrom(affinePlace, SPREAD.slice(0, 2)), WIDTH, HEIGHT)).toBeNull();
  });

  it('refuses points in a straight line', () => {
    const inLine = pointsFrom(affinePlace, [
      [0, 0],
      [1000, 1000],
      [2000, 2000],
      [3000, 3000],
    ]);
    expect(fitPhoto(inLine, WIDTH, HEIGHT)).toBeNull();
  });

  it('fits 3 points exactly with an affine fit and reports no errors', () => {
    const fit = fitPhoto(pointsFrom(affinePlace, SPREAD.slice(0, 3)), WIDTH, HEIGHT)!;
    expect(fit.kind).toBe('affine');
    expect(fit.errors).toBeNull();
    expect(fit.rmsError).toBeNull();
    expect(fit.valid).toBe(true);
    expectClose(fit.corners[0], affinePlace(0, 0));
    expectClose(fit.corners[1], affinePlace(WIDTH, 0));
    expectClose(fit.corners[2], affinePlace(WIDTH, HEIGHT));
    expectClose(fit.corners[3], affinePlace(0, HEIGHT));
  });

  it('reports near-zero errors for 4 consistent points', () => {
    const fit = fitPhoto(pointsFrom(affinePlace, SPREAD.slice(0, 4)), WIDTH, HEIGHT)!;
    expect(fit.kind).toBe('affine');
    expect(fit.errors).toHaveLength(4);
    for (const error of fit.errors!) expect(error).toBeLessThan(0.01);
  });

  it('uses perspective for an angled photo with 6 points', () => {
    const fit = fitPhoto(pointsFrom(perspectivePlace, SPREAD), WIDTH, HEIGHT)!;
    expect(fit.kind).toBe('perspective');
    expect(fit.valid).toBe(true);
    expect(fit.rmsError!).toBeLessThan(0.01);
    expectClose(fit.corners[0], perspectivePlace(0, 0));
    expectClose(fit.corners[2], perspectivePlace(WIDTH, HEIGHT));
  });

  it('shows a 10 m slip as about 10 m, even with only 4 points', () => {
    const points = pointsFrom(affinePlace, SPREAD.slice(0, 4));
    // Move point 2 about 10 m east on the map.
    points[2] = { ...points[2], lng: points[2].lng + 0.00014 };
    const fit = fitPhoto(points, WIDTH, HEIGHT)!;
    // With so few points every point looks off, but none of them hides the problem.
    for (const error of fit.errors!) expect(error).toBeGreaterThan(5);
  });

  it('measures the misplaced point’s slip correctly with 6 points', () => {
    // With 6 points the slipped point reads close to its real 10 m, though a
    // neighbour can read as high. Pinpointing it reliably takes more points.
    for (const bad of [0, 1, 2, 3]) {
      const points = pointsFrom(affinePlace, SPREAD);
      points[bad] = { ...points[bad], lng: points[bad].lng + 0.00014 };
      const fit = fitPhoto(points, WIDTH, HEIGHT)!;
      expect(fit.kind).toBe('affine');
      expect(fit.errors![bad]).toBeGreaterThan(8);
      expect(fit.errors![bad]).toBeLessThan(12);
    }
  });

  it('keeps straight-down photos affine rather than bending them to fit a mistake', () => {
    const points = pointsFrom(affinePlace, SPREAD);
    points[4] = { ...points[4], lat: points[4].lat + 0.00009 };
    expect(fitPhoto(points, WIDTH, HEIGHT)!.kind).toBe('affine');
  });

  it('reports errors in ground metres, not Mercator metres', () => {
    // At 50° north, Mercator metres are about 1.56 ground metres; a 10 m slip should read as about 10 m.
    const points = pointsFrom(affinePlace, SPREAD.slice(0, 4));
    const fit = fitPhoto(points, WIDTH, HEIGHT)!;
    const shifted = fit.toLngLat(points[0].px, points[0].py);
    const metresPerDegreeLng = 111320 * Math.cos((50.26 * Math.PI) / 180);
    expect(Math.abs(shifted.lng - points[0].lng) * metresPerDegreeLng).toBeLessThan(0.01);
  });

  it('flags corners that fold over as invalid', () => {
    // Swap two map positions so the photo would have to be twisted to fit.
    const points = pointsFrom(affinePlace, SPREAD.slice(0, 5));
    const a = { lng: points[0].lng, lat: points[0].lat };
    points[0] = { ...points[0], lng: points[1].lng, lat: points[1].lat };
    points[1] = { ...points[1], ...a };
    const fit = fitPhoto(points, WIDTH, HEIGHT);
    expect(fit === null || fit.valid === false || fit.rmsError! > 50).toBe(true);
  });
  it('rejects an angled fit whose horizon crosses the photo', () => {
    // A steep tilt: the ground runs away to a horizon a third of the way down
    // the photo. Points are only clicked below it, so the fit is exact, but the
    // top corners would be beyond the horizon.
    const steep = (px: number, py: number): LngLat => {
      const w = 1 - (HEIGHT - py) / 2000;
      return unproject({ x: ORIGIN.x + (0.15 * px) / w, y: ORIGIN.y - (0.15 * py) / w });
    };
    const fit = fitPhoto(
      pointsFrom(steep, [
        [300, 1700],
        [3700, 1800],
        [3600, 2900],
        [400, 2800],
        [2000, 2300],
        [1200, 2000],
      ]),
      WIDTH,
      HEIGHT,
    );
    expect(fit === null || !fit.valid).toBe(true);
  });
});

describe('Web Mercator', () => {
  it('round-trips a point', () => {
    const point = { lng: -5.05, lat: 50.26 };
    expectClose(unproject(project(point)), point);
  });
});

describe('rectToQuadMatrix', () => {
  // Applies a CSS matrix3d (column by column) to a 2D point.
  function apply(m: number[], x: number, y: number): XY {
    const w = m[3] * x + m[7] * y + m[15];
    return { x: (m[0] * x + m[4] * y + m[12]) / w, y: (m[1] * x + m[5] * y + m[13]) / w };
  }

  function expectCornersLand(quad: XY[]) {
    const m = rectToQuadMatrix(WIDTH, HEIGHT, quad);
    const corners: [number, number][] = [
      [0, 0],
      [WIDTH, 0],
      [WIDTH, HEIGHT],
      [0, HEIGHT],
    ];
    corners.forEach(([x, y], i) => {
      const p = apply(m, x, y);
      expect(p.x).toBeCloseTo(quad[i].x, 6);
      expect(p.y).toBeCloseTo(quad[i].y, 6);
    });
  }

  it('maps the photo onto a rotated rectangle', () => {
    expectCornersLand([
      { x: 100, y: 50 },
      { x: 500, y: 250 },
      { x: 400, y: 450 },
      { x: 0, y: 250 },
    ]);
  });

  it('maps the photo onto an uneven quadrilateral (an angled photo)', () => {
    expectCornersLand([
      { x: 120, y: 40 },
      { x: 610, y: 90 },
      { x: 520, y: 480 },
      { x: 60, y: 400 },
    ]);
  });
});
