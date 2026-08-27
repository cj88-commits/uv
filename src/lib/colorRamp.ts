// A continuous UV Index -> RGB colour ramp. Anchor points sit near the
// standard category boundaries (see src/lib/uv.ts) so the dominant hue at
// each anchor still reads as "the" colour for that category, but values
// between anchors are linearly blended — two UV values that differ by 0.1
// get visibly (if subtly) different colours instead of being quantised
// into one of five flat bands.
//
// This is a purely visual mapping. It has no bearing on the underlying
// science — see docs/MVP_ARCHITECTURE.md.

type Stop = [uv: number, rgb: [number, number, number]];

const STOPS: Stop[] = [
  [0, [17, 94, 63]], // deep green — very low
  [2, [67, 160, 71]], // green — low
  [4, [190, 200, 60]], // yellow-green — entering moderate
  [6, [250, 176, 44]], // orange — high begins
  [8, [237, 106, 58]], // red-orange — very high begins
  [10, [211, 47, 47]], // red
  [12, [152, 66, 168]], // red-purple — extreme
  [15, [95, 26, 128]], // deep purple — extreme ceiling
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Continuous UV Index -> [r,g,b], clamped to the ramp's ends. */
export function continuousUvColor(uv: number): [number, number, number] {
  if (uv <= STOPS[0][0]) return STOPS[0][1];
  const last = STOPS[STOPS.length - 1];
  if (uv >= last[0]) return last[1];

  for (let i = 0; i < STOPS.length - 1; i++) {
    const [uvLo, rgbLo] = STOPS[i];
    const [uvHi, rgbHi] = STOPS[i + 1];
    if (uv >= uvLo && uv <= uvHi) {
      const t = (uv - uvLo) / (uvHi - uvLo);
      return [
        lerp(rgbLo[0], rgbHi[0], t),
        lerp(rgbLo[1], rgbHi[1], t),
        lerp(rgbLo[2], rgbHi[2], t),
      ];
    }
  }
  return last[1];
}

export function continuousUvColorCss(uv: number): string {
  const [r, g, b] = continuousUvColor(uv).map(Math.round);
  return `rgb(${r},${g},${b})`;
}
