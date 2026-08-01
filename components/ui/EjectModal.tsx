'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The one place the eject flow talks to the user, success or not.
 *
 * Three honest states, straight from the eject response (lib/roblox/eject-status
 * maps it — nothing here is a hopeful guess):
 *  - uploaded:   the model is in their Roblox inventory; show exactly where it
 *                lives and the Studio steps only they can do. Moderation
 *                Rejected is its own truth, not buried in a status suffix.
 *  - processing: Roblox accepted the upload and is still working — not a
 *                failure, and not "done" either.
 *  - failed:     plain language, one concrete next step, the server's message
 *                verbatim underneath. Never the user's fault.
 *
 * Tone rule: the user built this game; Bloxable helped move it. No "your
 * finished game is ready" — the finishing (insert + publish) is theirs to do,
 * because no Roblox API can publish a place on someone else's behalf.
 */

import {
  ejectFailureCopy,
  type EjectOutcome,
  type EjectProcessing,
  type EjectUploaded,
  type StudioChain,
} from '@/lib/roblox/eject-status'

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function ServiceFoldersStep({ folders }: { folders: string[] }) {
  if (folders.length === 0) return null
  return (
    <li>
      Move the {list(folders)} folder{folders.length === 1 ? '' : 's'} out of the model and into the service
      {folders.length === 1 ? '' : 's'} they are named after.
    </li>
  )
}

/**
 * The Studio chain, rendered inside a success state. `opened` leads with the
 * one remaining step; `unavailable`/`failed` say why, verbatim, and hand over
 * to the Toolbox path. The place file Studio opens is the FULL game — services
 * included — so this path has none of the model's folder-moving caveats.
 */
function StudioChainStatus({ studio, onRetry }: { studio: StudioChain; onRetry?: () => void }) {
  if (studio.kind === 'launching') {
    return <p>Roblox Studio is opening with your game loaded…</p>
  }
  if (studio.kind === 'opened') {
    return (
      <>
        <p>
          Roblox Studio is opening with your whole game loaded — nothing to drag in, nothing to move around.
        </p>
        <p>
          <strong>One step left: File → Publish to Roblox.</strong> That puts it on your account, under your name.
        </p>
      </>
    )
  }
  return (
    <>
      <p>
        Studio didn&apos;t open on this computer{studio.kind === 'unavailable' ? '' : ' this time'}.
        {onRetry && (
          <>
            {' '}
            <button className="btn btn-plain" onClick={onRetry}>
              Try again
            </button>
          </>
        )}
      </p>
      <p className="eject-detail dim">{studio.message}</p>
    </>
  )
}

// --- the share link -----------------------------------------------------------

interface FoundPlace {
  placeId: string
  shareUrl: string
  source: string
}

type FinderState =
  | { kind: 'watching'; tries: number }
  | { kind: 'found'; place: FoundPlace }
  | { kind: 'idle-hint'; detail: string | null }
  | { kind: 'error'; message: string }

const FINDER_INTERVAL_MS = 10_000
const FINDER_MAX_TRIES = 30 // ~5 minutes of watching, then hints + paste box

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function placeFrom(body: unknown): FoundPlace | null {
  if (!isRecord(body) || body.found !== true || !isRecord(body.place)) return null
  const place = body.place
  if (typeof place.placeId !== 'string' || typeof place.shareUrl !== 'string') return null
  return { placeId: place.placeId, shareUrl: place.shareUrl, source: typeof place.source === 'string' ? place.source : '' }
}

/**
 * Watches for the game the user publishes from Studio and turns it into the
 * link they can send a friend. Polls the published-place route (public games
 * API underneath — it can only see PUBLIC games, and the copy owns that), and
 * offers the paste-once fallback when watching is not enough. Free path:
 * nothing here needs the operator key or any paid step.
 */
function ShareLinkFinder({ projectId, active }: { projectId: string; active: boolean }) {
  const [state, setState] = useState<FinderState>({ kind: 'watching', tries: 0 })
  const [pasted, setPasted] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tries = useRef(0)

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/published-place`, { method: 'POST' })
      const body: unknown = await res.json().catch(() => null)
      const place = placeFrom(body)
      if (place) {
        setState({ kind: 'found', place })
        return
      }
      tries.current += 1
      if (tries.current >= FINDER_MAX_TRIES) {
        const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : null
        setState({ kind: 'idle-hint', detail })
        return
      }
      setState({ kind: 'watching', tries: tries.current })
      timer.current = setTimeout(() => void poll(), FINDER_INTERVAL_MS)
    } catch {
      setState({ kind: 'error', message: 'Could not check — is the app still running?' })
    }
  }, [projectId])

  useEffect(() => {
    if (!active) return
    tries.current = 0
    void poll()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [active, poll])

  async function submitPaste() {
    if (!pasted.trim() || pasteBusy) return
    setPasteBusy(true)
    setPasteError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/published-place`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link: pasted }),
      })
      const body: unknown = await res.json().catch(() => null)
      const place = placeFrom(body)
      if (res.ok && place) {
        setState({ kind: 'found', place })
      } else {
        const message = isRecord(body) && typeof body.error === 'string' ? body.error : 'That link did not check out.'
        setPasteError(message)
      }
    } catch {
      setPasteError('Could not check the link — is the app still running?')
    } finally {
      setPasteBusy(false)
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The link is visible and selectable either way.
    }
  }

  if (!active && state.kind !== 'found') return null

  if (state.kind === 'found') {
    return (
      <div className="share-link">
        <p>
          <strong>Your link — send it to a friend:</strong>
        </p>
        <p className="share-link-url mono">{state.place.shareUrl}</p>
        <div className="share-link-actions">
          <button className="btn btn-accent" onClick={() => void copyLink(state.place.shareUrl)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <a className="btn btn-plain" href={state.place.shareUrl} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        </div>
        <p className="dim">
          If a friend cannot join, check Roblox&apos;s Game Settings → Permissions — the game has to be Public.
        </p>
      </div>
    )
  }

  return (
    <div className="share-link">
      {state.kind === 'watching' && (
        <p className="dim">
          Watching for your publish… After File → Publish, set the game to Public (Game Settings → Permissions) — the
          moment Roblox lists it, your share link lands here.
        </p>
      )}
      {state.kind === 'idle-hint' && (
        <p className="dim">
          {state.detail ??
            'Roblox has not listed the game yet. If you published it, make sure it is Public — or paste its link below.'}
        </p>
      )}
      {state.kind === 'error' && <p className="dim">{state.message}</p>}

      <div className="share-link-paste">
        <input
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Already published? Paste your game link here once"
          spellCheck={false}
        />
        <button className="btn btn-plain" onClick={() => void submitPaste()} disabled={pasteBusy || !pasted.trim()}>
          {pasteBusy ? 'Checking…' : 'Use it'}
        </button>
      </div>
      {pasteError && <p className="eject-detail dim">{pasteError}</p>}
    </div>
  )
}

/**
 * The Toolbox route — the fallback when Studio is not installed (and there for
 * anyone who prefers it). This is the MODEL path, so the folder-moving and
 * service-property caveats belong here and only here.
 */
function ToolboxSteps({ result, open }: { result: EjectUploaded; open: boolean }) {
  return (
    <details className="eject-toolbox" open={open}>
      <summary>The Toolbox way — works on any computer with Studio</summary>
      <ol className="eject-steps">
        <li>Open Roblox Studio → Toolbox → Inventory → My Models.</li>
        <li>
          Drag {result.projectName} into your place — it is the newest model there.
        </li>
        <ServiceFoldersStep folders={result.serviceFolders} />
        <li>File → Publish to Roblox. Your experience, on your account.</li>
      </ol>
      {result.servicesWithProperties.length > 0 && (
        <p className="dim">
          {list(result.servicesWithProperties)} settings stay behind on this route — a model carries instances, not
          service properties. Set those in Studio. (The place file Studio opens directly has them already.)
        </p>
      )}
      {result.droppedInstances.length > 0 && (
        <p className="dim">Left out of the model (it cannot hold them): {list(result.droppedInstances)}.</p>
      )}
    </details>
  )
}

function Uploaded({ result, studio, onRetryStudio, projectId }: { result: EjectUploaded; studio: StudioChain | null; onRetryStudio?: () => void; projectId?: string }) {
  const where = result.username ? `your Roblox inventory (@${result.username})` : 'your Roblox inventory'

  if (result.moderation.verdict === 'rejected') {
    return (
      <>
        <p>
          <strong>{result.projectName}</strong> reached Roblox, but their review said no.
        </p>
        <p className="dim">Model {result.assetId} · Rejected by Roblox moderation</p>
        <p>
          Roblox reviews every upload, and it turned this one down — that is Roblox&apos;s call, not a mistake you
          made. It will not show up in your Toolbox while it is rejected.
        </p>
        <p>
          Names, images and sounds trip the review most often. Open it on Roblox to see their reason, adjust the game
          here, and send it again — every send makes a fresh model, so nothing is stuck.
        </p>
      </>
    )
  }

  return (
    <>
      <p>
        <strong>{result.projectName}</strong> is in {where}.
      </p>
      <p className="dim">
        Model {result.assetId}
        {result.moderation.label ? ` · ${result.moderation.label}` : ''}
      </p>

      {studio && <StudioChainStatus studio={studio} onRetry={onRetryStudio} />}

      {projectId && <ShareLinkFinder projectId={projectId} active />}

      <ToolboxSteps result={result} open={!studio || (studio.kind !== 'opened' && studio.kind !== 'launching')} />

      {result.moderation.verdict === 'reviewing' && (
        <p className="dim">
          Roblox is still checking the model copy over — it appears in your Toolbox once that clears, usually within
          minutes. Publishing the place Studio opened is not held up by that.
        </p>
      )}
      {result.moderation.verdict === 'unknown' && result.moderation.label && (
        <p className="dim">
          Roblox reports this model as “{result.moderation.label}”. If it does not appear in your Toolbox soon, check
          it on Roblox.
        </p>
      )}
    </>
  )
}

function Processing({ result, studio, onRetryStudio, projectId }: { result: EjectProcessing; studio: StudioChain | null; onRetryStudio?: () => void; projectId?: string }) {
  const where = result.username ? `your Roblox inventory (@${result.username})` : 'your Roblox inventory'
  return (
    <>
      <p>
        <strong>{result.projectName}</strong> is on its way to {where}.
      </p>
      <p className="dim">
        Roblox accepted the upload and is still working on it
        {result.operationId ? ` (operation ${result.operationId})` : ''}.
      </p>

      {studio && <StudioChainStatus studio={studio} onRetry={onRetryStudio} />}
      {(!studio || (studio.kind !== 'opened' && studio.kind !== 'launching')) && (
        <p>
          Give it a few minutes, then open Roblox Studio → Toolbox → Inventory → My Models — it lands there when Roblox
          finishes. Drag it into your place and File → Publish to Roblox.
        </p>
      )}

      {projectId && <ShareLinkFinder projectId={projectId} active />}

      {result.serviceFolders.length > 0 && (
        <p className="dim">
          If you go the Toolbox way: once it arrives, move the {list(result.serviceFolders)} folder
          {result.serviceFolders.length === 1 ? '' : 's'} into the service
          {result.serviceFolders.length === 1 ? '' : 's'} they are named after. (The place Studio opens directly needs
          none of that.)
        </p>
      )}
      <p className="dim">Sending again later is safe, but every send makes a separate model.</p>
    </>
  )
}

export default function EjectModal({
  outcome,
  studio = null,
  projectId,
  onClose,
  onOpenSettings,
  onRetryStudio,
}: {
  outcome: EjectOutcome
  /** State of the automatic open-in-Studio chain; null when it never started. */
  studio?: StudioChain | null
  /** Enables the share-link finder — the watcher needs a project to stamp. */
  projectId?: string
  onClose: () => void
  onOpenSettings?: () => void
  onRetryStudio?: () => void
}) {
  const failure = outcome.kind === 'failed' ? ejectFailureCopy(outcome.code) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card eject-card" onClick={(e) => e.stopPropagation()}>
        {outcome.kind === 'uploaded' && (
          <Uploaded result={outcome} studio={studio} onRetryStudio={onRetryStudio} projectId={outcome.moderation.verdict === 'rejected' ? undefined : projectId} />
        )}
        {outcome.kind === 'processing' && (
          <Processing result={outcome} studio={studio} onRetryStudio={onRetryStudio} projectId={projectId} />
        )}
        {outcome.kind === 'failed' && failure && (
          <>
            <p>
              <strong>{failure.title}</strong>
            </p>
            <p>{failure.body}</p>
            <p>{failure.action}</p>
            {outcome.detail && <p className="eject-detail dim">{outcome.detail}</p>}
          </>
        )}

        <div className="eject-actions">
          {outcome.kind === 'uploaded' && (
            <a className="btn btn-plain" href={outcome.assetUrl} target="_blank" rel="noopener noreferrer">
              View on Roblox
            </a>
          )}
          {outcome.kind === 'failed' && failure?.settings && onOpenSettings && (
            <button
              className="btn btn-plain"
              onClick={() => {
                onClose()
                onOpenSettings()
              }}
            >
              Open settings
            </button>
          )}
          <button className="btn btn-accent" onClick={onClose}>
            {outcome.kind === 'failed' ? 'Close' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
