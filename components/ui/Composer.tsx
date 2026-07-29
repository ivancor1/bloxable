'use client'

import { useMemo, useState, type RefObject } from 'react'
import { useAppStore } from '@/lib/state/store'
import { indexTree } from '@/lib/rbx/tree'
import { IconClose } from './icons'

export default function Composer({
  inputRef,
  onPaywall,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  onPaywall: () => void
}) {
  const [value, setValue] = useState('')
  const tree = useAppStore((s) => s.tree)
  const selectionId = useAppStore((s) => s.selectionId)
  const select = useAppStore((s) => s.select)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const streaming = useAppStore((s) => s.streaming)
  const credits = useAppStore((s) => s.credits)
  const projectId = useAppStore((s) => s.projectId)

  const selectedName = useMemo(() => {
    if (!selectionId || !tree) return null
    return indexTree(tree).get(selectionId)?.inst.name ?? null
  }, [selectionId, tree])

  function submit() {
    const text = value.trim()
    if (!text || !projectId || streaming) return
    if (!credits.unlimited && credits.remaining <= 0) {
      onPaywall()
      return
    }
    setValue('')
    void sendMessage(text)
  }

  return (
    <div className="composer">
      {selectionId && selectedName && (
        <span className="chip chip-selection">
          @{selectedName}
          <button aria-label="Remove selection" onClick={() => select(null)}>
            <IconClose />
          </button>
        </span>
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Describe your game…"
        disabled={streaming}
      />
    </div>
  )
}
