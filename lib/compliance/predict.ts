// Content-maturity label PREDICTOR. Pure and isomorphic — runs in the browser.
//
// This mirrors the label table and per-category consequences of the canonical
// doc (create.roblox.com/docs/production/promotion/content-maturity, fetched
// 2026-07-30). It is a PREDICTION ONLY: Roblox's own Questionnaire Preview
// page is authoritative, computes regional compliance we cannot see, and can
// change without notice. Every consumer must present the output as a forecast,
// never a promise.

import type { Answers, QuestionId } from './questions'
import { unansweredQuestions } from './questions'

export type MaturityLabel = 'Minimal' | 'Mild' | 'Moderate' | 'Restricted'

export const LABEL_ORDER: readonly MaturityLabel[] = ['Minimal', 'Mild', 'Moderate', 'Restricted']

export function labelRank(label: MaturityLabel): number {
  return LABEL_ORDER.indexOf(label)
}

export function maxLabel(a: MaturityLabel, b: MaturityLabel): MaturityLabel {
  return labelRank(a) >= labelRank(b) ? a : b
}

/** One answered fact and the minimum label it forces. */
export interface Contribution {
  /** The question(s) that produced this fact. */
  source: QuestionId
  /** The minimum label this fact forces. */
  atLeast: MaturityLabel
  /** Why, in the doc's terms. */
  rule: string
}

/**
 * Age gates that do NOT raise the maturity label — they restrict who can play
 * independently of it (doc: "Roblox restricts free-form user creation and
 * social hangouts to players over 16"; hangouts with private spaces and the
 * Restricted label itself are 18+).
 */
export interface Gates {
  /** Reasons the experience is limited to players 16+ (label unchanged). */
  sixteenPlus: string[]
  /** Reasons the experience is limited to age-verified players 18+ (label unchanged). */
  eighteenPlus: string[]
  /**
   * True when the predicted label is Restricted: publishing it requires the
   * CREATOR to be age-verified 18+. Surface with PublishTier.idVerified
   * semantics — false means "not confirmed", never "confirmed unverified".
   */
  requiresVerifiedCreator: boolean
}

export interface Prediction {
  /** The predicted label from the answers given so far. */
  label: MaturityLabel
  /** Every answered fact that forces a label floor, highest first. */
  contributions: Contribution[]
  /** The contributions that decided the final label. */
  decidedBy: Contribution[]
  gates: Gates
  /** True when every asked question is answered — only then is `label` final. */
  complete: boolean
  /** Asked-but-unanswered questions; more answers can only raise the label. */
  unanswered: QuestionId[]
}

/**
 * Predict the maturity label + gates from (possibly partial) answers.
 *
 * With partial answers the result is a FLOOR: unanswered questions can only
 * keep the label equal or push it higher, never lower — callers should treat
 * an incomplete prediction as "at least this".
 */
export function predictLabel(answers: Answers): Prediction {
  const contributions: Contribution[] = []
  const add = (source: QuestionId, atLeast: MaturityLabel, rule: string) =>
    contributions.push({ source, atLeast, rule })

  // --- Violence ---------------------------------------------------------
  if (answers['violence.depicted'] === true) {
    const intensity = answers['violence.intensity']
    const frequency = answers['violence.frequency']
    if (intensity === 'Restricted') {
      add('violence.intensity', 'Restricted', 'Strong (Restricted) violence forces the Restricted label.')
    } else if (intensity === 'Moderate') {
      add('violence.intensity', 'Moderate', 'Moderate violence forces at least a Moderate label.')
    } else if (intensity === 'Mild') {
      if (frequency === 'Repeated') {
        add('violence.frequency', 'Mild', 'Repeated mild violence forces at least a Mild label.')
      } else if (frequency === 'Occasional') {
        add('violence.frequency', 'Minimal', 'Occasional mild violence fits the Minimal label.')
      }
    }
  }

  // --- Blood --------------------------------------------------------------
  if (answers['blood.present'] === true) {
    const realism = answers['blood.realism']
    if (realism === 'Realistic') {
      const level = answers['blood.realisticLevel']
      if (level === 'Heavy') {
        add('blood.realisticLevel', 'Restricted', 'Heavy realistic blood forces the Restricted label.')
      } else if (level === 'Light') {
        add('blood.realisticLevel', 'Moderate', 'Light realistic blood forces at least a Moderate label.')
      }
    } else if (realism === 'Unrealistic') {
      const infrequent = answers['blood.unrealisticInfrequent']
      if (infrequent === false) {
        add('blood.unrealisticInfrequent', 'Mild', 'Heavy (frequent) unrealistic blood forces at least a Mild label.')
      } else if (infrequent === true) {
        add('blood.unrealisticInfrequent', 'Minimal', 'Light, fleeting unrealistic blood fits the Minimal label.')
      }
    }
  }

  // --- Fear ---------------------------------------------------------------
  if (answers['fear.present'] === true) {
    const intensity = answers['fear.intensity']
    if (intensity === 'Moderate') {
      add('fear.intensity', 'Moderate', 'Moderate fear-based content forces at least a Moderate label.')
    } else if (intensity === 'Mild') {
      add('fear.intensity', 'Mild', 'Mild fear-based content forces at least a Mild label.')
    }
  }

  // --- Crude humor ----------------------------------------------------------
  if (answers['crude.present'] === true) {
    const level = answers['crude.level']
    if (level === 'Moderate') {
      add('crude.level', 'Moderate', 'Moderate crude humor forces at least a Moderate label.')
    } else if (level === 'Mild') {
      add('crude.level', 'Mild', 'Mild crude humor forces at least a Mild label.')
    }
  }

  // --- Single-question forcers ---------------------------------------------
  if (answers['gambling.present'] === true) {
    add('gambling.present', 'Moderate', 'Unplayable gambling content forces at least a Moderate label.')
  }
  if (answers['language.present'] === true) {
    add('language.present', 'Restricted', 'Strong language forces the Restricted label.')
  }
  if (answers['romantic.present'] === true) {
    add('romantic.present', 'Restricted', 'Romantic themes or private/adult settings force the Restricted label.')
  }
  if (answers['alcohol.present'] === true) {
    add('alcohol.present', 'Restricted', 'Depicting or referencing alcohol forces the Restricted label.')
  }

  // --- Label = max of all floors, floored at Minimal -------------------------
  let label: MaturityLabel = 'Minimal'
  for (const c of contributions) label = maxLabel(label, c.atLeast)

  // --- Independent gates (do NOT raise the label) -----------------------------
  const sixteenPlus: string[] = []
  const eighteenPlus: string[] = []
  if (answers['freeform.present'] === true) {
    sixteenPlus.push('Free-form user creation is only available to players that are at least 16 years old.')
  }
  if (answers['hangout.primary'] === true) {
    if (answers['hangout.privateSpaces'] === true) {
      eighteenPlus.push(
        'Social hangouts with private spaces are only available to age-verified players that are at least 18 years old.',
      )
    } else if (answers['hangout.privateSpaces'] === false) {
      sixteenPlus.push('Social hangouts without private spaces are only available to players that are at least 16 years old.')
    }
  }
  if (answers['sensitive.primary'] === true) {
    sixteenPlus.push(
      'Experiences with a primary theme of a sensitive issue are only available to players who are at least 16 years old, and are not recommended or discoverable unless players have age-verified themselves.',
    )
  }

  const unanswered = unansweredQuestions(answers)
  contributions.sort((a, b) => labelRank(b.atLeast) - labelRank(a.atLeast))

  return {
    label,
    contributions,
    decidedBy: contributions.filter((c) => c.atLeast === label && labelRank(label) > 0),
    gates: {
      sixteenPlus,
      eighteenPlus,
      requiresVerifiedCreator: label === 'Restricted',
    },
    complete: unanswered.length === 0,
    unanswered,
  }
}

/** The doc's own one-line description of each label, for the result screen. */
export const LABEL_DESCRIPTIONS: Record<MaturityLabel, string> = {
  Minimal: 'May contain occasional mild violence and/or light unrealistic blood.',
  Mild: 'May contain repeated mild violence, heavy unrealistic blood, mild fear-based content, and/or mild crude humor.',
  Moderate:
    'May contain moderate violence, light realistic blood, moderate fear-based content, moderate crude humor, and/or unplayable gambling content.',
  Restricted:
    'May contain strong violence, heavy realistic blood, moderate crude humor, romantic themes, unplayable gambling content, the presence of alcohol, and/or strong language.',
}

/** Which Roblox audiences can access each label (doc, "Content maturity labels…"). */
export const LABEL_AUDIENCES: Record<MaturityLabel, string> = {
  Minimal: 'Eligible for Roblox Kids (ages 5–8) and Roblox Select (ages 9–15).',
  Mild: 'Eligible for Roblox Kids (ages 5–8) and Roblox Select (ages 9–15).',
  Moderate: 'Eligible for Roblox Select (ages 9–15) and standard Roblox (16+).',
  Restricted: 'Only accessible to age-verified Roblox users 18 and older.',
}
