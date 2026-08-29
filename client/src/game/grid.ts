/**
 * Shared grid primitives for the infiltration game. Level generation, pathfinding
 * and the engine all reason about the same integer cell grid, where cells
 * `1..gridSize - 2` are the walkable interior and the outer ring is wall.
 */

export interface GridPos {
  x: number;
  z: number;
}

/** Stable string key for a cell, so cells can live in a Set or Map. */
export function cellKey(pos: GridPos): string {
  return `${pos.x},${pos.z}`;
}

/** Inverse of {@link cellKey}. */
export function parseCellKey(key: string): GridPos {
  const [x, z] = key.split(",").map(Number);
  return { x, z };
}

export const CARDINAL_DIRS: readonly GridPos[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

/** True when the cell is inside the walkable interior (the outer ring is wall). */
export function isInterior(pos: GridPos, gridSize: number): boolean {
  return pos.x >= 1 && pos.z >= 1 && pos.x <= gridSize - 2 && pos.z <= gridSize - 2;
}

/** BFS over open interior cells, returning distance-from-start for every reachable cell. */
export function bfsDistances(
  start: GridPos,
  gridSize: number,
  blocked: ReadonlySet<string>
): Map<string, number> {
  const dist = new Map<string, number>([[cellKey(start), 0]]);
  const queue: GridPos[] = [start];

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const curDist = dist.get(cellKey(cur))!;
    for (const dir of CARDINAL_DIRS) {
      const next: GridPos = { x: cur.x + dir.x, z: cur.z + dir.z };
      if (!isInterior(next, gridSize)) continue;
      const key = cellKey(next);
      if (blocked.has(key) || dist.has(key)) continue;
      dist.set(key, curDist + 1);
      queue.push(next);
    }
  }
  return dist;
}
