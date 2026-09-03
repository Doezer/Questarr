import { describe, expect, it } from "vitest";
import { cellKey, type GridPos } from "../grid";
import { blockJitter, cellNoise, pillarCells, rubbleSpots } from "../vault-decor";

/** A straight interior wall run along z, well clear of the perimeter. */
function runAlongZ(x: number, from: number, to: number): GridPos[] {
  const cells: GridPos[] = [];
  for (let z = from; z <= to; z++) cells.push({ x, z });
  return cells;
}

describe("cellNoise", () => {
  it("is deterministic for a cell and seed", () => {
    expect(cellNoise({ x: 3, z: 7 }, 11)).toBe(cellNoise({ x: 3, z: 7 }, 11));
  });

  it("does not depend on iteration order or neighbours", () => {
    // The whole point of hashing coordinates: reading cells in a different order
    // must not shift the values, or one new crate re-rolls the entire level.
    const forward = [1, 2, 3, 4].map((x) => cellNoise({ x, z: 5 }, 2));
    const backward = [4, 3, 2, 1].map((x) => cellNoise({ x, z: 5 }, 2)).reverse();
    expect(forward).toEqual(backward);
  });

  it("distinguishes cells that a naive x+z hash would collide", () => {
    expect(cellNoise({ x: 2, z: 6 }, 1)).not.toBe(cellNoise({ x: 6, z: 2 }, 1));
    expect(cellNoise({ x: 1, z: 4 }, 1)).not.toBe(cellNoise({ x: 3, z: 2 }, 1));
  });

  it("stays in the unit interval and varies with the seed", () => {
    const values = [];
    for (let x = 0; x < 40; x++) values.push(cellNoise({ x, z: x * 3 }, 9));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(new Set(values).size).toBeGreaterThan(30);
    expect(cellNoise({ x: 3, z: 7 }, 11)).not.toBe(cellNoise({ x: 3, z: 7 }, 12));
  });
});

describe("blockJitter", () => {
  it("is signed and bounded, so it can raise or drop a block", () => {
    let sawNegative = false;
    let sawPositive = false;
    for (let x = 0; x < 60; x++) {
      const jitter = blockJitter({ x, z: 1 }, 4);
      expect(jitter).toBeGreaterThanOrEqual(-1);
      expect(jitter).toBeLessThan(1);
      if (jitter < 0) sawNegative = true;
      if (jitter > 0) sawPositive = true;
    }
    expect(sawNegative).toBe(true);
    expect(sawPositive).toBe(true);
  });
});

describe("pillarCells", () => {
  const gridSize = 21;

  it("returns only cells that are themselves walls", () => {
    const walls = [...runAlongZ(5, 3, 9), ...runAlongZ(9, 5, 5)];
    const wallKeys = new Set(walls.map(cellKey));
    // Anything returned is already blocked for movement and pathfinding, which
    // is what makes decorating it safe.
    for (const cell of pillarCells(walls, gridSize)) {
      expect(wallKeys.has(cellKey(cell))).toBe(true);
    }
  });

  it("skips the middle of a straight run", () => {
    const walls = runAlongZ(5, 3, 9);
    const middles = pillarCells(walls, gridSize).filter((c) => c.z > 3 && c.z < 9);
    expect(middles).toEqual([]);
  });

  it("marks a corner where two runs turn", () => {
    // An L: down x=5, then east along z=9.
    const walls = [...runAlongZ(5, 3, 9), { x: 6, z: 9 }, { x: 7, z: 9 }];
    const keys = pillarCells(walls, gridSize).map(cellKey);
    expect(keys).toContain(cellKey({ x: 5, z: 9 }));
  });

  it("marks a T-junction", () => {
    const walls = [...runAlongZ(5, 3, 9), { x: 6, z: 6 }];
    const keys = pillarCells(walls, gridSize).map(cellKey);
    expect(keys).toContain(cellKey({ x: 5, z: 6 }));
  });

  it("marks a run that terminates into the outer ring", () => {
    // z = 1 is the first interior row; z = 0 is the outer ring, which is never
    // listed in level.walls but is still stone, crossing this run at a right
    // angle — a T-junction the wall list alone cannot show.
    const walls = runAlongZ(5, 1, 6);
    const keys = pillarCells(walls, gridSize).map(cellKey);
    expect(keys).toContain(cellKey({ x: 5, z: 1 }));
    expect(keys).not.toContain(cellKey({ x: 5, z: 4 }));
  });

  it("does not colonnade a run laid alongside the outer ring", () => {
    // Every cell of this run touches the ring at x = 0, but runs parallel to it
    // rather than into it, so none of them is a corner.
    const walls = [
      { x: 1, z: 3 },
      { x: 1, z: 4 },
      { x: 1, z: 5 },
      { x: 1, z: 6 },
    ];
    const keys = pillarCells(walls, gridSize).map(cellKey);
    expect(keys).not.toContain(cellKey({ x: 1, z: 4 }));
    expect(keys).not.toContain(cellKey({ x: 1, z: 5 }));
  });

  it("handles an empty wall list", () => {
    expect(pillarCells([], gridSize)).toEqual([]);
  });
});

describe("rubbleSpots", () => {
  const gridSize = 21;
  const none = new Set<string>();

  it("is deterministic for a seed", () => {
    expect(rubbleSpots(7, gridSize, none, none)).toEqual(rubbleSpots(7, gridSize, none, none));
    expect(rubbleSpots(7, gridSize, none, none)).not.toEqual(rubbleSpots(8, gridSize, none, none));
  });

  it("never places debris on blocked or reserved cells", () => {
    const blocked = new Set([cellKey({ x: 4, z: 4 }), cellKey({ x: 5, z: 4 })]);
    const reserved = new Set([cellKey({ x: 10, z: 10 })]);
    for (const spot of rubbleSpots(3, gridSize, blocked, reserved, 1)) {
      expect(blocked.has(cellKey(spot.cell))).toBe(false);
      expect(reserved.has(cellKey(spot.cell))).toBe(false);
    }
  });

  it("keeps the placements of untouched cells stable when a crate appears", () => {
    // Rolling per cell regardless of eligibility is what buys this: adding one
    // blocker must not re-scatter the rest of the level.
    const before = rubbleSpots(5, gridSize, none, none);
    const blocked = new Set([cellKey({ x: 6, z: 6 })]);
    const after = rubbleSpots(5, gridSize, blocked, none);
    const survivors = before.filter((spot) => cellKey(spot.cell) !== cellKey({ x: 6, z: 6 }));
    expect(after).toEqual(survivors);
  });

  it("stays inside the walkable interior", () => {
    for (const spot of rubbleSpots(2, gridSize, none, none, 1)) {
      expect(spot.cell.x).toBeGreaterThanOrEqual(1);
      expect(spot.cell.z).toBeGreaterThanOrEqual(1);
      expect(spot.cell.x).toBeLessThanOrEqual(gridSize - 2);
      expect(spot.cell.z).toBeLessThanOrEqual(gridSize - 2);
    }
  });

  it("keeps each piece within its own cell and at a sane size", () => {
    for (const spot of rubbleSpots(11, gridSize, none, none, 1)) {
      expect(Math.abs(spot.offsetX)).toBeLessThan(0.5);
      expect(Math.abs(spot.offsetZ)).toBeLessThan(0.5);
      expect(spot.scale).toBeGreaterThan(0);
      expect(spot.rotation).toBeGreaterThanOrEqual(0);
      expect(spot.rotation).toBeLessThan(Math.PI * 2);
    }
  });

  it("scales with density, and places nothing at zero", () => {
    expect(rubbleSpots(4, gridSize, none, none, 0)).toEqual([]);
    const sparse = rubbleSpots(4, gridSize, none, none, 0.05).length;
    const dense = rubbleSpots(4, gridSize, none, none, 0.5).length;
    expect(dense).toBeGreaterThan(sparse);
  });
});
