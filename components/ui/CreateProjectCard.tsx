'use client'

import { useState } from 'react'
import { useAppStore } from '@/lib/state/store'

export default function CreateProjectCard() {
  const createProject = useAppStore((s) => s.createProject)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await createProject(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="empty-shell">
      <div className="create-card">
        <input
          aria-label="Project name"
          placeholder="Name your game"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          disabled={busy}
          autoFocus
        />
        <button className="btn btn-accent" onClick={submit} disabled={busy || !name.trim()}>
          Create
        </button>
      </div>
    </div>
  )
}
