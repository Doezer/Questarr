import { describe, expect, it } from "vitest";
import {
  AWARENESS_DECAY,
  AWARENESS_FULL,
  AWARENESS_SUSPICIOUS,
  LAMP_RADIUS,
  MOVEMENT_NOISE_RADIUS,
  STANCES,
  awarenessRate,
  illuminationAt,
  lampPositions,
  noiseRadiusFor,
  stepAwareness,
} from "../detection";

/** Fills a meter from empty at a fixed rate, returning the seconds it took. */
function secondsToFull(rate: number, step = 1 / 60): number {
  let awareness = 0;
  let elapsed = 0;
  while (awareness < AWARENESS_FULL && elapsed < 120) {
    awareness = stepAwareness(awareness, rate, true, step);
    elapsed += step;
  }
  return elapsed;
}

describe("illuminationAt", () => {
  const lamps = [{ x: 0, z: 0 }];

  it("is brightest under a lamp and dark beyond its radius", () => {
    expect(illuminationAt(0, 0, lamps)).toBe(1);
    expect(illuminationAt(LAMP_RADIUS, 0, lamps)).toBe(0);
    expect(illuminationAt(LAMP_RADIUS * 4, 0, lamps)).toBe(0);
  });

  it("falls off with distance", () => {
    expect(illuminationAt(LAMP_RADIUS / 2, 0, lamps)).toBeCloseTo(0.5);
    expect(illuminationAt(2, 0, lamps)).toBeGreaterThan(illuminationAt(5, 0, lamps));
  });

  it("takes the nearest lamp rather than summing overlapping pools", () => {
    const pair = [
      { x: -1, z: 0 },
      { x: 1, z: 0 },
    ];
    // Between two lamps the seam must not read brighter than directly under one.
    expect(illuminationAt(0, 0, pair)).toBeLessThanOrEqual(1);
    expect(illuminationAt(0, 0, pair)).toBeCloseTo(1 - 1 / LAMP_RADIUS);
  });

  it("is fully dark with no lamps at all", () => {
    expect(illuminationAt(0, 0, [])).toBe(0);
  });
});

describe("noiseRadiusFor", () => {
  it("is silent when barely moving, in either stance", () => {
    expect(noiseRadiusFor("standing", 0)).toBe(0);
    expect(noiseRadiusFor("crouched", 0.05)).toBe(0);
  });

  it("is loudest running upright and much quieter crouched", () => {
    const running = noiseRadiusFor("standing", 1);
    expect(running).toBeCloseTo(MOVEMENT_NOISE_RADIUS);
    expect(noiseRadiusFor("crouched", 1)).toBeLessThan(running / 2);
  });

  it("scales with speed and clamps out-of-range fractions", () => {
    expect(noiseRadiusFor("standing", 0.5)).toBeCloseTo(MOVEMENT_NOISE_RADIUS / 2);
    expect(noiseRadiusFor("standing", 4)).toBeCloseTo(noiseRadiusFor("standing", 1));
    expect(noiseRadiusFor("standing", -3)).toBe(0);
  });
});

describe("awarenessRate", () => {
  const lit = { distance: 0, visionRange: 9, illumination: 1, stance: "standing" as const };

  it("preserves the old 0.55s spot grace as the worst case", () => {
    expect(secondsToFull(awarenessRate(lit))).toBeCloseTo(0.55, 1);
  });

  it("is zero beyond the guard's sight range", () => {
    expect(awarenessRate({ ...lit, distance: 9.01 })).toBe(0);
    expect(awarenessRate({ ...lit, visionRange: 0 })).toBe(0);
  });

  it("slows with distance, darkness and crouching, but never to nothing", () => {
    const far = awarenessRate({ ...lit, distance: 8 });
    const dark = awarenessRate({ ...lit, illumination: 0 });
    const crouched = awarenessRate({ ...lit, stance: "crouched" });

    for (const rate of [far, dark, crouched]) {
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(awarenessRate(lit));
    }
  });

  it("compounds: crouching through shadow at range is far slower than standing in light", () => {
    const worst = awarenessRate(lit);
    const best = awarenessRate({
      distance: 8.5,
      visionRange: 9,
      illumination: 0,
      stance: "crouched",
    });
    expect(worst / best).toBeGreaterThan(10);
    // Slow enough to cross a guard's cone, not so slow it is never a risk.
    expect(secondsToFull(best)).toBeGreaterThan(5);
    expect(secondsToFull(best)).toBeLessThan(60);
  });

  it("clamps illumination outside 0..1 rather than extrapolating", () => {
    expect(awarenessRate({ ...lit, illumination: 5 })).toBeCloseTo(awarenessRate(lit));
    expect(awarenessRate({ ...lit, illumination: -5 })).toBeCloseTo(
      awarenessRate({ ...lit, illumination: 0 })
    );
  });
});

describe("stepAwareness", () => {
  it("fills while seen and decays once sight breaks", () => {
    expect(stepAwareness(0.5, 1, true, 0.1)).toBeCloseTo(0.6);
    expect(stepAwareness(0.5, 1, false, 0.1)).toBeCloseTo(0.5 - AWARENESS_DECAY * 0.1);
  });

  it("never leaves the 0..1 range", () => {
    expect(stepAwareness(0.99, 100, true, 1)).toBe(AWARENESS_FULL);
    expect(stepAwareness(0.01, 0, false, 10)).toBe(0);
  });

  it("crosses the suspicious threshold before it fills", () => {
    expect(AWARENESS_SUSPICIOUS).toBeGreaterThan(0);
    expect(AWARENESS_SUSPICIOUS).toBeLessThan(AWARENESS_FULL);
  });

  it("decays a full meter back to calm in a few seconds", () => {
    let awareness = AWARENESS_FULL;
    for (let i = 0; i < 60 * 3; i++) awareness = stepAwareness(awareness, 0, false, 1 / 60);
    expect(awareness).toBe(0);
  });
});

describe("STANCES", () => {
  it("makes crouching slower, quieter and harder to see", () => {
    const { standing, crouched } = STANCES;
    expect(crouched.speed).toBeLessThan(standing.speed);
    expect(crouched.noise).toBeLessThan(standing.noise);
    expect(crouched.visibility).toBeLessThan(standing.visibility);
    expect(crouched.height).toBeLessThan(standing.height);
  });

  it("costs more speed than it buys back visibility, so it is a real trade", () => {
    // Otherwise crouching would simply be the correct way to move at all times.
    const { crouched } = STANCES;
    expect(1 - crouched.speed).toBeGreaterThan(1 - crouched.visibility);
  });
});

describe("lampPositions", () => {
  it("puts one lamp at the centre of each room", () => {
    const identity = (cell: { x: number; z: number }) => ({ x: cell.x, z: cell.z });
    expect(
      lampPositions(
        [
          { x: 0, z: 0, w: 5, h: 5 },
          { x: 10, z: 2, w: 3, h: 7 },
        ],
        identity
      )
    ).toEqual([
      { x: 2, z: 2 },
      { x: 11, z: 5 },
    ]);
  });
});
