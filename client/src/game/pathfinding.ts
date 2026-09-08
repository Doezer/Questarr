import { CARDINAL_DIRS, cellKey, isInterior, type GridPos } from "./grid";

/**
 * A* over the walkable interior grid, cardinal moves only. Diagonal steps are
 * deliberately excluded so a path can never squeeze between two touching crates;
 * the resulting staircase is straightened afterwards by the caller's smoothing
 * pass, which tests real world-space clearance.
 */
export function findPath(
  start: GridPos,
  goal: GridPos,
  gridSize: number,
  blocked: ReadonlySet<string>
): GridPos[] {
  const startKey = cellKey(start);
  const goalKey = cellKey(goal);
  if (startKey === goalKey) return [];
  if (!isInterior(goal, gridSize) || blocked.has(goalKey)) return [];
  // A blocked start would otherwise seed the search and route the caller out of
  // the cell they should never have been standing in.
  if (!isInterior(start, gridSize) || blocked.has(startKey)) return [];

  const heuristic = (pos: GridPos) => Math.abs(pos.x - goal.x) + Math.abs(pos.z - goal.z);

  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, heuristic(start)]]);
  const open = new Map<string, GridPos>([[startKey, start]]);

  while (open.size > 0) {
    const currentKey = cheapestOpenCell(open, fScore);
    if (currentKey === goalKey) return reconstructPath(cameFrom, currentKey);

    const current = open.get(currentKey)!;
    open.delete(currentKey);
    relaxNeighbours(current, currentKey, {
      gridSize,
      blocked,
      heuristic,
      cameFrom,
      gScore,
      fScore,
      open,
    });
  }

  return [];
}

/**
 * The interior is at most a few hundred cells, so scanning the open set for the
 * cheapest node beats the bookkeeping of a real priority queue.
 */
function cheapestOpenCell(
  open: ReadonlyMap<string, GridPos>,
  fScore: ReadonlyMap<string, number>
): string {
  let bestKey = "";
  let bestScore = Infinity;
  for (const key of Array.from(open.keys())) {
    const score = fScore.get(key) ?? Infinity;
    if (score < bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}

interface SearchState {
  gridSize: number;
  blocked: ReadonlySet<string>;
  heuristic: (pos: GridPos) => number;
  cameFrom: Map<string, string>;
  gScore: Map<string, number>;
  fScore: Map<string, number>;
  open: Map<string, GridPos>;
}

/** Offers each walkable cardinal neighbour a cheaper route through `current`. */
function relaxNeighbours(current: GridPos, currentKey: string, state: SearchState) {
  const currentG = state.gScore.get(currentKey) ?? Infinity;
  for (const dir of CARDINAL_DIRS) {
    const next: GridPos = { x: current.x + dir.x, z: current.z + dir.z };
    if (!isInterior(next, state.gridSize)) continue;
    const nextKey = cellKey(next);
    if (state.blocked.has(nextKey)) continue;

    const tentative = currentG + 1;
    if (tentative >= (state.gScore.get(nextKey) ?? Infinity)) continue;

    state.cameFrom.set(nextKey, currentKey);
    state.gScore.set(nextKey, tentative);
    state.fScore.set(nextKey, tentative + state.heuristic(next));
    state.open.set(nextKey, next);
  }
}

/** Walks the came-from chain back to the start, dropping the start cell itself. */
function reconstructPath(cameFrom: Map<string, string>, goalKey: string): GridPos[] {
  const keys: string[] = [goalKey];
  let key = goalKey;
  while (cameFrom.has(key)) {
    key = cameFrom.get(key)!;
    keys.push(key);
  }
  keys.reverse();
  // Drop the start cell: the caller is already standing there.
  return keys.slice(1).map((k) => {
    const [x, z] = k.split(",").map(Number);
    return { x, z };
  });
}

/**
 * Finds the open interior cell closest to `target`, so clicking a crate or a wall
 * still walks the player to the sensible spot beside it. Search expands *through*
 * blocked cells because the target itself is usually one.
 */
export function nearestOpenCell(
  target: GridPos,
  gridSize: number,
  blocked: ReadonlySet<string>
): GridPos | null {
  const clamped: GridPos = {
    x: Math.min(Math.max(target.x, 1), gridSize - 2),
    z: Math.min(Math.max(target.z, 1), gridSize - 2),
  };
  if (!blocked.has(cellKey(clamped))) return clamped;

  const seen = new Set<string>([cellKey(clamped)]);
  const queue: GridPos[] = [clamped];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const dir of CARDINAL_DIRS) {
      const next: GridPos = { x: cur.x + dir.x, z: cur.z + dir.z };
      if (!isInterior(next, gridSize)) continue;
      const key = cellKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!blocked.has(key)) return next;
      queue.push(next);
    }
  }
  return null;
}
