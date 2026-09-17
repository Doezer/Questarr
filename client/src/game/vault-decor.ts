/**
 * Where the vault's decorative geometry goes.
 *
 * Pillars, rubble and the per-block height jitter that stops the masonry looking
 * extruded are all *placement* decisions over the level grid, and placement is
 * exactly the part that can go wrong: a pillar off a wall cell would be a
 * collider-less obstacle, and rubble on the terminal would bury an objective.
 * So the choices live here as pure functions over cells, testable without a
 * WebGL context, and the engine only turns their output into meshes.
 */

import { CARDINAL_DIRS, cellKey, isInterior, type GridPos } from "./grid";
import { mulberry32 } from "./rng";

/**
 * Deterministic value in [0, 1) for a cell, independent of iteration order.
 *
 * Seeding a single stream and pulling per cell would make every value depend on
 * how many cells came before it, so a wall block's height would change when an
 * unrelated block appeared. Hashing the coordinates instead pins each cell's
 * jitter to the cell itself.
 */
export function cellNoise(cell: GridPos, seed: number): number {
  // Two odd multipliers keep x and z from aliasing onto each other along the
  // diagonal, where a naive x + z would give every anti-diagonal one value.
  const hash = (cell.x * 73856093) ^ (cell.z * 19349663) ^ (seed * 83492791);
  return mulberry32(hash >>> 0)();
}

/**
 * Signed jitter for one masonry block, in [-1, 1].
 *
 * Scaled by the engine into a height and inset wobble so no two blocks in a run
 * top out at exactly the same line — the single cheapest thing that separates
 * "stone laid by hand" from "one box repeated".
 */
export function blockJitter(cell: GridPos, seed: number): number {
  return cellNoise(cell, seed) * 2 - 1;
}

/**
 * Wall cells that should carry a pillar: corners, T- and X-junctions, and the
 * ends where an interior run meets the outer ring.
 *
 * Every returned cell is one of `walls`, which matters: those cells are already
 * blocked for movement and pathfinding, so decorating them cannot change what
 * the level plays like. A straight run gets nothing — a pillar every few metres
 * along a flat wall reads as wallpaper rather than structure.
 */
export function pillarCells(walls: readonly GridPos[], gridSize: number): GridPos[] {
  const wallSet = new Set(walls.map(cellKey));
  // Junctions are read from the *listed* interior walls only. Folding the
  // implicit outer ring in here would make every cell of a run laid alongside it
  // look like a T, turning that whole run into a colonnade; the ring is handled
  // separately below, where its direction can be taken into account.
  const isWall = (cell: GridPos) => wallSet.has(cellKey(cell));
  const offRing = (cell: GridPos) => !isInterior(cell, gridSize);

  return walls.filter((cell) => {
    const [east, west, south, north] = CARDINAL_DIRS.map((dir) =>
      isWall({ x: cell.x + dir.x, z: cell.z + dir.z })
    );
    const count = [east, west, south, north].filter(Boolean).length;
    // 3 or 4 is a junction. Exactly 2 is a corner only when they turn — two
    // opposite neighbours is the middle of a straight run, which gets nothing.
    if (count >= 3) return true;
    if (count === 2 && !(east && west) && !(north && south)) return true;

    // A run that terminates *into* the outer ring meets stone crossing it at a
    // right angle, so it is a T-junction the wall list alone cannot show. It has
    // to run into the ring rather than merely alongside it, which is why the
    // run's own axis is compared against the axis the ring lies on.
    const runsOnX = east || west;
    const runsOnZ = north || south;
    const meetsRingOnX =
      offRing({ x: cell.x + 1, z: cell.z }) || offRing({ x: cell.x - 1, z: cell.z });
    const meetsRingOnZ =
      offRing({ x: cell.x, z: cell.z + 1 }) || offRing({ x: cell.x, z: cell.z - 1 });
    return (runsOnX && meetsRingOnX) || (runsOnZ && meetsRingOnZ);
  });
}

/** One piece of floor debris: which cell, and how it sits within it. */
export interface RubbleSpot {
  cell: GridPos;
  /** Offset from the cell centre, in fractions of a cell, each in (-0.5, 0.5). */
  offsetX: number;
  offsetZ: number;
  /** Scale multiplier on the base debris size. */
  scale: number;
  /** Y rotation in radians. */
  rotation: number;
}

/** Fraction of eligible floor cells that get debris. */
const RUBBLE_DENSITY = 0.12;
/** How far from the cell centre a piece may sit, so it never straddles a joint. */
const RUBBLE_SPREAD = 0.34;

/**
 * Scatters debris across open floor.
 *
 * Skips `blocked` (walls and crates, where it would float inside geometry) and
 * `reserved` (spawn, terminal, keycard and doors, where it would sit under
 * something the player has to read). The pieces are shorter than the player's
 * step and carry no collider, so this is purely something to look at.
 */
export function rubbleSpots(
  seed: number,
  gridSize: number,
  blocked: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
  density: number = RUBBLE_DENSITY
): RubbleSpot[] {
  const random = mulberry32(seed ^ 0x5ec0de);
  const spots: RubbleSpot[] = [];

  // Iterated in a fixed order rather than over a Set, so one seed always lays
  // the same debris down in the same places.
  for (let z = 1; z <= gridSize - 2; z++) {
    for (let x = 1; x <= gridSize - 2; x++) {
      const key = cellKey({ x, z });
      // Rolled for every cell, skipped afterwards: drawing only for eligible
      // cells would shift the stream and re-scatter the whole level whenever a
      // crate moved.
      const roll = random();
      const offsetX = (random() - 0.5) * 2 * RUBBLE_SPREAD;
      const offsetZ = (random() - 0.5) * 2 * RUBBLE_SPREAD;
      const scale = 0.6 + random() * 0.8;
      const rotation = random() * Math.PI * 2;
      if (roll >= density || blocked.has(key) || reserved.has(key)) continue;
      spots.push({ cell: { x, z }, offsetX, offsetZ, scale, rotation });
    }
  }
  return spots;
}
