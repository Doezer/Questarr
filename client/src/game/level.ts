import { mulberry32 } from "./rng";

export interface GridPos {
  x: number;
  z: number;
}

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

function cellKey(pos: GridPos): string {
  return `${pos.x},${pos.z}`;
}

/** BFS over open (non-crate) interior cells, returns distance-from-start for every reachable cell. */
function reachableFrom(
  start: GridPos,
  gridSize: number,
  blocked: Set<string>
): Map<string, number> {
  const dist = new Map<string, number>([[cellKey(start), 0]]);
  const queue: GridPos[] = [start];
  const dirs: GridPos[] = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ];

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curDist = dist.get(cellKey(cur))!;
    for (const dir of dirs) {
      const next: GridPos = { x: cur.x + dir.x, z: cur.z + dir.z };
      if (next.x < 1 || next.z < 1 || next.x > gridSize - 2 || next.z > gridSize - 2) continue;
      const key = cellKey(next);
      if (blocked.has(key) || dist.has(key)) continue;
      dist.set(key, curDist + 1);
      queue.push(next);
    }
  }
  return dist;
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
  const interiorCells = (config.gridSize - 2) * (config.gridSize - 2);

  let crates: GridPos[] = [];
  let reachable = new Map<string, number>();
  const maxAttempts = 25;

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
    reachable = reachableFrom(spawn, config.gridSize, blocked);
    const openCells = interiorCells - crates.length;
    if (reachable.size >= openCells * 0.6) break;
  }

  let terminal = spawn;
  let bestDist = -1;
  for (const [key, dist] of Array.from(reachable)) {
    if (dist > bestDist) {
      bestDist = dist;
      const [x, z] = key.split(",").map(Number);
      terminal = { x, z };
    }
  }

  const reachableCells = Array.from(reachable.keys()).map((key) => {
    const [x, z] = key.split(",").map(Number);
    return { x, z };
  });

  const guards: { waypoints: GridPos[] }[] = [];
  for (let g = 0; g < config.guardCount; g++) {
    const waypoints: GridPos[] = [];
    for (let i = 0; i < config.waypointsPerGuard; i++) {
      waypoints.push(reachableCells[Math.floor(rand() * reachableCells.length)]);
    }
    guards.push({ waypoints });
  }

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
