import { mulberry32 } from "./rng";
import { bfsDistances, cellKey, type GridPos } from "./grid";

export type { GridPos } from "./grid";

/** A room's floor area in grid cells; `x`/`z` are its lowest cell, inclusive. */
export interface Rect {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** A gap in an interior wall, joining the two rooms either side of it. */
export interface DoorDef {
  pos: GridPos;
  locked: boolean;
  /** Indices into {@link GeneratedLevel.rooms}. */
  rooms: [number, number];
}

/** Knobs the generator reads; {@link DEFAULT_LEVEL_CONFIG} supplies every default. */
export interface LevelConfig {
  gridSize: number;
  cellSize: number;
  roomCount: number;
  crateDensity: number;
  guardCount: number;
  waypointsPerGuard: number;
}

/** One fully generated facility: its geometry, its objectives and its patrols. */
export interface GeneratedLevel {
  gridSize: number;
  cellSize: number;
  rooms: Rect[];
  /** Interior wall cells. The outer ring is implicit and not listed here. */
  walls: GridPos[];
  doors: DoorDef[];
  crates: GridPos[];
  spawn: GridPos;
  terminal: GridPos;
  /** Null when the layout has no locked door, so no keycard is needed. */
  keycard: GridPos | null;
  guards: { waypoints: GridPos[] }[];
}

export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  gridSize: 21,
  cellSize: 3,
  roomCount: 5,
  crateDensity: 0.1,
  guardCount: 3,
  waypointsPerGuard: 3,
};

/** Smallest floor span a room may have on either axis. */
const MIN_ROOM_SPAN = 4;
/** Doors are kept off a wall's ends so they never open into a corner. */
const DOOR_EDGE_MARGIN = 1;

/** One BSP cut: the wall line it lays down, its single door, and the halves either side. */
interface Split {
  wall: GridPos[];
  door: GridPos;
  a: Rect;
  b: Rect;
}

/** Cell equality, for filtering a door back out of the wall line it sits in. */
function sameCell(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.z === b.z;
}

/** True when the cell falls inside the rectangle's floor area. */
function rectContains(rect: Rect, cell: GridPos): boolean {
  return (
    cell.x >= rect.x && cell.x < rect.x + rect.w && cell.z >= rect.z && cell.z < rect.z + rect.h
  );
}

/** Every cell in a rectangle, in column-major order. */
function rectCells(rect: Rect): GridPos[] {
  const cells: GridPos[] = [];
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    for (let z = rect.z; z < rect.z + rect.h; z++) cells.push({ x, z });
  }
  return cells;
}

/**
 * Cuts a rectangle in two along its longer axis, reserving one cell line for the
 * dividing wall and punching a single door through it. Returns null when neither
 * axis has room for two rooms plus that wall.
 */
function splitRect(rect: Rect, rand: () => number): Split | null {
  const canSplitZ = rect.h >= MIN_ROOM_SPAN * 2 + 1;
  const canSplitX = rect.w >= MIN_ROOM_SPAN * 2 + 1;
  if (!canSplitZ && !canSplitX) return null;
  // Halve the longer side by preference, so rooms stay roughly square.
  const splitAlongZ = canSplitZ && (!canSplitX || rect.h >= rect.w);

  const span = splitAlongZ ? rect.h : rect.w;
  const origin = splitAlongZ ? rect.z : rect.x;
  const wallLine = origin + MIN_ROOM_SPAN + Math.floor(rand() * (span - MIN_ROOM_SPAN * 2));

  const crossStart = splitAlongZ ? rect.x : rect.z;
  const crossSpan = splitAlongZ ? rect.w : rect.h;
  const wall: GridPos[] = [];
  for (let i = 0; i < crossSpan; i++) {
    const c = crossStart + i;
    wall.push(splitAlongZ ? { x: c, z: wallLine } : { x: wallLine, z: c });
  }

  // Keep the door off the wall's ends so there is floor either side of it.
  const doorRange = Math.max(1, crossSpan - DOOR_EDGE_MARGIN * 2);
  const doorOffset = Math.min(crossSpan - 1, DOOR_EDGE_MARGIN + Math.floor(rand() * doorRange));
  const door = wall[doorOffset];

  const a: Rect = splitAlongZ
    ? { x: rect.x, z: rect.z, w: rect.w, h: wallLine - rect.z }
    : { x: rect.x, z: rect.z, w: wallLine - rect.x, h: rect.h };
  const b: Rect = splitAlongZ
    ? { x: rect.x, z: wallLine + 1, w: rect.w, h: rect.z + rect.h - wallLine - 1 }
    : { x: wallLine + 1, z: rect.z, w: rect.x + rect.w - wallLine - 1, h: rect.h };

  return { wall, door, a, b };
}

/** The two room indices a door connects, found from the cells either side of it. */
function roomsBesideDoor(rooms: Rect[], door: GridPos): [number, number] | null {
  const neighbours: GridPos[] = [
    { x: door.x + 1, z: door.z },
    { x: door.x - 1, z: door.z },
    { x: door.x, z: door.z + 1 },
    { x: door.x, z: door.z - 1 },
  ];
  const found: number[] = [];
  for (const cell of neighbours) {
    const index = rooms.findIndex((room) => rectContains(room, cell));
    if (index >= 0 && !found.includes(index)) found.push(index);
  }
  return found.length === 2 ? [found[0], found[1]] : null;
}

/**
 * Binary-space partitions the interior into rooms. Each split contributes one
 * wall and exactly one door, so the room graph comes out a tree: always
 * connected, and with every door a bridge between the halves it joins.
 */
function partitionRooms(interior: Rect, roomCount: number, rand: () => number) {
  let rooms: Rect[] = [interior];
  const splits: Split[] = [];

  while (rooms.length < roomCount) {
    // Split the roomiest leaf first, which keeps room sizes even.
    let best = -1;
    let bestArea = 0;
    for (let i = 0; i < rooms.length; i++) {
      const area = rooms[i].w * rooms[i].h;
      if (area > bestArea) {
        bestArea = area;
        best = i;
      }
    }
    const split = best < 0 ? null : splitRect(rooms[best], rand);
    if (!split) break;
    rooms = [...rooms.slice(0, best), split.a, split.b, ...rooms.slice(best + 1)];
    splits.push(split);
  }

  const doors: DoorDef[] = [];
  const orphans: GridPos[] = [];
  for (const split of splits) {
    const joined = roomsBesideDoor(rooms, split.door);
    if (joined) doors.push({ pos: split.door, locked: false, rooms: joined });
    // A later perpendicular split can wall off the cell beside an earlier door,
    // leaving that door joining fewer than two rooms. Its cell was already
    // removed from its own wall line, so without sealing it here it becomes a
    // gap that is neither floor, wall nor door — and so gets no collider at all.
    else orphans.push(split.door);
  }

  const cut = splits.flatMap((split) => split.wall.filter((cell) => !sameCell(cell, split.door)));
  const seen = new Set<string>();
  const walls = [...cut, ...orphans].filter((cell) => {
    const key = cellKey(cell);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { rooms, walls, doors };
}

/** Breadth-first hop counts over the room graph, optionally ignoring one door. */
function roomHops(
  rooms: Rect[],
  doors: DoorDef[],
  start: number,
  skipDoor: DoorDef | null = null
): { hops: number[]; via: (DoorDef | null)[] } {
  const hops = rooms.map(() => Infinity);
  const via: (DoorDef | null)[] = rooms.map(() => null);
  hops[start] = 0;
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const room = queue[head++];
    for (const door of doors) {
      if (door === skipDoor || !door.rooms.includes(room)) continue;
      const next = door.rooms[0] === room ? door.rooms[1] : door.rooms[0];
      if (hops[next] !== Infinity) continue;
      hops[next] = hops[room] + 1;
      via[next] = door;
      queue.push(next);
    }
  }
  return { hops, via };
}

/** Walks the `via` chain back from a room, giving the doors along the route. */
function doorsOnRoute(via: (DoorDef | null)[], from: number, to: number): DoorDef[] {
  const route: DoorDef[] = [];
  let room = to;
  while (room !== from) {
    const door = via[room];
    if (!door) break;
    route.push(door);
    room = door.rooms[0] === room ? door.rooms[1] : door.rooms[0];
  }
  return route;
}

/** Furthest open cell in a room from a reference point, by grid distance. */
function farthestCellIn(room: Rect, from: GridPos, blocked: ReadonlySet<string>): GridPos {
  let best = { x: room.x, z: room.z };
  let bestDist = -1;
  for (const cell of rectCells(room)) {
    if (blocked.has(cellKey(cell))) continue;
    const dist = Math.abs(cell.x - from.x) + Math.abs(cell.z - from.z);
    if (dist > bestDist) {
      bestDist = dist;
      best = cell;
    }
  }
  return best;
}

/**
 * Places the keycard on the spawn side of the locked door, in the room furthest
 * from the entrance, so it is always collectable before the lock is reached.
 */
function pickKeycardCell(
  rooms: Rect[],
  doors: DoorDef[],
  lockedDoor: DoorDef,
  spawnRoom: number,
  spawn: GridPos,
  blocked: ReadonlySet<string>
): GridPos {
  const { hops } = roomHops(rooms, doors, spawnRoom, lockedDoor);
  let target = spawnRoom;
  let bestHops = -1;
  for (let index = 0; index < rooms.length; index++) {
    if (hops[index] !== Infinity && hops[index] > bestHops) {
      bestHops = hops[index];
      target = index;
    }
  }
  return farthestCellIn(rooms[target], spawn, blocked);
}

/** Cells a door needs kept clear, so crates can never seal a doorway. */
function doorApproaches(doors: DoorDef[]): GridPos[] {
  return doors.flatMap((door) => [
    door.pos,
    { x: door.pos.x + 1, z: door.pos.z },
    { x: door.pos.x - 1, z: door.pos.z },
    { x: door.pos.x, z: door.pos.z + 1 },
    { x: door.pos.x, z: door.pos.z - 1 },
  ]);
}

/** The cells a layout must keep connected, and the lock that gates the last one. */
interface CrateConstraints {
  spawn: GridPos;
  terminal: GridPos;
  keycard: GridPos | null;
  lockedDoor: DoorDef | null;
}

/**
 * True when crates would cut the player off from an objective.
 *
 * The two legs are checked under the lock state the player actually faces on
 * each: the keycard has to be collectable while the locked door is still shut,
 * and the terminal has to be reachable once it is open. An aggregate "most of
 * the floor is still reachable" test would pass layouts that strand exactly the
 * one cell the run depends on.
 */
function strandsObjective(
  blocked: ReadonlySet<string>,
  gridSize: number,
  constraints: CrateConstraints
): boolean {
  const { spawn, terminal, keycard, lockedDoor } = constraints;
  if (keycard && lockedDoor) {
    const locked = new Set(blocked);
    locked.add(cellKey(lockedDoor.pos));
    if (!bfsDistances(spawn, gridSize, locked).has(cellKey(keycard))) return true;
  }
  return !bfsDistances(spawn, gridSize, blocked).has(cellKey(terminal));
}

/** Rolls one crate layout, skipping reserved and already-blocked cells. */
function rollCrates(
  rooms: Rect[],
  reserved: ReadonlySet<string>,
  structural: ReadonlySet<string>,
  density: number,
  rand: () => number
): GridPos[] {
  const crates: GridPos[] = [];
  const taken = new Set(structural);
  for (const room of rooms) {
    for (const cell of rectCells(room)) {
      const key = cellKey(cell);
      if (reserved.has(key) || taken.has(key)) continue;
      if (rand() < density) {
        crates.push(cell);
        taken.add(key);
      }
    }
  }
  return crates;
}

/**
 * Scatters crates inside rooms for cover, keeping doorways and objective cells
 * clear. A layout that strands an objective is rerolled; if no roll in 25 tries
 * is sound, the level ships with no crates at all — a plain facility beats an
 * unwinnable one.
 */
function placeCrates(
  rooms: Rect[],
  reserved: ReadonlySet<string>,
  structural: ReadonlySet<string>,
  constraints: CrateConstraints,
  gridSize: number,
  density: number,
  rand: () => number
): GridPos[] {
  for (let attempt = 0; attempt < 25; attempt++) {
    const crates = rollCrates(rooms, reserved, structural, density, rand);
    const blocked = new Set([...structural, ...crates.map(cellKey)]);
    if (!strandsObjective(blocked, gridSize, constraints)) return crates;
  }
  return [];
}

/**
 * Gives each guard a patrol loop inside a single room, so patrols read as "this
 * guard works this room" rather than wandering the whole facility.
 */
function assignGuardWaypoints(
  rooms: Rect[],
  patrolRooms: number[],
  config: LevelConfig,
  blocked: ReadonlySet<string>,
  rand: () => number
): { waypoints: GridPos[] }[] {
  const guards: { waypoints: GridPos[] }[] = [];
  for (let g = 0; g < config.guardCount; g++) {
    const room = rooms[patrolRooms[g % patrolRooms.length]];
    const open = rectCells(room).filter((cell) => !blocked.has(cellKey(cell)));
    if (open.length === 0) continue;
    // Sampled without replacement: drawing the same cell twice would give this
    // guard a zero-length route, so it would stand still and its cone would
    // never sweep — a patrol that is no obstacle at all.
    const pool = [...open];
    const waypoints: GridPos[] = [];
    for (let i = 0; i < config.waypointsPerGuard && pool.length > 0; i++) {
      waypoints.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    guards.push({ waypoints });
  }
  return guards;
}

/**
 * Generates a facility from a numeric seed: BSP rooms joined by doors, the door
 * into the terminal's room locked, a keycard on the near side of that lock,
 * crates for cover, and a per-room patrol for each guard.
 */
export function generateLevel(seed: number, overrides: Partial<LevelConfig> = {}): GeneratedLevel {
  const config = { ...DEFAULT_LEVEL_CONFIG, ...overrides };
  const rand = mulberry32(seed);
  const interior: Rect = {
    x: 1,
    z: 1,
    w: Math.max(1, config.gridSize - 2),
    h: Math.max(1, config.gridSize - 2),
  };

  const { rooms, walls, doors } = partitionRooms(interior, config.roomCount, rand);
  const structural = new Set(walls.map(cellKey));

  // Enter from the room nearest the grid origin, so the way in is always a corner.
  const spawnRoom = rooms.reduce(
    (best, room, index) => (room.x + room.z < rooms[best].x + rooms[best].z ? index : best),
    0
  );
  const spawn: GridPos = { x: rooms[spawnRoom].x, z: rooms[spawnRoom].z };

  const { hops, via } = roomHops(rooms, doors, spawnRoom);
  const terminalRoom = hops.reduce(
    (best, value, index) => (value !== Infinity && value > hops[best] ? index : best),
    spawnRoom
  );
  const terminal = farthestCellIn(rooms[terminalRoom], spawn, structural);

  // The door into the terminal's room is the one worth locking: it is the last
  // bridge on the route, so the keycard detour can never be skipped.
  const route = doorsOnRoute(via, spawnRoom, terminalRoom);
  const lockedDoor = route.length > 0 ? route[0] : null;
  if (lockedDoor) lockedDoor.locked = true;

  const keycard = lockedDoor
    ? pickKeycardCell(rooms, doors, lockedDoor, spawnRoom, spawn, structural)
    : null;

  const reserved = new Set(
    [spawn, terminal, ...(keycard ? [keycard] : []), ...doorApproaches(doors)].map(cellKey)
  );
  const crates = placeCrates(
    rooms,
    reserved,
    structural,
    { spawn, terminal, keycard, lockedDoor },
    config.gridSize,
    config.crateDensity,
    rand
  );

  const blockedForGuards = new Set([...structural, ...crates.map(cellKey)]);
  const patrolRooms = rooms.map((_, index) => index).filter((index) => index !== spawnRoom);
  const guards = assignGuardWaypoints(
    rooms,
    patrolRooms.length > 0 ? patrolRooms : [spawnRoom],
    config,
    blockedForGuards,
    rand
  );

  return {
    gridSize: config.gridSize,
    cellSize: config.cellSize,
    rooms,
    walls,
    doors,
    crates,
    spawn,
    terminal,
    keycard,
    guards,
  };
}

/** Converts a grid cell to world-space XZ coordinates, centered on the facility. */
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
