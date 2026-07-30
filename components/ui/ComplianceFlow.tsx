'use client'

// Guided Maturity & Compliance flow. Self-contained: renders its own launcher
// pill (under the topbar) plus the right slide-over questionnaire, so the
// editor page mounts exactly one element.
//
// Honesty rules baked into the copy, in order of importance:
//   - Roblox's standing instruction (answer for the MOST extreme content) is
//     shown before any question, verbatim.
//   - The predicted label is ALWAYS framed as a prediction; Roblox's own
//     Questionnaire Preview screen is named as the authority.
//   - Bloxable never submits anything to Roblox — the user mirrors these
//     answers into the real questionnaire on the Creator Dashboard.
//   - Pre-filled answers show WHY (tree evidence); ambiguous questions are
//     left for the human, never guessed low.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/lib/state/store'
import {
  CATEGORIES,
  CREATOR_DASHBOARD_URL,
  cleanAnswers,
  isAsked,
  isComplete,
  unansweredQuestions,
  type Answers,
  type AnswerValue,
  type Question,
  type QuestionId,
} from '@/lib/compliance/questions'
import { LABEL_AUDIENCES, LABEL_DESCRIPTIONS, predictLabel } from '@/lib/compliance/predict'
import { prefillFromTree, type PrefillReason, type PrefillResult } from '@/lib/compliance/prefill'
import { treeHash } from '@/lib/compliance/hash'
import type { ComplianceRecord } from '@/lib/compliance/store'
import type { PublishTier } from '@/lib/roblox/eligibility'
import { IconClose } from './icons'
import css from './compliance.module.css'

type Step = { kind: 'intro' } | { kind: 'category'; index: number } | { kind: 'result' }

type Sources = Partial<Record<QuestionId, 'prefill' | 'user'>>

interface ComplianceGetResponse {
  record: ComplianceRecord | null
  currentTreeHash: string
  stale: boolean
}

function answerText(value: AnswerValue | undefined): string {
  if (value === undefined) return '—'
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return value
}

export default function ComplianceFlow() {
  const projectId = useAppStore((s) => s.projectId)
  const tree = useAppStore((s) => s.tree)
  const treeVersion = useAppStore((s) => s.treeVersion)
  const projects = useAppStore((s) => s.projects)
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''

  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState<ComplianceRecord | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'intro' })
  const [answers, setAnswers] = useState<Answers>({})
  const [sources, setSources] = useState<Sources>({})
  const [prefill, setPrefill] = useState<PrefillResult | null>(null)
  const [baseHash, setBaseHash] = useState('')
  const [dirty, setDirty] = useState(false)
  const [tier, setTier] = useState<PublishTier | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // Reset when the project changes (state adjustment during render — the
  // React-recommended alternative to a setState-in-effect cascade).
  if (projectId !== loadedFor) {
    setLoadedFor(projectId)
    setRecord(null)
    setOpen(false)
  }

  // Load the saved record whenever the project changes.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/compliance`)
        if (!res.ok || cancelled) return
        const data = (await res.json()) as ComplianceGetResponse
        if (!cancelled) setRecord(data.record)
      } catch {
        // No record view is the safe default — the flow still works from scratch.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Live staleness: the record was answered against a tree that no longer matches.
  const currentHash = useMemo(
    () => (tree ? treeHash(tree) : ''),
    // treeVersion is the store's monotonic change counter for the tree object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, treeVersion],
  )
  const stale = record !== null && currentHash !== '' && record.treeHash !== currentHash

  const reasonFor = useCallback(
    (id: QuestionId): PrefillReason | undefined => prefill?.reasons[id] ?? record?.prefillReasons?.[id],
    [prefill, record],
  )

  const persist = useCallback(
    async (nextAnswers: Answers, nextSources: Sources, completedAt: string | null, hash: string) => {
      if (!projectId) return
      const prefillReasons = { ...(record?.prefillReasons ?? {}), ...(prefill?.reasons ?? {}) }
      try {
        const res = await fetch(`/api/projects/${projectId}/compliance`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: nextAnswers, sources: nextSources, prefillReasons, treeHash: hash, completedAt }),
        })
        if (res.ok) {
          const data = (await res.json()) as ComplianceGetResponse
          setRecord(data.record)
          setDirty(false)
        }
      } catch {
        // Local-first app: a failed save surfaces on next load as a missing draft.
      }
    },
    [projectId, record, prefill],
  )

  const start = useCallback(
    (keepExistingAnswers: boolean) => {
      if (!tree) return
      const pf = prefillFromTree(tree, projectName)
      setPrefill(pf)
      setBaseHash(treeHash(tree))
      if (keepExistingAnswers && record) {
        setAnswers(cleanAnswers(record.answers))
        setSources({ ...record.sources })
      } else {
        const a = cleanAnswers(pf.answers)
        const src: Sources = {}
        for (const key of Object.keys(a) as QuestionId[]) src[key] = 'prefill'
        setAnswers(a)
        setSources(src)
      }
      setDirty(true)
      setStep({ kind: 'category', index: 0 })
    },
    [tree, projectName, record],
  )

  const openFlow = useCallback(() => {
    setOpen(true)
    setTier(null)
    if (record?.completedAt && !stale) {
      // Completed and current: show the result directly.
      setAnswers(cleanAnswers(record.answers))
      setSources({ ...record.sources })
      setBaseHash(record.treeHash)
      setPrefill(null)
      setStep({ kind: 'result' })
    } else {
      setStep({ kind: 'intro' })
    }
  }, [record, stale])

  const close = useCallback(() => {
    // Leaving mid-questionnaire keeps the draft (answers, sources, evidence).
    if (dirty && step.kind === 'category') {
      void persist(answers, sources, null, baseHash)
    }
    setOpen(false)
  }, [dirty, step, persist, answers, sources, baseHash])

  const setAnswer = useCallback(
    (id: QuestionId, value: AnswerValue) => {
      const merged = cleanAnswers({ ...answers, [id]: value })
      const nextSources: Sources = { ...sources, [id]: 'user' }
      for (const key of Object.keys(nextSources) as QuestionId[]) {
        if (merged[key] === undefined) delete nextSources[key]
      }
      // A new answer can reveal follow-up questions; apply their pre-fills
      // (never overwrites anything the user set — only fills blanks).
      if (prefill) {
        let changed = true
        while (changed) {
          changed = false
          for (const [key, v] of Object.entries(prefill.answers) as [QuestionId, AnswerValue][]) {
            if (merged[key] === undefined && isAsked(key, merged)) {
              merged[key] = v
              nextSources[key] = 'prefill'
              changed = true
            }
          }
        }
      }
      setAnswers(merged)
      setSources(nextSources)
      setDirty(true)
    },
    [answers, sources, prefill],
  )

  const prediction = useMemo(() => predictLabel(answers), [answers])

  // The Restricted label needs an age-verified 18+ creator — check honestly.
  useEffect(() => {
    if (step.kind !== 'result' || !prediction.gates.requiresVerifiedCreator || tier) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/roblox/eligibility')
        if (res.ok && !cancelled) setTier((await res.json()) as PublishTier)
      } catch {
        // tier stays null → "could not be checked" copy
      }
    })()
    return () => {
      cancelled = true
    }
  }, [step, prediction.gates.requiresVerifiedCreator, tier])

  if (!projectId || !tree) return null

  const launcherLabel = record?.completedAt
    ? `Maturity · ${stale ? 'retake' : predictLabel(record.answers).label}`
    : 'Maturity guide'

  const totalSteps = CATEGORIES.length + 1
  const progress =
    step.kind === 'intro' ? 0 : step.kind === 'category' ? (step.index + 1) / totalSteps : 1

  return (
    <>
      <button className={`btn ${css.launcher}`} onClick={openFlow} title="Maturity & Compliance guide">
        {record?.completedAt && (
          <span className={`${css.statusDot} ${stale ? css.dotStale : css.dotOk}`} />
        )}
        {launcherLabel}
      </button>

      {open && (
        <>
          <div className="sheet-overlay" onClick={close} />
          <div className={`sheet-panel ${css.panel}`}>
            <div className="sheet-head">
              <div className="sheet-title">
                Maturity &amp; Compliance
                <span className="sub">
                  {step.kind === 'category'
                    ? `${CATEGORIES[step.index].title} — ${step.index + 1} of ${CATEGORIES.length}`
                    : step.kind === 'result'
                      ? 'Your answer sheet'
                      : 'Guided questionnaire'}
                </span>
              </div>
              <button className="icon-btn" onClick={close} aria-label="Close">
                <IconClose />
              </button>
            </div>
            <div className={css.progressTrack}>
              <div className={css.progressFill} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>

            {step.kind === 'intro' && (
              <IntroStep
                hasRecord={record !== null}
                completed={!!record?.completedAt}
                stale={stale}
                onStartFresh={() => start(false)}
                onKeepAnswers={() => start(true)}
              />
            )}

            {step.kind === 'category' && (
              <CategoryStep
                index={step.index}
                answers={answers}
                sources={sources}
                reasonFor={reasonFor}
                askReasonFor={(id) => prefill?.ambiguous[id]}
                onSelect={setAnswer}
                onBack={() => setStep(step.index === 0 ? { kind: 'intro' } : { kind: 'category', index: step.index - 1 })}
                onNext={() => {
                  if (step.index + 1 < CATEGORIES.length) {
                    void persist(answers, sources, null, baseHash)
                    setStep({ kind: 'category', index: step.index + 1 })
                  } else {
                    const completedAt = isComplete(answers) ? new Date().toISOString() : null
                    void persist(answers, sources, completedAt, baseHash)
                    setStep({ kind: 'result' })
                  }
                }}
              />
            )}

            {step.kind === 'result' && (
              <ResultStep
                answers={answers}
                stale={stale}
                tier={tier}
                onEdit={() => {
                  if (!prefill && tree) setPrefill(prefillFromTree(tree, projectName))
                  setStep({ kind: 'category', index: 0 })
                }}
                onRetake={() => start(false)}
              />
            )}
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------

function IntroStep(props: {
  hasRecord: boolean
  completed: boolean
  stale: boolean
  onStartFresh: () => void
  onKeepAnswers: () => void
}) {
  return (
    <>
      <div className="sheet-body">
        {props.stale && props.hasRecord && (
          <div className={css.banner}>
            <strong>Your game changed since you last answered.</strong>
            Roblox requires the questionnaire to match the game — retake it so your answers stay
            accurate.
          </div>
        )}
        <p className={css.qPlain} style={{ fontSize: 12.5 }}>
          Roblox asks every creator the same questions about what is in their game, then gives it a
          maturity label so the right ages can play it. Bloxable built this game with you, so it
          pre-fills every answer it can prove from what is actually in the game — and shows you why.
          You change anything with one tap.
        </p>
        <div className={css.quote}>
          &ldquo;As you are completing the questionnaire, base your answers on the most mature or
          extreme content players can encounter within your experience.&rdquo;
          <br />— Roblox, Content maturity and compliance
        </div>
        <p className={css.qPlain} style={{ fontSize: 12.5 }}>
          Answer honestly. A lower label is not a win: Roblox compares games against their answers,
          and wrong answers can get an experience — or an account — moderated.
        </p>
        <div className={css.notice}>
          Bloxable never sends anything to Roblox. At the end you get your answer sheet to copy into
          the real questionnaire on the Creator Dashboard.
        </div>
      </div>
      <div className={css.nav}>
        {props.hasRecord ? (
          <button className="btn" onClick={props.onKeepAnswers}>
            {props.stale ? 'Review my old answers' : props.completed ? 'Edit my answers' : 'Resume'}
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-accent" onClick={props.onStartFresh}>
          {props.hasRecord ? 'Retake with fresh pre-fill' : 'Start'}
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// One category page
// ---------------------------------------------------------------------------

function CategoryStep(props: {
  index: number
  answers: Answers
  sources: Sources
  reasonFor: (id: QuestionId) => PrefillReason | undefined
  askReasonFor: (id: QuestionId) => PrefillReason | undefined
  onSelect: (id: QuestionId, value: AnswerValue) => void
  onBack: () => void
  onNext: () => void
}) {
  const category = CATEGORIES[props.index]
  const asked = category.questions.filter((q) => isAsked(q.id, props.answers))
  const unansweredHere = asked.filter((q) => props.answers[q.id] === undefined)
  const last = props.index === CATEGORIES.length - 1

  return (
    <>
      <div className="sheet-body">
        <div className={css.stepLabel}>
          {category.title} · {props.index + 1} / {CATEGORIES.length}
        </div>
        {asked.map((q) => (
          <QuestionBlock
            key={q.id}
            question={q}
            value={props.answers[q.id]}
            source={props.sources[q.id]}
            reason={props.reasonFor(q.id)}
            askReason={props.askReasonFor(q.id)}
            onSelect={(v) => props.onSelect(q.id, v)}
          />
        ))}
      </div>
      <div className={css.nav}>
        <button className="btn" onClick={props.onBack}>
          Back
        </button>
        <button
          className="btn btn-accent"
          disabled={unansweredHere.length > 0}
          title={unansweredHere.length > 0 ? 'Answer every question to continue' : undefined}
          onClick={props.onNext}
        >
          {last ? 'See my result' : 'Next'}
        </button>
      </div>
    </>
  )
}

function QuestionBlock(props: {
  question: Question
  value: AnswerValue | undefined
  source: 'prefill' | 'user' | undefined
  reason: PrefillReason | undefined
  askReason: PrefillReason | undefined
  onSelect: (value: AnswerValue) => void
}) {
  const { question: q, value } = props
  const detailed = q.options.some((o) => o.hint)

  return (
    <div className={css.question}>
      <p className={css.qText}>{q.text}</p>
      {q.plain && <p className={css.qPlain}>{q.plain}</p>}
      {q.help && (
        <details className={css.qHelp}>
          <summary>What Roblox means by this</summary>
          <p>{q.help}</p>
        </details>
      )}
      <div className={detailed ? css.optCol : css.optRow}>
        {q.options.map((o) => {
          const selected = value === o.value
          return (
            <button
              key={String(o.value)}
              className={`${css.opt} ${selected ? css.optSelected : ''}`}
              onClick={() => props.onSelect(o.value)}
            >
              {o.label}
              {o.hint && <span className={css.optHint}>{o.hint}</span>}
              {o.note && <span className={css.optNote}>{o.note}</span>}
            </button>
          )
        })}
      </div>

      {value !== undefined && props.source === 'prefill' && props.reason && (
        <div className={css.why}>
          <span className={css.whyTag}>Pre-filled</span>
          {props.reason.detail}
          {props.reason.evidence.length > 0 && (
            <ul className={css.evidence}>
              {props.reason.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {value === undefined && props.askReason && (
        <div className={`${css.why} ${css.whyAsk}`}>
          <span className={css.whyTag}>Needs your answer</span>
          {props.askReason.detail}
          {props.askReason.evidence.length > 0 && (
            <ul className={css.evidence}>
              {props.askReason.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

function ResultStep(props: {
  answers: Answers
  stale: boolean
  tier: PublishTier | null
  onEdit: () => void
  onRetake: () => void
}) {
  const prediction = predictLabel(props.answers)
  const { label, gates } = prediction
  const unanswered = unansweredQuestions(props.answers)

  return (
    <>
      <div className="sheet-body">
        {props.stale && (
          <div className={css.banner}>
            <strong>Your game changed after you answered.</strong>
            The answers below may no longer match the game — retake the questionnaire to keep them
            accurate.
          </div>
        )}

        <div className={css.labelCard}>
          <div className={css.labelKicker}>Predicted label — not a promise</div>
          <div className={`${css.labelName} ${label === 'Restricted' ? css.labelNameRestricted : ''}`}>
            {label}
            {!prediction.complete ? ' (at least)' : ''}
          </div>
          <p className={css.labelDesc}>{LABEL_DESCRIPTIONS[label]}</p>
          <p className={css.labelDesc} style={{ marginTop: 6 }}>
            {LABEL_AUDIENCES[label]}
          </p>
        </div>

        {unanswered.length > 0 && (
          <div className={css.banner}>
            <strong>
              {unanswered.length} question{unanswered.length === 1 ? '' : 's'} still unanswered.
            </strong>
            The prediction can only go up once you answer them. Use Edit answers below.
          </div>
        )}

        {prediction.decidedBy.length > 0 && (
          <>
            <div className={css.sectionHead}>Why this label</div>
            <ul className={css.reasonList}>
              {prediction.decidedBy.map((c) => (
                <li key={`${c.source}-${c.rule}`}>{c.rule}</li>
              ))}
            </ul>
          </>
        )}

        {(gates.sixteenPlus.length > 0 || gates.eighteenPlus.length > 0) && (
          <>
            <div className={css.sectionHead}>Age gates (separate from the label)</div>
            <ul className={css.reasonList}>
              {gates.eighteenPlus.map((g) => (
                <li key={g}>{g}</li>
              ))}
              {gates.sixteenPlus.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </>
        )}

        {gates.requiresVerifiedCreator && (
          <>
            <div className={css.sectionHead}>Restricted label — creator requirement</div>
            <div className={css.verify}>
              A Restricted experience can only get its label if the creator is age-verified as 18 or
              older on Roblox.{' '}
              {props.tier === null
                ? 'Bloxable could not check your verification right now — confirm it on Roblox.'
                : props.tier.idVerified === true
                  ? 'Roblox confirmed this account is ID-verified.'
                  : props.tier.idVerified === false
                    ? 'Roblox did not confirm an ID check on your account. If you already verified, know that its API is known to under-report — check your account on Roblox.'
                    : props.tier.needsConsent
                      ? 'Bloxable can check this once you connect your Roblox account with the extra permission (Settings).'
                      : 'Verification could not be confirmed right now — check your account on Roblox.'}
            </div>
          </>
        )}

        <div className={css.sectionHead}>Your answers — mirror these on Roblox</div>
        <div className={css.mirror}>
          {CATEGORIES.map((cat) => {
            const asked = cat.questions.filter((q) => isAsked(q.id, props.answers))
            if (asked.length === 0) return null
            return (
              <div key={cat.id}>
                <div className={`${css.mirrorRow} ${css.mirrorCat}`}>{cat.title}</div>
                {asked.map((q) => (
                  <div key={q.id} className={css.mirrorRow}>
                    <span className={css.mirrorQ}>{q.text}</span>
                    <span className={css.mirrorA}>{answerText(props.answers[q.id])}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div className={css.notice} style={{ marginTop: 16 }}>
          Bloxable has not sent anything to Roblox — this guide only prepares you. Take the official
          questionnaire yourself: Creator Dashboard → your experience → Audience → Maturity &amp;
          Compliance, and give these same answers. Roblox&apos;s Questionnaire Preview screen there
          shows the real label and is the final authority.
        </div>

        <p className={css.fine}>
          If you change the game later, Bloxable will flag this questionnaire as out of date so you
          can retake it — Roblox requires resubmitting when an update changes any answer.
        </p>
      </div>
      <div className={css.nav}>
        <button className="btn" onClick={props.onEdit}>
          Edit answers
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={props.onRetake}>
            Retake
          </button>
          <a className={`btn btn-accent ${css.linkBtn}`} href={CREATOR_DASHBOARD_URL} target="_blank" rel="noreferrer">
            Open Creator Dashboard
          </a>
        </div>
      </div>
    </>
  )
}
