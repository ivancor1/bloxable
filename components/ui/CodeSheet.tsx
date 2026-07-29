'use client'

import { useEffect, useMemo } from 'react'
import { useAppStore } from '@/lib/state/store'
import { indexTree } from '@/lib/rbx/tree'
import { scriptDisplayName } from './scriptDisplay'
import { IconClose } from './icons'

export default function CodeSheet({ scriptId, onClose }: { scriptId: string; onClose: () => void }) {
  const tree = useAppStore((s) => s.tree)

  const inst = useMemo(() => {
    if (!tree) return null
    return indexTree(tree).get(scriptId)?.inst ?? null
  }, [tree, scriptId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!inst) return null

  const source = inst.props['Source']
  const code = source?.type === 'ProtectedString' ? source.value : ''

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="mono">{scriptDisplayName(inst)}</span>
            <span className="sub">{inst.className}</span>
          </span>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <pre className="code-pre mono">{code}</pre>
        </div>
      </div>
    </>
  )
}
