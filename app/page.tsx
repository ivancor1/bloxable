'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/state/store'
import Viewer3D from '@/components/viewer/Viewer3D'
import Sidebar from '@/components/ui/Sidebar'
import Topbar from '@/components/ui/Topbar'
import Composer from '@/components/ui/Composer'
import TranscriptDock from '@/components/ui/TranscriptDock'
import CodeSheet from '@/components/ui/CodeSheet'
import SettingsSheet from '@/components/ui/SettingsSheet'
import PaywallModal from '@/components/ui/PaywallModal'
import CreateProjectCard from '@/components/ui/CreateProjectCard'
import SelectionChip from '@/components/ui/SelectionChip'

export default function Home() {
  const projects = useAppStore((s) => s.projects)
  const messages = useAppStore((s) => s.messages)
  const credits = useAppStore((s) => s.credits)
  const selectionId = useAppStore((s) => s.selectionId)
  const select = useAppStore((s) => s.select)
  const loadInitial = useAppStore((s) => s.loadInitial)

  const [ready, setReady] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [codeSheetId, setCodeSheetId] = useState<string | null>(null)
  const [paywallOpen, setPaywallOpen] = useState(false)

  const composerRef = useRef<HTMLInputElement>(null)
  const prevRemaining = useRef(credits.remaining)

  useEffect(() => {
    loadInitial().finally(() => setReady(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Out-of-credits paywall: open exactly when remaining hits zero.
  useEffect(() => {
    if (!credits.unlimited && prevRemaining.current > 0 && credits.remaining <= 0) {
      setPaywallOpen(true)
    }
    prevRemaining.current = credits.remaining
  }, [credits.remaining, credits.unlimited])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        composerRef.current?.focus()
        return
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarCollapsed((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        if (selectionId) {
          select(null)
        } else if (codeSheetId) {
          setCodeSheetId(null)
        } else if (settingsOpen) {
          setSettingsOpen(false)
        } else if (!dockCollapsed) {
          setDockCollapsed(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectionId, codeSheetId, settingsOpen, dockCollapsed, select])

  if (!ready) return <div className="empty-shell" />

  if (projects.length === 0) {
    return <CreateProjectCard />
  }

  return (
    <div className="app-shell">
      <Sidebar collapsed={sidebarCollapsed} onOpenScript={setCodeSheetId} />
      <main className="main-area">
        <div className="viewer-slot">
          <Viewer3D />
        </div>
        <Topbar onOpenSettings={() => setSettingsOpen(true)} />
        <SelectionChip />
        <div className="dock-composer-wrap">
          {messages.length > 0 && (
            <TranscriptDock collapsed={dockCollapsed} onToggleCollapse={() => setDockCollapsed((v) => !v)} />
          )}
          <Composer inputRef={composerRef} onPaywall={() => setPaywallOpen(true)} />
        </div>
      </main>
      {codeSheetId && <CodeSheet scriptId={codeSheetId} onClose={() => setCodeSheetId(null)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {paywallOpen && <PaywallModal onClose={() => setPaywallOpen(false)} />}
    </div>
  )
}
