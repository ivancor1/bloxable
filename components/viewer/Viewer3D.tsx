'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useAppStore } from '@/lib/state/store'
import { SceneSync } from './sceneSync'
import { createLightingRig, readLightingConfig, updateLightingRig, applyFog } from './lighting'
import { createSky, updateSkyPosition } from './sky'
import { createFlyControls } from './flyControls'
import GuiOverlay from './GuiOverlay'

// A left-click shorter/tighter than this counts as a "click" (select); anything
// longer/further was an orbit-drag and should not also fire a selection change.
const CLICK_MAX_DRAG_PX = 4
const CLICK_MAX_DURATION_MS = 500

/**
 * B4 -- 3D viewer. Client component; the shell (B5) mounts this edge-to-edge inside
 * a positioned container and it fills it absolutely. Subscribes directly to
 * useAppStore (tree/treeVersion/selectionId) rather than taking props, per D7 /
 * ARCHITECTURE's module map -- no other builder's files are touched.
 *
 * TODO(perf): v1 renders one THREE.Mesh per Part-family instance. Fine through a
 * few thousand parts; if real places push far beyond that, switch same-(shape,
 * material) groups to THREE.InstancedMesh. Not built here -- premature for v1.
 */
export default function Viewer3D() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // --- renderer -----------------------------------------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.inset = '0'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'
    container.appendChild(renderer.domElement)

    // --- scene / camera -------------------------------------------------------
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 20000)
    // Slightly-elevated 3/4 view near the default SpawnLocation (Baseplate top sits
    // at world Y=0 -- RESEARCH Part 2).
    camera.position.set(26, 18, 26)
    camera.lookAt(0, 3, 0)

    const sky = createSky()
    scene.add(sky)

    const lightingRig = createLightingRig(scene)
    const sceneSync = new SceneSync(scene)

    // --- camera controls --------------------------------------------------
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 3, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, // shift/ctrl/meta + left auto-switches to PAN (OrbitControls built-in)
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN, // inert: flyControls sets controls.enabled=false for the RMB-hold duration
    }
    controls.update()

    let flySpeed = 40
    const flyControls = createFlyControls(camera, renderer.domElement, controls, () => flySpeed)

    // --- resize (canvas fills its container; ResizeObserver-driven) -------
    function resize() {
      const el = containerRef.current
      if (!el) return
      const { clientWidth, clientHeight } = el
      if (clientWidth === 0 || clientHeight === 0) return
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight, false)
    }
    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    // --- selection: raycast on genuine clicks only (not orbit-drags) ------
    const raycaster = new THREE.Raycaster()
    const pointerNdc = new THREE.Vector2()
    let downX = 0
    let downY = 0
    let downAt = 0
    let downButton = -1

    function onPointerDown(event: PointerEvent) {
      downX = event.clientX
      downY = event.clientY
      downAt = performance.now()
      downButton = event.button
    }

    function onPointerUp(event: PointerEvent) {
      if (downButton !== 0 || event.button !== 0) return
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY)
      const elapsed = performance.now() - downAt
      if (moved > CLICK_MAX_DRAG_PX || elapsed > CLICK_MAX_DURATION_MS) return

      const rect = renderer.domElement.getBoundingClientRect()
      pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointerNdc, camera)
      const hits = raycaster.intersectObjects(sceneSync.raycastTargets, false)
      const id = hits.length > 0 ? sceneSync.idForObject3D(hits[0].object) ?? null : null
      useAppStore.getState().select(id)
    }

    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    // --- store subscription: diff-sync on treeVersion, cheap refresh on selection
    function computeSceneRadius(): number {
      const box = new THREE.Box3().setFromObject(sceneSync.workspaceRoot)
      if (box.isEmpty()) return 1024
      return box.getBoundingSphere(new THREE.Sphere()).radius
    }

    function syncFromStore() {
      const { tree } = useAppStore.getState()
      sceneSync.sync(tree)

      const radius = computeSceneRadius()
      flySpeed = THREE.MathUtils.clamp(radius * 0.15, 16, 500)

      const lightingConfig = readLightingConfig(tree)
      updateLightingRig(lightingRig, lightingConfig, radius)
      applyFog(scene, lightingConfig)

      sceneSync.setSelection(useAppStore.getState().selectionId)
    }
    syncFromStore()

    let lastTreeVersion = useAppStore.getState().treeVersion
    let lastSelectionId = useAppStore.getState().selectionId
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.treeVersion !== lastTreeVersion) {
        lastTreeVersion = state.treeVersion
        lastSelectionId = state.selectionId
        syncFromStore()
      } else if (state.selectionId !== lastSelectionId) {
        lastSelectionId = state.selectionId
        sceneSync.setSelection(state.selectionId)
      }
    })

    // --- animation loop -----------------------------------------------------
    const clock = new THREE.Clock()
    let frameId = 0
    function tick() {
      frameId = requestAnimationFrame(tick)
      const dt = clock.getDelta()
      flyControls.update(dt)
      if (!flyControls.looking) controls.update()
      updateSkyPosition(sky, camera.position)
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      unsubscribe()
      flyControls.dispose()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      sceneSync.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <GuiOverlay />
    </div>
  )
}
