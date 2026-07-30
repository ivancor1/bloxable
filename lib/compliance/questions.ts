// The Maturity & Compliance questionnaire model. Pure and isomorphic — no node
// imports; the client flow, the predictor, the pre-filler and the tests all
// share this single source of truth.
//
// QUESTION WORDING IS VERBATIM from the canonical Roblox doc, fetched as raw
// markdown on 2026-07-30:
//   https://create.roblox.com/docs/production/promotion/content-maturity.md
// (The older production/promotion/experience-guidelines page is stale and is
// deliberately ignored.) Do not "improve" the `text` strings — the whole point
// is that the user sees exactly what Roblox will ask them, so they can mirror
// their answers 1:1 into the real questionnaire on the Creator Dashboard.
// `help` and option `hint` strings carry Roblox's own definitions/examples from
// the same doc; `plain` is Bloxable's kid-readable explainer.

export type CategoryId =
  | 'violence'
  | 'blood'
  | 'fear'
  | 'crude'
  | 'gambling'
  | 'language'
  | 'romantic'
  | 'alcohol'
  | 'hangout'
  | 'freeform'
  | 'sensitive'
  | 'randomItems'
  | 'trading'
  | 'media'
  | 'ai'

export type QuestionId =
  | 'violence.depicted'
  | 'violence.intensity'
  | 'violence.frequency'
  | 'blood.present'
  | 'blood.realism'
  | 'blood.unrealisticInfrequent'
  | 'blood.realisticLevel'
  | 'fear.present'
  | 'fear.intensity'
  | 'fear.frequency'
  | 'crude.present'
  | 'crude.level'
  | 'gambling.present'
  | 'language.present'
  | 'romantic.present'
  | 'alcohol.present'
  | 'hangout.primary'
  | 'hangout.privateSpaces'
  | 'freeform.present'
  | 'sensitive.primary'
  | 'randomItems.present'
  | 'randomItems.respectsPolicy'
  | 'trading.present'
  | 'trading.respectsPolicy'
  | 'media.share'
  | 'media.feeds'
  | 'media.crossExperience'
  | 'ai.present'
  | 'ai.type'

/** Every non-boolean answer is one of Roblox's own option words. */
export type ChoiceValue =
  | 'Mild'
  | 'Moderate'
  | 'Restricted'
  | 'Occasional'
  | 'Repeated'
  | 'Unrealistic'
  | 'Realistic'
  | 'Light'
  | 'Heavy'
  | 'Extended'
  | 'Limited'

export type AnswerValue = boolean | ChoiceValue

/** A partially- or fully-answered questionnaire. Missing key = unanswered. */
export type Answers = Partial<Record<QuestionId, AnswerValue>>

export interface QuestionOption {
  value: AnswerValue
  /** The option label as Roblox shows it. */
  label: string
  /** Roblox's own description of this option, verbatim from the doc. */
  hint?: string
  /** An extra consequence Roblox states for picking this option. */
  note?: string
}

export interface Question {
  id: QuestionId
  category: CategoryId
  /** VERBATIM question wording from the canonical doc. Never edit. */
  text: string
  options: QuestionOption[]
  /** Only asked when this predicate over the current answers holds. */
  askedWhen?: (a: Answers) => boolean
  /** Roblox's definition/guidance for this question, from the same doc. */
  help?: string
  /** Bloxable's plain-language explainer (a 12-year-old should get it). */
  plain?: string
}

export interface Category {
  id: CategoryId
  /** The doc's section heading. */
  title: string
  questions: Question[]
}

const YES_NO: QuestionOption[] = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
]

export const CATEGORIES: Category[] = [
  {
    id: 'violence',
    title: 'Violence',
    questions: [
      {
        id: 'violence.depicted',
        category: 'violence',
        text: 'Does this experience depict violence and/or violent content?',
        options: YES_NO,
        help: 'Violence is the intentional use of physical or psychological force against players or non-playable characters (NPCs).',
        plain: 'Any fighting, weapons, or characters getting hurt counts — even cartoony fighting where bodies just disappear.',
      },
      {
        id: 'violence.intensity',
        category: 'violence',
        text: 'How intense is the violence?',
        askedWhen: (a) => a['violence.depicted'] === true,
        options: [
          {
            value: 'Mild',
            label: 'Mild',
            hint: 'Implied or unrealistic depictions of violence, such as bodies disappearing the moment their health reaches zero.',
          },
          {
            value: 'Moderate',
            label: 'Moderate',
            hint: "Non-graphic, realistic-looking depictions of violence and/or death that don't violate Roblox Community Standards, such as realistic depictions of real-life injuries.",
          },
          {
            value: 'Restricted',
            label: 'Restricted',
            hint: 'Graphic and realistic-looking depictions of violence and/or death that do not violate the Restricted Content Policy, such as non-real world beheadings/decapitation, impalement, hangings, dismemberment, mutilation, severed/severing body parts, presence of organs, maiming, disfiguration, and electrocution.',
            note: 'Experiences with strong violence are only available to age-verified players that are at least 18 years old.',
          },
        ],
        help: 'If there is any moment that the consequence of violence is realistic, your experience meets either the moderate or strong criteria, even if the realistic violence only occurs once.',
        plain: 'Pick the level of the WORST moment a player could see, not the average.',
      },
      {
        id: 'violence.frequency',
        category: 'violence',
        text: 'How frequent is the violence?',
        askedWhen: (a) => a['violence.depicted'] === true,
        options: [
          {
            value: 'Occasional',
            label: 'Occasional',
            hint: 'Violence occurs either rarely or occasionally, such as at a couple key moments of the experience.',
          },
          {
            value: 'Repeated',
            label: 'Repeated',
            hint: 'Violence either occurs often, or it occurs rarely, but when it does occur, many violent events happen in quick succession.',
          },
        ],
        help: 'Note that even a small part of your experience contains repeated violence, it meets the Repeated criteria.',
      },
    ],
  },
  {
    id: 'blood',
    title: 'Blood',
    questions: [
      {
        id: 'blood.present',
        category: 'blood',
        text: 'Does this experience depict any blood?',
        options: YES_NO,
        help: "Blood is the red liquid that flows through human and animal bodies that's essential to life.",
        plain: 'Any blood at all — even yellow cartoon blood — counts as Yes.',
      },
      {
        id: 'blood.realism',
        category: 'blood',
        text: 'How realistic is the blood?',
        askedWhen: (a) => a['blood.present'] === true,
        options: [
          {
            value: 'Unrealistic',
            label: 'Unrealistic',
            hint: 'Blood appears unrealistic, such as being pixelated or having a different color or shape.',
          },
          {
            value: 'Realistic',
            label: 'Realistic',
            hint: 'Blood appears realistic, such as having the same color, shape, and splatter properties as blood in the real world.',
          },
        ],
      },
      {
        id: 'blood.unrealisticInfrequent',
        category: 'blood',
        text: 'Are the depictions of blood infrequent and/or fleeting?',
        askedWhen: (a) => a['blood.present'] === true && a['blood.realism'] === 'Unrealistic',
        options: [
          {
            value: true,
            label: 'Yes',
            hint: 'Unrealistic blood only occurs sometimes, such as yellow blood splattering for a few seconds.',
          },
          {
            value: false,
            label: 'No',
            hint: 'Unrealistic blood only occurs often, such as repeated bloodshed or with lasting imagery.',
          },
        ],
      },
      {
        id: 'blood.realisticLevel',
        category: 'blood',
        text: 'What level of blood and/or gore is depicted?',
        askedWhen: (a) => a['blood.present'] === true && a['blood.realism'] === 'Realistic',
        options: [
          {
            value: 'Light',
            label: 'Light',
            hint: 'The bloodshed is minimal, such as blood spatter from a distance.',
          },
          {
            value: 'Heavy',
            label: 'Heavy',
            hint: 'The bloodshed is significant, such as pools of blood, gushing blood, and up-close blood spatter.',
            note: 'Experiences with heavy, realistic blood are only available to age-verified players that are at least 18 years old.',
          },
        ],
        help: 'If you depict realistic blood anywhere within your experience, such as blood splatter from a distance, your experience automatically meets the Light criteria.',
      },
    ],
  },
  {
    id: 'fear',
    title: 'Fear',
    questions: [
      {
        id: 'fear.present',
        category: 'fear',
        text: 'Does this experience include scary elements that may trigger fear?',
        options: YES_NO,
        help: 'Fear-based content contains scary or horrifying elements that trigger fear in players.',
        plain: 'Jump scares, creepy monsters, spooky music, dark suspense — any of it counts.',
      },
      {
        id: 'fear.intensity',
        category: 'fear',
        text: 'What level of scary elements are there?',
        askedWhen: (a) => a['fear.present'] === true,
        options: [
          {
            value: 'Mild',
            label: 'Mild',
            hint: 'Loud/heavy breathing, pounding heart, shrieking or screaming, creepy-looking NPCs, jump scares, ominous music, and/or gameplay that builds suspense.',
          },
          {
            value: 'Moderate',
            label: 'Moderate',
            hint: 'Characters with disfigured mouths with realistic blood, lack of flesh with realistic-looking connective tissues, organs, and/or blood vessels visible, realistic open wounds and/or leaking/bleeding eyes with realistic blood.',
          },
        ],
      },
      {
        id: 'fear.frequency',
        category: 'fear',
        text: 'How frequently do the scary elements occur?',
        askedWhen: (a) => a['fear.present'] === true,
        options: [
          {
            value: 'Occasional',
            label: 'Occasional',
            hint: 'Scary elements occur either rarely or occasionally, such as at a couple key moments of the experience.',
          },
          {
            value: 'Repeated',
            label: 'Repeated',
            hint: 'Scary elements either occur often, or they occur rarely, but when they do occur, many violent events happen in quick succession.',
          },
        ],
      },
    ],
  },
  {
    id: 'crude',
    title: 'Crude humor',
    questions: [
      {
        id: 'crude.present',
        category: 'crude',
        text: 'Does this experience depict, reference, or encourage crude humor?',
        options: YES_NO,
        help: 'Crude humor is a type of humor that depicts or references crude bodily functions, such as burping, farting, vomit, pee, and/or poop for comical purposes.',
        plain: 'Fart clouds, burps, poop emoji — bathroom jokes of any kind.',
      },
      {
        id: 'crude.level',
        category: 'crude',
        text: 'What is the level of crude humor?',
        askedWhen: (a) => a['crude.present'] === true,
        options: [
          {
            value: 'Mild',
            label: 'Mild',
            hint: 'Depicts and/or references burping, farting (e.g. fart cloud), and/or unrealistic looking vomit or poop (e.g. poop coils, poop emoji).',
          },
          {
            value: 'Moderate',
            label: 'Moderate',
            hint: 'Depicts and/or references pee.',
          },
        ],
      },
    ],
  },
  {
    id: 'gambling',
    title: 'Unplayable gambling content',
    questions: [
      {
        id: 'gambling.present',
        category: 'gambling',
        text: 'Does this experience contain unplayable gambling content?',
        options: YES_NO,
        help: 'While experiences cannot contain playable gambling content, including simulated gambling, you can depict unplayable gambling content, such as showing a casino or people playing cards that players cannot bet on or play. You do not need to report depictions of, and/or references to, items or activities that are typically associated with gambling, but are not games of chance/luck, such as horse racing, car racing, and poker chips.',
        plain: 'A casino or card table players can SEE but not play. (Playable gambling is not allowed on Roblox at all.)',
      },
    ],
  },
  {
    id: 'language',
    title: 'Strong language',
    questions: [
      {
        id: 'language.present',
        category: 'language',
        text: 'Do you depict and/or want to allow strong language in your experience?',
        options: YES_NO,
        help: 'Strong language is vulgar and obscene language that is not used to harass, discriminate, incite violence, or threaten others, or used in a sexual context. For example, strong language content could be depictions of a non-playable character (NPC) using obscenity like the "f-word" that is not directed towards another character or group of people (e.g. "f* off").',
        plain: 'Real swear words, written or spoken, anywhere in the game. Answering Yes makes the game 18+ only.',
      },
    ],
  },
  {
    id: 'romantic',
    title: 'Romantic themes',
    questions: [
      {
        id: 'romantic.present',
        category: 'romantic',
        text: 'Does this experience depict or reference (including in the title) romantic themes and/or primarily take place in private spaces (e.g. shower stalls, hotel rooms) or settings intended for adults (e.g. clubs, bars)?',
        options: YES_NO,
        help: 'Romantic themes are non-sexual expressions of love or affection, such as a quick kiss on the mouth. Private spaces are enclosed spaces designed for activities that are personal and secluded, such as sleeping, changing clothes, or bathing, and designed for one person or a very small number of people. Settings intended for adults are settings designed to cater to adult clientele, such as clubs or bars.',
        plain: 'Kissing, dating, or a game set mainly in bedrooms, bathrooms, clubs, or bars — even just in the title. Answering Yes makes the game 18+ only.',
      },
    ],
  },
  {
    id: 'alcohol',
    title: 'Alcohol',
    questions: [
      {
        id: 'alcohol.present',
        category: 'alcohol',
        text: 'Does this experience depict, reference, or include use of alcohol?',
        options: YES_NO,
        help: 'Alcohol is an intoxicating adult beverage. If your experience includes, depicts, or references alcohol, or depicts adult business and locations that provide or sell alcohol, such as characters drinking alcohol at a bar, you must disclose it.',
        plain: 'Beer, wine, a bar that serves drinks — showing or mentioning any of it. Answering Yes makes the game 18+ only.',
      },
    ],
  },
  {
    id: 'hangout',
    title: 'Social hangout',
    questions: [
      {
        id: 'hangout.primary',
        category: 'hangout',
        text: 'Is the primary theme or activity of this experience a social hangout?',
        options: YES_NO,
        help: 'Social hangouts are experiences where the primary theme or activity is to talk to or interact with other players using voice or text chat. This includes hangouts, vibe games, socializing spaces, and supportive places like sad rooms. It does not apply to experiences where the primary theme or activity is roleplay. Note that if your title or description includes content referencing social hangouts, your experience will be classified as a social hangout.',
        plain: 'Is chatting with other players the MAIN point of the game? (Not just a game that happens to have chat.)',
      },
      {
        id: 'hangout.privateSpaces',
        category: 'hangout',
        text: 'Does your experience include private spaces?',
        askedWhen: (a) => a['hangout.primary'] === true,
        options: YES_NO,
        help: 'Private spaces are enclosed spaces that are designed for activities that are personal and secluded, such as sleeping, changing clothes, or bathing, and are designed for one person or for a very small number of people, such as a bathroom stall, bedroom, or small tent.',
        plain: 'Bedrooms, bathroom stalls, small tents — closed-off spots built for one or two people.',
      },
    ],
  },
  {
    id: 'freeform',
    title: 'Free-form user creation',
    questions: [
      {
        id: 'freeform.present',
        category: 'freeform',
        text: 'Does this experience include free-form user creation?',
        options: YES_NO,
        help: 'Free-form user creation refers to features that allow players to create anything within an experience, such as writing words or making illustrations on a chalkboard. It does not apply to in-experience creations that players assemble with 3D assets, such as building a house or creating an outfit, or anything that goes through Roblox moderation before it is published or replicated.',
        plain: 'Can players draw or write anything they want where other players see it (like a whiteboard)? Building with pre-made blocks does not count.',
      },
    ],
  },
  {
    id: 'sensitive',
    title: 'Sensitive issues',
    questions: [
      {
        id: 'sensitive.primary',
        category: 'sensitive',
        text: 'Is the primary theme of this experience a sensitive issue?',
        options: YES_NO,
        help: 'Sensitive issues are current social, political, and religious issues with polarized viewpoints that evoke strong emotional reactions — for example: immigration, capital punishment, gun control, marriage equality, pay equity in sports, prayer in schools, racial profiling, affirmative action, vaccination policies, and reproductive rights. If your experience includes such content but is not primarily themed on it (such as a religious building in a city, or guns in a first-person shooter), you do not need to disclose it.',
        plain: 'Is the WHOLE game about a hot-button real-world debate? A church in your city map does not count.',
      },
    ],
  },
  {
    id: 'randomItems',
    title: 'Paid random items',
    questions: [
      {
        id: 'randomItems.present',
        category: 'randomItems',
        text: 'Does this experience contain paid random items?',
        options: YES_NO,
        help: 'Paid random items are virtual items players can purchase with Robux or other currency, such as a coin players can purchase with Robux to later redeem for a random virtual item. You do not need to report virtual items that you provide in exchange for players completing an action that does not involve the payment of Robux or any other currency.',
        plain: 'Loot boxes: players pay Robux and get a surprise item. Free daily-reward chests do not count.',
      },
      {
        id: 'randomItems.respectsPolicy',
        category: 'randomItems',
        text: 'Does this experience respect the ArePaidRandomItemsRestricted policy API?',
        askedWhen: (a) => a['randomItems.present'] === true,
        options: YES_NO,
        help: 'Use PolicyService:GetPolicyInfoForPlayerAsync — if ArePaidRandomItemsRestricted returns true for a player, include additional logic to hide, replace, or block the purchase of random items for those players.',
        plain: 'Does your code check Roblox\'s PolicyService and turn off loot boxes for players in regions that ban them?',
      },
    ],
  },
  {
    id: 'trading',
    title: 'Paid item trading',
    questions: [
      {
        id: 'trading.present',
        category: 'trading',
        text: 'Does this experience contain the ability for users to trade items that they paid for?',
        options: YES_NO,
        help: 'Paid item trading is the ability for players to purchase virtual items that they can then trade with other players, such as a marketplace for exchanging Limited items.',
        plain: 'Can players buy items and then trade them with each other?',
      },
      {
        id: 'trading.respectsPolicy',
        category: 'trading',
        text: 'Does this experience respect the IsPaidItemTradingAllowed policy API?',
        askedWhen: (a) => a['trading.present'] === true,
        options: YES_NO,
        help: 'Use PolicyService:GetPolicyInfoForPlayerAsync — if IsPaidItemTradingAllowed returns false for a player, include additional logic to hide, replace, or block the trading of paid items for those players.',
        plain: 'Does your code check Roblox\'s PolicyService and turn off trading for players in regions that ban it?',
      },
    ],
  },
  {
    id: 'media',
    title: 'Media',
    questions: [
      {
        id: 'media.share',
        category: 'media',
        text: 'Does your experience allow users to share media content (videos, images, text, audio, 3D models) from their gameplay that other users can see?',
        options: YES_NO,
        help: 'This question only applies if your experience lets users share gameplay content using tools built into the experience itself.',
        plain: 'Does YOUR game have a built-in way for players to post screenshots, clips, or sounds that other players can see?',
      },
      {
        id: 'media.feeds',
        category: 'media',
        text: 'Does your experience contain content feeds with continuous loading or audio/video that plays automatically?',
        options: YES_NO,
        help: 'Continuous loading means that content loads automatically as the user scrolls, without requiring any specific user interaction (such as a manual "load more" button or pagination).',
        plain: 'An endless-scroll feed (like a video app), or video/audio that starts playing by itself.',
      },
      {
        id: 'media.crossExperience',
        category: 'media',
        text: 'Does your experience allow users to view content that was captured from other experiences on Roblox?',
        options: YES_NO,
        help: 'This question applies to any in-experience viewing functionality, such as a SurfaceGui for static images, a VideoFrame, or an asset viewer.',
        plain: 'Can players watch screenshots or clips that were recorded in OTHER Roblox games, inside yours?',
      },
    ],
  },
  {
    id: 'ai',
    title: 'AI interaction',
    questions: [
      {
        id: 'ai.present',
        category: 'ai',
        text: 'Does your experience allow users to interact with generative AI components?',
        options: YES_NO,
        help: 'This question includes experiences in which a user can interact with a generative AI model in any way that triggers a response from the model. These interactions can include text chat, voice chat, images, 3D generations, avatar movement, etc. Your answer to this question should not consider whether you used generative AI to help develop the experience, only whether users can interact with it in the experience.',
        plain: 'Is there an AI chatbot or AI generator INSIDE the game that answers players? Using Bloxable to BUILD the game does not count.',
      },
      {
        id: 'ai.type',
        category: 'ai',
        text: 'What type of interactions does your experience allow between users and a generative AI model?',
        askedWhen: (a) => a['ai.present'] === true,
        options: [
          {
            value: 'Extended',
            label: 'Extended',
            hint: "Extended interactions meet at least one of the following criteria: cross-session memory is enabled (the experience saves the context of a user's prior interactions with AI and loads it on subsequent sessions), or the experience's main purpose is to interact with a generative AI bot or character (users can interact with the AI continuously with no time limit).",
          },
          {
            value: 'Limited',
            label: 'Limited',
            hint: 'Experiences that do not meet at least one of these criteria are considered limited interactions.',
          },
        ],
      },
    ],
  },
]

/**
 * Roblox's standing instruction for the whole questionnaire, verbatim from the
 * doc — the flow shows this to the user before any question.
 */
export const MOST_EXTREME_INSTRUCTION =
  'base your answers on the most mature or extreme content players can encounter within your experience'

/** Where the real questionnaire lives. */
export const CREATOR_DASHBOARD_URL = 'https://create.roblox.com/dashboard/creations'

/** The canonical doc every string in this module came from. */
export const CANONICAL_DOC_URL = 'https://create.roblox.com/docs/production/promotion/content-maturity'

// ---------------------------------------------------------------------------
// Lookups + validation
// ---------------------------------------------------------------------------

export const ALL_QUESTIONS: Question[] = CATEGORIES.flatMap((c) => c.questions)

const QUESTION_BY_ID = new Map<QuestionId, Question>(ALL_QUESTIONS.map((q) => [q.id, q]))

export function getQuestion(id: QuestionId): Question {
  const q = QUESTION_BY_ID.get(id)
  if (!q) throw new Error(`Unknown question: ${id}`)
  return q
}

export function isQuestionId(id: string): id is QuestionId {
  return QUESTION_BY_ID.has(id as QuestionId)
}

/** Is this question currently asked, given the other answers? */
export function isAsked(id: QuestionId, answers: Answers): boolean {
  const q = getQuestion(id)
  return q.askedWhen ? q.askedWhen(answers) : true
}

/** All questions currently asked, in questionnaire order. */
export function askedQuestions(answers: Answers): Question[] {
  return ALL_QUESTIONS.filter((q) => isAsked(q.id, answers))
}

/** Asked questions that have no answer yet. */
export function unansweredQuestions(answers: Answers): QuestionId[] {
  return askedQuestions(answers)
    .filter((q) => answers[q.id] === undefined)
    .map((q) => q.id)
}

/** True when every asked question has a valid answer. */
export function isComplete(answers: Answers): boolean {
  return unansweredQuestions(answers).length === 0
}

export function isValidAnswer(id: QuestionId, value: unknown): value is AnswerValue {
  const q = QUESTION_BY_ID.get(id)
  if (!q) return false
  return q.options.some((o) => o.value === value)
}

/**
 * Keeps only known question ids with valid option values, and drops answers to
 * questions that are not asked given the surviving answers (e.g. a stored
 * violence intensity after violence.depicted was flipped to No). Used by the
 * API route on write and by the flow when an answer change hides follow-ups.
 */
export function cleanAnswers(raw: unknown): Answers {
  const out: Answers = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isQuestionId(key) && isValidAnswer(key, value)) out[key] = value
  }
  // Drop orphaned follow-ups. One pass suffices: askedWhen predicates only ever
  // depend on earlier, unconditional-or-earlier questions in the same category.
  for (const q of ALL_QUESTIONS) {
    if (out[q.id] !== undefined && !isAsked(q.id, out)) delete out[q.id]
  }
  return out
}
