import * as THREE from 'three'

// Shared, module-level BufferGeometry templates. Reused across every instance of a
// given shape -- per-instance sizing/orientation is always baked into the composed
// TRS Matrix4 applied to the mesh (see rbxProps.cframeToMatrix4 + shapeScaleVector),
// NEVER by mutating a template's vertex data. Local unit space spans -0.5..0.5 on
// every axis, matching BasePart.Size = full extents (RESEARCH Part 3).

export type PartKind = 'block' | 'ball' | 'cylinder' | 'wedge' | 'cornerWedge' | 'truss'

/** Enum.PartType Block / TrussPart / SpawnLocation body. */
export const blockGeometry = new THREE.BoxGeometry(1, 1, 1)

/**
 * Enum.PartType Ball. RESEARCH Part 3 [OFFICIAL, devforum]: the rendered/collided
 * shape is a TRUE sphere of diameter = min(Size.x, Size.y, Size.z) -- never an
 * ellipsoid stretched to the full bounding box. Unit sphere of diameter 1 (radius
 * 0.5); callers must apply a UNIFORM scale (d, d, d), never Size directly.
 */
export const ballGeometry = new THREE.SphereGeometry(0.5, 32, 16)

/**
 * Enum.PartType Cylinder. RESEARCH Part 3 [COMMUNITY-STANDARD]: a freshly-inserted
 * Studio Cylinder lies on its side, so the round axis runs along local X (not the
 * three.js default Y). CylinderGeometry is Y-aligned by default; rotateZ(90deg) bakes
 * the X-axis orientation into the shared template once. After rotation, local X is
 * the length axis (unit length 1) and local Y/Z are the circular cross-section (unit
 * diameter 1) -- so callers scale directly by Size.x/y/z, matching Roblox's
 * Size.X = length-along-axis, Size.Y/Z = cross-section-diameter convention.
 */
export const cylinderGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1).rotateZ(Math.PI / 2)

/**
 * TrussPart: documented v1 placeholder. RESEARCH Part 3 flags TrussPart's Style enum
 * and its visual-lattice-vs-box-collision split as unconfirmed against live docs;
 * ship the same box template used for Block, per RESEARCH's explicit recommendation.
 */
export const trussPlaceholderGeometry = blockGeometry

/** SpawnLocation's "subtle distinct top face" marker -- see sceneSync.ts. Flat plane
 *  baked to sit just above the unit box's +Y face, facing up. */
export const spawnTopMarkerGeometry = new THREE.PlaneGeometry(1, 1)
  .rotateX(-Math.PI / 2)
  .translate(0, 0.5 + 0.0015, 0)

function quad(a: number[], b: number[], c: number[], d: number[]): number[][] {
  return [a, b, c, a, c, d]
}

function trianglesToGeometry(vertices: number[][]): THREE.BufferGeometry {
  const positions = new Float32Array(vertices.length * 3)
  for (let i = 0; i < vertices.length; i++) {
    positions[i * 3] = vertices[i][0]
    positions[i * 3 + 1] = vertices[i][1]
    positions[i * 3 + 2] = vertices[i][2]
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.computeVertexNormals()
  return geo
}

/**
 * WedgePart: RESEARCH Part 3 [COMMUNITY-STANDARD, stravant/roblox-geometry +
 * devforum #703790]. 6 vertices: top-back-left/right, bottom-back-left/right,
 * bottom-front-left/right (no top-front vertex). Back (+Z) is a full vertical
 * rectangle, Bottom (-Y) is a full rectangle, extrusion runs along local X, and the
 * entire Front (-Z) face is replaced by the diagonal slope from the top-back edge
 * down to the bottom-front edge. Winding verified per-face via the cross-product
 * outward-normal rule (CCW as seen from outside).
 */
function buildWedgeGeometry(): THREE.BufferGeometry {
  const TBL = [-0.5, 0.5, 0.5]
  const TBR = [0.5, 0.5, 0.5]
  const BBL = [-0.5, -0.5, 0.5]
  const BBR = [0.5, -0.5, 0.5]
  const BFL = [-0.5, -0.5, -0.5]
  const BFR = [0.5, -0.5, -0.5]

  const tris: number[][] = [
    ...quad(BBL, BBR, TBR, TBL), // Back (+Z), full height
    ...quad(BBR, BBL, BFL, BFR), // Bottom (-Y)
    TBL, BFL, BBL, // Left end cap (-X)
    TBR, BBR, BFR, // Right end cap (+X)
    ...quad(TBL, TBR, BFR, BFL), // Sloped front, top-back -> bottom-front
  ]
  return trianglesToGeometry(tris)
}

/**
 * CornerWedgePart: RESEARCH Part 3 [COMMUNITY-STANDARD, stravant/roblox-geometry],
 * flagged there as not independently re-confirmed. 5 vertices: a single elevated
 * apex at Top-Front-Right plus the four bottom corners (full bottom quad) -- "a box
 * with exactly one full-height vertical edge (Front-Right) tapering to zero height
 * at the diagonally opposite (Back-Left) corner." The source text calls the Back and
 * Left slopes "quad" faces, but with only 5 total vertices no planar 4-vertex set
 * satisfies that (verified by hand via the coplanarity/scalar-triple-product test on
 * every candidate); the geometrically self-consistent build used here instead is 1
 * bottom quad + 4 triangular sides (Front, Right, Back, Left) meeting at the apex,
 * which independently satisfies Euler's formula (V=5, E=8, F=5) and is watertight.
 * Flagged as a deliberate, disclosed deviation from the source wording -- recommend
 * a Studio screenshot spot-check before treating the face split as final.
 */
function buildCornerWedgeGeometry(): THREE.BufferGeometry {
  const TFR = [0.5, 0.5, -0.5] // apex: Top-Front-Right
  const BBL = [-0.5, -0.5, 0.5]
  const BBR = [0.5, -0.5, 0.5]
  const BFL = [-0.5, -0.5, -0.5]
  const BFR = [0.5, -0.5, -0.5]

  const tris: number[][] = [
    ...quad(BBR, BBL, BFL, BFR), // Bottom (-Y)
    TFR, BFR, BFL, // Front (-Z)
    TFR, BBR, BFR, // Right (+X)
    TFR, BBL, BBR, // Back slope (+Z/+Y blend, "BackSurface")
    TFR, BFL, BBL, // Left slope (-X/+Y blend, "LeftSurface")
  ]
  return trianglesToGeometry(tris)
}

export const wedgeGeometry = buildWedgeGeometry()
export const cornerWedgeGeometry = buildCornerWedgeGeometry()

export function geometryForKind(kind: PartKind): THREE.BufferGeometry {
  switch (kind) {
    case 'ball':
      return ballGeometry
    case 'cylinder':
      return cylinderGeometry
    case 'wedge':
      return wedgeGeometry
    case 'cornerWedge':
      return cornerWedgeGeometry
    case 'truss':
      return trussPlaceholderGeometry
    case 'block':
    default:
      return blockGeometry
  }
}

// Defensive floor only (not a verified Roblox clamp) -- avoids a degenerate
// zero/negative-scale matrix, which would break rendering and raycasting.
const MIN_STUD = 0.05

/** Ball ignores non-uniform Size beyond deriving the diameter -- everything else
 *  scales its unit template directly by Size. */
export function shapeScaleVector(kind: PartKind, size: readonly [number, number, number]): THREE.Vector3 {
  if (kind === 'ball') {
    const d = Math.max(MIN_STUD, Math.min(size[0], size[1], size[2]))
    return new THREE.Vector3(d, d, d)
  }
  return new THREE.Vector3(
    Math.max(MIN_STUD, Math.abs(size[0])),
    Math.max(MIN_STUD, Math.abs(size[1])),
    Math.max(MIN_STUD, Math.abs(size[2])),
  )
}
