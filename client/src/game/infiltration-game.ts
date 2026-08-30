import * as THREE from "three";
import { IsoCamera } from "./iso-camera";
import { cellKey, isInterior, type GridPos } from "./grid";
import { findPath, nearestOpenCell } from "./pathfinding";
import {
  generateLevel,
  gridToWorld,
  worldToGrid,
  type DoorDef,
  type GeneratedLevel,
} from "./level";
import {
  AWARENESS_FULL,
  AWARENESS_SUSPICIOUS,
  STANCES,
  THROW_NOISE_RADIUS,
  awarenessRate,
  illuminationAt,
  lampPositions,
  noiseRadiusFor,
  stepAwareness,
  type Stance,
} from "./detection";

export interface InfiltrationGameCallbacks {
  onPauseChange?: (paused: boolean) => void;
  onCaught?: () => void;
  onWin?: () => void;
  /** Fires every frame while near the terminal, progress in [0, 1]. */
  onHackProgress?: (progress: number, canInteract: boolean) => void;
  /** Fires when the level is built and whenever the keycard is picked up. */
  onObjectiveChange?: (objective: ObjectiveState) => void;
  /** Fires on a fixed cadence with the player's stance and worst guard awareness. */
  onStealthChange?: (stealth: StealthState) => void;
}

/** What the HUD needs to show about how exposed the player currently is. */
export interface StealthState {
  stance: Stance;
  /** Highest awareness across all guards, in [0, 1]. */
  awareness: number;
  /** Illumination at the player's feet, in [0, 1]. */
  illumination: number;
}

export interface ObjectiveState {
  /** True when a locked door stands between the player and the terminal. */
  needsKeycard: boolean;
  hasKeycard: boolean;
}

/** Axis-aligned XZ footprint of a solid object, used for circle-vs-box collision. */
interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type GuardState = "patrol" | "suspicious" | "investigate" | "alert";

/** A patrolling guard: its meshes, its route, and the FSM state driving both. */
interface Guard {
  group: THREE.Group;
  coneMaterial: THREE.MeshBasicMaterial;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  state: GuardState;
  stateTimer: number;
  investigateTarget: THREE.Vector3 | null;
  path: THREE.Vector3[];
  destination: THREE.Vector3 | null;
  /** How certain this guard is that it has seen the player, in [0, 1]. */
  awareness: number;
  /** Last sampled line of sight, refreshed on the vision interval. */
  seen: boolean;
}

/** A powered door in an interior wall, sliding into the floor as it opens. */
interface Door {
  def: DoorDef;
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  world: THREE.Vector3;
  box: Box;
  /** 0 fully closed, 1 fully open. */
  openness: number;
}

/** A thrown distraction in flight, or resting on the floor until it expires. */
interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  landed: boolean;
  life: number;
}

/** A mesh that can stand between the isometric camera and the player. */
interface Occluder {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

const PLAYER_RADIUS = 0.4;
const PLAYER_SPEED = 5;
const PLAYER_ARRIVE_EPSILON = 0.18;
const PLAYER_STUCK_TIMEOUT = 1.2;
const CRATE_SIZE = 2.2;
const CRATE_HEIGHT = 1.8;
const WALL_HEIGHT = 4;
const DOOR_HEIGHT = 2.8;
const VISION_RANGE = 9;
const VISION_HALF_FOV = THREE.MathUtils.degToRad(32);
const VISION_CHECK_INTERVAL = 0.15;
const GUARD_SPEED = 2.2;
const GUARD_EYE_HEIGHT = 1.2;
const INTERACT_DISTANCE = 2.4;
const HACK_DURATION = 2;
const THROW_COOLDOWN = 1;
const OCCLUDED_OPACITY = 0.2;
const DOOR_TRIGGER_RANGE = 3.2;
const DOOR_OPEN_SECONDS = 0.45;
/** Below this openness a door still blocks movement and sight. */
const DOOR_SOLID_UNTIL = 0.5;
const KEYCARD_PICKUP_RANGE = 1.6;
/** Movement noise is emitted on a cadence, not per frame, so guards re-path sanely. */
const MOVEMENT_NOISE_INTERVAL = 0.4;
/** How often the stealth HUD is refreshed; far coarser than the render loop. */
const STEALTH_REPORT_INTERVAL = 0.1;
const DOOR_COLORS = { locked: 0xff3b3b, unlocked: 0x35f0b0 };
const CONE_COLORS: Record<GuardState, number> = {
  patrol: 0xffd23c,
  suspicious: 0xffb020,
  investigate: 0xff9f1c,
  alert: 0xff3b3b,
};

/**
 * Isometric infiltration game: path around a procedurally generated facility,
 * stay out of the guards' vision cones, and reach the terminal.
 *
 * Every per-frame value lives on this class rather than in React state — the HUD
 * is updated imperatively through the callbacks so the render loop never triggers
 * a re-render.
 */
export class InfiltrationGame {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private iso: IsoCamera;
  private clock = new THREE.Clock();
  private canvas: HTMLCanvasElement;
  private callbacks: InfiltrationGameCallbacks;

  private level!: GeneratedLevel;
  /** Walls and crates: cells nothing can ever walk through. */
  private staticBlockedCells = new Set<string>();
  private solidBoxes: Box[] = [];
  private doors: Door[] = [];
  private keycardMesh: THREE.Mesh | null = null;
  /** Tracked separately from the card so pickup hides the glow with it. */
  private keycardHalo: THREE.Mesh | null = null;
  private hasKeycard = false;
  private occluders: Occluder[] = [];
  private facilityHalfExtent = 0;
  private terminalWorld = new THREE.Vector3();
  private guards: Guard[] = [];
  private projectiles: Projectile[] = [];

  private player = new THREE.Group();
  private playerPath: THREE.Vector3[] = [];
  private velocity = new THREE.Vector2();
  private stuckTimer = 0;
  private lastWaypointDistance = Infinity;
  private autoHack = false;

  private hoverMesh!: THREE.Mesh;
  private hoverMaterial!: THREE.MeshBasicMaterial;
  private markerMesh!: THREE.Mesh;
  private markerMaterial!: THREE.MeshBasicMaterial;
  private markerPulse = 0;

  private stance: Stance = "standing";
  /** Room lamp centres in world space, the light sources detection reads. */
  private lamps: { x: number; z: number }[] = [];
  /** Scaled on crouch so the stance is readable from the isometric camera. */
  private playerBody: THREE.Group | null = null;
  private movementNoiseAccum = 0;
  private stealthReportAccum = 0;

  private keys = new Set<string>();
  private pointerGround: THREE.Vector3 | null = null;
  private visionCheckAccum = 0;
  private throwCooldown = 0;
  private hackProgress = 0;
  private caughtCooldown = 0;
  private paused = true;
  private finished = false;
  private disposed = false;
  private animationHandle = 0;
  private resizeObserver: ResizeObserver;
  private readonly occlusionRaycaster = new THREE.Raycaster();

  constructor(canvas: HTMLCanvasElement, seed: number, callbacks: InfiltrationGameCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;

    this.iso = new IsoCamera(canvas);

    this.scene.fog = new THREE.Fog(0x0d121b, 78, 165);
    this.scene.background = new THREE.Color(0x0d121b);

    this.buildLevel(seed);

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    canvas.addEventListener("contextmenu", this.handleContextMenu);
    canvas.addEventListener("wheel", this.handleWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas);
    this.handleResize();
  }

  /** Rebuilds the facility from a fresh seed, reusing the renderer and camera. */
  regenerate(seed: number) {
    this.guards = [];
    this.projectiles = [];
    this.occluders = [];
    this.doors = [];
    this.keycardMesh = null;
    this.keycardHalo = null;
    this.hasKeycard = false;
    this.playerPath = [];
    this.clearScene();
    this.hackProgress = 0;
    this.autoHack = false;
    this.finished = false;
    this.caughtCooldown = 0;
    // A fresh layout is a fresh run: start it upright rather than inheriting the
    // stance the last run happened to end in.
    this.stance = "standing";
    this.movementNoiseAccum = 0;
    this.buildLevel(seed);
  }

  /** Removes and disposes every scene child so replays don't leak GPU memory. */
  private clearScene() {
    this.scene.traverse((object) => {
      // Meshes, lines and the floor GridHelper all carry geometry/material that
      // has to go back to the GPU, or replays leak a level's worth each time.
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }

  /** Freezes the simulation and drops held input, so nothing drifts while paused. */
  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.velocity.set(0, 0);
    }
    this.callbacks.onPauseChange?.(paused);
  }

  /** Starts the render loop. Safe to call once; `dispose` stops it. */
  start() {
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.animationHandle = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.update(dt);
      this.renderer.render(this.scene, this.iso.camera);
    };
    loop();
  }

  /** Detaches every listener and returns all GPU resources. */
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationHandle);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.canvas.removeEventListener("contextmenu", this.handleContextMenu);
    this.canvas.removeEventListener("wheel", this.handleWheel);
    this.resizeObserver.disconnect();
    this.clearScene();
    this.renderer.dispose();
  }

  // --- level construction -------------------------------------------------

  /** Generates a facility for the seed and raises every mesh and collider for it. */
  private buildLevel(seed: number) {
    this.level = generateLevel(seed);
    this.facilityHalfExtent = (this.level.gridSize * this.level.cellSize) / 2;
    this.iso.setBounds(this.facilityHalfExtent);
    this.solidBoxes = [];
    this.staticBlockedCells = new Set([...this.level.crates, ...this.level.walls].map(cellKey));

    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x232a3a, 1.5));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xd6e4ff, 1.15);
    key.position.set(12, 20, 8);
    this.scene.add(key);
    // A lamp per room, so rooms read as separately lit spaces rather than one
    // hall with a hotspot in the middle.
    // One source of truth for where light is: the meshes and the detection math
    // read the same list, so a shadow that looks safe on screen actually is.
    this.lamps = lampPositions(this.level.rooms, (cell) => gridToWorld(cell, this.level));
    for (const centre of this.lamps) {
      const lamp = new THREE.PointLight(0x6ee7ff, 26, 26, 2);
      lamp.position.set(centre.x, 5.5, centre.z);
      this.scene.add(lamp);
    }

    const floorSize = this.level.gridSize * this.level.cellSize;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshStandardMaterial({ color: 0x222b3b, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.buildFloorGrid(floorSize);

    this.buildPerimeter(floorSize);
    for (const wallCell of this.level.walls) this.buildInteriorWall(wallCell);
    for (const cratePos of this.level.crates) this.buildCrate(cratePos);
    for (const door of this.level.doors) this.buildDoor(door);
    this.buildTerminal();
    this.buildKeycard();
    this.buildGuards();
    this.buildCursorMeshes();
    this.buildPlayer();
    this.reportObjective();
  }

  /** Pushes the current objective to the HUD, which owns no per-frame state itself. */
  private reportObjective() {
    this.callbacks.onObjectiveChange?.({
      needsKeycard: this.level.doors.some((door) => door.locked),
      hasKeycard: this.hasKeycard,
    });
  }

  /** Faint tile lines, so click-to-move destinations are readable at a glance. */
  private buildFloorGrid(floorSize: number) {
    const grid = new THREE.GridHelper(floorSize, this.level.gridSize, 0x3c4c68, 0x2f3c53);
    grid.position.y = 0.01;
    this.scene.add(grid);
  }

  /** Raises the four perimeter walls, each an occluder in its own right. */
  private buildPerimeter(floorSize: number) {
    const half = floorSize / 2;
    const specs: [number, number, number, number][] = [
      [0, half, floorSize, 0.4], // north (thin in z)
      [0, -half, floorSize, 0.4], // south
      [half, 0, 0.4, floorSize], // east
      [-half, 0, 0.4, floorSize], // west
    ];
    for (const [x, z, w, d] of specs) {
      // Each wall owns its material so fading one occluder doesn't fade all four.
      const material = new THREE.MeshStandardMaterial({ color: 0x333c50, roughness: 0.8 });
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), material);
      wall.position.set(x, WALL_HEIGHT / 2, z);
      this.scene.add(wall);
      this.occluders.push({ mesh: wall, material });
    }
  }

  /** A waist-high crate: cover from sight, and a solid box for collision. */
  private buildCrate(gridPos: GridPos) {
    const world = gridToWorld(gridPos, this.level);
    const material = new THREE.MeshStandardMaterial({ color: 0x49536b, roughness: 0.7 });
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(CRATE_SIZE, CRATE_HEIGHT, CRATE_SIZE),
      material
    );
    crate.position.set(world.x, CRATE_HEIGHT / 2, world.z);
    this.scene.add(crate);
    this.occluders.push({ mesh: crate, material });
    this.solidBoxes.push(boxAround(world.x, world.z, CRATE_SIZE));
  }

  /**
   * One box per interior wall cell rather than per wall run: the occlusion fade
   * then dissolves just the segment covering the player instead of a whole wall.
   */
  private buildInteriorWall(cell: GridPos) {
    const world = gridToWorld(cell, this.level);
    const size = this.level.cellSize;
    const material = new THREE.MeshStandardMaterial({ color: 0x4a5570, roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, WALL_HEIGHT, size), material);
    mesh.position.set(world.x, WALL_HEIGHT / 2, world.z);
    this.scene.add(mesh);
    this.occluders.push({ mesh, material });
    this.solidBoxes.push(boxAround(world.x, world.z, size));
  }

  /** A door panel plus its collider, tinted by lock state and tracked for sliding. */
  private buildDoor(def: DoorDef) {
    const world = gridToWorld(def.pos, this.level);
    const size = this.level.cellSize;
    const group = new THREE.Group();

    const material = new THREE.MeshStandardMaterial({
      color: 0x1b2330,
      emissive: DOOR_COLORS.locked,
      emissiveIntensity: 0.6,
      roughness: 0.4,
      metalness: 0.5,
    });
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.92, DOOR_HEIGHT, size * 0.5),
      material
    );
    panel.position.y = DOOR_HEIGHT / 2;
    group.add(panel);

    // The frame stays put while the panel slides down inside it.
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x39435c, roughness: 0.7 });
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(size, WALL_HEIGHT - DOOR_HEIGHT, size * 0.6),
      frameMaterial
    );
    lintel.position.set(world.x, DOOR_HEIGHT + (WALL_HEIGHT - DOOR_HEIGHT) / 2, world.z);
    this.scene.add(lintel);
    this.occluders.push({ mesh: lintel, material: frameMaterial });

    group.position.set(world.x, 0, world.z);
    this.scene.add(group);

    this.doors.push({
      def,
      group,
      material,
      world: new THREE.Vector3(world.x, 0, world.z),
      box: boxAround(world.x, world.z, size),
      openness: 0,
    });
  }

  /** The pickup that unlocks the terminal's door, if this layout has a lock. */
  private buildKeycard() {
    if (!this.level.keycard) return;
    const world = gridToWorld(this.level.keycard, this.level);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.05, 0.34),
      new THREE.MeshStandardMaterial({
        color: 0xffd23c,
        emissive: 0x6b5200,
        emissiveIntensity: 1.2,
      })
    );
    mesh.position.set(world.x, 0.9, world.z);
    this.scene.add(mesh);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.9, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd23c,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(world.x, 0.02, world.z);
    this.scene.add(halo);

    this.keycardMesh = mesh;
    this.keycardHalo = halo;
  }

  /** The objective terminal, and the world position proximity checks measure against. */
  private buildTerminal() {
    const world = gridToWorld(this.level.terminal, this.level);
    this.terminalWorld.set(world.x, 0, world.z);
    const group = new THREE.Group();

    const housingMaterial = new THREE.MeshStandardMaterial({
      color: 0x161c26,
      roughness: 0.55,
      metalness: 0.35,
    });

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 12), housingMaterial);
    base.position.y = 0.06;

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.85, 10), housingMaterial);
    pole.position.y = 0.12 + 0.85 / 2;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), housingMaterial);
    deck.position.y = 0.95;

    const screenMaterial = new THREE.MeshStandardMaterial({
      color: 0x0b2a22,
      emissive: 0x35f0b0,
      emissiveIntensity: 1.6,
    });
    // BoxGeometry face-group order is [+x, -x, +y, -y, +z, -z]; only the front
    // (+z, the group's forward direction) face gets the glowing screen material.
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.46, 0.06), [
      housingMaterial,
      housingMaterial,
      housingMaterial,
      housingMaterial,
      screenMaterial,
      housingMaterial,
    ]);
    screen.position.y = 1.28;
    screen.rotation.x = -0.22;

    // A ground halo marks the objective from across the room, where the console
    // itself is only a few pixels tall.
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.35, 32),
      new THREE.MeshBasicMaterial({
        color: 0x35f0b0,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.02;

    group.add(base, pole, deck, screen, halo);
    group.position.set(world.x, 0, world.z);

    // Face the screen roughly back toward spawn, since that's the direction
    // the player approaches from on their way to the terminal.
    const spawnWorld = gridToWorld(this.level.spawn, this.level);
    group.rotation.y = Math.atan2(spawnWorld.x - world.x, spawnWorld.z - world.z);

    this.scene.add(group);
  }

  /** Spawns a guard per patrol in the level, each on the first cell of its route. */
  private buildGuards() {
    for (const guardDef of this.level.guards) {
      const waypoints = guardDef.waypoints.map((wp) => {
        const world = gridToWorld(wp, this.level);
        return new THREE.Vector3(world.x, 0, world.z);
      });
      if (waypoints.length === 0) continue;

      const group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.35, 1.1, 4, 8),
        new THREE.MeshStandardMaterial({ color: 0xd23c3c })
      );
      body.position.y = 0.95;

      // A flat floor sector reads far better than a 3D cone from an isometric
      // angle. CircleGeometry lies in XY starting at +X; laying it flat with
      // rotation.x = -PI/2 maps local +Y to world -Z, so the group's forward
      // (+Z, the vector checkVision uses) sits at angle -PI/2.
      const coneMaterial = new THREE.MeshBasicMaterial({
        color: CONE_COLORS.patrol,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const cone = new THREE.Mesh(
        new THREE.CircleGeometry(
          VISION_RANGE,
          32,
          -Math.PI / 2 - VISION_HALF_FOV,
          VISION_HALF_FOV * 2
        ),
        coneMaterial
      );
      cone.rotation.x = -Math.PI / 2;
      cone.position.y = 0.03;

      group.add(body, cone);
      group.position.copy(waypoints[0]);
      this.scene.add(group);

      this.guards.push({
        group,
        coneMaterial,
        waypoints,
        waypointIndex: 0,
        state: "patrol",
        stateTimer: 0,
        investigateTarget: null,
        path: [],
        destination: null,
        awareness: 0,
        seen: false,
      });
    }
  }

  /** The player avatar: a capsule with a wedge marking the direction it faces. */
  private buildPlayer() {
    this.player = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 1, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x5eb0ff, roughness: 0.5 })
    );
    body.position.y = 0.85;
    // A small nose cone makes the player's facing (and so their approach angle)
    // legible from the fixed isometric view.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.42, 8),
      new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x1d4e73 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.05, 0.36);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;

    // Body and nose ride in their own group: crouch scales that, leaving the
    // ground shadow (which reads as the player's footprint) at full size.
    const upper = new THREE.Group();
    upper.add(body, nose);
    this.playerBody = upper;
    this.player.add(upper, shadow);
    this.scene.add(this.player);
    this.applyStance();
    this.resetPlayerToSpawn();
    this.iso.jumpTo(this.player.position);
  }

  /** Flips between standing and crouched, and tells the HUD immediately. */
  private toggleStance() {
    this.stance = this.stance === "standing" ? "crouched" : "standing";
    this.applyStance();
    this.reportStealth();
  }

  /** Reflects the current stance in the player mesh. */
  private applyStance() {
    if (this.playerBody) this.playerBody.scale.y = STANCES[this.stance].height;
  }

  /** Pushes stance, exposure and the worst guard's awareness to the HUD. */
  private reportStealth() {
    if (!this.callbacks.onStealthChange) return;
    let awareness = 0;
    for (const guard of this.guards) awareness = Math.max(awareness, guard.awareness);
    this.callbacks.onStealthChange({
      stance: this.stance,
      awareness,
      illumination: this.playerIllumination(),
    });
  }

  /** Illumination at the player's feet, which is what guards actually read. */
  private playerIllumination(): number {
    return illuminationAt(this.player.position.x, this.player.position.z, this.lamps);
  }

  /** The hover tile and move marker that make click-to-move destinations legible. */
  private buildCursorMeshes() {
    const cell = this.level.cellSize;
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.hoverMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(cell * 0.92, cell * 0.92),
      this.hoverMaterial
    );
    this.hoverMesh.rotation.x = -Math.PI / 2;
    this.hoverMesh.position.y = 0.02;
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);

    this.markerMaterial = new THREE.MeshBasicMaterial({
      color: 0x35f0b0,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.markerMesh = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.46, 24), this.markerMaterial);
    this.markerMesh.rotation.x = -Math.PI / 2;
    this.markerMesh.position.y = 0.03;
    this.markerMesh.visible = false;
    this.scene.add(this.markerMesh);
  }

  /** Returns the player to the entry point and cancels any order in flight. */
  private resetPlayerToSpawn() {
    const spawnWorld = gridToWorld(this.level.spawn, this.level);
    this.player.position.set(spawnWorld.x, 0, spawnWorld.z);
    this.player.rotation.y = 0;
    this.playerPath = [];
    this.velocity.set(0, 0);
    this.autoHack = false;
    if (this.markerMesh) this.markerMesh.visible = false;
  }

  // --- input ----------------------------------------------------------

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.code === "Escape") {
      this.setPaused(!this.paused);
      return;
    }
    if (this.paused) return;
    this.keys.add(event.code);
    if (event.code === "KeyF") this.throwDistraction();
    if (event.code === "ControlLeft" || event.code === "ControlRight") this.toggleStance();
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private handlePointerMove = (event: PointerEvent) => {
    this.pointerGround = this.iso.screenToGround(event.clientX, event.clientY);
    this.updateHoverMesh();
  };

  private handlePointerLeave = () => {
    this.pointerGround = null;
    this.hoverMesh.visible = false;
  };

  private handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.iso.zoomBy(Math.sign(event.deltaY) * -2);
  };

  private handlePointerDown = (event: PointerEvent) => {
    if (this.paused || this.finished) return;
    const ground = this.iso.screenToGround(event.clientX, event.clientY);
    if (!ground) return;

    if (event.button === 2) {
      this.throwDistraction(ground);
      return;
    }
    if (event.button !== 0) return;

    // Clicking on (or right beside) the console is an "interact" order: walk into
    // range and start hacking on arrival.
    const toTerminal = Math.hypot(ground.x - this.terminalWorld.x, ground.z - this.terminalWorld.z);
    if (toTerminal <= this.level.cellSize * 0.7) {
      this.orderInteractWithTerminal();
      return;
    }
    this.orderMoveTo(ground);
  };

  /** Resizes the renderer and reshapes the orthographic frustum to the new canvas. */
  private handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.iso.resize(width, height);
    this.renderer.setSize(width, height, false);
  }

  /** Highlights the cell under the cursor, tinted red where it isn't walkable. */
  private updateHoverMesh() {
    if (!this.pointerGround || this.paused) {
      this.hoverMesh.visible = false;
      return;
    }
    const cell = worldToGrid(this.pointerGround.x, this.pointerGround.z, this.level);
    const world = gridToWorld(cell, this.level);
    this.hoverMesh.position.set(world.x, 0.02, world.z);
    this.hoverMesh.visible = true;
    const walkable =
      isInterior(cell, this.level.gridSize) && !this.playerBlockedCells().has(cellKey(cell));
    this.hoverMaterial.color.setHex(walkable ? 0xffffff : 0xff6b6b);
    this.hoverMaterial.opacity = walkable ? 0.1 : 0.16;
  }

  // --- orders and pathing ----------------------------------------------

  /** Issues a move order to a world-space ground point, cancelling any hack intent. */
  private orderMoveTo(point: THREE.Vector3, keepHackIntent = false) {
    if (!keepHackIntent) this.autoHack = false;

    const destination = this.resolveDestination(point);
    if (!destination) return;

    // pathBetween already falls back to a straight walk when the grid route is
    // empty, and it tests the same clearance from the same start point, so an
    // empty path here means the destination simply can't be reached.
    const path = this.pathTo(destination);
    if (path.length === 0) return;
    this.playerPath = path;

    this.stuckTimer = 0;
    this.lastWaypointDistance = Infinity;
    this.markerMesh.position.set(destination.x, 0.03, destination.z);
    this.markerMesh.visible = true;
  }

  /** Walks into console range from the player's current side, then hacks on arrival. */
  private orderInteractWithTerminal() {
    // Stand just short of the console, on the side the player is approaching from.
    const toPlayer = new THREE.Vector3()
      .subVectors(this.player.position, this.terminalWorld)
      .setY(0);
    if (toPlayer.lengthSq() < 1e-4) toPlayer.set(0, 0, 1);
    toPlayer.normalize();
    const stand = this.terminalWorld.clone().addScaledVector(toPlayer, INTERACT_DISTANCE * 0.7);

    this.autoHack = true;
    this.orderMoveTo(stand, true);
  }

  /** Snaps a clicked point to somewhere the player can actually stand. */
  private resolveDestination(point: THREE.Vector3): THREE.Vector3 | null {
    const bound = this.facilityHalfExtent - 0.6;
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(point.x, -bound, bound),
      0,
      THREE.MathUtils.clamp(point.z, -bound, bound)
    );
    if (!this.collides(clamped.x, clamped.z)) return clamped;

    const cell = nearestOpenCell(
      worldToGrid(clamped.x, clamped.z, this.level),
      this.level.gridSize,
      this.playerBlockedCells()
    );
    if (!cell) return null;
    const world = gridToWorld(cell, this.level);
    return new THREE.Vector3(world.x, 0, world.z);
  }

  /**
   * Grid-A* from the player to a world point, straightened into as few waypoints
   * as the geometry allows and ending on the exact requested point.
   */
  private pathTo(destination: THREE.Vector3): THREE.Vector3[] {
    return this.pathBetween(this.player.position, destination, this.playerBlockedCells(), true);
  }

  /**
   * Cells the player may not route through. A locked door counts as solid until
   * the keycard is found, so click-to-move never plots a course through it.
   */
  private playerBlockedCells(): ReadonlySet<string> {
    if (this.hasKeycard) return this.staticBlockedCells;
    const locked = this.level.doors.filter((door) => door.locked);
    if (locked.length === 0) return this.staticBlockedCells;
    return new Set([...this.staticBlockedCells, ...locked.map((door) => cellKey(door.pos))]);
  }

  /** Guards work here, so every door opens for them. */
  private guardBlockedCells(): ReadonlySet<string> {
    return this.staticBlockedCells;
  }

  /** Grid route between two world points, smoothed and ending on the exact target. */
  private pathBetween(
    from: THREE.Vector3,
    destination: THREE.Vector3,
    blocked: ReadonlySet<string>,
    forPlayer: boolean
  ): THREE.Vector3[] {
    const startCell = worldToGrid(from.x, from.z, this.level);
    const goalCell = worldToGrid(destination.x, destination.z, this.level);
    const cells = findPath(startCell, goalCell, this.level.gridSize, blocked);

    const points = cells.map((cell) => {
      const world = gridToWorld(cell, this.level);
      return new THREE.Vector3(world.x, 0, world.z);
    });
    // The last grid cell is only the destination's cell; finish on the real point.
    if (points.length > 0) points[points.length - 1] = destination.clone();
    else if (this.segmentClear(from, destination, forPlayer)) points.push(destination.clone());

    return this.smoothPath(from, points, forPlayer);
  }

  /**
   * String-pulling: repeatedly jump to the furthest waypoint still reachable in a
   * straight line, which turns A*'s cardinal staircase into natural diagonals.
   */
  private smoothPath(
    from: THREE.Vector3,
    points: THREE.Vector3[],
    forPlayer: boolean
  ): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    let cursor = from.clone();
    let i = 0;
    while (i < points.length) {
      let furthest = i;
      for (let j = points.length - 1; j > i; j--) {
        if (this.segmentClear(cursor, points[j], forPlayer)) {
          furthest = j;
          break;
        }
      }
      out.push(points[furthest]);
      cursor = points[furthest];
      i = furthest + 1;
    }
    return out;
  }

  /** Samples the straight line for player-radius clearance against crates and walls. */
  private segmentClear(from: THREE.Vector3, to: THREE.Vector3, forPlayer = true): boolean {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(dist / 0.3));
    const bound = this.facilityHalfExtent - 0.5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(from.x, to.x, t);
      const z = THREE.MathUtils.lerp(from.z, to.z, t);
      if (Math.abs(x) >= bound || Math.abs(z) >= bound) return false;
      if (this.collides(x, z, forPlayer)) return false;
    }
    return true;
  }

  // --- per-frame update -------------------------------------------------

  /** One simulation step. Camera, occlusion and marker keep animating while paused. */
  private update(dt: number) {
    if (!this.paused && !this.finished) {
      this.updatePlayerMovement(dt);
      this.updateProjectiles(dt);
      this.updateGuards(dt);
      this.updateDoors(dt);
      this.updateKeycard();
      this.updateHack(dt);
      // Both cooldowns are game time, so they stop with the simulation: ticking
      // them while paused would let a player tap Esc to refresh their throw, or
      // burn off the post-catch grace period the guards are meant to get.
      if (this.caughtCooldown > 0) this.caughtCooldown -= dt;
      if (this.throwCooldown > 0) this.throwCooldown -= dt;
    }

    this.iso.follow(this.player.position, dt);
    this.updateOcclusion();
    this.updateMarker(dt);
  }

  /** Advances the player along the current order, with damped acceleration. */
  private updatePlayerMovement(dt: number) {
    this.velocity.multiplyScalar(Math.exp(-8 * dt));

    const waypoint = this.playerPath[0];
    if (waypoint) this.steerTowardWaypoint(waypoint, dt);

    if (this.velocity.lengthSq() < 1e-4) {
      this.velocity.set(0, 0);
      return;
    }

    this.moveWithCollision(this.velocity.x * dt, this.velocity.y * dt);
    this.player.rotation.y = Math.atan2(this.velocity.x, this.velocity.y);
    this.emitFootstepNoise(dt);
  }

  /**
   * Leaks the player's own position to nearby guards while they move.
   *
   * Emitted on a cadence rather than per frame: the target moves with the
   * player, and re-pathing every guard on every frame toward a target that has
   * shifted a few centimetres is both wasteful and jittery.
   */
  private emitFootstepNoise(dt: number) {
    this.movementNoiseAccum += dt;
    if (this.movementNoiseAccum < MOVEMENT_NOISE_INTERVAL) return;
    this.movementNoiseAccum = 0;

    const topSpeed = PLAYER_SPEED * STANCES[this.stance].speed;
    const radius = noiseRadiusFor(this.stance, this.velocity.length() / topSpeed);
    if (radius > 0) this.emitNoise(this.player.position, radius);
  }

  /** Accelerates toward the current waypoint, or retires it once reached. */
  private steerTowardWaypoint(waypoint: THREE.Vector3, dt: number) {
    const dx = waypoint.x - this.player.position.x;
    const dz = waypoint.z - this.player.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= PLAYER_ARRIVE_EPSILON) {
      this.reachWaypoint();
      return;
    }

    const topSpeed = PLAYER_SPEED * STANCES[this.stance].speed;
    this.velocity.x += (dx / distance) * topSpeed * dt * 8;
    this.velocity.y += (dz / distance) * topSpeed * dt * 8;
    this.velocity.clampLength(0, topSpeed);
    this.trackWaypointProgress(distance, dt);
  }

  /** Retires the waypoint just arrived at, ending the order if it was the last. */
  private reachWaypoint() {
    this.playerPath.shift();
    this.lastWaypointDistance = Infinity;
    this.stuckTimer = 0;
    if (this.playerPath.length === 0) {
      this.markerMesh.visible = false;
      // Coasting on residual velocity would drift past the clicked tile.
      this.velocity.set(0, 0);
    }
  }

  /**
   * Walking into geometry the smoothed path didn't predict (a guard body, a
   * corner clipped by the arrival epsilon) would otherwise stall forever, so a
   * waypoint that stops getting closer eventually cancels the order.
   */
  private trackWaypointProgress(distance: number, dt: number) {
    if (distance >= this.lastWaypointDistance - 0.001) {
      this.stuckTimer += dt;
      if (this.stuckTimer > PLAYER_STUCK_TIMEOUT) this.abortPath();
    } else {
      this.stuckTimer = 0;
    }
    this.lastWaypointDistance = distance;
  }

  /** Cancels the current order outright, e.g. when the player is wedged. */
  private abortPath() {
    this.playerPath = [];
    this.velocity.set(0, 0);
    this.stuckTimer = 0;
    this.lastWaypointDistance = Infinity;
    this.markerMesh.visible = false;
  }

  /** Applies movement one axis at a time, so hitting a crate slides along it. */
  private moveWithCollision(dx: number, dz: number) {
    const pos = this.player.position;
    const bound = this.facilityHalfExtent - 0.5;

    const nextX = pos.x + dx;
    if (!this.collides(nextX, pos.z) && Math.abs(nextX) < bound) pos.x = nextX;

    const nextZ = pos.z + dz;
    if (!this.collides(pos.x, nextZ) && Math.abs(nextZ) < bound) pos.z = nextZ;
  }

  /**
   * True when a player-radius circle here overlaps a wall, crate or barring door.
   *
   * `forPlayer` matters at a locked door: a guard standing at one holds it open,
   * and without this the player could simply walk through the gap and skip the
   * keycard entirely — the lock is only enforced in the pathfinder, and a
   * straight-line fallback never consults it.
   */
  private collides(x: number, z: number, forPlayer = true): boolean {
    for (const box of this.solidBoxes) {
      if (overlapsBox(x, z, box, PLAYER_RADIUS)) return true;
    }
    for (const door of this.doors) {
      if (this.doorBars(door, forPlayer) && overlapsBox(x, z, door.box, PLAYER_RADIUS)) {
        return true;
      }
    }
    return false;
  }

  /** Whether a door currently bars whoever is asking. */
  private doorBars(door: Door, forPlayer: boolean): boolean {
    if (forPlayer && door.def.locked && !this.hasKeycard) return true;
    return door.openness < DOOR_SOLID_UNTIL;
  }

  /** Samples the sight line for a crate standing between the two points. */
  private lineOfSightBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dist = from.distanceTo(to);
    const steps = Math.ceil(dist / 0.6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(from.x, to.x, t);
      const z = THREE.MathUtils.lerp(from.z, to.z, t);
      if (this.solidBoxes.some((box) => overlapsBox(x, z, box, 0.3))) return true;
      const shutDoor = this.doors.some(
        (door) => door.openness < DOOR_SOLID_UNTIL && overlapsBox(x, z, door.box, 0.3)
      );
      if (shutDoor) return true;
    }
    return false;
  }

  /**
   * Fades whatever stands between the camera and the player. Without this, the
   * fixed isometric angle regularly parks a wall or a crate on top of the player.
   */
  private updateOcclusion() {
    const target = this.player.position.clone().setY(1);
    const origin = this.iso.eye;
    const direction = new THREE.Vector3().subVectors(target, origin).normalize();
    this.occlusionRaycaster.set(origin, direction);
    this.occlusionRaycaster.far = origin.distanceTo(target);

    const meshes = this.occluders.map((entry) => entry.mesh);
    const hits = new Set(
      this.occlusionRaycaster.intersectObjects(meshes, false).map((h) => h.object)
    );

    for (const { mesh, material } of this.occluders) {
      const desired = hits.has(mesh) ? OCCLUDED_OPACITY : 1;
      material.opacity += (desired - material.opacity) * 0.2;
      const transparent = material.opacity < 0.99;
      material.transparent = transparent;
      material.depthWrite = !transparent;
    }
  }

  /**
   * Slides each door open for anyone standing at it who may pass, and shut again
   * once they leave. Guards carry keys; the player needs the keycard.
   */
  private updateDoors(dt: number) {
    for (const door of this.doors) {
      const target = this.doorShouldOpen(door) ? 1 : 0;
      const step = dt / DOOR_OPEN_SECONDS;
      door.openness = THREE.MathUtils.clamp(
        door.openness + THREE.MathUtils.clamp(target - door.openness, -step, step),
        0,
        1
      );
      // The panel retracts into the floor; the frame above it stays put.
      door.group.position.y = -door.openness * DOOR_HEIGHT;

      const passable = !door.def.locked || this.hasKeycard;
      door.material.emissive.setHex(passable ? DOOR_COLORS.unlocked : DOOR_COLORS.locked);
    }
  }

  /** True while someone authorised to pass is standing within trigger range. */
  private doorShouldOpen(door: Door): boolean {
    const playerMayPass = !door.def.locked || this.hasKeycard;
    if (playerMayPass && this.player.position.distanceTo(door.world) <= DOOR_TRIGGER_RANGE) {
      return true;
    }
    return this.guards.some(
      (guard) => guard.group.position.distanceTo(door.world) <= DOOR_TRIGGER_RANGE
    );
  }

  /** Picks the keycard up on contact, which unlocks every locked door. */
  private updateKeycard() {
    if (!this.keycardMesh || this.hasKeycard) return;
    const distance = Math.hypot(
      this.player.position.x - this.keycardMesh.position.x,
      this.player.position.z - this.keycardMesh.position.z
    );
    if (distance > KEYCARD_PICKUP_RANGE) return;

    this.hasKeycard = true;
    this.keycardMesh.visible = false;
    if (this.keycardHalo) this.keycardHalo.visible = false;
    // A route plotted around the locked door is no longer the shortest one.
    this.abortPath();
    this.reportObjective();
  }

  /** Pulses the destination ring so a pending order stays noticeable. */
  private updateMarker(dt: number) {
    if (this.keycardMesh?.visible) this.keycardMesh.rotation.y += dt * 1.4;
    if (!this.markerMesh.visible) return;
    this.markerPulse = (this.markerPulse + dt * 3) % (Math.PI * 2);
    this.markerMaterial.opacity = 0.5 + 0.3 * Math.sin(this.markerPulse);
  }

  /** Lobs a noisemaker at the aim point, pulling nearby guards off patrol. */
  private throwDistraction(aimPoint?: THREE.Vector3) {
    if (this.throwCooldown > 0 || this.paused || this.finished) return;
    const target = aimPoint ?? this.pointerGround;
    if (!target) return;
    this.throwCooldown = THROW_COOLDOWN;

    const origin = this.player.position.clone().setY(1.1);
    const toTarget = new THREE.Vector3().subVectors(target, origin).setY(0);
    const distance = Math.max(toTarget.length(), 0.5);
    toTarget.normalize();

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffcf6e, emissive: 0x6b4a00 })
    );
    mesh.position.copy(origin).addScaledVector(toTarget, 0.5);
    this.scene.add(mesh);

    // Lob it: pick the horizontal speed that lands near the aim point given the
    // fixed launch arc, so throws feel aimed rather than fixed-range.
    const flightTime = 0.9;
    const velocity = toTarget.multiplyScalar(Math.min(distance, 16) / flightTime);
    velocity.y = 4.5;
    this.projectiles.push({ mesh, velocity, landed: false, life: 3 });

    this.player.rotation.y = Math.atan2(velocity.x, velocity.z);
  }

  /** Steps thrown objects through their arc and retires them once spent. */
  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile.landed) {
        projectile.velocity.y -= 14 * dt;
        projectile.mesh.position.addScaledVector(projectile.velocity, dt);
        if (projectile.mesh.position.y <= 0.14) {
          projectile.mesh.position.y = 0.14;
          projectile.landed = true;
          this.emitNoise(projectile.mesh.position);
        }
      }
      projectile.life -= dt;
      if (projectile.life <= 0) {
        this.scene.remove(projectile.mesh);
        projectile.mesh.geometry.dispose();
        (projectile.mesh.material as THREE.Material).dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Sends every guard within earshot to investigate the noise. */
  private emitNoise(position: THREE.Vector3, radius: number = THROW_NOISE_RADIUS) {
    // Earshot is measured from where the noise actually landed, but the guard is
    // sent to the nearest cell it can stand on: a projectile that comes to rest
    // on a crate would otherwise hand findPath a blocked goal, leaving the guard
    // rooted in place for the whole investigate window.
    const target = this.reachablePointNear(position);
    if (!target) return;

    for (const guard of this.guards) {
      if (guard.state === "alert") continue;
      if (guard.group.position.distanceTo(position) <= radius) {
        guard.state = "investigate";
        guard.investigateTarget = target.clone();
        guard.stateTimer = 3;
        // Force a fresh route to the noise on the next movement step.
        guard.destination = null;
        guard.path = [];
      }
    }
  }

  /** Nearest cell a guard can stand on near a world point, or null if none exists. */
  private reachablePointNear(position: THREE.Vector3): THREE.Vector3 | null {
    const cell = nearestOpenCell(
      worldToGrid(position.x, position.z, this.level),
      this.level.gridSize,
      this.guardBlockedCells()
    );
    if (!cell) return null;
    const world = gridToWorld(cell, this.level);
    return new THREE.Vector3(world.x, 0, world.z);
  }

  /** Advances every guard: vision on its own interval, then movement and FSM. */
  private updateGuards(dt: number) {
    this.visionCheckAccum += dt;
    // Line-of-sight raycasts are the expensive part, so they keep their own
    // coarse interval; the meter itself integrates every frame off the last
    // sample, which keeps it smooth enough to render as a bar.
    const shouldCheckVision = this.visionCheckAccum >= VISION_CHECK_INTERVAL;
    if (shouldCheckVision) this.visionCheckAccum = 0;

    for (const guard of this.guards) {
      this.stepGuardMovement(guard, dt);
      guard.coneMaterial.color.setHex(CONE_COLORS[guard.state]);

      const alerted = this.tickGuardState(guard, dt);
      if (alerted) continue;

      if (shouldCheckVision) guard.seen = this.caughtCooldown <= 0 && this.canSeePlayer(guard);
      this.processGuardAwareness(guard, dt);
    }

    this.stealthReportAccum += dt;
    if (this.stealthReportAccum >= STEALTH_REPORT_INTERVAL) {
      this.stealthReportAccum = 0;
      this.reportStealth();
    }
  }

  /** Ages the guard's current state out; returns true while it is still alert. */
  private tickGuardState(guard: Guard, dt: number): boolean {
    if (guard.state === "alert") {
      guard.awareness = 0;
      guard.stateTimer -= dt;
      if (guard.stateTimer <= 0) this.returnGuardToPatrol(guard);
      return true;
    }

    if (guard.state === "investigate") {
      guard.stateTimer -= dt;
      if (guard.stateTimer <= 0) {
        guard.investigateTarget = null;
        this.returnGuardToPatrol(guard);
      }
    }
    return false;
  }

  /** Sends a guard back to its patrol loop, forcing a fresh route next step. */
  private returnGuardToPatrol(guard: Guard) {
    guard.state = "patrol";
    guard.destination = null;
    guard.path = [];
  }

  /**
   * Fills or drains this guard's awareness, and moves it through the states the
   * meter implies.
   *
   * Distance, light and stance all feed the fill rate, so the same cone sweeping
   * over a crouched player in shadow is survivable where it would be fatal to
   * someone sprinting upright under a lamp.
   */
  private processGuardAwareness(guard: Guard, dt: number) {
    const rate = guard.seen
      ? awarenessRate({
          distance: guard.group.position.distanceTo(this.player.position),
          visionRange: VISION_RANGE,
          illumination: this.playerIllumination(),
          stance: this.stance,
        })
      : 0;
    guard.awareness = stepAwareness(guard.awareness, rate, guard.seen, dt);

    if (guard.awareness >= AWARENESS_FULL) {
      this.onCaught(guard);
      return;
    }
    if (guard.awareness >= AWARENESS_SUSPICIOUS) {
      this.raiseSuspicion(guard);
    } else if (guard.state === "suspicious" && guard.awareness <= 0) {
      this.returnGuardToPatrol(guard);
    }
  }

  /**
   * Halts a guard that has half-noticed something, facing the player's last
   * known position. Standing still is the tell: a cone that stops sweeping is
   * the player's cue to break line of sight before the meter tops out.
   */
  private raiseSuspicion(guard: Guard) {
    if (guard.state === "investigate" || guard.state === "alert") return;
    guard.state = "suspicious";
    guard.investigateTarget = this.player.position.clone().setY(0);
    guard.destination = null;
    guard.path = [];
  }

  /** Routes a guard toward its current objective, re-pathing when that changes. */
  private stepGuardMovement(guard: Guard, dt: number) {
    if (guard.state === "suspicious") {
      this.faceSuspicion(guard, dt);
      return;
    }

    const target =
      guard.state === "investigate" && guard.investigateTarget
        ? guard.investigateTarget
        : guard.waypoints[guard.waypointIndex];

    if (!guard.destination?.equals(target)) {
      guard.destination = target.clone();
      guard.path = this.pathBetween(guard.group.position, target, this.guardBlockedCells(), false);
    }

    const waypoint = guard.path[0];
    if (!waypoint) {
      if (guard.state === "patrol" && guard.waypoints.length > 1) {
        guard.waypointIndex = (guard.waypointIndex + 1) % guard.waypoints.length;
        guard.destination = null;
      }
      return;
    }

    const toWaypoint = new THREE.Vector3().subVectors(waypoint, guard.group.position).setY(0);
    const dist = toWaypoint.length();
    if (dist <= 0.15) {
      guard.path.shift();
      return;
    }

    toWaypoint.normalize();
    guard.group.position.addScaledVector(toWaypoint, GUARD_SPEED * dt);
    const desiredYaw = Math.atan2(toWaypoint.x, toWaypoint.z);
    guard.group.rotation.y = lerpAngle(guard.group.rotation.y, desiredYaw, Math.min(1, dt * 6));
  }

  /** Turns a suspicious guard toward what it half-saw, without closing the distance. */
  private faceSuspicion(guard: Guard, dt: number) {
    const target = guard.investigateTarget;
    if (!target) return;
    const toTarget = new THREE.Vector3().subVectors(target, guard.group.position).setY(0);
    if (toTarget.lengthSq() < 1e-6) return;
    const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
    guard.group.rotation.y = lerpAngle(guard.group.rotation.y, desiredYaw, Math.min(1, dt * 4));
  }

  /** True when the guard currently has an unobstructed view of the player. */
  private canSeePlayer(guard: Guard): boolean {
    const guardPos = guard.group.position;
    const playerPos = this.player.position;
    const toPlayer = new THREE.Vector3(playerPos.x - guardPos.x, 0, playerPos.z - guardPos.z);
    const distance = toPlayer.length();
    if (distance > VISION_RANGE) return false;

    toPlayer.normalize();
    const forward = new THREE.Vector3(
      Math.sin(guard.group.rotation.y),
      0,
      Math.cos(guard.group.rotation.y)
    );
    const angle = forward.angleTo(toPlayer);
    if (angle > VISION_HALF_FOV) return false;

    const guardEye = new THREE.Vector3(guardPos.x, GUARD_EYE_HEIGHT, guardPos.z);
    const playerEye = new THREE.Vector3(playerPos.x, GUARD_EYE_HEIGHT, playerPos.z);
    return !this.lineOfSightBlocked(guardEye, playerEye);
  }

  /** Raises the alarm: the guard goes alert and the player restarts from spawn. */
  private onCaught(guard: Guard) {
    guard.state = "alert";
    guard.stateTimer = 1.4;
    guard.destination = null;
    guard.path = [];
    this.caughtCooldown = 1.6;
    // caughtCooldown suppresses vision checks for everyone, so any guard that
    // had already banked sight time would otherwise resume the grace period
    // part-spent and catch the respawned player almost immediately.
    for (const other of this.guards) {
      other.awareness = 0;
      other.seen = false;
    }
    this.hackProgress = 0;

    this.resetPlayerToSpawn();
    this.iso.jumpTo(this.player.position);

    this.callbacks.onCaught?.();
  }

  /** Drives console progress while the player holds position in range. */
  private updateHack(dt: number) {
    const dist = Math.hypot(
      this.player.position.x - this.terminalWorld.x,
      this.player.position.z - this.terminalWorld.z
    );
    const canInteract = dist <= INTERACT_DISTANCE;
    const hacking =
      canInteract && (this.keys.has("KeyE") || (this.autoHack && !this.playerPath[0]));

    if (hacking) {
      this.hackProgress = Math.min(1, this.hackProgress + dt / HACK_DURATION);
      if (this.hackProgress >= 1) {
        this.finished = true;
        this.autoHack = false;
        this.callbacks.onWin?.();
      }
    } else {
      this.hackProgress = Math.max(0, this.hackProgress - dt * 1.5);
    }

    this.callbacks.onHackProgress?.(this.hackProgress, canInteract);
  }
}

/** Axis-aligned square of `size` centred on a world XZ point. */
function boxAround(x: number, z: number, size: number): Box {
  const half = size / 2;
  return { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half };
}

/** True when a circle of `radius` at (x, z) overlaps the box. */
function overlapsBox(x: number, z: number, box: Box, radius: number): boolean {
  const nearestX = THREE.MathUtils.clamp(x, box.minX, box.maxX);
  const nearestZ = THREE.MathUtils.clamp(z, box.minZ, box.maxZ);
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2 < radius * radius;
}

/** Lerps between angles the short way round, so guards never spin the long way. */
function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + delta * t;
}
