'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/lib/state/store'
import type { RbxInstance } from '@/lib/rbx/types'
import { IconChevronDown, IconPlus } from './icons'
import { isScriptInstance, scriptDisplayName } from './scriptDisplay'
import { relativeTime } from './relativeTime'
import PublishReadiness from './PublishReadiness'

function ProjectSwitcher() {
  const router = useRouter()
  const projects = useAppStore((s) => s.projects)
  const projectId = useAppStore((s) => s.projectId)
  const createProject = useAppStore((s) => s.createProject)

  const [open, setOpen] = useState(false)
  const [newMode, setNewMode] = useState(false)
  const [name, setName] = useState('')

  const current = projects.find((p) => p.id === projectId)

  async function submitNew() {
    const trimmed = name.trim()
    if (!trimmed) return
    setName('')
    setNewMode(false)
    setOpen(false)
    const id = await createProject(trimmed)
    router.push(`/p/${id}`)
  }

  return (
    <div className="switcher">
      <button className="switcher-btn" onClick={() => setOpen((v) => !v)}>
        <span className="name">{current?.name ?? ''}</span>
        <IconChevronDown />
      </button>
      {open && (
        <div className="switcher-menu">
          <button
            className="switcher-menu-item"
            onClick={() => {
              setOpen(false)
              router.push('/')
            }}
          >
            ← All projects
          </button>
          <div className="switcher-menu-sep" />
          {projects.map((p) => (
            <button
              key={p.id}
              className={`switcher-menu-item${p.id === projectId ? ' active' : ''}`}
              onClick={() => {
                setOpen(false)
                if (p.id !== projectId) router.push(`/p/${p.id}`)
              }}
            >
              {p.name}
            </button>
          ))}
          <div className="switcher-menu-sep" />
          {newMode ? (
            <div className="switcher-new-form">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNew()
                  if (e.key === 'Escape') setNewMode(false)
                }}
              />
              <button className="btn btn-accent" onClick={submitNew}>
                Create
              </button>
            </div>
          ) : (
            <button className="switcher-menu-item" onClick={() => setNewMode(true)}>
              New project
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Threads() {
  const threads = useAppStore((s) => s.threads)
  const activeThreadId = useAppStore((s) => s.activeThreadId)
  const openThread = useAppStore((s) => s.openThread)

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-head">
        <span className="section-label">Threads</span>
        <button className="icon-btn" aria-label="New thread" onClick={() => openThread(null)}>
          <IconPlus />
        </button>
      </div>
      <div className="thread-list">
        {threads.map((t) => (
          <div
            key={t.id}
            className={`thread-row${t.id === activeThreadId ? ' active' : ''}`}
            onClick={() => openThread(t.id)}
          >
            <span className="thread-title">{t.title}</span>
            <span className="thread-time">{relativeTime(t.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TreeNode({
  inst,
  depth,
  onOpenScript,
}: {
  inst: RbxInstance
  depth: number
  onOpenScript: (id: string) => void
}) {
  const isScript = isScriptInstance(inst)
  const label = isScript ? scriptDisplayName(inst) : inst.name

  return (
    <div>
      <div
        className={`tree-row${isScript ? ' tree-row-script mono' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={isScript ? () => onOpenScript(inst.id) : undefined}
      >
        {label}
      </div>
      {inst.children.map((c) => (
        <TreeNode key={c.id} inst={c} depth={depth + 1} onOpenScript={onOpenScript} />
      ))}
    </div>
  )
}

function Files({ onOpenScript }: { onOpenScript: (id: string) => void }) {
  const tree = useAppStore((s) => s.tree)

  return (
    <div className="sidebar-section grow">
      <div className="sidebar-section-head">
        <span className="section-label">Files</span>
      </div>
      <div className="tree-list">
        {tree?.services.map((s) => (
          <TreeNode key={s.id} inst={s} depth={0} onOpenScript={onOpenScript} />
        ))}
      </div>
    </div>
  )
}

export default function Sidebar({
  collapsed,
  onOpenScript,
}: {
  collapsed: boolean
  onOpenScript: (id: string) => void
}) {
  return (
    <div className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-inner">
        <ProjectSwitcher />
        <Threads />
        <Files onOpenScript={onOpenScript} />
        <PublishReadiness />
      </div>
    </div>
  )
}
