'use client'

// The publish-readiness sheet. Layout only — every state decision lives in
// view.ts and every word in copy.ts. Renders usefully in ALL tier states,
// including the deferred-consent zero-account one: the hook copy (what
// publishing actually takes) is the point, not a login wall.

import { useEffect } from 'react'
import { IconClose } from '../icons'
import { relativeTime } from '../relativeTime'
import { FOOTER, LOAD, PANEL_SUB, PANEL_TITLE, SIXTEEN_PLUS, UNDER_16 } from './copy'
import type { FactVM, PillVM, ReadinessVM, Tone } from './view'
import styles from './publishReadiness.module.css'
import type { EligibilityState } from './usePublishTier'

const DOT_BY_TONE: Record<Tone, string> = {
  ok: styles.dotOk,
  todo: styles.dotTodo,
  unknown: styles.dotUnknown,
  self: styles.dotSelf,
}

const PILL_BY_TONE: Record<PillVM['tone'], string> = {
  ok: styles.pillOk,
  todo: styles.pillTodo,
  unknown: styles.pillUnknown,
}

function Dot({ tone }: { tone: Tone }) {
  return <span className={`${styles.dot} ${DOT_BY_TONE[tone]}`} aria-hidden />
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noopener noreferrer">
      {label} ↗
    </a>
  )
}

function FactRow({ fact }: { fact: FactVM }) {
  return (
    <div className={styles.fact}>
      <Dot tone={fact.tone} />
      <div>
        <div className={styles.factLabel}>
          {fact.label}
          {fact.detail && <span className={styles.factDetail}>{fact.detail}</span>}
        </div>
        <div className={styles.factText}>
          {fact.text}
          {fact.link && (
            <>
              {' '}
              <ExternalLink href={fact.link.href} label={fact.link.label} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SixteenPlusCard({ vm }: { vm: ReadinessVM }) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{SIXTEEN_PLUS.title}</span>
        <span className={`${styles.pill} ${PILL_BY_TONE[vm.pill.tone]}`}>{vm.pill.label}</span>
      </div>

      <h3 className={styles.hookHeadline}>{SIXTEEN_PLUS.hookHeadline}</h3>
      <p className={styles.body}>{SIXTEEN_PLUS.hookIntro}</p>
      <ol className={styles.hookSteps}>
        {SIXTEEN_PLUS.hookSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className={styles.statusLine}>
        <Dot tone={vm.pill.tone} />
        <span>{vm.statusLine}</span>
      </div>

      <div className={styles.groupLabel}>{SIXTEEN_PLUS.factsTitle}</div>
      {vm.facts.map((fact) => (
        <FactRow key={fact.key} fact={fact} />
      ))}

      {vm.nextSteps.length > 0 && (
        <>
          <div className={styles.groupLabel}>{SIXTEEN_PLUS.nextStepsTitle}</div>
          <ol className={styles.steps}>
            {vm.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}

      <div className={styles.note}>
        <p className={styles.noteTitle}>{vm.creatorAge.title}</p>
        <p className={styles.body}>{vm.creatorAge.body}</p>
      </div>
    </section>
  )
}

function UnderSixteenCard({ vm }: { vm: ReadinessVM }) {
  const u = vm.underSixteen
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{UNDER_16.title}</span>
        <span className={`${styles.pill} ${styles.pillUnknown}`}>{u.pill}</span>
      </div>

      <p className={styles.body}>{u.intro}</p>
      <ul className={styles.reasons}>
        {u.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <p className={styles.aside}>
        {u.twoFactor.text} <ExternalLink href={u.twoFactor.link.href} label={u.twoFactor.link.label} />
      </p>
      {u.premiumNote && <p className={styles.aside}>{u.premiumNote}</p>}
      <p className={styles.aside}>
        {u.feeDetails.text} <ExternalLink href={u.feeDetails.link.href} label={u.feeDetails.link.label} />
      </p>
      <p className={styles.aside}>{u.noWorkaround}</p>
    </section>
  )
}

export default function ReadinessPanel({
  state,
  onRefresh,
  onClose,
}: {
  state: EligibilityState
  onRefresh: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className="sheet-panel" role="dialog" aria-label={PANEL_TITLE}>
        <div className="sheet-head">
          <div className="sheet-title">
            {PANEL_TITLE}
            <span className="sub">{PANEL_SUB}</span>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="sheet-body">
          {state.phase === 'loading' && (
            <div className={styles.loadingRow}>
              <span className="spinner" />
              {LOAD.checking}
            </div>
          )}

          {state.phase === 'error' && (
            <div className={styles.errorBox}>
              {LOAD.errorLead}
              <span className={styles.errorMessage}>{state.message}</span>
            </div>
          )}

          {state.phase === 'ready' && (
            <>
              <SixteenPlusCard vm={state.view} />
              <UnderSixteenCard vm={state.view} />
            </>
          )}

          <div className={styles.footer}>
            <p style={{ margin: 0 }}>{FOOTER.assistive}</p>
            {state.phase === 'ready' && (
              <>
                <div className={styles.groupLabel}>{FOOTER.docsTitle}</div>
                <div className={styles.docsList}>
                  {state.view.docs.map((doc) => (
                    <ExternalLink key={doc.href} href={doc.href} label={doc.label} />
                  ))}
                </div>
              </>
            )}
            <div className={styles.checkedRow}>
              <span>
                {state.phase === 'ready' ? `${FOOTER.checkedPrefix} ${relativeTime(state.view.checkedAt)}` : ''}
              </span>
              <button className="btn" onClick={onRefresh} disabled={state.phase === 'loading'}>
                {state.phase === 'error' ? LOAD.retry : FOOTER.checkAgain}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
