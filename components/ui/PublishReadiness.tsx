'use client'

// Sidebar entry for the publish-readiness surface — the one line Sidebar.tsx
// mounts. A quiet row at the bottom of the sidebar: tone dot + label +
// one-word status; clicking opens the full ReadinessPanel sheet. The status
// summarizes audiences.sixteenPlus.status from the tier object, with
// 'unknown' rendered as a neutral "Not checked yet" — never as a failure.

import { useState } from 'react'
import { LOAD, SIDEBAR_LABEL, SIXTEEN_PLUS } from './publishReadiness/copy'
import ReadinessPanel from './publishReadiness/ReadinessPanel'
import { usePublishTier } from './publishReadiness/usePublishTier'
import type { Tone } from './publishReadiness/view'
import styles from './publishReadiness/publishReadiness.module.css'

const DOT_BY_TONE: Record<Tone, string> = {
  ok: styles.dotOk,
  todo: styles.dotTodo,
  unknown: styles.dotUnknown,
  self: styles.dotSelf,
}

export default function PublishReadiness() {
  const { state, refresh } = usePublishTier()
  const [open, setOpen] = useState(false)

  const summary: { text: string; tone: Tone } =
    state.phase === 'loading'
      ? { text: LOAD.checking, tone: 'unknown' }
      : state.phase === 'error'
        ? { text: LOAD.entryError, tone: 'unknown' }
        : { text: SIXTEEN_PLUS.pill[state.tier.audiences.sixteenPlus.status], tone: state.view.pill.tone }

  return (
    <>
      <button className={styles.entry} onClick={() => setOpen(true)}>
        <span className={`${styles.dot} ${DOT_BY_TONE[summary.tone]}`} aria-hidden />
        <span className={styles.entryLabel}>{SIDEBAR_LABEL}</span>
        <span className={styles.entryStatus}>{summary.text}</span>
      </button>
      {open && <ReadinessPanel state={state} onRefresh={refresh} onClose={() => setOpen(false)} />}
    </>
  )
}
