'use client'

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

function Uploaded({ result }: { result: EjectUploaded }) {
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

      <ol className="eject-steps">
        <li>Open Roblox Studio → Toolbox → Inventory → My Models.</li>
        <li>
          Drag {result.projectName} into your place — it is the newest model there.
        </li>
        <ServiceFoldersStep folders={result.serviceFolders} />
        <li>File → Publish to Roblox. Your experience, on your account.</li>
      </ol>

      {result.moderation.verdict === 'reviewing' && (
        <p className="dim">
          Roblox is still checking it over — it appears in your Toolbox once that clears, usually within minutes.
        </p>
      )}
      {result.moderation.verdict === 'unknown' && result.moderation.label && (
        <p className="dim">
          Roblox reports this model as “{result.moderation.label}”. If it does not appear in your Toolbox soon, check
          it on Roblox.
        </p>
      )}
      {result.servicesWithProperties.length > 0 && (
        <p className="dim">
          {list(result.servicesWithProperties)} settings stay behind — a model carries instances, not service
          properties. Set those in Studio.
        </p>
      )}
      {result.droppedInstances.length > 0 && (
        <p className="dim">Left out (a model cannot hold them): {list(result.droppedInstances)}.</p>
      )}
    </>
  )
}

function Processing({ result }: { result: EjectProcessing }) {
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
      <p>
        Give it a few minutes, then open Roblox Studio → Toolbox → Inventory → My Models — it lands there when Roblox
        finishes. Drag it into your place and File → Publish to Roblox.
      </p>
      {result.serviceFolders.length > 0 && (
        <p className="dim">
          Once it arrives, move the {list(result.serviceFolders)} folder{result.serviceFolders.length === 1 ? '' : 's'}{' '}
          into the service{result.serviceFolders.length === 1 ? '' : 's'} they are named after.
        </p>
      )}
      <p className="dim">Sending again later is safe, but every send makes a separate model.</p>
    </>
  )
}

export default function EjectModal({
  outcome,
  onClose,
  onOpenSettings,
}: {
  outcome: EjectOutcome
  onClose: () => void
  onOpenSettings?: () => void
}) {
  const failure = outcome.kind === 'failed' ? ejectFailureCopy(outcome.code) : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card eject-card" onClick={(e) => e.stopPropagation()}>
        {outcome.kind === 'uploaded' && <Uploaded result={outcome} />}
        {outcome.kind === 'processing' && <Processing result={outcome} />}
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
