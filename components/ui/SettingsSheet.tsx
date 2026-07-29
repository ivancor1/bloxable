'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/lib/state/store'
import type { ProjectMeta } from '@/lib/rbx/types'
import { IconClose } from './icons'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export default function SettingsSheet({ onClose }: { onClose: () => void }) {
  const projectId = useAppStore((s) => s.projectId)
  const projects = useAppStore((s) => s.projects)
  const project = projects.find((p) => p.id === projectId)

  const [hasKey, setHasKey] = useState(false)
  const [masked, setMasked] = useState<string | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [universeId, setUniverseId] = useState(project?.roblox?.universeId ?? '')
  const [placeId, setPlaceId] = useState(project?.roblox?.placeId ?? '')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setHasKey(!!(isRecord(data) && data.hasKey))
        setMasked(isRecord(data) && typeof data.masked === 'string' ? data.masked : null)
      })
      .catch(() => setHasKey(false))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function saveKey() {
    const key = apiKeyInput.trim()
    if (!key) return
    // app/api/settings/route.ts only exposes GET and PUT.
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ robloxApiKey: key }),
    })
    if (res.ok) {
      setApiKeyInput('')
      const data = await res.json().catch(() => null)
      setHasKey(!!(isRecord(data) && data.hasKey))
      setMasked(isRecord(data) && typeof data.masked === 'string' ? data.masked : null)
    }
  }

  async function saveIds(next: { universeId: string; placeId: string }) {
    if (!projectId) return
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roblox: { universeId: next.universeId, placeId: next.placeId } }),
    })
    if (!res.ok) return
    const updated = (await res.json().catch(() => null)) as ProjectMeta | null
    useAppStore.setState((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId
          ? updated ?? { ...p, roblox: { universeId: next.universeId, placeId: next.placeId } }
          : p,
      ),
    }))
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/settings/test', { method: 'POST' })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const message = isRecord(data) && typeof data.error === 'string' ? data.error : `Failed (${res.status})`
        setTestResult({ ok: false, message })
        return
      }
      // Real introspect result (app/api/settings/test/route.ts): render the
      // actual returned fields, not invented status prose.
      const enabled = isRecord(data) && data.enabled === true
      const expired = isRecord(data) && data.expired === true
      const universeIds = isRecord(data) && Array.isArray(data.universeIds) ? (data.universeIds as string[]) : []
      const bits = [expired ? 'Expired' : enabled ? 'Enabled' : 'Disabled']
      bits.push(`${universeIds.length} universe${universeIds.length === 1 ? '' : 's'}`)
      setTestResult({ ok: enabled && !expired, message: bits.join(' · ') })
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Connection failed' })
    } finally {
      setTesting(false)
    }
  }

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
              onBlur={saveKey}
              placeholder={hasKey ? masked ?? '••••••••' : ''}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="universe-id">Universe ID</label>
              <input
                id="universe-id"
                value={universeId}
                onChange={(e) => setUniverseId(e.target.value)}
                onBlur={() => saveIds({ universeId, placeId })}
              />
            </div>
            <div className="field">
              <label htmlFor="place-id">Place ID</label>
              <input
                id="place-id"
                value={placeId}
                onChange={(e) => setPlaceId(e.target.value)}
                onBlur={() => saveIds({ universeId, placeId })}
              />
            </div>
          </div>

          <button className="btn" onClick={testConnection} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {testResult && (
            <p className={`test-result ${testResult.ok ? 'ok' : 'err'}`}>{testResult.message}</p>
          )}

          <details className="disclosure">
            <summary>Where do I find these?</summary>
            <div className="disclosure-body">
              <p>One-time setup — Roblox can&apos;t create an experience by API:</p>
              <p>1. In Roblox Studio: File -&gt; Publish to Roblox (a Baseplate is fine). After this, Studio isn&apos;t needed again.</p>
              <p>2. At create.roblox.com/dashboard/creations: hover your experience -&gt; the three-dot menu -&gt; Copy Universe ID. Open it -&gt; Places -&gt; the Place ID is in the URL.</p>
              <p>3. At create.roblox.com/dashboard/credentials: Create API Key -&gt; add &apos;universe-places&apos; -&gt; select your experience -&gt; Write -&gt; paste the key here. It stays on this machine. Keys expire after 60 days unused.</p>
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
