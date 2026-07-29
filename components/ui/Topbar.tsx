'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/state/store'
import { IconGear } from './icons'

type Toast = { kind: 'ok' | 'err'; text: string; href?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function extractMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    if (typeof body.message === 'string') return body.message
    if (typeof body.error === 'string') return body.error
    if (Array.isArray(body.errors)) {
      const first = body.errors[0]
      if (isRecord(first) && typeof first.message === 'string') return first.message
    }
  }
  return fallback
}

export default function Topbar({
  onOpenSettings,
}: {
  onOpenSettings: () => void
}) {
  const projects = useAppStore((s) => s.projects)
  const projectId = useAppStore((s) => s.projectId)
  const credits = useAppStore((s) => s.credits)

  const project = projects.find((p) => p.id === projectId)
  const [publishing, setPublishing] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])

  function showToast(t: Toast) {
    setToast(t)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 6000)
  }

  async function handlePublish() {
    if (!projectId || publishing) return

    const hasIds = !!(project?.roblox?.universeId && project?.roblox?.placeId)
    let hasKey = false
    try {
      const settingsRes = await fetch('/api/settings')
      const settings = settingsRes.ok ? await settingsRes.json() : null
      hasKey = !!(isRecord(settings) && settings.hasKey)
    } catch {
      hasKey = false
    }

    if (!hasIds || !hasKey) {
      onOpenSettings()
      return
    }

    setPublishing(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, { method: 'POST' })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        showToast({ kind: 'err', text: extractMessage(data, 'Publish failed') })
      } else {
        const versionNumber = isRecord(data) && typeof data.versionNumber === 'number' ? data.versionNumber : undefined
        const placeId = project?.roblox?.placeId
        showToast({
          kind: 'ok',
          text: versionNumber !== undefined ? `Live — version ${versionNumber}` : 'Live',
          href: placeId ? `https://www.roblox.com/games/start?placeId=${placeId}` : undefined,
        })
      }
    } catch (e) {
      showToast({ kind: 'err', text: e instanceof Error ? e.message : 'Publish failed' })
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="topbar">
      <span className="topbar-project">{project?.name ?? ''}</span>
      <div className="topbar-right">
        <span className="credits-pill">{credits.remaining} left</span>
        {projectId && (
          <a className="btn btn-plain" href={`/api/projects/${projectId}/export`}>
            Export
          </a>
        )}
        <button className="btn btn-accent" onClick={handlePublish} disabled={publishing || !projectId}>
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
        <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <IconGear />
        </button>
        {toast && (
          <div className={`toast ${toast.kind}`}>
            {toast.href ? (
              <a href={toast.href} target="_blank" rel="noopener noreferrer">
                {toast.text}
              </a>
            ) : (
              toast.text
            )}
          </div>
        )}
      </div>
    </div>
  )
}
