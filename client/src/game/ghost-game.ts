import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { generateLevel, gridToWorld, type GeneratedLevel, type GridPos } from "./level";

export interface GhostGameCallbacks {
  onLockChange?: (locked: boolean) => void;
  onCaught?: () => void;
  onWin?: () => void;
  /** Fires ~10x/sec while near the terminal, progress in [0, 1]. */
  onHackProgress?: (progress: number, canInteract: boolean) => void;
}

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface Guard {
  group: THREE.Group;
  waypoints: THREE.Vector3[];
  waypointIndex: number;
  state: "patrol" | "investigate" | "alert";
  stateTimer: number;
  investigateTarget: THREE.Vector3 | null;
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  landed: boolean;
  life: number;
}

const PLAYER_RADIUS = 0.4;
const PLAYER_EYE_HEIGHT = 1.7;
const PLAYER_SPEED = 6;
const CRATE_SIZE = 2.2;
const CRATE_HEIGHT = 1.8;
const WALL_HEIGHT = 4;
const VISION_RANGE = 9;
const VISION_HALF_FOV = THREE.MathUtils.degToRad(32);
const VISION_CHECK_INTERVAL = 0.15;
const GUARD_SPEED = 2.2;
const NOISE_RADIUS = 6.5;
const INTERACT_DISTANCE = 2.2;
const HACK_DURATION = 2;
const THROW_COOLDOWN = 1;

export class GhostGame {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: PointerLockControls;
  private clock = new THREE.Clock();
  private canvas: HTMLCanvasElement;
  private callbacks: GhostGameCallbacks;

  private level!: GeneratedLevel;
  private crateBoxes: Box[] = [];
  private roomHalfExtent = 0;
  private terminalWorld = new THREE.Vector3();
  private guards: Guard[] = [];
  private projectiles: Projectile[] = [];

  private keys = new Set<string>();
  private velocity = new THREE.Vector2();
  private visionCheckAccum = 0;
  private throwCooldown = 0;
  private hackProgress = 0;
  private caughtCooldown = 0;
  private disposed = false;
  private animationHandle = 0;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, seed: number, callbacks: GhostGameCallbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
    this.controls = new PointerLockControls(this.camera, canvas);
    this.controls.addEventListener("lock", () => this.callbacks.onLockChange?.(true));
    this.controls.addEventListener("unlock", () => {
      // Keys held when the player pauses (Esc) may never see their keyup, so clear
      // input state or the player would start moving on their own after resuming.
      this.keys.clear();
      this.velocity.set(0, 0);
      this.callbacks.onLockChange?.(false);
    });

    this.scene.fog = new THREE.Fog(0x05070a, 12, 32);
    this.scene.background = new THREE.Color(0x05070a);

    this.buildLevel(seed);

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(canvas);
    this.handleResize();
  }

  /** Tears down everything and regenerates the room from a fresh seed, keeping the same renderer/camera. */
  regenerate(seed: number) {
    this.guards = [];
    this.projectiles = [];
    this.clearScene();
    this.hackProgress = 0;
    this.buildLevel(seed);
  }

  /** Removes and disposes every scene child so replays don't leak GPU geometry/material memory. */
  private clearScene() {
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    while (this.scene.children.length) this.scene.remove(this.scene.children[0]);
  }

  lock() {
    this.controls.lock();
  }

  start() {
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.animationHandle = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.1);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationHandle);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.resizeObserver.disconnect();
    this.controls.unlock();
    this.clearScene();
    this.renderer.dispose();
  }

  // --- level construction -------------------------------------------------

  private buildLevel(seed: number) {
    this.level = generateLevel(seed);
    this.roomHalfExtent = (this.level.gridSize * this.level.cellSize) / 2;
    this.crateBoxes = [];

    this.scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a12, 0.55));
    const spot = new THREE.PointLight(0x6ee7ff, 6, 20, 2);
    spot.position.set(0, 3.2, 0);
    this.scene.add(spot);

    const floorSize = this.level.gridSize * this.level.cellSize;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.buildWalls(floorSize);
    for (const cratePos of this.level.crates) this.buildCrate(cratePos);
    this.buildTerminal();
    this.buildGuards();

    const spawnWorld = gridToWorld(this.level.spawn, this.level);
    this.camera.position.set(spawnWorld.x, PLAYER_EYE_HEIGHT, spawnWorld.z);
    this.camera.rotation.set(0, 0, 0);
  }

  private buildWalls(floorSize: number) {
    const material = new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.8 });
    const half = floorSize / 2;
    const specs: [number, number, number, number][] = [
      [0, half, floorSize, 0.4], // north (thin in z)
      [0, -half, floorSize, 0.4], // south
      [half, 0, 0.4, floorSize], // east
      [-half, 0, 0.4, floorSize], // west
    ];
    for (const [x, z, w, d] of specs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), material);
      wall.position.set(x, WALL_HEIGHT / 2, z);
      this.scene.add(wall);
    }
  }

  private buildCrate(gridPos: GridPos) {
    const world = gridToWorld(gridPos, this.level);
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(CRATE_SIZE, CRATE_HEIGHT, CRATE_SIZE),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 })
    );
    crate.position.set(world.x, CRATE_HEIGHT / 2, world.z);
    this.scene.add(crate);
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
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.6, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: 0x0e1a16 })
    );
    base.position.y = 0.55;
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.08, 16),
      new THREE.MeshStandardMaterial({
        color: 0x35f0b0,
        emissive: 0x35f0b0,
        emissiveIntensity: 1.4,
      })
    );
    glow.position.y = 1.14;
    group.add(base, glow);
    group.position.set(world.x, 0, world.z);
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
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(Math.tan(VISION_HALF_FOV) * VISION_RANGE, VISION_RANGE, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffd23c,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
        })
      );
      // Cone apex sits at the guard's eyes (local Z=0) and widens outward along +Z,
      // matching the forward vector used by checkVision.
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(0, 0.9, VISION_RANGE / 2);
      group.add(body, cone);
      group.position.copy(waypoints[0]);
      this.scene.add(group);

      this.guards.push({
        group,
        waypoints,
        waypointIndex: 0,
        state: "patrol",
        stateTimer: 0,
        investigateTarget: null,
      });
    }
  }

  // --- input ----------------------------------------------------------

  private handleKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
    if (event.code === "KeyF") this.throwDistraction();
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  // --- per-frame update -------------------------------------------------

  private update(dt: number) {
    if (this.controls.isLocked) {
      this.updatePlayerMovement(dt);
      this.updateProjectiles(dt);
      this.updateGuards(dt);
      this.updateHack(dt);
    }
    if (this.caughtCooldown > 0) this.caughtCooldown -= dt;
    if (this.throwCooldown > 0) this.throwCooldown -= dt;
  }

  private updatePlayerMovement(dt: number) {
    const forwardInput =
      (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) -
      (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
    const rightInput =
      (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) -
      (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);

    const damping = Math.exp(-8 * dt);
    this.velocity.multiplyScalar(damping);
    if (forwardInput !== 0 || rightInput !== 0) {
      const len = Math.hypot(forwardInput, rightInput) || 1;
      this.velocity.x += (rightInput / len) * PLAYER_SPEED * dt * 8;
      this.velocity.y += (forwardInput / len) * PLAYER_SPEED * dt * 8;
      this.velocity.clampLength(0, PLAYER_SPEED);
    }

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();

    const moveX = right.x * this.velocity.x + forward.x * this.velocity.y;
    const moveZ = right.z * this.velocity.x + forward.z * this.velocity.y;

    this.moveWithCollision(moveX * dt, moveZ * dt);
  }

  private moveWithCollision(dx: number, dz: number) {
    const pos = this.camera.position;
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

  private throwDistraction() {
    if (this.throwCooldown > 0 || !this.controls.isLocked) return;
    this.throwCooldown = THROW_COOLDOWN;

    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xffcf6e, emissive: 0x6b4a00 })
    );
    mesh.position.copy(this.camera.position).addScaledVector(forward, 0.6);
    this.scene.add(mesh);

    const velocity = forward.clone().multiplyScalar(9).setY(3.5);
    this.projectiles.push({ mesh, velocity, landed: false, life: 3 });
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      if (!projectile.landed) {
        projectile.velocity.y -= 14 * dt;
        projectile.mesh.position.addScaledVector(projectile.velocity, dt);
        if (projectile.mesh.position.y <= 0.12) {
          projectile.mesh.position.y = 0.12;
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
        guard.investigateTarget = position.clone();
        guard.stateTimer = 3;
      }
    }
  }

  private updateGuards(dt: number) {
    this.visionCheckAccum += dt;
    const shouldCheckVision = this.visionCheckAccum >= VISION_CHECK_INTERVAL;
    if (shouldCheckVision) this.visionCheckAccum = 0;

    for (const guard of this.guards) {
      this.stepGuardMovement(guard, dt);

      if (guard.state === "alert") {
        guard.stateTimer -= dt;
        if (guard.stateTimer <= 0) guard.state = "patrol";
        continue;
      }

      if (guard.state === "investigate") {
        guard.stateTimer -= dt;
        if (guard.stateTimer <= 0) {
          guard.state = "patrol";
          guard.investigateTarget = null;
        }
      }

      if (shouldCheckVision && this.caughtCooldown <= 0) {
        this.checkVision(guard);
      }
    }
  }

  private stepGuardMovement(guard: Guard, dt: number) {
    const target =
      guard.state === "investigate" && guard.investigateTarget
        ? guard.investigateTarget
        : guard.waypoints[guard.waypointIndex];

    const toTarget = new THREE.Vector3().subVectors(target, guard.group.position);
    toTarget.y = 0;
    const dist = toTarget.length();

    if (dist > 0.15) {
      toTarget.normalize();
      guard.group.position.addScaledVector(toTarget, GUARD_SPEED * dt);
      const desiredYaw = Math.atan2(toTarget.x, toTarget.z);
      guard.group.rotation.y = THREE.MathUtils.lerp(
        guard.group.rotation.y,
        desiredYaw,
        Math.min(1, dt * 6)
      );
    } else if (guard.state === "patrol") {
      guard.waypointIndex = (guard.waypointIndex + 1) % guard.waypoints.length;
    }
  }

  private checkVision(guard: Guard) {
    const guardPos = guard.group.position;
    const playerPos = this.camera.position;
    const toPlayer = new THREE.Vector3(playerPos.x - guardPos.x, 0, playerPos.z - guardPos.z);
    const distance = toPlayer.length();
    if (distance > VISION_RANGE) return;

    toPlayer.normalize();
    const forward = new THREE.Vector3(
      Math.sin(guard.group.rotation.y),
      0,
      Math.cos(guard.group.rotation.y)
    );
    const angle = forward.angleTo(toPlayer);
    if (angle > VISION_HALF_FOV) return;

    const guardEye = new THREE.Vector3(guardPos.x, 1.2, guardPos.z);
    const playerEye = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);
    if (this.lineOfSightBlocked(guardEye, playerEye)) return;

    this.onCaught(guard);
  }

  private onCaught(guard: Guard) {
    guard.state = "alert";
    guard.stateTimer = 1.4;
    this.caughtCooldown = 1.6;
    this.hackProgress = 0;

    const spawnWorld = gridToWorld(this.level.spawn, this.level);
    this.camera.position.set(spawnWorld.x, PLAYER_EYE_HEIGHT, spawnWorld.z);

    this.callbacks.onCaught?.();
  }

  private updateHack(dt: number) {
    const dist = Math.hypot(
      this.camera.position.x - this.terminalWorld.x,
      this.camera.position.z - this.terminalWorld.z
    );
    const canInteract = dist <= INTERACT_DISTANCE;

    if (canInteract && this.keys.has("KeyE")) {
      this.hackProgress = Math.min(1, this.hackProgress + dt / HACK_DURATION);
      if (this.hackProgress >= 1) {
        this.callbacks.onWin?.();
        this.controls.unlock();
      }
    } else {
      this.hackProgress = Math.max(0, this.hackProgress - dt * 1.5);
    }

    this.callbacks.onHackProgress?.(this.hackProgress, canInteract);
  }
}
