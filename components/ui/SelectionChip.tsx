'use client'

import { useMemo } from 'react'
import { useAppStore, type GizmoMode } from '@/lib/state/store'
import { indexTree } from '@/lib/rbx/tree'
import { IconClose } from '@/components/ui/icons'

const GIZMO_CLASSES = new Set(['Part', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'SpawnLocation'])
const MODES: { mode: GizmoMode; label: string }[] = [
  { mode: 'move', label: 'Move' },
  { mode: 'rotate', label: 'Rotate' },
  { mode: 'scale', label: 'Scale' },
]

/**
 * DESIGN.md (Viewer): on selection "a small chip appears bottom-left of the
 * canvas: `Name · ClassName` with ✕". Part-family selections additionally get
 * the Move/Rotate/Scale segmented control that drives the viewer's gizmo.
 *
 * Lives here rather than in components/viewer/** because it is a DOM overlay,
 * not canvas content; the viewer only owns the outline mesh + gizmo itself.
 */
export default function SelectionChip() {
  const selectionId = useAppStore((s) => s.selectionId)
  const tree = useAppStore((s) => s.tree)
  const select = useAppStore((s) => s.select)
  const gizmoMode = useAppStore((s) => s.gizmoMode)
  const setGizmoMode = useAppStore((s) => s.setGizmoMode)

  const inst = useMemo(() => {
    if (!selectionId || !tree) return null
    return indexTree(tree).get(selectionId)?.inst ?? null
  }, [selectionId, tree])

  if (!inst) return null

  const gizmoCapable = GIZMO_CLASSES.has(inst.className) && !!inst.props.CFrame

  return (
    <div className="selection-chip">
      {gizmoCapable && (
        <span className="chip gizmo-modes" role="group" aria-label="Transform mode">
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={mode === gizmoMode ? 'active' : ''}
              onClick={() => setGizmoMode(mode)}
            >
              {label}
            </button>
          ))}
        </span>
      )}
      <span className="chip chip-selection">
        {inst.name} · {inst.className}
        <button aria-label="Clear selection" onClick={() => select(null)}>
          <IconClose />
        </button>
      </span>
    </div>
  )
}
