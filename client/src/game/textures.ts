/**
 * Procedurally drawn surface textures for the vault.
 *
 * Everything here is painted into a `<canvas>` at load time rather than shipped
 * as image files: the easter egg should not add megabytes to the bundle, and a
 * tiling 256px pattern is all a fixed isometric camera can resolve anyway.
 *
 * Each texture is drawn in *greyscale* around mid-luminance and tinted by the
 * material's `color`, so one stone pattern serves the floor, the walls and the
 * pillars at three different tints. The same canvas is reused as a `bumpMap`,
 * where its luminance becomes relief — which is what makes the sodium lamps rake
 * across the masonry instead of washing it flat.
 *
 * Like the engine itself this needs a browser to do anything, so it is not unit
 * tested; `null` comes back wherever a 2D context is unavailable and callers
 * fall back to an untextured material.
 */

import * as THREE from "three";
import { mulberry32 } from "./rng";

/** Edge length of every generated texture. Powers of two mip and wrap cleanly. */
const SIZE = 256;

/** A drawn texture and the bump map derived from the same pixels. */
export interface VaultTexture {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  bumpScale: number;
}

type Painter = (ctx: CanvasRenderingContext2D, random: () => number) => void;

const cache = new Map<string, VaultTexture | null>();

/**
 * Paints one texture, wraps it for tiling, and scales it to `repeat` tiles.
 *
 * Results are cached by pattern *and* scale. A level has dozens of wall
 * segments, and every one of them needs its own **material** so occlusion can
 * fade a single segment — but they all want the same image on the GPU. The
 * scale has to be part of the key because `repeat` lives on the texture rather
 * than the material: cloning per material would give the wide floor its own
 * scale at the cost of a fresh GPU upload per mesh, and a leak on every replay,
 * since disposing a material does not dispose its textures.
 */
function build(
  name: string,
  seed: number,
  paint: Painter,
  bumpScale: number,
  repeat: number
): VaultTexture | null {
  const key = `${name}@${repeat}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    cache.set(key, null);
    return null;
  }

  paint(ctx, mulberry32(seed));

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.colorSpace = THREE.SRGBColorSpace;

  // The bump map reads the same canvas as linear height rather than as colour,
  // and a texture carries exactly one colour space, so it needs its own object.
  const bumpMap = new THREE.CanvasTexture(canvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(repeat, repeat);

  const texture: VaultTexture = { map, bumpMap, bumpScale };
  cache.set(key, texture);
  return texture;
}

/** Grain that hides the flatness of a solid fill. Drawn wrapped, so it tiles. */
function speckle(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  alpha: number
) {
  for (let i = 0; i < count; i++) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const r = 0.5 + random() * 2.5;
    const shade = Math.floor(random() * 255);
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draws a course of blocks with recessed joints, wrapping at the edges.
 *
 * Blocks are drawn *bright*: the pattern multiplies into the material colour, so
 * a mid-grey pattern over a dark palette tint darkens the surface twice and the
 * lamps end up lighting nothing. `stagger` breaks the bond between courses so
 * the joints do not line up into a grid.
 */
function courses(
  ctx: CanvasRenderingContext2D,
  random: () => number,
  rows: number,
  cols: number,
  stagger: boolean
) {
  const rowHeight = SIZE / rows;
  const colWidth = SIZE / cols;
  ctx.lineWidth = 2;

  for (let row = 0; row < rows; row++) {
    const y = row * rowHeight;
    const offset = stagger && row % 2 === 1 ? colWidth / 2 : 0;
    for (let col = -1; col < cols; col++) {
      const x = col * colWidth + offset;
      // Each block gets its own shade, so a course reads as separate stones.
      const shade = 186 + Math.floor(random() * 55);
      ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
      ctx.fillRect(x + 1.5, y + 1.5, colWidth - 3, rowHeight - 3);
      // A dark joint and a light top edge: cheap, and enough for the bump map
      // to catch a lamp along every course.
      ctx.strokeStyle = "rgba(40, 36, 32, 0.85)";
      ctx.strokeRect(x + 1.5, y + 1.5, colWidth - 3, rowHeight - 3);
      ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
      ctx.fillRect(x + 1.5, y + 1.5, colWidth - 3, 2);
    }
  }
}

/** Damp flagstones: large slabs, worn unevenly, with grit in the joints. */
export function stoneFloorTexture(repeat: number): VaultTexture | null {
  return build(
    "stone-floor",
    0x51a6,
    (ctx, random) => {
      ctx.fillStyle = "rgb(186, 180, 172)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      courses(ctx, random, 4, 4, true);
      // Damp patches, darker than the slabs and unrelated to the joints, so the
      // floor does not read as a tiled grid from above.
      for (let i = 0; i < 14; i++) {
        const x = random() * SIZE;
        const y = random() * SIZE;
        const r = 10 + random() * 34;
        const patch = ctx.createRadialGradient(x, y, 0, x, y, r);
        patch.addColorStop(0, "rgba(70, 66, 62, 0.5)");
        patch.addColorStop(1, "rgba(70, 66, 62, 0)");
        ctx.fillStyle = patch;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      speckle(ctx, random, 900, 0.1);
    },
    0.35,
    repeat
  );
}

/** Coursed masonry for walls and pillars: smaller blocks, deeper joints. */
export function masonryTexture(repeat: number): VaultTexture | null {
  return build(
    "masonry",
    0x9c31,
    (ctx, random) => {
      ctx.fillStyle = "rgb(178, 170, 161)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      courses(ctx, random, 8, 4, true);
      speckle(ctx, random, 700, 0.12);
    },
    0.6,
    repeat
  );
}

/** Rough sawn timber: planks along one axis, with knots and end banding. */
export function timberTexture(repeat: number): VaultTexture | null {
  return build(
    "timber",
    0x2f77,
    (ctx, random) => {
      ctx.fillStyle = "rgb(198, 176, 146)";
      ctx.fillRect(0, 0, SIZE, SIZE);

      const planks = 5;
      const plankWidth = SIZE / planks;
      for (let i = 0; i < planks; i++) {
        const shade = 182 + Math.floor(random() * 60);
        ctx.fillStyle = `rgb(${shade}, ${Math.floor(shade * 0.92)}, ${Math.floor(shade * 0.78)})`;
        ctx.fillRect(i * plankWidth + 1, 0, plankWidth - 2, SIZE);
        // Grain: long, near-horizontal strokes that follow the plank.
        for (let g = 0; g < 26; g++) {
          ctx.strokeStyle = `rgba(90, 74, 56, ${0.1 + random() * 0.2})`;
          ctx.lineWidth = 0.5 + random();
          const y = random() * SIZE;
          ctx.beginPath();
          ctx.moveTo(i * plankWidth + 2, y);
          ctx.bezierCurveTo(
            i * plankWidth + plankWidth * 0.3,
            y + (random() - 0.5) * 8,
            i * plankWidth + plankWidth * 0.7,
            y + (random() - 0.5) * 8,
            i * plankWidth + plankWidth - 2,
            y
          );
          ctx.stroke();
        }
        // A dark gap between planks, which the bump map turns into a groove.
        ctx.fillStyle = "rgba(50, 38, 26, 0.9)";
        ctx.fillRect(i * plankWidth, 0, 2, SIZE);
      }

      // Iron banding across the planks, top and bottom, like a shipping crate.
      ctx.fillStyle = "rgba(70, 62, 54, 0.85)";
      ctx.fillRect(0, 12, SIZE, 14);
      ctx.fillRect(0, SIZE - 26, SIZE, 14);
      speckle(ctx, random, 400, 0.08);
    },
    0.5,
    repeat
  );
}

/** Pitted, riveted iron for door leaves. */
export function ironTexture(repeat: number): VaultTexture | null {
  return build(
    "iron",
    0x71bd,
    (ctx, random) => {
      ctx.fillStyle = "rgb(176, 170, 164)";
      ctx.fillRect(0, 0, SIZE, SIZE);
      // Corrosion blooms, so the leaf is not a flat metal panel.
      for (let i = 0; i < 40; i++) {
        const x = random() * SIZE;
        const y = random() * SIZE;
        const r = 3 + random() * 18;
        const bloom = ctx.createRadialGradient(x, y, 0, x, y, r);
        bloom.addColorStop(0, `rgba(90, 78, 66, ${0.25 + random() * 0.35})`);
        bloom.addColorStop(1, "rgba(90, 78, 66, 0)");
        ctx.fillStyle = bloom;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // Rivets on a regular grid: the one thing on the door that is man-made.
      for (let x = 24; x < SIZE; x += 52) {
        for (let y = 24; y < SIZE; y += 52) {
          const rivet = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 5);
          rivet.addColorStop(0, "rgba(235, 230, 225, 0.9)");
          rivet.addColorStop(1, "rgba(70, 64, 58, 0.9)");
          ctx.fillStyle = rivet;
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      speckle(ctx, random, 600, 0.12);
    },
    0.45,
    repeat
  );
}

/**
 * Applies a drawn texture to a material.
 *
 * The material keeps whatever `color` it was given: the pattern multiplies into
 * it, so the palette still decides what the surface *is* and this only decides
 * how it is worked. A no-op when the texture could not be drawn, which leaves
 * the material as the flat tinted surface it was before.
 */
export function applyTexture(material: THREE.MeshStandardMaterial, texture: VaultTexture | null) {
  if (!texture) return;
  material.map = texture.map;
  material.bumpMap = texture.bumpMap;
  material.bumpScale = texture.bumpScale;
}

/**
 * Drops every cached texture.
 *
 * Materials are disposed per replay and never own these textures, so the cache
 * outlives them; this is called only when the game itself goes away.
 */
export function disposeVaultTextures() {
  for (const texture of cache.values()) {
    texture?.map.dispose();
    texture?.bumpMap.dispose();
  }
  cache.clear();
}
