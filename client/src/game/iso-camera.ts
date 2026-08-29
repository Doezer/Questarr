import * as THREE from "three";

/**
 * Fixed isometric camera rig.
 *
 * The camera sits on the normalized (1, 1, 1) diagonal, which is exactly the
 * classic dimetric view: 45 degrees of yaw and atan(1 / sqrt(2)) ~= 35.26 degrees
 * of pitch. An orthographic projection keeps parallel lines parallel so the scene
 * reads as a flat 2D board rather than a 3D room seen from above.
 */
const ISO_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();
/** Ortho projection makes this purely a near/far concern, not a scale one. */
const CAMERA_DISTANCE = 60;
const DEFAULT_VIEW_SIZE = 26;
const MIN_VIEW_SIZE = 14;
const MAX_VIEW_SIZE = 40;
const FOLLOW_LERP_RATE = 6;

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;

  private target = new THREE.Vector3();
  /** Half-width of the play area the camera keeps framed, 0 for unbounded. */
  private boundHalfExtent = 0;
  private viewSize = DEFAULT_VIEW_SIZE;
  private aspect = 1;
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.applyTransform();
  }

  /**
   * Limits how far the camera target may travel from the origin, so following a
   * player into a corner doesn't leave two thirds of the screen showing the void
   * outside the room.
   */
  setBounds(halfExtent: number) {
    this.boundHalfExtent = halfExtent;
  }

  /** Snaps the camera to a target without easing, for spawns and respawns. */
  jumpTo(position: THREE.Vector3) {
    this.target.copy(this.clampToBounds(position));
    this.applyTransform();
  }

  /** Eases the camera toward a target, framerate-independently. */
  follow(position: THREE.Vector3, dt: number) {
    this.target.lerp(this.clampToBounds(position), 1 - Math.exp(-FOLLOW_LERP_RATE * dt));
    this.applyTransform();
  }

  /** Keeps the camera target inside the play area, with a margin for the view size. */
  private clampToBounds(position: THREE.Vector3): THREE.Vector3 {
    if (this.boundHalfExtent <= 0) return position;
    // The frustum is rotated 45 degrees against the room, so this is a deliberate
    // approximation: leave roughly a third of the view size as margin.
    const limit = Math.max(0, this.boundHalfExtent - this.viewSize * 0.35);
    return new THREE.Vector3(
      THREE.MathUtils.clamp(position.x, -limit, limit),
      position.y,
      THREE.MathUtils.clamp(position.z, -limit, limit)
    );
  }

  /** Rebuilds the frustum for a new canvas size, preserving the current zoom. */
  resize(width: number, height: number) {
    this.aspect = width / height;
    this.applyFrustum();
  }

  /** Wheel zoom, in view-size units (positive shrinks the visible area). */
  zoomBy(delta: number) {
    this.viewSize = THREE.MathUtils.clamp(this.viewSize - delta, MIN_VIEW_SIZE, MAX_VIEW_SIZE);
    this.applyFrustum();
  }

  /**
   * Projects a pointer position onto the ground plane (y = 0). Returns null when
   * the ray misses, which an orthographic camera aimed at the floor never does in
   * practice but is still worth not pretending about.
   */
  screenToGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? hit : null;
  }

  /** World-space point the camera looks at, used for occlusion raycasts. */
  get eye(): THREE.Vector3 {
    return this.camera.position;
  }

  /** Re-seats the camera on the iso diagonal, looking at the current target. */
  private applyTransform() {
    this.camera.position.copy(this.target).addScaledVector(ISO_DIRECTION, CAMERA_DISTANCE);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Sizes the orthographic box so `viewSize` world units fill the canvas height. */
  private applyFrustum() {
    const halfHeight = this.viewSize / 2;
    const halfWidth = halfHeight * this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }
}
