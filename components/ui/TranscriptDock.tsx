'use client'

import { useEffect, useRef } from 'react'
import { useAppStore, PENDING_PREFIX, ERROR_PREFIX } from '@/lib/state/store'
import type { ThreadMessage } from '@/lib/protocol'
import { IconChevronDown, IconChevronUp } from './icons'

type Chip = { kind: 'pending' | 'error' | 'done'; text: string }

function parseChip(raw: string): Chip {
  if (raw.startsWith(PENDING_PREFIX)) return { kind: 'pending', text: raw.slice(PENDING_PREFIX.length) }
  if (raw.startsWith(ERROR_PREFIX)) return { kind: 'error', text: raw.slice(ERROR_PREFIX.length) }
  return { kind: 'done', text: raw }
}

function ToolChips({ chips }: { chips: string[] }) {
  if (chips.length === 0) return null
  const parsed = chips.map(parseChip)
  const settled = parsed.filter((c) => c.kind !== 'pending')
  const pending = parsed.filter((c) => c.kind === 'pending')
  const collapse = settled.length > 6

  return (
    <div className="chip-row">
      {collapse ? (
        <span className="chip">{settled.length} changes</span>
      ) : (
        settled.map((c, i) => (
          <span key={i} className={`chip${c.kind === 'error' ? ' chip-err' : ''}`}>
            {c.text}
          </span>
        ))
      )}
      {pending.map((c, i) => (
        <span key={`p${i}`} className="chip chip-pending">
          <span className="spinner" />
          {c.text}
        </span>
      ))}
    </div>
  )
}

function MessageRow({ message }: { message: ThreadMessage }) {
  if (message.role === 'user') {
    return (
      <div className="msg-row user">
        <div className="msg-user-bubble">{message.content}</div>
      </div>
    )
  }
  // An assistant turn with nothing in it yet renders as blank space; the working
  // row below stands in for it until the first token or tool arrives.
  if (!message.content.trim() && (message.toolSummaries ?? []).length === 0) return null
  return (
    <div className="msg-row">
      <div className="msg-assistant">
        {message.content}
        <ToolChips chips={message.toolSummaries ?? []} />
      </div>
    </div>
  )
}

export default function TranscriptDock({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const messages = useAppStore((s) => s.messages)
  const streaming = useAppStore((s) => s.streaming)
  const scrollRef = useRef<HTMLDivElement>(null)

  // A tool in flight already animates its own chip; otherwise the model is
  // thinking and nothing on screen would move without this.
  const last = messages[messages.length - 1]
  const toolInFlight = (last?.toolSummaries ?? []).some((c) => c.startsWith(PENDING_PREFIX))
  const showWorking = streaming && !toolInFlight

  useEffect(() => {
    if (collapsed) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, collapsed, showWorking])

  return (
    <div className={`transcript-dock${collapsed ? ' collapsed' : ''}`}>
      <div className="dock-header">
        <button className="icon-btn" aria-label={collapsed ? 'Expand' : 'Collapse'} onClick={onToggleCollapse}>
          {collapsed ? <IconChevronUp /> : <IconChevronDown />}
        </button>
      </div>
      {!collapsed && (
        <div className="transcript-scroll" ref={scrollRef}>
          {messages.map((m, i) => (
            <MessageRow key={i} message={m} />
          ))}
          {showWorking && (
            <div className="msg-row">
              <div className="msg-assistant working-row">
                <span className="spinner" />
                <span>Thinking…</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
