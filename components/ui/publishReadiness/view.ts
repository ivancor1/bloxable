// Pure tier → view-model mapping for the publish-readiness surface. All state
// decisions live here (testable without a DOM); all words live in copy.ts;
// the .tsx files just lay the result out. `import type` keeps the server-only
// eligibility module out of the client bundle — only its shape crosses over.

import type { PublishTier, SixteenPlusAudience } from '@/lib/roblox/eligibility'
import { FACTS, FOOTER, SIXTEEN_PLUS, UNDER_16, creatorAgeNote } from './copy'

/**
 * Visual tone. 'unknown' and 'self' (only you can check this) are first-class
 * neutral states — the CSS renders them gray, never red: an unchecked fact is
 * not a failure.
 */
export type Tone = 'ok' | 'todo' | 'unknown' | 'self'

export interface LinkOut {
  href: string
  label: string
}

export interface FactVM {
  key: 'account' | 'accountAge' | 'ageCheck' | 'questionnaire'
  label: string
  text: string
  tone: Tone
  detail?: string
  link?: LinkOut
}

export interface PillVM {
  label: string
  tone: 'ok' | 'todo' | 'unknown'
}

export interface ReadinessVM {
  pill: PillVM
  statusLine: string
  facts: FactVM[]
  /** Concrete remaining steps, verbatim from the tier derivation. */
  nextSteps: string[]
  creatorAge: { title: string; body: string }
  underSixteen: {
    pill: string
    intro: string
    /** Verbatim from the tier object — one source of truth, no paraphrase. */
    reasons: string[]
    twoFactor: { text: string; link: LinkOut }
    /** Only when Roblox affirmatively reports Premium; false is inconclusive. */
    premiumNote: string | null
    feeDetails: { text: string; link: LinkOut }
    noWorkaround: string
  }
  docs: LinkOut[]
  checkedAt: string
}

const PILL_TONE: Record<SixteenPlusAudience['status'], PillVM['tone']> = {
  eligible: 'ok',
  'likely-eligible': 'ok',
  'needs-steps': 'todo',
  unknown: 'unknown',
}

function accountFact(tier: PublishTier): FactVM {
  if (!tier.account) {
    return { key: 'account', label: FACTS.account.label, text: FACTS.account.notConnected, tone: 'unknown' }
  }
  return {
    key: 'account',
    label: FACTS.account.label,
    text: tier.account.source === 'oauth' ? FACTS.account.oauth : FACTS.account.studio,
    tone: 'ok',
    detail: `${FACTS.account.idPrefix} ${tier.account.userId}`,
  }
}

function accountAgeFact(tier: PublishTier): FactVM {
  const days = tier.accountAgeDays
  if (days === 'unknown') {
    return { key: 'accountAge', label: FACTS.accountAge.label, text: FACTS.accountAge.unknown, tone: 'unknown' }
  }
  return days >= 2
    ? { key: 'accountAge', label: FACTS.accountAge.label, text: FACTS.accountAge.oldEnough(days), tone: 'ok' }
    : { key: 'accountAge', label: FACTS.accountAge.label, text: FACTS.accountAge.tooNew(days), tone: 'todo' }
}

/**
 * idVerified semantics (lib/roblox/eligibility.ts): true is confirmed; false
 * is "Roblox did not confirm" — a known API bug under-reports it, so it never
 * renders as a confirmed absence; 'unknown' means the source itself was
 * missing, split by WHY (consent not asked yet vs. lookup failed).
 */
function ageCheckFact(tier: PublishTier): FactVM {
  const base = { key: 'ageCheck' as const, label: FACTS.ageCheck.label }
  if (tier.idVerified === true) return { ...base, text: FACTS.ageCheck.confirmed, tone: 'ok' }
  if (tier.idVerified === false) return { ...base, text: FACTS.ageCheck.notConfirmed, tone: 'todo' }
  return tier.needsConsent
    ? { ...base, text: FACTS.ageCheck.unknownNeedsConsent, tone: 'unknown' }
    : { ...base, text: FACTS.ageCheck.unknownError, tone: 'unknown' }
}

function questionnaireFact(tier: PublishTier): FactVM {
  return {
    key: 'questionnaire',
    label: FACTS.questionnaire.label,
    text: FACTS.questionnaire.text,
    tone: 'self',
    link: { href: tier.docs.publishing, label: FACTS.questionnaire.linkLabel },
  }
}

export function buildReadinessView(tier: PublishTier): ReadinessVM {
  const status = tier.audiences.sixteenPlus.status
  return {
    pill: { label: SIXTEEN_PLUS.pill[status], tone: PILL_TONE[status] },
    statusLine: SIXTEEN_PLUS.statusLine[status],
    facts: [accountFact(tier), accountAgeFact(tier), ageCheckFact(tier), questionnaireFact(tier)],
    nextSteps: tier.audiences.sixteenPlus.missing,
    creatorAge: creatorAgeNote(tier.creatorAgeFloorDocumented),
    underSixteen: {
      pill: UNDER_16.pill,
      intro: UNDER_16.intro,
      reasons: tier.audiences.underSixteen.reasons,
      twoFactor: {
        text: UNDER_16.twoFactorText,
        link: { href: tier.twoFactor.settingsUrl, label: UNDER_16.twoFactorLinkLabel },
      },
      premiumNote: tier.premium === true ? UNDER_16.premiumNote : null,
      feeDetails: {
        text: UNDER_16.feeDetailsText,
        link: { href: tier.docs.kidsAndSelect, label: UNDER_16.feeDetailsLinkLabel },
      },
      noWorkaround: UNDER_16.noWorkaround,
    },
    docs: [
      { href: tier.docs.publishing, label: FOOTER.docLabels.publishing },
      { href: tier.docs.accountVerification, label: FOOTER.docLabels.accountVerification },
      { href: tier.docs.kidsAndSelect, label: FOOTER.docLabels.kidsAndSelect },
    ],
    checkedAt: tier.checkedAt,
  }
}
