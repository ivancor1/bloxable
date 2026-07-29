'use client'

import { useMemo } from 'react'
import { useAppStore } from '@/lib/state/store'
import { indexTree } from '@/lib/rbx/tree'
import { IconClose } from '@/components/ui/icons'

/**
 * DESIGN.md (Viewer): on selection "a small chip appears bottom-left of the
 * canvas: `Name · ClassName` with ✕".
 *
 * Lives here rather than in components/viewer/** because it is a DOM overlay,
 * not canvas content; the viewer only owns the accent outline mesh.
 */
export default function SelectionChip() {
  const selectionId = useAppStore((s) => s.selectionId)
  const tree = useAppStore((s) => s.tree)
  const select = useAppStore((s) => s.select)

  const inst = useMemo(() => {
    if (!selectionId || !tree) return null
    return indexTree(tree).get(selectionId)?.inst ?? null
  }, [selectionId, tree])

  if (!inst) return null

  return (
    <div className="selection-chip">
      <span className="chip chip-selection">
        {inst.name} · {inst.className}
        <button aria-label="Clear selection" onClick={() => select(null)}>
          <IconClose />
        </button>
      </span>
    </div>
  )
}
