'use client'

import { useEffect, useState } from 'react'
import { IconClose } from './icons'

/**
 * Explicit-consent install flow for the Studio helper plugin
 * (plugin/BloxableHelper.luau).
 *
 * The trust contract this component keeps:
 *   - Nothing is ever installed without the user clicking Install inside the
 *     dialog. Opening the app, opening the dialog, closing the dialog — none
 *     of it writes anything anywhere.
 *   - The Install button cannot be reached before the explanation: it lives at
 *     the bottom of the consent dialog, below what the plugin does, what it
 *     never does, a "Show me the code" expander with the real source (served
 *     verbatim by GET /api/studio-plugin/status), and the exact file path that
 *     will be written. It also stays disabled until that status has actually
 *     loaded, so the path and code shown are real, never placeholders.
 *   - Uninstall is one click too, plus the manual path for doing it by hand.
 *
 * The only network calls here go to this app's own localhost API routes.
 */

interface HelperPluginStatus {
  supported: boolean
  reason: string | null
  folder: string | null
  targetPath: string | null
  installed: boolean
  byteIdentical: boolean | null
  shippedSha256: string
  shippedBytes: number
  installedSha256: string | null
  source: string
}

async function readError(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json()
    const message = (data as { error?: unknown } | null)?.error
    if (typeof message === 'string' && message) return message
  } catch {
    // fall through
  }
  return `HTTP ${res.status}`
}

async function fetchStatus(): Promise<
  { ok: true; status: HelperPluginStatus } | { ok: false; error: string | null }
> {
  try {
    const res = await fetch('/api/studio-plugin/status')
    if (!res.ok) return { ok: false, error: await readError(res) }
    return { ok: true, status: (await res.json()) as HelperPluginStatus }
  } catch {
    // Status stays unknown; the dialog retries when opened.
    return { ok: false, error: null }
  }
}

export default function HelperPluginConsent() {
  const [status, setStatus] = useState<HelperPluginStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Read-only status check against this app's own local API (which only looks
  // at the local disk) so the row below tells the truth. Nothing is written.
  useEffect(() => {
    let cancelled = false
    void fetchStatus().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setStatus(result.status)
        setError(null)
      } else if (result.error) {
        setError(result.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  function openDialog() {
    setNotice(null)
    setError(null)
    setOpen(true)
    // Refresh so the dialog never shows a stale state.
    void fetchStatus().then((result) => {
      if (result.ok) {
        setStatus(result.status)
        setError(null)
      } else if (result.error) {
        setError(result.error)
      }
    })
  }

  async function install() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/studio-plugin/install', { method: 'POST' })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const data = (await res.json()) as { path: string; status: HelperPluginStatus }
      setStatus(data.status)
      setNotice(`Installed: ${data.path}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/studio-plugin/remove', { method: 'POST' })
      if (!res.ok) {
        setError(await readError(res))
        return
      }
      const data = (await res.json()) as { existed: boolean; path: string; status: HelperPluginStatus }
      setStatus(data.status)
      setNotice(data.existed ? `Removed: ${data.path}` : 'It was not installed — nothing to remove.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const installed = status?.installed === true
  const stateLabel =
    status === null
      ? 'checking…'
      : !status.supported
        ? 'not available on this computer'
        : !status.installed
          ? 'not installed'
          : status.byteIdentical
            ? 'installed'
            : 'installed (older copy)'

  return (
    <>
      <section style={{ maxWidth: 1060, margin: '0 auto', padding: '0 36px 64px' }}>
        <div className="conn-status" style={{ marginTop: 0, justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              className="conn-dot"
              style={{ background: installed ? 'var(--ok)' : 'var(--border-strong)' }}
            />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong style={{ color: 'var(--text)', fontWeight: 600 }}>Studio helper plugin</strong>
              {' — '}
              {stateLabel}. Optional: tells Bloxable which Roblox account is signed into Studio, nothing else.
            </span>
          </span>
          <button className="btn" style={{ flexShrink: 0 }} onClick={openDialog}>
            {installed ? 'Details' : 'Details & install'}
          </button>
        </div>
      </section>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 600, maxWidth: '94vw', maxHeight: '86vh', overflowY: 'auto', textAlign: 'left' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>The Studio helper plugin</span>
              <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
                <IconClose />
              </button>
            </div>

            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)' }}>
              Bloxable works without it. Installing it is your call, and here is everything it does — before
              anything is installed.
            </p>

            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>What it does</p>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              It answers one question for Bloxable: <em>which Roblox account is signed into Studio on this
              computer?</em> When Studio starts, the plugin asks Studio for the signed-in account&apos;s user ID —
              a public number, the same one anyone can see on a profile page — and sends that one number to the
              Bloxable app running on this computer. That is the whole job. Bloxable uses it to tell you honestly
              what that account can publish.
            </p>

            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>What it never does</p>
            <ul style={{ margin: '0 0 14px', paddingLeft: 18, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.7 }}>
              <li>Never reads cookies, passwords, or login tokens (no .ROBLOSECURITY — ever).</li>
              <li>Never opens, reads, or changes your games, scripts, or files.</li>
              <li>
                Never talks to the internet. The only place it sends anything is this computer
                (<span className="mono">localhost</span>) — it cannot reach roblox.com or anywhere else.
              </li>
              <li>
                Never runs in the background. It reports once when Studio starts (up to three quiet tries if
                Bloxable isn&apos;t open yet), then stops until the next Studio start.
              </li>
            </ul>

            <details className="disclosure" style={{ margin: '0 0 14px' }}>
              <summary>Show me the code — the exact file, nothing hidden</summary>
              <div className="disclosure-body">
                {status ? (
                  <>
                    <p style={{ margin: '0 0 8px' }}>
                      This is the complete plugin, verbatim ({status.shippedBytes.toLocaleString('en-US')} bytes,
                      SHA-256 <span className="mono">{status.shippedSha256.slice(0, 16)}…</span>). What you read
                      here is byte-for-byte what gets installed.
                    </p>
                    <pre className="code-pre" style={{ maxHeight: 320, overflowY: 'auto' }}>{status.source}</pre>
                  </>
                ) : (
                  <p style={{ margin: 0 }}>Loading the plugin source…</p>
                )}
              </div>
            </details>

            <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600 }}>Where it goes</p>
            <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              One file, into Studio&apos;s own local plugins folder — the same folder Studio opens from
              Plugins&nbsp;→&nbsp;Plugins&nbsp;Folder, so you can see it there yourself:
            </p>
            <p className="mono" style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text)', wordBreak: 'break-all' }}>
              {status?.targetPath ?? 'Working out the exact path…'}
            </p>

            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--text-faint)', lineHeight: 1.6 }}>
              Two honest notes: Studio loads local plugins at startup, so it takes effect the next time Studio
              starts. And the first time it runs, Studio itself shows a permission popup asking whether this
              plugin may talk to <span className="mono">localhost</span> — that is Studio double-checking, which
              is exactly what should happen. Saying no there simply leaves Bloxable not knowing who is signed in.
            </p>

            {status !== null && !status.supported && (
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)' }}>{status.reason}</p>
            )}

            {installed && (
              <div className="conn-status" style={{ marginTop: 0, marginBottom: 14 }}>
                <span className="conn-dot" />
                <span>
                  Installed{status?.byteIdentical === false ? ' — older copy; Install updates it' : ''}. To remove
                  it: the Remove button below, or delete that file yourself and restart Studio.
                </span>
              </div>
            )}

            {notice && (
              <p className="test-result ok" style={{ margin: '0 0 12px', wordBreak: 'break-all' }}>{notice}</p>
            )}
            {error && (
              <p className="test-result err" style={{ margin: '0 0 12px' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setOpen(false)}>Close</button>
              {installed && (
                <button className="btn" onClick={remove} disabled={busy || !status?.supported}>
                  {busy ? 'Working…' : 'Remove the helper'}
                </button>
              )}
              {/* Inert until the explanation above is real: disabled until the
                  status (exact path + verbatim source) has loaded, and the
                  button itself only exists below the full explanation. */}
              <button
                className="btn btn-accent"
                onClick={install}
                disabled={busy || status === null || !status.supported}
              >
                {busy
                  ? 'Working…'
                  : status === null
                    ? 'Loading…'
                    : installed
                      ? status.byteIdentical
                        ? 'Reinstall'
                        : 'Update the helper'
                      : 'Install the helper'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
