import { describe, expect, it } from "vitest";
import { generateLevel, gridToWorld } from "../level";

describe("generateLevel", () => {
  it("always places the terminal reachable from spawn, on an open (non-crate) cell", () => {
    for (let seed = 0; seed < 50; seed++) {
      const level = generateLevel(seed);
      const crateKeys = new Set(level.crates.map((c) => `${c.x},${c.z}`));

      expect(crateKeys.has(`${level.terminal.x},${level.terminal.z}`)).toBe(false);
      expect(crateKeys.has(`${level.spawn.x},${level.spawn.z}`)).toBe(false);
      expect(level.terminal).not.toEqual(level.spawn);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = generateLevel(1234);
    const b = generateLevel(1234);
    expect(a).toEqual(b);
  });

  it("produces different layouts for different seeds", () => {
    const a = generateLevel(1);
    const b = generateLevel(2);
    expect(a).not.toEqual(b);
  });

  it("keeps every guard waypoint off crates and within the room bounds", () => {
    const level = generateLevel(42);
    const crateKeys = new Set(level.crates.map((c) => `${c.x},${c.z}`));
    for (const guard of level.guards) {
      for (const wp of guard.waypoints) {
        expect(crateKeys.has(`${wp.x},${wp.z}`)).toBe(false);
        expect(wp.x).toBeGreaterThanOrEqual(1);
        expect(wp.x).toBeLessThanOrEqual(level.gridSize - 2);
      }
    }
  });

  it("never places a guard waypoint on the player's spawn cell", () => {
    for (let seed = 0; seed < 50; seed++) {
      const level = generateLevel(seed);
      for (const guard of level.guards) {
        for (const wp of guard.waypoints) {
          expect(wp).not.toEqual(level.spawn);
        }
      }
    }
  });
});

describe("gridToWorld", () => {
  it("centers the room on the world origin", () => {
    const level = generateLevel(1);
    const center = gridToWorld({ x: (level.gridSize - 1) / 2, z: (level.gridSize - 1) / 2 }, level);
    expect(center.x).toBeCloseTo(0);
    expect(center.z).toBeCloseTo(0);
  });
});
