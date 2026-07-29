import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { PatchOp, RbxInstance } from '@/lib/rbx/types'
import { useAppStore, type GizmoMode } from '@/lib/state/store'
import { indexTree } from '@/lib/rbx/tree'
import { getCFrame, getVector3 } from './rbxProps'

// Studio-style direct manipulation for the selected part. The gizmo drives a
// proxy Object3D (our meshes render with matrixAutoUpdate=false, which
// TransformControls cannot drive directly); every change event is converted to
// an `update` PatchOp and applied to the LOCAL store tree, so the mesh moves
// through the exact same tree→scene sync path the AI's edits use. On drag end
// the final op goes to POST /api/projects/:id/ops (validate → persist → one
// undo step per drag).

const MODE_MAP: Record<GizmoMode, 'translate' | 'rotate' | 'scale'> = {
  move: 'translate',
  rotate: 'rotate',
  scale: 'scale',
}

/** Classes the gizmo may manipulate — world parts with a real CFrame. */
const GIZMO_CLASSES = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'SpawnLocation'])

const MIN_SIZE = 0.05

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function quatToRowMajor(q: THREE.Quaternion): [number, number, number, number, number, number, number, number, number] {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements
  // three stores column-major; CFrame rot is row-major R00..R22.
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
}

export interface GizmoHandle {
  /** Re-read selection/tree/mode from the store. Cheap; call on store changes. */
  update(): void
  /** True while the pointer is on a gizmo handle or mid-drag — click-select must skip. */
  readonly active: boolean
  dispose(): void
}

export function createTransformGizmo(
  camera: THREE.Camera,
  dom: HTMLElement,
  scene: THREE.Scene,
  orbit: OrbitControls
): GizmoHandle {
  const controls = new TransformControls(camera, dom)
  controls.setTranslationSnap(1) // 1 stud, Studio default feel
  controls.setRotationSnap(THREE.MathUtils.degToRad(15))
  controls.setSize(0.9)
  const helper = controls.getHelper()
  scene.add(helper)

  const proxy = new THREE.Object3D()
  scene.add(proxy)

  let attachedId: string | null = null
  let mode: GizmoMode = 'move'
  let pendingOp: PatchOp | null = null
  let rafQueued = false

  function currentInstance(): RbxInstance | null {
    const { selectionId, tree } = useAppStore.getState()
    if (!selectionId || !tree) return null
    const inst = indexTree(tree).get(selectionId)?.inst ?? null
    if (!inst || !GIZMO_CLASSES.has(inst.className) || !inst.props.CFrame) return null
    return inst
  }

  function opFromProxy(id: string): PatchOp {
    const rot = quatToRowMajor(proxy.quaternion)
    const props: Record<string, { type: 'CFrame' | 'Vector3'; value: never } | unknown> = {}
    props.CFrame = {
      type: 'CFrame',
      value: {
        pos: [round3(proxy.position.x), round3(proxy.position.y), round3(proxy.position.z)],
        rot: rot.map(round3) as typeof rot,
      },
    }
    if (mode === 'scale') {
      props.Size = {
        type: 'Vector3',
        value: [
          round3(Math.max(MIN_SIZE, Math.abs(proxy.scale.x))),
          round3(Math.max(MIN_SIZE, Math.abs(proxy.scale.y))),
          round3(Math.max(MIN_SIZE, Math.abs(proxy.scale.z))),
        ],
      }
    }
    return { op: 'update', id, props } as PatchOp
  }

  function applyLive() {
    rafQueued = false
    if (!attachedId) return
    pendingOp = opFromProxy(attachedId)
    // Local-only application: moves the mesh through the normal tree→scene sync.
    useAppStore.getState().applyPatchOps([pendingOp])
  }

  controls.addEventListener('objectChange', () => {
    if (!rafQueued) {
      rafQueued = true
      requestAnimationFrame(applyLive)
    }
  })

  controls.addEventListener('dragging-changed', (event) => {
    const dragging = (event as unknown as { value: boolean }).value
    orbit.enabled = !dragging
    if (!dragging && pendingOp && attachedId) {
      // Commit the final state: server validates, persists, and records one
      // undo step for the whole drag.
      const final = opFromProxy(attachedId)
      pendingOp = null
      void useAppStore.getState().applyManualOps([final])
    }
  })

  function update() {
    if (controls.dragging) return // never fight the user's hand mid-drag
    const inst = currentInstance()
    const nextMode = useAppStore.getState().gizmoMode
    if (!inst) {
      attachedId = null
      controls.detach()
      helper.visible = false
      return
    }

    mode = nextMode
    controls.setMode(MODE_MAP[mode])

    const cf = getCFrame(inst)
    const size = getVector3(inst, 'Size', [4, 1, 2])
    proxy.position.set(cf.pos[0], cf.pos[1], cf.pos[2])
    const r = cf.rot
    const m = new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1)
    proxy.quaternion.setFromRotationMatrix(m)
    // In scale mode the proxy's scale IS the live Size; otherwise keep it unit
    // so the translate/rotate handles render at a constant size.
    if (mode === 'scale') proxy.scale.set(size[0], size[1], size[2])
    else proxy.scale.set(1, 1, 1)
    proxy.updateMatrixWorld(true)

    attachedId = inst.id
    controls.attach(proxy)
    helper.visible = true
  }

  return {
    update,
    get active() {
      return controls.dragging || controls.axis !== null
    },
    dispose() {
      controls.detach()
      controls.dispose()
      scene.remove(helper, proxy)
    },
  }
}
