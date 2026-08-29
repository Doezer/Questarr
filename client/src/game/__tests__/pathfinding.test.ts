import { describe, expect, it } from "vitest";
import { cellKey, type GridPos } from "../grid";
import { findPath, nearestOpenCell } from "../pathfinding";
import { generateLevel } from "../level";

const GRID = 13;

function blockedFrom(cells: GridPos[]): Set<string> {
  return new Set(cells.map(cellKey));
}

/** Every step must be a single cardinal move onto an open interior cell. */
function assertValidPath(path: GridPos[], start: GridPos, blocked: Set<string>) {
  let prev = start;
  for (const step of path) {
    expect(Math.abs(step.x - prev.x) + Math.abs(step.z - prev.z)).toBe(1);
    expect(blocked.has(cellKey(step))).toBe(false);
    expect(step.x).toBeGreaterThanOrEqual(1);
    expect(step.z).toBeGreaterThanOrEqual(1);
    expect(step.x).toBeLessThanOrEqual(GRID - 2);
    expect(step.z).toBeLessThanOrEqual(GRID - 2);
    prev = step;
  }
}

describe("findPath", () => {
  it("walks an empty grid in the fewest possible steps", () => {
    const blocked = blockedFrom([]);
    const start = { x: 1, z: 1 };
    const goal = { x: 5, z: 4 };
    const path = findPath(start, goal, GRID, blocked);

    expect(path.at(-1)).toEqual(goal);
    expect(path).toHaveLength(Math.abs(goal.x - start.x) + Math.abs(goal.z - start.z));
    assertValidPath(path, start, blocked);
  });

  it("routes around a wall of blocked cells instead of through it", () => {
    // A vertical barrier at x = 3 with a single gap at z = 8.
    const barrier: GridPos[] = [];
    for (let z = 1; z <= GRID - 2; z++) if (z !== 8) barrier.push({ x: 3, z });
    const blocked = blockedFrom(barrier);

    const start = { x: 1, z: 1 };
    const path = findPath(start, { x: 6, z: 1 }, GRID, blocked);

    expect(path.length).toBeGreaterThan(0);
    expect(path.some((step) => step.x === 3 && step.z === 8)).toBe(true);
    assertValidPath(path, start, blocked);
  });

  it("returns no path when the goal is walled off", () => {
    const box: GridPos[] = [
      { x: 5, z: 4 },
      { x: 5, z: 6 },
      { x: 4, z: 5 },
      { x: 6, z: 5 },
    ];
    expect(findPath({ x: 1, z: 1 }, { x: 5, z: 5 }, GRID, blockedFrom(box))).toEqual([]);
  });

  it("returns no path for a blocked, out-of-bounds, or identical goal", () => {
    const blocked = blockedFrom([{ x: 4, z: 4 }]);
    expect(findPath({ x: 1, z: 1 }, { x: 4, z: 4 }, GRID, blocked)).toEqual([]);
    expect(findPath({ x: 1, z: 1 }, { x: 0, z: 5 }, GRID, blocked)).toEqual([]);
    expect(findPath({ x: 1, z: 1 }, { x: 1, z: 1 }, GRID, blocked)).toEqual([]);
  });

  it("refuses to path out of a blocked start cell", () => {
    const blocked = blockedFrom([{ x: 1, z: 1 }]);
    expect(findPath({ x: 1, z: 1 }, { x: 5, z: 5 }, GRID, blocked)).toEqual([]);
  });

  it("is deterministic", () => {
    const blocked = blockedFrom([
      { x: 3, z: 3 },
      { x: 3, z: 4 },
    ]);
    const a = findPath({ x: 1, z: 1 }, { x: 7, z: 7 }, GRID, blocked);
    const b = findPath({ x: 1, z: 1 }, { x: 7, z: 7 }, GRID, blocked);
    expect(a).toEqual(b);
  });

  it("can always path from spawn to the terminal on a generated level", () => {
    for (let seed = 0; seed < 30; seed++) {
      const level = generateLevel(seed);
      const blocked = blockedFrom(level.crates);
      const path = findPath(level.spawn, level.terminal, level.gridSize, blocked);

      expect(path.length).toBeGreaterThan(0);
      expect(path.at(-1)).toEqual(level.terminal);
      for (const step of path) expect(blocked.has(cellKey(step))).toBe(false);
    }
  });
});

describe("nearestOpenCell", () => {
  it("returns the cell itself when it is already open", () => {
    expect(nearestOpenCell({ x: 4, z: 4 }, GRID, blockedFrom([]))).toEqual({ x: 4, z: 4 });
  });

  it("steps off a blocked cell onto an adjacent open one", () => {
    const blocked = blockedFrom([{ x: 4, z: 4 }]);
    const found = nearestOpenCell({ x: 4, z: 4 }, GRID, blocked)!;
    expect(blocked.has(cellKey(found))).toBe(false);
    expect(Math.abs(found.x - 4) + Math.abs(found.z - 4)).toBe(1);
  });

  it("clamps a point outside the interior back into it", () => {
    expect(nearestOpenCell({ x: 99, z: -5 }, GRID, blockedFrom([]))).toEqual({
      x: GRID - 2,
      z: 1,
    });
  });

  it("returns null when the whole interior is blocked", () => {
    const all: GridPos[] = [];
    for (let x = 1; x <= GRID - 2; x++) {
      for (let z = 1; z <= GRID - 2; z++) all.push({ x, z });
    }
    expect(nearestOpenCell({ x: 4, z: 4 }, GRID, blockedFrom(all))).toBeNull();
  });
});
