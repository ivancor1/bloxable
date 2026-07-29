import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Studio-style right-mouse-hold look + WASD/QE fly (RESEARCH Part 3's recommended
// camera rig, item 7 of the brief). Coexists with OrbitControls rather than
// replacing it: OrbitControls owns left-drag orbit / wheel zoom / shift-left-drag
// and middle-drag pan; this module owns the right button exclusively.
//
// Conflict-avoidance: OrbitControls.onPointerDown / onPointerMove both early-return
// whenever `controls.enabled === false`, so setting that flag for the duration of
// the RMB hold fully cedes camera control to fly mode regardless of DOM listener
// registration order. On release, OrbitControls' internal target is resynced to the
// camera's new pose (pointed a fixed distance along the camera's new forward vector)
// before re-enabling it, so it doesn't snap the camera back to its pre-fly orbit.
//
// Pointer capture (not full Pointer Lock) is used so mouse deltas keep arriving even
// if the cursor leaves the canvas mid-drag -- simpler, and avoids fighting the
// shell's own Esc handling (DESIGN.md) that Pointer Lock's exit gesture would collide
// with.

const LOOK_SENSITIVITY = 0.0028
const MAX_PITCH = Math.PI / 2 - 0.02
const SPRINT_MULTIPLIER = 3
const FLY_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyQ', 'ShiftLeft', 'ShiftRight'])

export interface FlyControls {
  /** Call once per frame; moves the camera while RMB-look + WASD/QE are active. */
  update(deltaSeconds: number): void
  readonly looking: boolean
  dispose(): void
}

export function createFlyControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
  orbit: OrbitControls,
  getSpeed: () => number,
): FlyControls {
  let looking = false
  let activePointerId: number | null = null
  let yaw = 0
  let pitch = 0
  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const keys = new Set<string>()

  function beginLook(event: PointerEvent) {
    if (event.button !== 2 || looking) return
    event.preventDefault()
    looking = true
    activePointerId = event.pointerId
    domElement.setPointerCapture(event.pointerId)
    euler.setFromQuaternion(camera.quaternion, 'YXZ')
    yaw = euler.y
    pitch = euler.x
    orbit.enabled = false
  }

  function endLook() {
    if (!looking) return
    looking = false
    if (activePointerId !== null) {
      try {
        domElement.releasePointerCapture(activePointerId)
      } catch {
        // pointer already released (e.g. window blur) -- nothing to do
      }
    }
    activePointerId = null
    keys.clear()

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    const dist = Math.max(5, camera.position.distanceTo(orbit.target))
    orbit.target.copy(camera.position).addScaledVector(forward, dist)
    orbit.update()
    orbit.enabled = true
  }

  function onPointerDown(event: PointerEvent) {
    beginLook(event)
  }

  function onPointerMove(event: PointerEvent) {
    if (!looking || event.pointerId !== activePointerId) return
    yaw -= event.movementX * LOOK_SENSITIVITY
    pitch -= event.movementY * LOOK_SENSITIVITY
    pitch = THREE.MathUtils.clamp(pitch, -MAX_PITCH, MAX_PITCH)
    euler.set(pitch, yaw, 0, 'YXZ')
    camera.quaternion.setFromEuler(euler)
  }

  function onPointerUp(event: PointerEvent) {
    if (event.button !== 2) return
    endLook()
  }

  function onContextMenu(event: MouseEvent) {
    // Always suppress the browser context menu over the canvas -- RMB is claimed
    // for look, regardless of whether a look session is mid-flight right now.
    event.preventDefault()
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!looking) return
    keys.add(event.code)
    if (FLY_KEYS.has(event.code)) event.preventDefault()
  }

  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code)
  }

  function onBlur() {
    endLook()
  }

  domElement.addEventListener('pointerdown', onPointerDown)
  domElement.addEventListener('pointermove', onPointerMove)
  domElement.addEventListener('pointerup', onPointerUp)
  domElement.addEventListener('pointercancel', onPointerUp)
  domElement.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  const forwardVec = new THREE.Vector3()
  const rightVec = new THREE.Vector3()
  const moveVec = new THREE.Vector3()

  return {
    get looking() {
      return looking
    },
    update(deltaSeconds: number) {
      if (!looking || keys.size === 0) return
      const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight')
      const speed = getSpeed() * (sprinting ? SPRINT_MULTIPLIER : 1)

      camera.getWorldDirection(forwardVec)
      rightVec.crossVectors(forwardVec, camera.up).normalize()
      moveVec.set(0, 0, 0)
      if (keys.has('KeyW')) moveVec.add(forwardVec)
      if (keys.has('KeyS')) moveVec.sub(forwardVec)
      if (keys.has('KeyD')) moveVec.add(rightVec)
      if (keys.has('KeyA')) moveVec.sub(rightVec)
      if (keys.has('KeyE')) moveVec.y += 1
      if (keys.has('KeyQ')) moveVec.y -= 1

      if (moveVec.lengthSq() > 0) {
        moveVec.normalize().multiplyScalar(speed * deltaSeconds)
        camera.position.add(moveVec)
      }
    },
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      domElement.removeEventListener('pointerup', onPointerUp)
      domElement.removeEventListener('pointercancel', onPointerUp)
      domElement.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}
