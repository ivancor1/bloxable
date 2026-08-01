'use client'

import { useEffect, useRef, useState } from 'react'
import type { ProjectMeta } from '@/lib/rbx/types'
import { useAppStore } from '@/lib/state/store'
import { IconGear, IconRedo, IconUndo } from './icons'
import EjectModal from './EjectModal'
import OpenInStudio from './OpenInStudio'
import {
  networkFailureOutcome,
  outcomeFromEjectResponse,
  studioChainFromResponse,
  studioChainNetworkFailure,
  type EjectOutcome,
  type StudioChain,
} from '@/lib/roblox/eject-status'

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
  const history = useAppStore((s) => s.history)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)
  const setProjectMeta = useAppStore((s) => s.setProjectMeta)

  const project = projects.find((p) => p.id === projectId)
  const [publishing, setPublishing] = useState(false)
  const [ejecting, setEjecting] = useState(false)
  const [eject, setEject] = useState<EjectOutcome | null>(null)
  const [ejectStudio, setEjectStudio] = useState<StudioChain | null>(null)
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

    // The place is auto-assigned from the operator pool server-side; the only
    // hard pre-flight is the key + a configured universe.
    let configured = false
    try {
      const settingsRes = await fetch('/api/settings')
      const settings = settingsRes.ok ? await settingsRes.json() : null
      const hasIds = !!(project?.roblox?.universeId && project?.roblox?.placeId)
      configured =
        isRecord(settings) &&
        settings.hasKey === true &&
        (hasIds ||
          (typeof settings.universeId === 'string' &&
            Array.isArray(settings.placePool) &&
            settings.placePool.length > 0))
    } catch {
      configured = false
    }

    if (!configured) {
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
        const playUrl = isRecord(data) && typeof data.playUrl === 'string' ? data.playUrl : undefined
        if (isRecord(data) && isRecord(data.meta)) setProjectMeta(data.meta as unknown as ProjectMeta)
        showToast({
          kind: 'ok',
          text: versionNumber !== undefined ? `Live — version ${versionNumber}` : 'Live',
          href: playUrl,
        })
      }
    } catch (e) {
      showToast({ kind: 'err', text: e instanceof Error ? e.message : 'Publish failed' })
    } finally {
      setPublishing(false)
    }
  }

  /**
   * Eject: upload this game as a Model into the user's OWN Roblox account. They
   * insert it from the Toolbox and publish it themselves — the step that makes
   * the experience theirs (and unblocks DevEx). Requires their own Roblox
   * sign-in, which is a different credential from the operator's publish key.
   */
  async function handleEject() {
    if (!projectId || ejecting) return

    let connected = false
    try {
      const res = await fetch('/api/roblox/account')
      const account: unknown = res.ok ? await res.json() : null
      connected = isRecord(account) && account.connected === true
    } catch {
      connected = false
    }
    if (!connected) {
      onOpenSettings()
      return
    }

    setEjecting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/eject`, { method: 'POST' })
      const data: unknown = await res.json().catch(() => null)
      if (res.ok && isRecord(data) && isRecord(data.meta)) setProjectMeta(data.meta as unknown as ProjectMeta)
      // Success, still-processing and every failure all land in the modal —
      // the mapping (and its copy) lives in lib/roblox/eject-status.
      const outcome = outcomeFromEjectResponse(res.status, data, project?.name ?? 'Your game')
      setEject(outcome)
      // The chain: upload landed → open Studio with the full place loaded, so
      // the one remaining step is File → Publish. Skipped when moderation said
      // no — that moment belongs to the rejection message, not a new window.
      const chain =
        outcome.kind === 'processing' ||
        (outcome.kind === 'uploaded' && outcome.moderation.verdict !== 'rejected')
      if (chain) void launchStudioChain()
    } catch {
      setEject(networkFailureOutcome(project?.name ?? 'Your game'))
    } finally {
      setEjecting(false)
    }
  }

  /** POSTs the existing open-studio route and mirrors its answer into the modal. */
  async function launchStudioChain() {
    if (!projectId) return
    setEjectStudio({ kind: 'launching' })
    try {
      const res = await fetch(`/api/projects/${projectId}/open-studio`, { method: 'POST' })
      const data: unknown = await res.json().catch(() => null)
      setEjectStudio(studioChainFromResponse(res.status, data))
    } catch {
      setEjectStudio(studioChainNetworkFailure())
    }
  }

  // The user's own published game outranks the operator-universe copy — the
  // whole point of the eject path is that THEIR account hosts the game.
  const playUrl = project?.userPlace
    ? `https://www.roblox.com/games/start?placeId=${project.userPlace.placeId}`
    : project?.lastPublish && project.roblox?.placeId
      ? `https://www.roblox.com/games/start?placeId=${project.roblox.placeId}`
      : undefined

  return (
    <div className="topbar">
      <span className="topbar-project">{project?.name ?? ''}</span>
      <div className="topbar-right">
        <button
          className="icon-btn"
          aria-label="Undo"
          onClick={() => void undo()}
          disabled={history.undo === 0}
        >
          <IconUndo />
        </button>
        <button
          className="icon-btn"
          aria-label="Redo"
          onClick={() => void redo()}
          disabled={history.redo === 0}
        >
          <IconRedo />
        </button>
        {!credits.unlimited && <span className="credits-pill">{credits.remaining} left</span>}
        {playUrl && (
          <a className="btn btn-plain" href={playUrl} target="_blank" rel="noopener noreferrer">
            Play
          </a>
        )}
        {projectId && (
          <a className="btn btn-plain" href={`/api/projects/${projectId}/export`}>
            Export
          </a>
        )}
        <OpenInStudio />
        <button
          className="btn btn-plain"
          onClick={() => void handleEject()}
          disabled={ejecting || !projectId}
          title="Upload this game as a model into your own Roblox account"
        >
          {ejecting ? 'Sending…' : 'Send to Roblox'}
        </button>
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
      {eject && (
        <EjectModal
          outcome={eject}
          studio={ejectStudio}
          projectId={projectId ?? undefined}
          onClose={() => {
            setEject(null)
            setEjectStudio(null)
          }}
          onOpenSettings={onOpenSettings}
          onRetryStudio={() => void launchStudioChain()}
        />
      )}
    </div>
  )
}
