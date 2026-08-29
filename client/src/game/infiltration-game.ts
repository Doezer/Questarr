import * as THREE from "three";
import { IsoCamera } from "./iso-camera";
import { cellKey, isInterior, type GridPos } from "./grid";
import { findPath, nearestOpenCell } from "./pathfinding";
import { generateLevel, gridToWorld, worldToGrid, type GeneratedLevel } from "./level";

export interface InfiltrationGameCallbacks {
  onPauseChange?: (paused: boolean) => void;
  onCaught?: () => void;
  onWin?: () => void;
  /** Fires every frame while near the terminal, progress in [0, 1]. */
  onHackProgress?: (progress: number, canInteract: boolean) => void;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

type GuardState = "patrol" | "investigate" | "alert";

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
  /** Seconds this guard has held the player in sight, reset when the view breaks. */
  spottedFor: number;
}

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
const VISION_RANGE = 9;
const VISION_HALF_FOV = THREE.MathUtils.degToRad(32);
const VISION_CHECK_INTERVAL = 0.15;
/**
 * How long a guard must hold the player in sight before raising the alarm. The
 * first-person build could catch on the first frame because the player could see
 * only what was in front of them; from a fixed isometric view the vision cones are
 * drawn on the floor, so the player deserves the moment it takes to react to one
 * sweeping over them.
 */
const SPOT_GRACE = 0.55;
const GUARD_SPEED = 2.2;
const GUARD_EYE_HEIGHT = 1.2;
const NOISE_RADIUS = 6.5;
const INTERACT_DISTANCE = 2.4;
const HACK_DURATION = 2;
const THROW_COOLDOWN = 1;
const OCCLUDED_OPACITY = 0.2;
const CONE_COLORS: Record<GuardState, number> = {
  patrol: 0xffd23c,
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
  private blockedCells = new Set<string>();
  private crateBoxes: Box[] = [];
  private occluders: Occluder[] = [];
  private roomHalfExtent = 0;
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

    this.scene.fog = new THREE.Fog(0x0d121b, 62, 130);
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
    this.playerPath = [];
    this.clearScene();
    this.hackProgress = 0;
    this.autoHack = false;
    this.finished = false;
    this.caughtCooldown = 0;
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

  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.keys.clear();
      this.velocity.set(0, 0);
    }
    this.callbacks.onPauseChange?.(paused);
  }

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

  private buildLevel(seed: number) {
    this.level = generateLevel(seed);
    this.roomHalfExtent = (this.level.gridSize * this.level.cellSize) / 2;
    this.iso.setBounds(this.roomHalfExtent);
    this.crateBoxes = [];
    this.blockedCells = new Set(this.level.crates.map(cellKey));

    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x232a3a, 1.5));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xd6e4ff, 1.15);
    key.position.set(12, 20, 8);
    this.scene.add(key);
    const accent = new THREE.PointLight(0x6ee7ff, 40, 30, 2);
    accent.position.set(0, 6, 0);
    this.scene.add(accent);

    const floorSize = this.level.gridSize * this.level.cellSize;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshStandardMaterial({ color: 0x222b3b, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.buildFloorGrid(floorSize);

    this.buildWalls(floorSize);
    for (const cratePos of this.level.crates) this.buildCrate(cratePos);
    this.buildTerminal();
    this.buildGuards();
    this.buildCursorMeshes();
    this.buildPlayer();
  }

  /** Faint tile lines, so click-to-move destinations are readable at a glance. */
  private buildFloorGrid(floorSize: number) {
    const grid = new THREE.GridHelper(floorSize, this.level.gridSize, 0x3c4c68, 0x2f3c53);
    grid.position.y = 0.01;
    this.scene.add(grid);
  }

  private buildWalls(floorSize: number) {
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
    this.crateBoxes.push({
      minX: world.x - CRATE_SIZE / 2,
      maxX: world.x + CRATE_SIZE / 2,
      minZ: world.z - CRATE_SIZE / 2,
      maxZ: world.z + CRATE_SIZE / 2,
    });
  }

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
        spottedFor: 0,
      });
    }
  }

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

    this.player.add(body, nose, shadow);
    this.scene.add(this.player);
    this.resetPlayerToSpawn();
    this.iso.jumpTo(this.player.position);
  }

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

  private handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.iso.resize(width, height);
    this.renderer.setSize(width, height, false);
  }

  private updateHoverMesh() {
    if (!this.pointerGround || this.paused) {
      this.hoverMesh.visible = false;
      return;
    }
    const cell = worldToGrid(this.pointerGround.x, this.pointerGround.z, this.level);
    const world = gridToWorld(cell, this.level);
    this.hoverMesh.position.set(world.x, 0.02, world.z);
    this.hoverMesh.visible = true;
    const walkable = isInterior(cell, this.level.gridSize) && !this.blockedCells.has(cellKey(cell));
    this.hoverMaterial.color.setHex(walkable ? 0xffffff : 0xff6b6b);
    this.hoverMaterial.opacity = walkable ? 0.1 : 0.16;
  }

  // --- orders and pathing ----------------------------------------------

  /** Issues a move order to a world-space ground point, cancelling any hack intent. */
  private orderMoveTo(point: THREE.Vector3, keepHackIntent = false) {
    if (!keepHackIntent) this.autoHack = false;

    const destination = this.resolveDestination(point);
    if (!destination) return;

    const path = this.pathTo(destination);
    if (path.length === 0) {
      // Already close enough that no pathing is needed — just walk straight there.
      if (this.segmentClear(this.player.position, destination)) {
        this.playerPath = [destination];
      } else {
        return;
      }
    } else {
      this.playerPath = path;
    }

    this.stuckTimer = 0;
    this.lastWaypointDistance = Infinity;
    this.markerMesh.position.set(destination.x, 0.03, destination.z);
    this.markerMesh.visible = true;
  }

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
    const bound = this.roomHalfExtent - 0.6;
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(point.x, -bound, bound),
      0,
      THREE.MathUtils.clamp(point.z, -bound, bound)
    );
    if (!this.collides(clamped.x, clamped.z)) return clamped;

    const cell = nearestOpenCell(
      worldToGrid(clamped.x, clamped.z, this.level),
      this.level.gridSize,
      this.blockedCells
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
    return this.pathBetween(this.player.position, destination);
  }

  private pathBetween(from: THREE.Vector3, destination: THREE.Vector3): THREE.Vector3[] {
    const startCell = worldToGrid(from.x, from.z, this.level);
    const goalCell = worldToGrid(destination.x, destination.z, this.level);
    const cells = findPath(startCell, goalCell, this.level.gridSize, this.blockedCells);

    const points = cells.map((cell) => {
      const world = gridToWorld(cell, this.level);
      return new THREE.Vector3(world.x, 0, world.z);
    });
    // The last grid cell is only the destination's cell; finish on the real point.
    if (points.length > 0) points[points.length - 1] = destination.clone();
    else if (this.segmentClear(from, destination)) points.push(destination.clone());

    return this.smoothPath(from, points);
  }

  /**
   * String-pulling: repeatedly jump to the furthest waypoint still reachable in a
   * straight line, which turns A*'s cardinal staircase into natural diagonals.
   */
  private smoothPath(from: THREE.Vector3, points: THREE.Vector3[]): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    let cursor = from.clone();
    let i = 0;
    while (i < points.length) {
      let furthest = i;
      for (let j = points.length - 1; j > i; j--) {
        if (this.segmentClear(cursor, points[j])) {
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
  private segmentClear(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(dist / 0.3));
    const bound = this.roomHalfExtent - 0.5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(from.x, to.x, t);
      const z = THREE.MathUtils.lerp(from.z, to.z, t);
      if (Math.abs(x) >= bound || Math.abs(z) >= bound) return false;
      if (this.collides(x, z)) return false;
    }
    return true;
  }

  // --- per-frame update -------------------------------------------------

  private update(dt: number) {
    if (!this.paused && !this.finished) {
      this.updatePlayerMovement(dt);
      this.updateProjectiles(dt);
      this.updateGuards(dt);
      this.updateHack(dt);
    }
    if (this.caughtCooldown > 0) this.caughtCooldown -= dt;
    if (this.throwCooldown > 0) this.throwCooldown -= dt;

    this.iso.follow(this.player.position, dt);
    this.updateOcclusion();
    this.updateMarker(dt);
  }

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

    this.velocity.x += (dx / distance) * PLAYER_SPEED * dt * 8;
    this.velocity.y += (dz / distance) * PLAYER_SPEED * dt * 8;
    this.velocity.clampLength(0, PLAYER_SPEED);
    this.trackWaypointProgress(distance, dt);
  }

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

  private abortPath() {
    this.playerPath = [];
    this.velocity.set(0, 0);
    this.stuckTimer = 0;
    this.lastWaypointDistance = Infinity;
    this.markerMesh.visible = false;
  }

  private moveWithCollision(dx: number, dz: number) {
    const pos = this.player.position;
    const bound = this.roomHalfExtent - 0.5;

    const nextX = pos.x + dx;
    if (!this.collides(nextX, pos.z) && Math.abs(nextX) < bound) pos.x = nextX;

    const nextZ = pos.z + dz;
    if (!this.collides(pos.x, nextZ) && Math.abs(nextZ) < bound) pos.z = nextZ;
  }

  private collides(x: number, z: number): boolean {
    for (const box of this.crateBoxes) {
      const nearestX = THREE.MathUtils.clamp(x, box.minX, box.maxX);
      const nearestZ = THREE.MathUtils.clamp(z, box.minZ, box.maxZ);
      const distSq = (x - nearestX) ** 2 + (z - nearestZ) ** 2;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) return true;
    }
    return false;
  }

  private lineOfSightBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dist = from.distanceTo(to);
    const steps = Math.ceil(dist / 0.6);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = THREE.MathUtils.lerp(from.x, to.x, t);
      const z = THREE.MathUtils.lerp(from.z, to.z, t);
      for (const box of this.crateBoxes) {
        if (
          x >= box.minX - 0.3 &&
          x <= box.maxX + 0.3 &&
          z >= box.minZ - 0.3 &&
          z <= box.maxZ + 0.3
        ) {
          return true;
        }
      }
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

  private updateMarker(dt: number) {
    if (!this.markerMesh.visible) return;
    this.markerPulse = (this.markerPulse + dt * 3) % (Math.PI * 2);
    this.markerMaterial.opacity = 0.5 + 0.3 * Math.sin(this.markerPulse);
  }

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

  private emitNoise(position: THREE.Vector3) {
    for (const guard of this.guards) {
      if (guard.state === "alert") continue;
      if (guard.group.position.distanceTo(position) <= NOISE_RADIUS) {
        guard.state = "investigate";
        guard.investigateTarget = position.clone().setY(0);
        guard.stateTimer = 3;
        // Force a fresh route to the noise on the next movement step.
        guard.destination = null;
        guard.path = [];
      }
    }
  }

  private updateGuards(dt: number) {
    this.visionCheckAccum += dt;
    const shouldCheckVision = this.visionCheckAccum >= VISION_CHECK_INTERVAL;
    if (shouldCheckVision) this.visionCheckAccum = 0;

    for (const guard of this.guards) {
      this.stepGuardMovement(guard, dt);
      guard.coneMaterial.color.setHex(CONE_COLORS[guard.state]);

      const alerted = this.tickGuardState(guard, dt);
      if (alerted) continue;

      if (shouldCheckVision && this.caughtCooldown <= 0) this.processGuardVision(guard);
    }
  }

  /** Ages the guard's current state out; returns true while it is still alert. */
  private tickGuardState(guard: Guard, dt: number): boolean {
    if (guard.state === "alert") {
      guard.spottedFor = 0;
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

  private returnGuardToPatrol(guard: Guard) {
    guard.state = "patrol";
    guard.destination = null;
    guard.path = [];
  }

  /** Accumulates sight time and raises the alarm once the grace window elapses. */
  private processGuardVision(guard: Guard) {
    if (!this.canSeePlayer(guard)) {
      guard.spottedFor = 0;
      return;
    }

    guard.spottedFor += VISION_CHECK_INTERVAL;
    // Closing in on the player reads as the guard reacting, and gives the
    // player a visible cue that they have been noticed.
    if (guard.state === "patrol") {
      guard.state = "investigate";
      guard.investigateTarget = this.player.position.clone().setY(0);
      guard.stateTimer = 3;
      guard.destination = null;
      guard.path = [];
    }
    if (guard.spottedFor >= SPOT_GRACE) this.onCaught(guard);
  }

  private stepGuardMovement(guard: Guard, dt: number) {
    const target =
      guard.state === "investigate" && guard.investigateTarget
        ? guard.investigateTarget
        : guard.waypoints[guard.waypointIndex];

    if (!guard.destination || !guard.destination.equals(target)) {
      guard.destination = target.clone();
      guard.path = this.pathBetween(guard.group.position, target);
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

  private onCaught(guard: Guard) {
    guard.state = "alert";
    guard.stateTimer = 1.4;
    guard.destination = null;
    guard.path = [];
    this.caughtCooldown = 1.6;
    // caughtCooldown suppresses vision checks for everyone, so any guard that
    // had already banked sight time would otherwise resume the grace period
    // part-spent and catch the respawned player almost immediately.
    for (const other of this.guards) other.spottedFor = 0;
    this.hackProgress = 0;

    this.resetPlayerToSpawn();
    this.iso.jumpTo(this.player.position);

    this.callbacks.onCaught?.();
  }

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

/** Lerps between angles the short way round, so guards never spin the long way. */
function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + delta * t;
}
