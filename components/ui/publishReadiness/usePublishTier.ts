'use client'

// Client fetch of GET /api/roblox/eligibility. The route never starts an
// OAuth flow (deferred consent), so polling it on mount costs the user
// nothing and asks them for nothing — missing sources come back as honest
// 'unknown' fields, not errors.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublishTier } from '@/lib/roblox/eligibility'
import { buildReadinessView, type ReadinessVM } from './view'

export type EligibilityState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; tier: PublishTier; view: ReadinessVM }

export function usePublishTier(): { state: EligibilityState; refresh: () => void } {
  const [state, setState] = useState<EligibilityState>({ phase: 'loading' })
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/roblox/eligibility')
      const data: unknown = await res.json()
      if (!alive.current) return
      if (!res.ok) {
        const message =
          typeof (data as { error?: unknown } | null)?.error === 'string'
            ? (data as { error: string }).error
            : `HTTP ${res.status}`
        setState({ phase: 'error', message })
        return
      }
      const tier = data as PublishTier
      setState({ phase: 'ready', tier, view: buildReadinessView(tier) })
    } catch (err) {
      if (!alive.current) return
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  const refresh = useCallback(() => {
    setState({ phase: 'loading' })
    void load()
  }, [load])

  // Initial state is already 'loading', so mount just starts the fetch —
  // same async-IIFE idiom as SettingsSheet's account load.
  useEffect(() => {
    alive.current = true
    void (async () => {
      await load()
    })()
    return () => {
      alive.current = false
    }
  }, [load])

  return { state, refresh }
}
