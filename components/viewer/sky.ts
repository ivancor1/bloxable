import * as THREE from 'three'

// Vertical-gradient sky: a large inverted sphere the camera always sits inside of.
// RESEARCH Part 3 flags these hexes as the report's OWN estimate (not pulled from a
// fetched authoritative source) -- "sample actual pixel colors from a fresh Studio
// screenshot before finalizing," disclosed here rather than presented as verified.
const SKY_ZENITH = new THREE.Color(0x7092a5)
const SKY_UPPER = new THREE.Color(0x8fb8de)
const SKY_HORIZON = new THREE.Color(0xc6d9ea)

export const SKY_RADIUS = 15000

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 upper;
  uniform vec3 horizon;
  varying vec3 vWorldPosition;
  void main() {
    float h = normalize(vWorldPosition).y;
    vec3 col = mix(horizon, upper, smoothstep(-0.05, 0.35, h));
    col = mix(col, zenith, smoothstep(0.35, 1.0, h));
    gl_FragColor = vec4(col, 1.0);
  }
`

export function createSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 16)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: SKY_ZENITH },
      upper: { value: SKY_UPPER },
      horizon: { value: SKY_HORIZON },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  mesh.renderOrder = -1000
  mesh.frustumCulled = false
  return mesh
}

/** Skydome trick: follow the camera's position (never its rotation) each frame so
 *  the "infinitely far away" illusion holds regardless of camera translation. */
export function updateSkyPosition(sky: THREE.Mesh, cameraPosition: THREE.Vector3) {
  sky.matrix.setPosition(cameraPosition)
  sky.matrixWorldNeedsUpdate = true
}
