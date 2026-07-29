import * as THREE from 'three'

// Procedural detail maps for the most common Roblox materials, plus the classic
// baseplate stud grid. All generated on canvas at runtime (client only) — no
// downloaded assets, nothing fetched. Luminance stays in the 0.72..1.0 band so
// THREE's map-multiplies-color pipeline keeps the part's Color dominant; these
// add texture, not palette. Deterministic (seeded PRNG) so reloads look alike.
//
// Sharing model: one canvas per material name; textures are cheap clones of
// that canvas per repeat bucket (clone() shares the underlying image), so a
// 2048-stud baseplate and a 4-stud crate reuse the same pixels at different
// tiling densities.

const TILE = 256

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Painter = (ctx: CanvasRenderingContext2D, rand: () => number) => void

function gray(v: number): string {
  const b = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255)
  return `rgb(${b},${b},${b})`
}

function fillNoise(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  base: number,
  amplitude: number,
  cell: number
) {
  for (let y = 0; y < TILE; y += cell) {
    for (let x = 0; x < TILE; x += cell) {
      ctx.fillStyle = gray(base + (rand() - 0.5) * 2 * amplitude)
      ctx.fillRect(x, y, cell, cell)
    }
  }
}

const PAINTERS: Record<string, Painter> = {
  Concrete: (ctx, rand) => {
    fillNoise(ctx, rand, 0.88, 0.05, 4)
    fillNoise(ctx, rand, 0.88, 0.03, 16)
  },
  Grass: (ctx, rand) => {
    fillNoise(ctx, rand, 0.85, 0.1, 3)
    // sparse blade flecks
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = gray(0.75 + rand() * 0.25)
      ctx.fillRect(Math.floor(rand() * TILE), Math.floor(rand() * TILE), 1, 2 + Math.floor(rand() * 3))
    }
  },
  Sand: (ctx, rand) => {
    fillNoise(ctx, rand, 0.92, 0.04, 2)
  },
  Slate: (ctx, rand) => {
    fillNoise(ctx, rand, 0.85, 0.07, 8)
    ctx.strokeStyle = gray(0.72)
    ctx.lineWidth = 1
    for (let i = 0; i < 14; i++) {
      ctx.beginPath()
      const y = rand() * TILE
      ctx.moveTo(0, y)
      ctx.lineTo(TILE, y + (rand() - 0.5) * 40)
      ctx.stroke()
    }
  },
  Wood: (ctx, rand) => {
    // vertical grain bands
    for (let x = 0; x < TILE; x += 2) {
      const v = 0.86 + Math.sin(x * 0.35) * 0.05 + (rand() - 0.5) * 0.05
      ctx.fillStyle = gray(v)
      ctx.fillRect(x, 0, 2, TILE)
    }
  },
  WoodPlanks: (ctx, rand) => {
    PAINTERS.Wood(ctx, rand)
    ctx.strokeStyle = gray(0.68)
    ctx.lineWidth = 2
    const plank = TILE / 4
    for (let x = 0; x <= TILE; x += plank) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, TILE)
      ctx.stroke()
    }
    // staggered end joints
    for (let i = 0; i < 4; i++) {
      const y = Math.floor(rand() * TILE)
      ctx.beginPath()
      ctx.moveTo(i * plank, y)
      ctx.lineTo((i + 1) * plank, y)
      ctx.stroke()
    }
  },
  Brick: (ctx, rand) => {
    fillNoise(ctx, rand, 0.88, 0.04, 8)
    ctx.strokeStyle = gray(0.7)
    ctx.lineWidth = 3
    const rowH = TILE / 8
    const brickW = TILE / 4
    for (let row = 0; row < 8; row++) {
      const y = row * rowH
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(TILE, y)
      ctx.stroke()
      const offset = row % 2 === 0 ? 0 : brickW / 2
      for (let x = offset; x <= TILE; x += brickW) {
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + rowH)
        ctx.stroke()
      }
    }
  },
  Cobblestone: (ctx, rand) => {
    fillNoise(ctx, rand, 0.86, 0.05, 8)
    ctx.strokeStyle = gray(0.7)
    ctx.lineWidth = 2
    const cell = TILE / 6
    for (let y = 0; y < TILE; y += cell) {
      for (let x = 0; x < TILE; x += cell) {
        const r = cell * (0.38 + rand() * 0.08)
        ctx.beginPath()
        ctx.arc(x + cell / 2 + (rand() - 0.5) * 6, y + cell / 2 + (rand() - 0.5) * 6, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  },
  Metal: (ctx, rand) => {
    // brushed horizontal streaks
    for (let y = 0; y < TILE; y += 1) {
      ctx.fillStyle = gray(0.93 + (rand() - 0.5) * 0.06)
      ctx.fillRect(0, y, TILE, 1)
    }
  },
  DiamondPlate: (ctx, rand) => {
    PAINTERS.Metal(ctx, rand)
    ctx.fillStyle = gray(0.8)
    const step = TILE / 8
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const cx = x * step + step / 2 + (y % 2 === 0 ? 0 : step / 2)
        const cy = y * step + step / 2
        ctx.save()
        ctx.translate(cx % TILE, cy)
        ctx.rotate(Math.PI / 4)
        ctx.fillRect(-step * 0.18, -step * 0.06, step * 0.36, step * 0.12)
        ctx.restore()
      }
    }
  },
  Fabric: (ctx, rand) => {
    fillNoise(ctx, rand, 0.9, 0.03, 2)
    ctx.strokeStyle = gray(0.84)
    ctx.lineWidth = 1
    for (let i = 0; i < TILE; i += 4) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, TILE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(TILE, i)
      ctx.stroke()
    }
  },
  Marble: (ctx, rand) => {
    fillNoise(ctx, rand, 0.95, 0.02, 16)
    ctx.strokeStyle = gray(0.85)
    ctx.lineWidth = 1.5
    for (let i = 0; i < 6; i++) {
      ctx.beginPath()
      let x = rand() * TILE
      let y = 0
      ctx.moveTo(x, y)
      while (y < TILE) {
        x += (rand() - 0.5) * 30
        y += 10 + rand() * 20
        ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  },
}

/** Materials that reuse another painter. */
const ALIASES: Record<string, string> = {
  LeafyGrass: 'Grass',
  Ground: 'Sand',
  Mud: 'Sand',
  Asphalt: 'Concrete',
  Pavement: 'Concrete',
  Limestone: 'Concrete',
  Sandstone: 'Concrete',
  Basalt: 'Slate',
  Rock: 'Slate',
  Granite: 'Slate',
  Pebble: 'Cobblestone',
  CorrodedMetal: 'Metal',
  Foil: 'Metal',
  Carpet: 'Fabric',
  Leather: 'Fabric',
}

const BUMP_SCALE: Record<string, number> = {
  Brick: 0.03,
  Cobblestone: 0.03,
  DiamondPlate: 0.02,
  WoodPlanks: 0.02,
  Slate: 0.025,
}

// ---------------------------------------------------------------------------

const canvasCache = new Map<string, HTMLCanvasElement>()
const textureCache = new Map<string, THREE.CanvasTexture>()

function paintCanvas(name: string, painter: Painter, seed: number): HTMLCanvasElement {
  const cached = canvasCache.get(name)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = gray(0.9)
  ctx.fillRect(0, 0, TILE, TILE)
  painter(ctx, mulberry32(seed))
  canvasCache.set(name, canvas)
  return canvas
}

function textureFrom(canvas: HTMLCanvasElement, cacheKey: string, repeat: number): THREE.CanvasTexture {
  const key = `${cacheKey}|${repeat}`
  const cached = textureCache.get(key)
  if (cached) return cached
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  textureCache.set(key, tex)
  return tex
}

/** Buckets a part's largest dimension into a power-of-two tiling density so the
 *  material cache stays small while big surfaces still tile believably. One
 *  tile ≈ 8 studs, matching the baseplate's StudsPerTileU/V=8. */
export function repeatBucketFor(size: readonly [number, number, number]): number {
  const maxDim = Math.max(size[0], size[1], size[2])
  const raw = Math.max(1, maxDim / 8)
  return Math.min(256, Math.pow(2, Math.round(Math.log2(raw))))
}

export interface DetailMaps {
  map: THREE.CanvasTexture
  bumpMap: THREE.CanvasTexture
  bumpScale: number
}

/** Detail maps for a material at a tiling bucket, or null for smooth materials
 *  (Plastic, Neon, Glass, …). Client-only: returns null with no DOM. */
export function detailMapsFor(materialName: string | undefined, repeat: number): DetailMaps | null {
  if (!materialName || typeof document === 'undefined') return null
  const painterName = PAINTERS[materialName] ? materialName : ALIASES[materialName]
  if (!painterName) return null
  const painter = PAINTERS[painterName]
  let seed = 7
  for (const ch of painterName) seed = (seed * 31 + ch.charCodeAt(0)) | 0
  const canvas = paintCanvas(painterName, painter, seed)
  return {
    map: textureFrom(canvas, `detail:${painterName}`, repeat),
    bumpMap: textureFrom(canvas, `detail:${painterName}`, repeat),
    bumpScale: BUMP_SCALE[painterName] ?? 0.015,
  }
}

/** The classic Roblox stud grid (the baseplate's Texture child, asset
 *  rbxassetid://6372755229, tiles 8x8 studs). Drawn, not downloaded. */
export function studsTexture(repeat: number): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const canvas = paintCanvas('__studs', (ctx) => {
    ctx.fillStyle = gray(0.97)
    ctx.fillRect(0, 0, TILE, TILE)
    const cell = TILE / 8 // 8 studs per tile
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const cx = x * cell + cell / 2
        const cy = y * cell + cell / 2
        const r = cell * 0.32
        ctx.strokeStyle = gray(0.82)
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cx, cy + 1, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.strokeStyle = gray(1)
        ctx.beginPath()
        ctx.arc(cx, cy - 1, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }, 1)
  return textureFrom(canvas, '__studs', repeat)
}
