'use client'

/**
 * Shown after a successful eject. The model is in the user's own Roblox
 * inventory; these are the remaining steps only they can do, because no Roblox
 * API can publish a place on someone else's behalf.
 *
 * Everything here comes from the eject response — the service folders, the
 * dropped instances and the moderation state are what the build and Roblox
 * actually reported, not a hopeful guess.
 */
export interface EjectResult {
  assetId: string
  assetUrl: string
  moderationState: string | null
  projectName: string
  serviceFolders: string[]
  droppedInstances: string[]
  servicesWithProperties: string[]
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export default function EjectModal({ result, onClose }: { result: EjectResult; onClose: () => void }) {
  const pending = result.moderationState !== null && result.moderationState !== 'Approved'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card eject-card" onClick={(e) => e.stopPropagation()}>
        <p>
          <strong>{result.projectName}</strong> is in your Roblox account.
        </p>
        <p className="dim">
          Model {result.assetId}
          {result.moderationState ? ` · ${result.moderationState}` : ''}
        </p>

        <ol className="eject-steps">
          <li>Roblox Studio → Toolbox → Inventory → My Models.</li>
          <li>Drag {result.projectName} into your place.</li>
          {result.serviceFolders.length > 0 && (
            <li>
              Move the {list(result.serviceFolders)} folder{result.serviceFolders.length === 1 ? '' : 's'} out of the
              model and into the service{result.serviceFolders.length === 1 ? '' : 's'} they are named after.
            </li>
          )}
          <li>File → Publish to Roblox. It is your experience, on your account.</li>
        </ol>

        {pending && (
          <p className="dim">Roblox is still moderating it — it appears in the Toolbox once that clears.</p>
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

        <div className="eject-actions">
          <a className="btn btn-plain" href={result.assetUrl} target="_blank" rel="noopener noreferrer">
            View on Roblox
          </a>
          <button className="btn btn-accent" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
