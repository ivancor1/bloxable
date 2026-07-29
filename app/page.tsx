'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ProjectMeta } from '@/lib/rbx/types'
import { useAppStore } from '@/lib/state/store'
import SettingsSheet from '@/components/ui/SettingsSheet'
import { relativeTime } from '@/components/ui/relativeTime'
import { IconGear, IconPlus } from '@/components/ui/icons'
import { APP_NAME } from '@/lib/config'

// Deterministic pastel cover per project — no thumbnails yet, so every card
// gets a stable two-stop gradient derived from its id.
const COVERS: [string, string][] = [
  ['#c9d2f8', '#eef2fe'],
  ['#f8d8c9', '#fdf1ea'],
  ['#c9f0e2', '#eafcf5'],
  ['#e6d5f7', '#f6effd'],
  ['#f7edc4', '#fdf9e8'],
  ['#cfe5fb', '#ecf5fe'],
]

function coverFor(id: string): [string, string] {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return COVERS[Math.abs(h) % COVERS.length]
}

function titleFromPrompt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  if (flat.length <= 34) return flat
  return `${flat.slice(0, 33).trimEnd()}…`
}

function ProjectCard({ project }: { project: ProjectMeta }) {
  const router = useRouter()
  const [from, to] = coverFor(project.id)
  return (
    <button className="project-card" onClick={() => router.push(`/p/${project.id}`)}>
      <div className="project-cover" style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}>
        {project.lastPublish && (
          <span className="badge">
            <span className="dot" />
            LIVE
          </span>
        )}
      </div>
      <div className="project-card-body">
        <div className="project-card-name">{project.name}</div>
        <div className="project-card-meta">Edited {relativeTime(project.updatedAt)}</div>
      </div>
    </button>
  )
}

export default function HomePage() {
  const router = useRouter()
  const projects = useAppStore((s) => s.projects)
  const loadInitial = useAppStore((s) => s.loadInitial)
  const createProject = useAppStore((s) => s.createProject)

  const [ready, setReady] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadInitial().finally(() => setReady(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sorted = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects]
  )

  async function startFromPrompt() {
    const text = prompt.trim()
    if (!text || creating) return
    setCreating(true)
    try {
      const id = await createProject(titleFromPrompt(text))
      router.push(`/p/${id}?prompt=${encodeURIComponent(text)}`)
    } catch {
      setCreating(false)
    }
  }

  return (
    <div className="home">
      <nav className="home-nav">
        <span className="home-logo">
          <span className="home-logo-mark" />
          {APP_NAME}
        </span>
        <button className="btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <IconGear />
        </button>
      </nav>

      <section className="hero">
        <h1>What will you build today?</h1>
        <div className="hero-bar">
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') startFromPrompt()
            }}
            placeholder="Describe a game — an obby, a tycoon, a laser tag arena…"
            disabled={creating}
          />
          <button className="btn btn-accent" onClick={startFromPrompt} disabled={creating || !prompt.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
        <p className="hero-sub">Real Roblox games, built by describing them.</p>
      </section>

      <section className="home-section">
        {ready && (
          <>
            <div className="home-section-head">
              <span className="count">{sorted.length}</span>
              <span className="label">{sorted.length === 1 ? 'game' : 'games'}</span>
            </div>
            <div className="project-grid">
              {sorted.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
              <button className="create-tile" onClick={() => inputRef.current?.focus()}>
                <span className="plus">
                  <IconPlus />
                </span>
                New game
              </button>
            </div>
          </>
        )}
      </section>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
