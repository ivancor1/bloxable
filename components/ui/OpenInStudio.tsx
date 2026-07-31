'use client'

/**
 * Topbar entry point for the open-in-Studio route. Self-contained (own state,
 * own toast) so the Topbar diff stays one import and one element.
 *
 * Copy is deliberately honest: opening in Studio hands the user a standard
 * local place file — a copy, freshly built from the project. Nothing converts,
 * nothing is lost, and nothing publishes; Studio is a companion here, not a
 * replacement.
 */

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/state/store'

function extractError(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string') return error
  }
  return fallback
}

export default function OpenInStudio() {
  const projectId = useAppStore((s) => s.projectId)
  const [opening, setOpening] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  function showToast(kind: 'ok' | 'err', text: string) {
    setToast({ kind, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  async function handleOpen() {
    if (!projectId || opening) return
    setOpening(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/open-studio`, { method: 'POST' })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        showToast('err', extractError(data, 'Could not open Roblox Studio'))
      } else {
        // Studio takes a few seconds to appear; this bridges the silence.
        showToast('ok', 'Roblox Studio is opening your place file.')
      }
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : 'Could not open Roblox Studio')
    } finally {
      setOpening(false)
    }
  }

  return (
    <span className="open-studio">
      <button
        className="btn btn-plain"
        onClick={() => void handleOpen()}
        disabled={opening || !projectId}
        title="Open a copy of this project in Roblox Studio as a standard place file. Nothing is converted or published; edits saved in Studio stay in that file."
      >
        {opening ? 'Opening…' : 'Open in Studio'}
      </button>
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </span>
  )
}
