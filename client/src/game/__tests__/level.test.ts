import { describe, expect, it } from "vitest";
import { cellKey, isInterior, type GridPos } from "../grid";
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

/** True when the cell falls inside the rectangle's floor area. */
function containsCell(rect: { x: number; z: number; w: number; h: number }, cell: GridPos) {
  return (
    cell.x >= rect.x && cell.x < rect.x + rect.w && cell.z >= rect.z && cell.z < rect.z + rect.h
  );
}

/** Cells of the facility's perimeter ring that are not walled: the way in. */
function perimeterHoles(level: GeneratedLevel): string[] {
  const walls = new Set(level.walls.map(cellKey));
  const { facility } = level;
  const interior = {
    x: facility.x + 1,
    z: facility.z + 1,
    w: facility.w - 2,
    h: facility.h - 2,
  };
  return rectCells(facility)
    .filter((cell) => !containsCell(interior, cell))
    .map(cellKey)
    .filter((key) => !walls.has(key));
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

  it("leaves no interior cell that is neither floor, wall, door nor open ground", () => {
    // Every cell of the grid has to be *something* the engine builds: room floor
    // and the apron are walked on, walls and the shut gate are collided with. A
    // cell that is none of them is a hole with no collider and nothing drawn.
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const floor = new Set(level.rooms.flatMap(rectCells).map(cellKey));
      const walls = new Set(level.walls.map(cellKey));
      const doors = new Set(level.doors.map((door) => cellKey(door.pos)));
      const apron = new Set(rectCells(level.apron).map(cellKey));

      for (let x = 1; x <= level.gridSize - 2; x++) {
        for (let z = 1; z <= level.gridSize - 2; z++) {
          const cell = { x, z };
          if (!isInterior(cell, level.gridSize)) continue;
          const key = cellKey(cell);
          const accounted =
            floor.has(key) ||
            walls.has(key) ||
            doors.has(key) ||
            apron.has(key) ||
            key === cellKey(level.gate.pos);
          expect(accounted).toBe(true);
        }
      }
    }
  });

  it("gives each guard distinct patrol waypoints", () => {
    // Repeated waypoints leave a guard with a zero-length route: it never moves
    // and its cone never sweeps, so it stops being an obstacle.
    for (const seed of SEEDS) {
      for (const guard of generateLevel(seed).guards) {
        const unique = new Set(guard.waypoints.map(cellKey));
        expect(unique.size).toBe(guard.waypoints.length);
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
      const spawnRoom = level.rooms.findIndex((room) => containsCell(room, level.spawn));

      expect(level.guards.length).toBeGreaterThan(0);
      for (const guard of level.guards) {
        expect(guard.waypoints.length).toBeGreaterThan(0);
        for (const waypoint of guard.waypoints) {
          expect(blocked.has(cellKey(waypoint))).toBe(false);
          const room = level.rooms.findIndex((r) => containsCell(r, waypoint));
          // findIndex returns -1 for a waypoint in no room at all, and -1 is not
          // spawnRoom either — so without this the assertion below would pass a
          // waypoint that had escaped the facility entirely.
          expect(room).toBeGreaterThanOrEqual(0);
          expect(room).not.toBe(spawnRoom);
        }
      }
    }
  });

  it("falls back to a single unlocked room when the grid is too small to split", () => {
    const level = generateLevel(1, { gridSize: 7 });
    expect(level.rooms).toHaveLength(1);
    expect(level.doors).toHaveLength(0);
    expect(level.keycard).toBeNull();
    // The facility always has its own perimeter, however small it gets, so the
    // one thing that can never be empty here is the wall list.
    expect(level.walls.length).toBeGreaterThan(0);
    expect(perimeterHoles(level)).toEqual([cellKey(level.gate.pos)]);
  });
});

describe("the gate", () => {
  it("starts the player outside, on the apron", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      expect(containsCell(level.apron, level.spawn)).toBe(true);
      expect(containsCell(level.facility, level.spawn)).toBe(false);
      // Nothing is placed on the approach, so the opening walk is never blocked.
      const blocked = structuralBlocked(level);
      for (const cell of rectCells(level.apron)) {
        expect(blocked.has(cellKey(cell))).toBe(false);
      }
    }
  });

  it("is the only opening in the facility's perimeter", () => {
    // This is what makes the approach mean anything: with any second hole the
    // player could walk around the gate and the whole entrance is decoration.
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      expect(perimeterHoles(level)).toEqual([cellKey(level.gate.pos)]);
    }
  });

  it("opens from the apron into the room it names", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const { gate } = level;
      const blocked = structuralBlocked(level);
      expect(blocked.has(cellKey(gate.pos))).toBe(false);

      // The cell outside is apron, and the cell opposite it is the room floor
      // the gate leads onto — so the gate is genuinely a threshold, not a slot
      // punched into a corner or against the end of an interior partition.
      expect(containsCell(level.apron, gate.outside)).toBe(true);
      const inner = {
        x: gate.pos.x * 2 - gate.outside.x,
        z: gate.pos.z * 2 - gate.outside.z,
      };
      expect(containsCell(level.rooms[gate.room], inner)).toBe(true);
      expect(blocked.has(cellKey(inner))).toBe(false);

      // `spansX` says which way the leaf faces; the player always crosses the
      // gate on the other axis.
      expect(gate.spansX).toBe(gate.outside.x === gate.pos.x);
    }
  });

  it("is the only route in, so sealing it strands the terminal", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      const sealed = structuralBlocked(level);
      sealed.add(cellKey(level.gate.pos));
      expect(findPath(level.spawn, level.terminal, level.gridSize, sealed)).toEqual([]);
      // And with it open the run is walkable end to end, keycard included.
      expect(
        findPath(level.spawn, level.terminal, level.gridSize, structuralBlocked(level)).length
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the apron and the facility from overlapping", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      for (const cell of rectCells(level.apron)) {
        expect(containsCell(level.facility, cell)).toBe(false);
        expect(isInterior(cell, level.gridSize)).toBe(true);
      }
      for (const cell of rectCells(level.facility)) {
        expect(isInterior(cell, level.gridSize)).toBe(true);
      }
    }
  });

  it("puts no patrol out on the approach", () => {
    for (const seed of SEEDS) {
      const level = generateLevel(seed);
      for (const guard of level.guards) {
        for (const waypoint of guard.waypoints) {
          expect(containsCell(level.apron, waypoint)).toBe(false);
        }
      }
    }
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
