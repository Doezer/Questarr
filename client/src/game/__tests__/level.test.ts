import { describe, expect, it } from "vitest";
import { cellKey, type GridPos } from "../grid";
import { findPath } from "../pathfinding";
import { generateLevel, gridToWorld, worldToGrid, type GeneratedLevel } from "../level";

const SEEDS = Array.from({ length: 30 }, (_, i) => i);

/** Cells nothing can walk through: interior walls plus crates. */
function structuralBlocked(level: GeneratedLevel): Set<string> {
  return new Set([...level.walls, ...level.crates].map(cellKey));
}

/** Adds the locked doors, giving the set a player without the keycard faces. */
function blockedWithoutKeycard(level: GeneratedLevel): Set<string> {
  const blocked = structuralBlocked(level);
  for (const door of level.doors) if (door.locked) blocked.add(cellKey(door.pos));
  return blocked;
}

function rectCells(rect: { x: number; z: number; w: number; h: number }): GridPos[] {
  const cells: GridPos[] = [];
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    for (let z = rect.z; z < rect.z + rect.h; z++) cells.push({ x, z });
  }
  return cells;
}

describe("generateLevel", () => {
  it("is deterministic for a given seed, and varies between seeds", () => {
    expect(generateLevel(1234)).toEqual(generateLevel(1234));
    expect(generateLevel(1)).not.toEqual(generateLevel(2));
  });

  it("carves rooms that never overlap each other or the walls between them", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      expect(level.rooms.length).toBeGreaterThan(1);

      const seen = new Set<string>();
      for (const room of level.rooms) {
        for (const cell of rectCells(room)) {
          const key = cellKey(cell);
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      for (const wall of level.walls) expect(seen.has(cellKey(wall))).toBe(false);
    }
  });

  it("keeps every room, door and objective inside the interior", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const max = level.gridSize - 2;
      const inside = (cell: GridPos) =>
        cell.x >= 1 && cell.z >= 1 && cell.x <= max && cell.z <= max;

      for (const room of level.rooms)
        for (const cell of rectCells(room)) expect(inside(cell)).toBe(true);
      for (const door of level.doors) expect(inside(door.pos)).toBe(true);
      expect(inside(level.spawn)).toBe(true);
      expect(inside(level.terminal)).toBe(true);
      if (level.keycard) expect(inside(level.keycard)).toBe(true);
    }
  });

  it("puts each door in a wall line joining exactly two distinct rooms", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const wallKeys = new Set(level.walls.map(cellKey));

      for (const door of level.doors) {
        // The door cell is the gap, so it is not itself a wall.
        expect(wallKeys.has(cellKey(door.pos))).toBe(false);
        expect(door.rooms[0]).not.toBe(door.rooms[1]);
        expect(level.rooms[door.rooms[0]]).toBeDefined();
        expect(level.rooms[door.rooms[1]]).toBeDefined();
      }
    }
  });

  it("never blocks a doorway or an objective with a crate", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const crateKeys = new Set(level.crates.map(cellKey));

      for (const door of level.doors) expect(crateKeys.has(cellKey(door.pos))).toBe(false);
      expect(crateKeys.has(cellKey(level.spawn))).toBe(false);
      expect(crateKeys.has(cellKey(level.terminal))).toBe(false);
      if (level.keycard) expect(crateKeys.has(cellKey(level.keycard))).toBe(false);
    }
  });

  it("locks exactly one door, on the route to the terminal", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const locked = level.doors.filter((door) => door.locked);
      expect(locked).toHaveLength(1);

      // With the keycard the terminal is reachable; without it, it is not.
      expect(
        findPath(level.spawn, level.terminal, level.gridSize, structuralBlocked(level)).length
      ).toBeGreaterThan(0);
      expect(
        findPath(level.spawn, level.terminal, level.gridSize, blockedWithoutKeycard(level))
      ).toEqual([]);
    }
  });

  it("always leaves the keycard reachable before the lock is reached", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      expect(level.keycard).not.toBeNull();
      expect(level.keycard).not.toEqual(level.spawn);
      expect(
        findPath(level.spawn, level.keycard!, level.gridSize, blockedWithoutKeycard(level)).length
      ).toBeGreaterThan(0);
    }
  });

  it("never lets a crate layout strand the keycard or the terminal", () => {
    // At this density the first roll frequently strands an objective, so both
    // the reroll and its no-crates fallback are exercised across these seeds.
    for (const seed of SEEDS) {
      const level = generateLevel(seed, { crateDensity: 0.3 });
      expect(
        findPath(level.spawn, level.keycard!, level.gridSize, blockedWithoutKeycard(level)).length
      ).toBeGreaterThan(0);
      expect(
        findPath(level.spawn, level.terminal, level.gridSize, structuralBlocked(level)).length
      ).toBeGreaterThan(0);
    }
  });

  it("gives every guard a patrol on open cells away from the entrance room", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const blocked = structuralBlocked(level);
      const spawnRoom = level.rooms.findIndex(
        (room) =>
          level.spawn.x >= room.x &&
          level.spawn.x < room.x + room.w &&
          level.spawn.z >= room.z &&
          level.spawn.z < room.z + room.h
      );

      expect(level.guards.length).toBeGreaterThan(0);
      for (const guard of level.guards) {
        expect(guard.waypoints.length).toBeGreaterThan(0);
        for (const waypoint of guard.waypoints) {
          expect(blocked.has(cellKey(waypoint))).toBe(false);
          const room = level.rooms.findIndex(
            (r) =>
              waypoint.x >= r.x &&
              waypoint.x < r.x + r.w &&
              waypoint.z >= r.z &&
              waypoint.z < r.z + r.h
          );
          expect(room).not.toBe(spawnRoom);
        }
      }
    }
  });

  it("falls back to a single unlocked room when the grid is too small to split", () => {
    const level = generateLevel(1, { gridSize: 7 });
    expect(level.rooms).toHaveLength(1);
    expect(level.doors).toHaveLength(0);
    expect(level.walls).toHaveLength(0);
    expect(level.keycard).toBeNull();
  });
});

describe("gridToWorld / worldToGrid", () => {
  it("centers the facility on the world origin", () => {
    const level = generateLevel(1);
    const centre = gridToWorld({ x: (level.gridSize - 1) / 2, z: (level.gridSize - 1) / 2 }, level);
    expect(centre.x).toBeCloseTo(0);
    expect(centre.z).toBeCloseTo(0);
  });

  it("round-trips a cell through world space", () => {
    const level = generateLevel(7);
    for (const cell of [
      { x: 1, z: 1 },
      { x: 5, z: 12 },
      { x: level.gridSize - 2, z: level.gridSize - 2 },
    ]) {
      const world = gridToWorld(cell, level);
      expect(worldToGrid(world.x, world.z, level)).toEqual(cell);
    }
  });
});
