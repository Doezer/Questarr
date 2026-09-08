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

/**
 * Which grid edge the open approach sits against, and so which face of the
 * facility carries the gate.
 */
export type ApronSide = "north" | "south" | "east" | "west";

/** The one way in through the facility's perimeter wall. */
export interface GateDef {
  /** The gate cell itself, punched out of the perimeter wall. */
  pos: GridPos;
  /**
   * True when the wall this gate sits in runs along x, so the gate panel spans
   * x and the player passes through it along z. The engine needs this to orient
   * the leaf, and it cannot be derived from rooms the way interior doors are:
   * one side of a gate is not a room at all.
   */
  spansX: boolean;
  /** The apron cell immediately outside, where the approach ends. */
  outside: GridPos;
  /** Index into {@link GeneratedLevel.rooms} of the room it opens into. */
  room: number;
}

/** Knobs the generator reads; {@link DEFAULT_LEVEL_CONFIG} supplies every default. */
export interface LevelConfig {
  gridSize: number;
  cellSize: number;
  roomCount: number;
  crateDensity: number;
  guardCount: number;
  waypointsPerGuard: number;
  /** Depth of the open approach outside the facility, in cells. */
  apronDepth: number;
}

/** One fully generated facility: its geometry, its objectives and its patrols. */
export interface GeneratedLevel {
  gridSize: number;
  cellSize: number;
  rooms: Rect[];
  /**
   * Every wall cell: the facility's own perimeter ring as well as the interior
   * partitions. Only the grid's outer ring is implicit and unlisted — that is
   * the rock the whole map is cut out of, not part of the building.
   */
  walls: GridPos[];
  doors: DoorDef[];
  /** The facility's footprint, perimeter wall included. */
  facility: Rect;
  /** The approach outside the facility: open ground, no roof, no patrols. */
  apron: Rect;
  apronSide: ApronSide;
  gate: GateDef;
  crates: GridPos[];
  /** Where the run starts — out on the apron, facing the gate. */
  spawn: GridPos;
  terminal: GridPos;
  /** Null when the layout has no locked door, so no keycard is needed. */
  keycard: GridPos | null;
  guards: { waypoints: GridPos[] }[];
}

export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  // Wider than the facility needs: the extra rows are the apron the player
  // crosses before the gate, so the building keeps the size it always had.
  gridSize: 26,
  cellSize: 3,
  roomCount: 5,
  crateDensity: 0.1,
  guardCount: 3,
  waypointsPerGuard: 3,
  apronDepth: 4,
};

/** The four approach sides, in a fixed order so a seed always picks the same one. */
const APRON_SIDES: readonly ApronSide[] = ["north", "south", "east", "west"];
/** Keeps the gate off the corners of the face it sits in. */
const GATE_EDGE_MARGIN = 2;

/** Smallest floor span a room may have on either axis. */
const MIN_ROOM_SPAN = 4;
/** Doors are kept off a wall's ends so they never open into a corner. */
const DOOR_EDGE_MARGIN = 1;

/** One BSP cut: the wall line it lays down and the halves either side of it. */
interface Split {
  wall: GridPos[];
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
 * dividing wall. Returns null when neither axis has room for two rooms plus that
 * wall. The door through the wall is punched later, by {@link pickDoorInWall},
 * once every cut is known.
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

  const a: Rect = splitAlongZ
    ? { x: rect.x, z: rect.z, w: rect.w, h: wallLine - rect.z }
    : { x: rect.x, z: rect.z, w: wallLine - rect.x, h: rect.h };
  const b: Rect = splitAlongZ
    ? { x: rect.x, z: wallLine + 1, w: rect.w, h: rect.z + rect.h - wallLine - 1 }
    : { x: wallLine + 1, z: rect.z, w: rect.x + rect.w - wallLine - 1, h: rect.h };

  return { wall, a, b };
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
 * Chooses the one cell of a wall line to leave open as a door.
 *
 * Only cells with a room on either side qualify: a later perpendicular cut can
 * lay wall against this line, and a door there would open into stone. Picking
 * the door *after* every cut is known is what keeps the room graph a tree —
 * choosing it during the split and sealing it later when a cut spoiled it used
 * to drop that split's edge, and a level whose graph had fallen apart has no
 * route to lock and so no keycard to find.
 */
function pickDoorInWall(
  wall: readonly GridPos[],
  rooms: Rect[],
  rand: () => number
): DoorDef | null {
  const candidates: { pos: GridPos; rooms: [number, number]; edge: number }[] = [];
  for (let i = 0; i < wall.length; i++) {
    const joined = roomsBesideDoor(rooms, wall[i]);
    if (!joined) continue;
    candidates.push({ pos: wall[i], rooms: joined, edge: Math.min(i, wall.length - 1 - i) });
  }
  if (candidates.length === 0) return null;

  // Prefer a door clear of the wall's ends so there is floor either side of it,
  // but never at the cost of having no door at all on a short or crowded line.
  const reach = Math.min(DOOR_EDGE_MARGIN, Math.max(...candidates.map((c) => c.edge)));
  const preferred = candidates.filter((c) => c.edge >= reach);
  const pick = preferred[Math.floor(rand() * preferred.length)];
  return { pos: pick.pos, locked: false, rooms: pick.rooms };
}

/**
 * Binary-space partitions the interior into rooms. Each cut contributes one
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
  const openings = new Set<string>();
  for (const split of splits) {
    const door = pickDoorInWall(split.wall, rooms, rand);
    if (!door) continue;
    doors.push(door);
    openings.add(cellKey(door.pos));
  }

  const walls = splits.flatMap((split) =>
    split.wall.filter((cell) => !openings.has(cellKey(cell)))
  );

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

/** The ring of cells enclosing a rectangle's floor area. */
function ringCells(outer: Rect, inner: Rect): GridPos[] {
  return rectCells(outer).filter((cell) => !rectContains(inner, cell));
}

/** How the grid divides into an approach and the walled facility beyond it. */
interface Compound {
  /** The facility footprint, perimeter wall included. */
  facility: Rect;
  /** The BSP area inside that wall. */
  interior: Rect;
  /** The open ground outside the gate. */
  apron: Rect;
  apronSide: ApronSide;
  /** True when the gate's wall runs along x, so the player enters along z. */
  spansX: boolean;
  /** The facility face the apron looks at, as a constant on the gate's axis. */
  gateLine: number;
  /** Step from the gate towards the apron: -1 or +1 on the entry axis. */
  outward: number;
}

/**
 * Splits the grid interior into an apron and a walled facility.
 *
 * The apron is a band against one seeded edge; the facility takes the rest, and
 * the face between them is where the gate will go. The gate itself is not
 * chosen here — see {@link pickGate}, which needs the rooms first.
 */
function layOutCompound(gridSize: number, apronDepth: number, rand: () => number): Compound {
  const side = APRON_SIDES[Math.floor(rand() * APRON_SIDES.length)];
  const low = 1;
  const span = Math.max(1, gridSize - 2);
  const alongZ = side === "north" || side === "south";
  // "north"/"west" put the apron at the low end of their axis; the other two
  // put it at the high end, and the facility takes whatever is left.
  const apronAtLow = side === "north" || side === "west";
  // The apron is carved *out of* the span rather than added to it, so the two
  // always tile the grid exactly. A facility needs three cells on this axis to
  // have an interior at all, and on a grid too small to afford the configured
  // approach the apron gives way rather than running off the edge and stranding
  // the spawn outside the world.
  const depth = Math.max(1, Math.min(apronDepth, span - 3));
  const facilitySpan = span - depth;

  const apronStart = apronAtLow ? low : low + facilitySpan;
  const facilityStart = apronAtLow ? low + depth : low;

  const facility: Rect = alongZ
    ? { x: low, z: facilityStart, w: span, h: facilitySpan }
    : { x: facilityStart, z: low, w: facilitySpan, h: span };
  const apron: Rect = alongZ
    ? { x: low, z: apronStart, w: span, h: depth }
    : { x: apronStart, z: low, w: depth, h: span };
  const interior: Rect = {
    x: facility.x + 1,
    z: facility.z + 1,
    w: Math.max(1, facility.w - 2),
    h: Math.max(1, facility.h - 2),
  };

  // The facility's extent on the entry axis, then whichever end of it the apron
  // is on. Split in two rather than nested: the axis choice and the end choice
  // are independent, and folding them together reads as one four-way decision.
  const faceStart = alongZ ? facility.z : facility.x;
  const faceSpan = alongZ ? facility.h : facility.w;
  const gateLine = apronAtLow ? faceStart : faceStart + faceSpan - 1;

  return {
    facility,
    interior,
    apron,
    apronSide: side,
    spansX: alongZ,
    gateLine,
    outward: apronAtLow ? -1 : 1,
  };
}

/** A gate and the two cells either side of it. */
interface GateChoice {
  gate: GateDef;
  inner: GridPos;
  spawn: GridPos;
}

/**
 * Works out the gate one position along the face would make, or null when that
 * position is unusable because the cell inside it is not open room floor.
 *
 * Split out of {@link pickGate} so that function is left with the two decisions
 * that matter — which positions to try, and which of them to take — rather than
 * the axis arithmetic for every cell either side of the opening.
 */
function gateCandidateAt(compound: Compound, cross: number, rooms: Rect[]): GateChoice | null {
  const { apron, spansX, gateLine, outward } = compound;
  const inner: GridPos = spansX
    ? { x: cross, z: gateLine - outward }
    : { x: gateLine - outward, z: cross };
  const room = rooms.findIndex((rect) => rectContains(rect, inner));
  if (room < 0) return null;

  const pos: GridPos = spansX ? { x: cross, z: gateLine } : { x: gateLine, z: cross };
  const outside: GridPos = spansX
    ? { x: cross, z: gateLine + outward }
    : { x: gateLine + outward, z: cross };
  // The far edge of the apron, straight out from the gate, so the run opens
  // with the whole approach and the way in already lined up.
  const spawnLine = outward < 0 ? apron.z : apron.z + apron.h - 1;
  const spawnCol = outward < 0 ? apron.x : apron.x + apron.w - 1;
  const spawn: GridPos = spansX ? { x: cross, z: spawnLine } : { x: spawnCol, z: cross };

  return { gate: { pos, spansX, outside, room }, inner, spawn };
}

/**
 * Punches the gate through the facility face the apron looks at.
 *
 * Candidates are limited to positions whose *inner* neighbour is open room
 * floor: a BSP partition can meet the perimeter anywhere along that face, and a
 * gate opening onto the end of one would lead into solid wall. Corners are
 * excluded too, so the gate always has building either side of it.
 */
function pickGate(
  compound: Compound,
  rooms: Rect[],
  doors: DoorDef[],
  partitionWalls: ReadonlySet<string>,
  rand: () => number
): GateChoice | null {
  const { interior, spansX } = compound;
  const crossStart = spansX ? interior.x : interior.z;
  const crossSpan = spansX ? interior.w : interior.h;
  // Corners are excluded so the gate always has building either side of it —
  // except on a face too short to afford that, where any position beats none.
  const margin = Math.min(GATE_EDGE_MARGIN, Math.floor((crossSpan - 1) / 2));

  const candidates: GateChoice[] = [];
  for (let i = margin; i < crossSpan - margin; i++) {
    const candidate = gateCandidateAt(compound, crossStart + i, rooms);
    if (!candidate || partitionWalls.has(cellKey(candidate.inner))) continue;
    candidates.push(candidate);
  }

  if (candidates.length === 0) return null;

  // Sealing an orphaned door can split the room graph, and a gate opening into
  // a stranded room would leave the terminal and the keycard on the far side of
  // a wall with no door. Entering through the best-connected room avoids that:
  // the deepest room from there is then a real destination, so the lock and the
  // keycard detour both have somewhere to go.
  const reach = candidates.map(
    (candidate) =>
      roomHops(rooms, doors, candidate.gate.room).hops.filter((hop) => hop !== Infinity).length
  );
  const best = Math.max(...reach);
  const bestCandidates = candidates.filter((_, index) => reach[index] === best);
  return bestCandidates[Math.floor(rand() * bestCandidates.length)];
}

/**
 * Generates a facility from a numeric seed: BSP rooms joined by doors, the door
 * into the terminal's room locked, a keycard on the near side of that lock,
 * crates for cover, and a per-room patrol for each guard.
 */
export function generateLevel(seed: number, overrides: Partial<LevelConfig> = {}): GeneratedLevel {
  const config = { ...DEFAULT_LEVEL_CONFIG, ...overrides };
  const rand = mulberry32(seed);
  const compound = layOutCompound(config.gridSize, config.apronDepth, rand);
  const { interior, facility, apron } = compound;

  const partition = partitionRooms(interior, config.roomCount, rand);
  const { rooms, doors } = partition;
  const partitionWalls = new Set(partition.walls.map(cellKey));

  // Every position along the face is a candidate, so this only comes back null
  // for a facility too small to have a face at all — not for any real config.
  const choice = pickGate(compound, rooms, doors, partitionWalls, rand);
  if (!choice) throw new Error(`seed ${seed}: no gate position on the facility face`);
  const { gate, spawn } = choice;

  // The facility's own perimeter is real, listed wall — the gate is simply the
  // one cell missing from it, so nothing else has to know a gate exists to
  // treat the rest of that ring as solid.
  const perimeter = ringCells(facility, interior).filter((cell) => !sameCell(cell, gate.pos));
  const walls = [...partition.walls, ...perimeter];
  const structural = new Set(walls.map(cellKey));

  // The run starts outside, so the room the layout is measured from is the one
  // behind the gate: the first thing the player reaches indoors.
  const entryRoom = gate.room;

  const { hops, via } = roomHops(rooms, doors, entryRoom);
  const terminalRoom = hops.reduce(
    (best, value, index) => (value !== Infinity && value > hops[best] ? index : best),
    entryRoom
  );
  const terminal = farthestCellIn(rooms[terminalRoom], gate.pos, structural);

  // The door into the terminal's room is the one worth locking: it is the last
  // bridge on the route, so the keycard detour can never be skipped.
  const route = doorsOnRoute(via, entryRoom, terminalRoom);
  const lockedDoor = route.length > 0 ? route[0] : null;
  if (lockedDoor) lockedDoor.locked = true;

  const keycard = lockedDoor
    ? pickKeycardCell(rooms, doors, lockedDoor, entryRoom, gate.pos, structural)
    : null;

  const reserved = new Set(
    [
      spawn,
      terminal,
      gate.pos,
      gate.outside,
      choice.inner,
      ...(keycard ? [keycard] : []),
      ...doorApproaches(doors),
    ].map(cellKey)
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
  const patrolRooms = rooms.map((_, index) => index).filter((index) => index !== entryRoom);
  const guards = assignGuardWaypoints(
    rooms,
    patrolRooms.length > 0 ? patrolRooms : [entryRoom],
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
    facility,
    apron,
    apronSide: compound.apronSide,
    gate,
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
