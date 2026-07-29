'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/state/store'
import { IconClose } from './icons'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

interface ConnectResult {
  connected: boolean
  universeId: string | null
  places: { id: string; name: string }[]
  candidates: { universeId: string; placeCount: number }[]
  expiresAt: string | null
  blocked: string | null
}

/**
 * Operator configuration, one field deep. The API key already knows which
 * universes it can publish to and place lists are public, so Connect derives
 * everything else — nobody copies IDs out of a dashboard (see
 * lib/roblox/discover.ts). Manual entry survives behind Advanced for the
 * all-universes-scoped key case.
 */
export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const projectId = useAppStore((s) => s.projectId)
  const projects = useAppStore((s) => s.projects)
  const project = projects.find((p) => p.id === projectId)

  const [hasKey, setHasKey] = useState(false)
  const [masked, setMasked] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [universeId, setUniverseId] = useState('')
  const [placeCount, setPlaceCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ConnectResult | null>(null)
  const [manualUniverse, setManualUniverse] = useState('')
  const [manualPlaces, setManualPlaces] = useState('')

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!isRecord(data)) return
        setHasKey(data.hasKey === true)
        setMasked(typeof data.masked === 'string' ? data.masked : null)
        const uid = typeof data.universeId === 'string' ? data.universeId : ''
        setUniverseId(uid)
        setManualUniverse(uid)
        const pool = Array.isArray(data.placePool) ? (data.placePool as string[]) : []
        setPlaceCount(pool.length)
        setManualPlaces(pool.join(', '))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function connect(pinUniverse?: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
          ...(pinUniverse ? { universeId: pinUniverse } : {}),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(isRecord(data) && typeof data.error === 'string' ? data.error : `Failed (${res.status})`)
        return
      }
      const r = data as ConnectResult
      setResult(r)
      setApiKeyInput('')
      setHasKey(true)
      if (r.universeId) {
        setUniverseId(r.universeId)
        setManualUniverse(r.universeId)
      }
      setPlaceCount(r.places.length)
      setManualPlaces(r.places.map((p) => p.id).join(', '))
      if (r.blocked) setError(r.blocked)
      const settings = await fetch('/api/settings').then((x) => (x.ok ? x.json() : null))
      if (isRecord(settings) && typeof settings.masked === 'string') setMasked(settings.masked)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveManual() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          universeId: manualUniverse.trim(),
          placePool: manualPlaces.split(',').map((p) => p.trim()).filter(Boolean),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(isRecord(data) && typeof data.error === 'string' ? data.error : 'Could not save')
        return
      }
      if (isRecord(data)) {
        setUniverseId(typeof data.universeId === 'string' ? data.universeId : '')
        setPlaceCount(Array.isArray(data.placePool) ? data.placePool.length : 0)
      }
    } finally {
      setBusy(false)
    }
  }

  const connected = !!universeId && placeCount > 0

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-head">
          <span className="sheet-title">Roblox connection</span>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor="roblox-api-key">API key</label>
            <input
              id="roblox-api-key"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void connect()
              }}
              placeholder={hasKey ? masked ?? '••••••••' : 'Paste your Open Cloud key'}
              disabled={busy}
            />
          </div>

          <button
            className="btn btn-accent"
            onClick={() => void connect()}
            disabled={busy || (!apiKeyInput.trim() && !hasKey)}
          >
            {busy ? 'Connecting…' : connected ? 'Reconnect' : 'Connect'}
          </button>

          {error && <p className="test-result err">{error}</p>}

          {connected && (
            <div className="conn-status">
              <span className="conn-dot" />
              Connected — experience {universeId}, {placeCount} place{placeCount === 1 ? '' : 's'}
              {result?.expiresAt ? ` · key expires ${new Date(result.expiresAt).toLocaleDateString()}` : ''}
            </div>
          )}

          {result && result.candidates.length > 1 && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Experience</label>
              {result.candidates.map((c) => (
                <button
                  key={c.universeId}
                  className={`switcher-menu-item${c.universeId === universeId ? ' active' : ''}`}
                  onClick={() => void connect(c.universeId)}
                  disabled={busy}
                >
                  {c.universeId} · {c.placeCount} place{c.placeCount === 1 ? '' : 's'}
                </button>
              ))}
            </div>
          )}

          {project?.roblox?.placeId && (
            <p className="settings-footer">This game publishes to place {project.roblox.placeId}.</p>
          )}

          <details className="disclosure">
            <summary>First time? One-time setup</summary>
            <div className="disclosure-body">
              <p>Roblox has no API that can create an experience, so it starts in Studio — once, ever:</p>
              <p>1. Roblox Studio → File → Publish to Roblox (an empty Baseplate is fine). Add a few extra places to that same experience if you want to host several games.</p>
              <p>2. create.roblox.com/dashboard/credentials → Create API Key → add the <strong>universe-places</strong> system → select your experience → add the <strong>Write</strong> operation → copy the key.</p>
              <p>3. Paste it above and hit Connect. The experience and its places are read from the key — nothing else to copy.</p>
              <p>Keys expire after 60 days unused. You can also set ROBLOX_API_KEY in .env.local instead of pasting.</p>
            </div>
          </details>

          <details className="disclosure">
            <summary>Advanced — set IDs manually</summary>
            <div className="disclosure-body">
              <p>Only needed if your key is scoped to all universes, so we can&apos;t tell which one to use.</p>
              <div className="field">
                <label htmlFor="universe-id">Universe ID</label>
                <input
                  id="universe-id"
                  value={manualUniverse}
                  onChange={(e) => setManualUniverse(e.target.value)}
                  onBlur={saveManual}
                />
              </div>
              <div className="field">
                <label htmlFor="place-pool">Places (comma-separated IDs)</label>
                <input
                  id="place-pool"
                  value={manualPlaces}
                  onChange={(e) => setManualPlaces(e.target.value)}
                  onBlur={saveManual}
                />
              </div>
            </div>
          </details>

          <p className="settings-footer">
            Preview renders real place data (parts, colors, lighting) and screen UI. Terrain, meshes and image assets show in Roblox only.
          </p>
        </div>
      </div>
    </>
  )
}
