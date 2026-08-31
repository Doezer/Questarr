/**
 * Stealth math for the infiltration game: stance, illumination, movement noise
 * and the guard awareness meter.
 *
 * All of it is pure functions over plain numbers, deliberately: the engine needs
 * a WebGL context and so cannot be unit-tested, but this is where the rules that
 * decide whether a run succeeds actually live.
 */

import type { GridPos } from "./grid";

/** How the player is carrying themselves, which drives noise and visibility. */
export type Stance = "standing" | "crouched";

export interface StanceProfile {
  /** Multiplier on the player's top speed. */
  speed: number;
  /** Multiplier on the noise radius movement emits. */
  noise: number;
  /** Multiplier on how fast a guard's awareness fills. */
  visibility: number;
  /** Vertical scale for the player mesh, so the stance reads on screen. */
  height: number;
}

/**
 * Crouching costs more than half the player's speed and buys back rather less
 * than half their visibility, so it is a deliberate trade rather than a strictly
 * better way to move.
 */
export const STANCES: Record<Stance, StanceProfile> = {
  standing: { speed: 1, noise: 1, visibility: 1, height: 1 },
  crouched: { speed: 0.45, noise: 0.35, visibility: 0.55, height: 0.6 },
};

/**
 * World-space radius over which a room lamp still contributes light.
 *
 * This is the single cutoff: the engine hands it to each `THREE.PointLight` as
 * its range, so the pool a player can see and the pool detection reads end at
 * the same place. The falloff *shapes* still differ — the renderer is physical
 * (inverse-square), this is linear — but a spot that looks dark is dark, which
 * is the property the stealth routing depends on.
 */
export const LAMP_RADIUS = 9;
/** Intensity for a lamp of {@link LAMP_RADIUS}, tuned so the pool reads on screen. */
export const LAMP_INTENSITY = 30;

/**
 * Illumination at a world-space point, 0 in full shadow to 1 directly beneath a
 * lamp. Only the nearest lamp counts: overlapping pools that summed to more than
 * 1 would make the mid-room seams brighter than the lamps themselves.
 */
export function illuminationAt(
  x: number,
  z: number,
  lamps: readonly { x: number; z: number }[],
  radius: number = LAMP_RADIUS
): number {
  if (radius <= 0) return 0;
  let brightest = 0;
  for (const lamp of lamps) {
    const distance = Math.hypot(x - lamp.x, z - lamp.z);
    if (distance >= radius) continue;
    brightest = Math.max(brightest, 1 - distance / radius);
  }
  return brightest;
}

/** Radius of the noise a thrown distraction makes on landing. */
export const THROW_NOISE_RADIUS = 6.5;
/** Radius of the noise a player running flat out makes. */
export const MOVEMENT_NOISE_RADIUS = 4.2;
/** Below this fraction of top speed, movement is silent. */
const SILENT_SPEED_FRACTION = 0.05;

/**
 * Earshot of the player's own footsteps. Sprinting upright carries; creeping is
 * silent, which is what makes crouch worth its speed cost when guards are close.
 */
export function noiseRadiusFor(
  stance: Stance,
  speedFraction: number,
  baseRadius: number = MOVEMENT_NOISE_RADIUS
): number {
  const fraction = Math.min(Math.max(speedFraction, 0), 1);
  if (fraction <= SILENT_SPEED_FRACTION) return 0;
  return baseRadius * STANCES[stance].noise * fraction;
}

/** Awareness at which a guard breaks patrol to come and look. */
export const AWARENESS_SUSPICIOUS = 0.3;
/** Awareness at which the guard is certain and the run is blown. */
export const AWARENESS_FULL = 1;
/** Awareness lost per second once the guard's view of the player breaks. */
export const AWARENESS_DECAY = 0.45;

/**
 * Worst-case fill rate, in awareness per second.
 *
 * Phases 1 and 2 caught the player after 0.55s of unbroken sight, which play-
 * tested as a fair window from a fixed isometric camera. That number survives
 * here as the *ceiling*: standing upright, lit, and right on top of a guard
 * still takes 0.55s, and every other situation is slower.
 */
const PEAK_RATE = 1 / 0.55;
/** Share of the rate that proximity controls; the rest applies at any range. */
const PROXIMITY_WEIGHT = 0.65;
/** Share of the rate that light controls. */
const LIGHT_WEIGHT = 0.75;

export interface AwarenessInput {
  /** Distance from guard to player, in world units. */
  distance: number;
  /** The guard's sight range; beyond it the player is not visible at all. */
  visionRange: number;
  /** Illumination at the player's feet, from {@link illuminationAt}. */
  illumination: number;
  stance: Stance;
}

/**
 * How fast this guard's awareness fills, per second of unbroken sight.
 *
 * Neither distance nor darkness can zero the rate out — a guard staring
 * straight at someone eventually notices them however far away and however
 * dim — but together they can slow it by roughly an order of magnitude, which
 * is what makes shadow worth routing through.
 */
export function awarenessRate({
  distance,
  visionRange,
  illumination,
  stance,
}: AwarenessInput): number {
  if (visionRange <= 0 || distance > visionRange) return 0;
  const proximity = 1 - Math.min(Math.max(distance / visionRange, 0), 1);
  const light = Math.min(Math.max(illumination, 0), 1);
  return (
    PEAK_RATE *
    (1 - PROXIMITY_WEIGHT + PROXIMITY_WEIGHT * proximity) *
    (1 - LIGHT_WEIGHT + LIGHT_WEIGHT * light) *
    STANCES[stance].visibility
  );
}

/**
 * Advances an awareness meter by one step, clamped to [0, 1]. `seen` decides
 * whether it fills at `rate` or decays.
 */
export function stepAwareness(current: number, rate: number, seen: boolean, dt: number): number {
  const delta = seen ? rate * dt : -AWARENESS_DECAY * dt;
  return Math.min(AWARENESS_FULL, Math.max(0, current + delta));
}

/** Room lamp positions in world space, one per room centre. */
export function lampPositions(
  rooms: readonly { x: number; z: number; w: number; h: number }[],
  toWorld: (cell: GridPos) => { x: number; z: number }
): { x: number; z: number }[] {
  return rooms.map((room) =>
    toWorld({ x: room.x + (room.w - 1) / 2, z: room.z + (room.h - 1) / 2 })
  );
}
