import { mulberry32 } from "./rng";
import { bfsDistances, cellKey, type GridPos } from "./grid";

export type { GridPos } from "./grid";

export interface LevelConfig {
  gridSize: number;
  cellSize: number;
  crateDensity: number;
  guardCount: number;
  waypointsPerGuard: number;
}

export interface GeneratedLevel {
  gridSize: number;
  cellSize: number;
  crates: GridPos[];
  spawn: GridPos;
  terminal: GridPos;
  guards: { waypoints: GridPos[] }[];
}

export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  gridSize: 13,
  cellSize: 3,
  crateDensity: 0.16,
  guardCount: 2,
  waypointsPerGuard: 3,
};

// Waypoints stay a few cells (by walkable BFS distance) from spawn so a guard
// can't be patrolling right on top of the player when they spawn or respawn.
const MIN_WAYPOINT_DISTANCE_FROM_SPAWN = 3;

/**
 * Scatters crates over the interior, retrying with a fresh layout if too much
 * of the room would end up unreachable from spawn.
 */
function placeCrates(
  config: LevelConfig,
  spawn: GridPos,
  rand: () => number
): { crates: GridPos[]; reachable: Map<string, number> } {
  const interiorCells = (config.gridSize - 2) * (config.gridSize - 2);
  const maxAttempts = 25;

  let crates: GridPos[] = [];
  let reachable = new Map<string, number>();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    crates = [];
    const blocked = new Set<string>();
    for (let x = 1; x <= config.gridSize - 2; x++) {
      for (let z = 1; z <= config.gridSize - 2; z++) {
        if (x <= 2 && z <= 2) continue; // keep the spawn corner clear
        if (rand() < config.crateDensity) {
          crates.push({ x, z });
          blocked.add(cellKey({ x, z }));
        }
      }
    }
    reachable = bfsDistances(spawn, config.gridSize, blocked);
    const openCells = interiorCells - crates.length;
    if (reachable.size >= openCells * 0.6) break;
  }

  return { crates, reachable };
}

/** Picks the reachable cell with the greatest walkable distance from spawn. */
function pickTerminal(reachable: Map<string, number>, spawn: GridPos): GridPos {
  let terminal = spawn;
  let bestDist = -1;
  for (const [key, dist] of Array.from(reachable)) {
    if (dist > bestDist) {
      bestDist = dist;
      const [x, z] = key.split(",").map(Number);
      terminal = { x, z };
    }
  }
  return terminal;
}

/**
 * Reachable cells far enough from spawn to patrol, falling back to any other
 * reachable cell, and only ever including spawn itself if it's the sole
 * reachable cell (e.g. a degenerately small overridden grid size).
 */
function pickWaypointPool(reachable: Map<string, number>, spawn: GridPos): GridPos[] {
  const spawnKey = cellKey(spawn);
  const reachableCells: GridPos[] = [];
  const waypointCandidates: GridPos[] = [];
  for (const [key, dist] of Array.from(reachable)) {
    if (key === spawnKey) continue;
    const [x, z] = key.split(",").map(Number);
    const cell = { x, z };
    reachableCells.push(cell);
    if (dist > MIN_WAYPOINT_DISTANCE_FROM_SPAWN) waypointCandidates.push(cell);
  }
  if (waypointCandidates.length > 0) return waypointCandidates;
  if (reachableCells.length > 0) return reachableCells;
  return [spawn];
}

function assignGuardWaypoints(
  config: LevelConfig,
  waypointPool: GridPos[],
  rand: () => number
): { waypoints: GridPos[] }[] {
  const guards: { waypoints: GridPos[] }[] = [];
  for (let g = 0; g < config.guardCount; g++) {
    const waypoints: GridPos[] = [];
    for (let i = 0; i < config.waypointsPerGuard; i++) {
      waypoints.push(waypointPool[Math.floor(rand() * waypointPool.length)]);
    }
    guards.push({ waypoints });
  }
  return guards;
}

/**
 * Generates a stealth-level layout from a numeric seed: crate placement, a
 * spawn point, a terminal placed at the far end of the reachable area, and
 * patrol waypoints for each guard. Retries crate placement if it would wall
 * off too much of the room, so the terminal is always reachable.
 */
export function generateLevel(seed: number, overrides: Partial<LevelConfig> = {}): GeneratedLevel {
  const config = { ...DEFAULT_LEVEL_CONFIG, ...overrides };
  const rand = mulberry32(seed);
  const spawn: GridPos = { x: 1, z: 1 };

  const { crates, reachable } = placeCrates(config, spawn, rand);
  const terminal = pickTerminal(reachable, spawn);
  const waypointPool = pickWaypointPool(reachable, spawn);
  const guards = assignGuardWaypoints(config, waypointPool, rand);

  return {
    gridSize: config.gridSize,
    cellSize: config.cellSize,
    crates,
    spawn,
    terminal,
    guards,
  };
}

/** Converts a grid cell to world-space XZ coordinates, centered on the room. */
export function gridToWorld(pos: GridPos, level: Pick<GeneratedLevel, "gridSize" | "cellSize">) {
  const offset = (level.gridSize - 1) / 2;
  return {
    x: (pos.x - offset) * level.cellSize,
    z: (pos.z - offset) * level.cellSize,
  };
}

/** Inverse of {@link gridToWorld}: snaps a world-space XZ point to its grid cell. */
export function worldToGrid(
  x: number,
  z: number,
  level: Pick<GeneratedLevel, "gridSize" | "cellSize">
): GridPos {
  const offset = (level.gridSize - 1) / 2;
  return {
    x: Math.round(x / level.cellSize + offset),
    z: Math.round(z / level.cellSize + offset),
  };
}
