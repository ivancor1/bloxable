// Questionnaire PRE-FILL from the actual RbxTree. Pure and isomorphic — the
// client runs it against the tree it already holds.
//
// Bloxable generated this game, so every answer we pre-fill is justified by
// tree evidence: instance class names, instance names, tags, every string
// property (TextLabel.Text, Script.Source, …) and the project title. Two hard
// rules, in line with Roblox's standing instruction to answer for the MOST
// extreme content a player can encounter:
//
//   1. NEVER pre-fill an answer that could understate content. "No" is only
//      pre-filled when a scan of the whole tree finds zero signals for that
//      category. Any signal at all → the question is left UNANSWERED with the
//      evidence shown, so the human decides. (An unanswered question can only
//      be answered up by the user, never silently down by us.)
//   2. Every pre-filled answer carries a machine-readable reason — rule id,
//      plain-language detail, and the concrete tree evidence — shown in the UI.
//
// Judgment questions (violence intensity/frequency, blood realism, fear level,
// …) are never pre-filled: only the creator knows how the worst moment looks.

import type { RbxInstance, RbxTree } from '@/lib/rbx/types'
import type { Answers, QuestionId } from './questions'

export interface PrefillReason {
  /** Machine-readable rule id, e.g. 'no-evidence' | 'evidence-found' | 'policy-api-absent'. */
  rule: string
  /** One plain-language sentence a 12-year-old understands. */
  detail: string
  /** Concrete citations into the tree (instance, where, what matched). */
  evidence: string[]
}

export interface ScanStats {
  instances: number
  scripts: number
  scriptLines: number
  textValues: number
}

export interface PrefillResult {
  /** Question id → pre-filled answer. Only answers rule 1 allows. */
  answers: Answers
  /** Question id → why it was pre-filled (always present for every answer). */
  reasons: Partial<Record<QuestionId, PrefillReason>>
  /** Questions deliberately left blank because the tree was ambiguous, with why. */
  ambiguous: Partial<Record<QuestionId, PrefillReason>>
  stats: ScanStats
}

// ---------------------------------------------------------------------------
// Tokenizer — camelCase-aware so "SwordHandler" yields ["sword","handler"].
// ---------------------------------------------------------------------------

export function tokenize(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Signal vocabulary. Tokens match whole words after camelCase splitting;
// phrases match against the space-joined token stream; sourceMarkers match as
// raw substrings of script Source only (exact Roblox API names).
// ---------------------------------------------------------------------------

interface Signal {
  tokens?: string[]
  phrases?: string[]
  sourceMarkers?: string[]
  /** Regexes run against script Source only, with a human-readable label. */
  sourcePatterns?: { re: RegExp; label: string }[]
  /** Exact class names whose mere presence is a signal. */
  classNames?: string[]
}

const SIGNALS: Record<string, Signal> = {
  violence: {
    tokens: [
      'kill', 'kills', 'killed', 'killer', 'damage', 'weapon', 'weapons', 'sword', 'swords', 'gun', 'guns',
      'shoot', 'shooting', 'shot', 'bullet', 'bullets', 'fight', 'fighting', 'combat', 'attack', 'attacks',
      'punch', 'stab', 'battle', 'war', 'explode', 'explosion', 'explosive', 'bomb', 'grenade', 'knife',
      'blade', 'zombie', 'zombies', 'death', 'dead', 'die', 'dies', 'died', 'hurt',
    ],
  },
  // Proof the game DEALS damage (not just names things after weapons) — kept as
  // its own signal so weak name hits can never crowd it out of the evidence cap.
  violenceStrong: {
    sourceMarkers: ['TakeDamage'],
    sourcePatterns: [
      { re: /\.Health\s*-=/, label: "contains code that lowers a character's Health" },
      { re: /\.Health\s*=\s*[^=\n][^\n]*-/, label: "contains code that lowers a character's Health" },
    ],
    classNames: ['Explosion'],
  },
  blood: { tokens: ['blood', 'bloody', 'bleed', 'bleeding', 'gore', 'gory'] },
  fear: {
    tokens: [
      'scary', 'scare', 'scares', 'jumpscare', 'jumpscares', 'horror', 'spooky', 'creepy', 'haunted',
      'ghost', 'ghosts', 'monster', 'monsters', 'scream', 'screaming', 'nightmare', 'zombie', 'zombies',
      'demon', 'demons', 'eerie', 'ominous',
    ],
  },
  crude: {
    tokens: ['fart', 'farts', 'farting', 'burp', 'burps', 'burping', 'poop', 'vomit', 'puke', 'pee', 'toilet'],
  },
  gambling: {
    tokens: [
      'casino', 'poker', 'roulette', 'blackjack', 'slot', 'slots', 'gamble', 'gambling', 'bet', 'bets',
      'betting', 'lottery', 'jackpot',
    ],
  },
  language: {
    // Actual obscenities only — a hit here IS depicted strong language.
    tokens: ['fuck', 'fucking', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'dick', 'pussy', 'motherfucker'],
  },
  romantic: {
    tokens: [
      'kiss', 'kissing', 'kisses', 'romance', 'romantic', 'dating', 'girlfriend', 'boyfriend', 'valentine',
      'wedding', 'marry', 'marriage', 'bedroom', 'bedrooms', 'motel', 'hotel', 'nightclub', 'shower',
    ],
  },
  alcohol: {
    tokens: [
      'alcohol', 'beer', 'wine', 'vodka', 'whiskey', 'whisky', 'tequila', 'champagne', 'cocktail', 'liquor',
      'booze', 'drunk', 'brewery', 'saloon', 'pub',
    ],
  },
  hangout: {
    tokens: ['hangout', 'hangouts', 'vibe', 'vibes', 'chill', 'chilling', 'socialize', 'socializing'],
    phrases: ['hang out', 'sad room'],
  },
  privateSpaces: { tokens: ['bedroom', 'bathroom', 'shower', 'stall', 'tent'] },
  freeform: {
    tokens: ['draw', 'drawing', 'paint', 'painting', 'canvas', 'whiteboard', 'chalkboard', 'sketch', 'doodle', 'graffiti'],
    classNames: ['TextBox'],
  },
  sensitive: {
    tokens: [
      'immigration', 'abortion', 'vaccine', 'vaccines', 'vaccination', 'politics', 'political', 'election',
      'elections', 'protest', 'protests', 'religion', 'religious', 'prayer',
    ],
    phrases: ['gun control', 'capital punishment', 'marriage equality', 'racial profiling', 'affirmative action', 'reproductive rights'],
  },
  purchases: {
    sourceMarkers: [
      'MarketplaceService', 'PromptProductPurchase', 'PromptPurchase', 'PromptGamePassPurchase',
      'DeveloperProduct', 'ProcessReceipt',
    ],
  },
  randomReward: { tokens: ['lootbox', 'loot', 'crate', 'crates', 'gacha', 'unbox', 'unboxing', 'jackpot'] },
  trading: { tokens: ['trade', 'trades', 'trading'] },
  policyRandom: { sourceMarkers: ['ArePaidRandomItemsRestricted'] },
  policyTrading: { sourceMarkers: ['IsPaidItemTradingAllowed'] },
  mediaShare: {
    tokens: ['screenshot', 'screenshots', 'capture', 'captures', 'share', 'sharing'],
    sourceMarkers: ['CaptureService'],
  },
  mediaFeeds: { tokens: ['feed', 'feeds', 'autoplay'], classNames: ['VideoFrame'] },
  mediaCross: {
    tokens: ['capture', 'captures'],
    sourceMarkers: ['CaptureService'],
    classNames: ['VideoFrame'],
  },
  ai: {
    tokens: ['llm', 'genai', 'chatbot', 'gpt'],
    sourceMarkers: ['openai', 'anthropic', 'chatgpt', 'claude', 'gemini', 'generativelanguage', 'huggingface'],
  },
}

const MAX_EVIDENCE = 6

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const SCRIPT_CLASSES = new Set(['Script', 'LocalScript', 'ModuleScript'])

interface Scan {
  hits: Map<string, string[]>
  stats: ScanStats
  /** Sounds that start playing on their own (Playing=true). */
  autoplaySounds: string[]
}

function scanTree(tree: RbxTree, projectName: string): Scan {
  const hits = new Map<string, string[]>()
  const stats: ScanStats = { instances: 0, scripts: 0, scriptLines: 0, textValues: 0 }
  const autoplaySounds: string[] = []

  const record = (signal: string, evidence: string) => {
    const list = hits.get(signal) ?? []
    if (list.length < MAX_EVIDENCE) list.push(evidence)
    hits.set(signal, list)
  }

  const matchText = (text: string, where: string, isSource: boolean) => {
    const tokens = tokenize(text)
    const tokenSet = new Set(tokens)
    const joined = ` ${tokens.join(' ')} `
    for (const [name, signal] of Object.entries(SIGNALS)) {
      for (const t of signal.tokens ?? []) {
        if (tokenSet.has(t)) {
          record(name, `${where} contains "${t}"`)
          break
        }
      }
      for (const p of signal.phrases ?? []) {
        if (joined.includes(` ${p} `)) {
          record(name, `${where} contains "${p}"`)
          break
        }
      }
      if (isSource) {
        for (const m of signal.sourceMarkers ?? []) {
          if (text.toLowerCase().includes(m.toLowerCase())) {
            record(name, `${where} calls/mentions ${m}`)
            break
          }
        }
        for (const p of signal.sourcePatterns ?? []) {
          if (p.re.test(text)) {
            record(name, `${where} ${p.label}`)
            break
          }
        }
      }
    }
  }

  const walk = (inst: RbxInstance) => {
    stats.instances += 1
    const label = `${inst.className} "${inst.name}" (id ${inst.id})`

    for (const [name, signal] of Object.entries(SIGNALS)) {
      if (signal.classNames?.includes(inst.className)) {
        record(name, `${label} — a ${inst.className} instance exists`)
      }
    }

    matchText(inst.name, `${label} — name`, false)
    for (const tag of inst.tags ?? []) matchText(tag, `${label} — tag`, false)

    for (const [propName, prop] of Object.entries(inst.props)) {
      if (prop.type === 'string' || prop.type === 'ProtectedString') {
        const isSource = propName === 'Source' && SCRIPT_CLASSES.has(inst.className)
        if (isSource) {
          stats.scripts += 1
          stats.scriptLines += prop.value ? prop.value.split('\n').length : 0
        } else if (prop.value) {
          stats.textValues += 1
        }
        if (prop.value) matchText(prop.value, `${label} — ${propName}`, isSource)
      }
      if (
        inst.className === 'Sound' &&
        propName === 'Playing' &&
        prop.type === 'bool' &&
        prop.value === true
      ) {
        autoplaySounds.push(label)
      }
    }
    for (const [attrName, attr] of Object.entries(inst.attributes ?? {})) {
      if (attr.type === 'string' && attr.value) {
        stats.textValues += 1
        matchText(attr.value, `${label} — attribute ${attrName}`, false)
      }
    }

    for (const child of inst.children) walk(child)
  }

  for (const service of tree.services) walk(service)
  if (projectName) matchText(projectName, `project title "${projectName}"`, false)

  return { hits, stats, autoplaySounds }
}

// ---------------------------------------------------------------------------
// Decision rules
// ---------------------------------------------------------------------------

function scanSummary(stats: ScanStats): string {
  return `scanned ${stats.instances} objects, ${stats.scripts} scripts (${stats.scriptLines} lines), ${stats.textValues} text values, and the project title`
}

function sample(words: string[] | undefined, n = 5): string {
  return (words ?? []).slice(0, n).join(', ')
}

export function prefillFromTree(tree: RbxTree, projectName: string): PrefillResult {
  const { hits, stats, autoplaySounds } = scanTree(tree, projectName)
  const answers: Answers = {}
  const reasons: PrefillResult['reasons'] = {}
  const ambiguous: PrefillResult['ambiguous'] = {}

  const get = (signal: string): string[] => hits.get(signal) ?? []

  /** "No" only on zero evidence; any evidence → unanswered with the evidence. */
  const noOrAsk = (id: QuestionId, signals: string[], topic: string, lookedFor: string) => {
    const evidence = signals.flatMap((s) => get(s))
    if (evidence.length === 0) {
      answers[id] = false
      reasons[id] = {
        rule: 'no-evidence',
        detail: `No ${topic} found anywhere in your game — ${scanSummary(stats)} (looked for e.g. ${lookedFor}).`,
        evidence: [],
      }
    } else {
      ambiguous[id] = {
        rule: 'ambiguous-evidence',
        detail: `Your game has content that might be ${topic} — only you know how it really looks in play, so answer this one yourself.`,
        evidence: evidence.slice(0, MAX_EVIDENCE),
      }
    }
  }

  // --- Violence: positive when the tree provably deals damage ----------------
  {
    const evidence = get('violence')
    const strong = get('violenceStrong')
    if (strong.length > 0) {
      answers['violence.depicted'] = true
      reasons['violence.depicted'] = {
        rule: 'evidence-found',
        detail: 'Your game contains code or objects that hurt characters, so this is a Yes. Pick the intensity and frequency yourself — answer for the most extreme moment a player can see.',
        evidence: strong.concat(evidence.filter((e) => !strong.includes(e))).slice(0, MAX_EVIDENCE),
      }
    } else {
      noOrAsk('violence.depicted', ['violence'], 'violence (fighting, weapons, characters getting hurt)', sample(SIGNALS.violence.tokens))
    }
  }

  noOrAsk('blood.present', ['blood'], 'blood', sample(SIGNALS.blood.tokens))
  noOrAsk('fear.present', ['fear'], 'scary content', sample(SIGNALS.fear.tokens))
  noOrAsk('crude.present', ['crude'], 'crude humor (bathroom jokes)', sample(SIGNALS.crude.tokens))
  noOrAsk('gambling.present', ['gambling'], 'gambling imagery (casinos, cards, slots)', sample(SIGNALS.gambling.tokens))

  // --- Strong language: a profanity hit IS depicted strong language ----------
  {
    const evidence = get('language')
    if (evidence.length > 0) {
      answers['language.present'] = true
      reasons['language.present'] = {
        rule: 'evidence-found',
        detail: 'Your game contains an obscene word, which Roblox counts as strong language (this makes the game 18+ only). Remove it and retake this if that is not what you want.',
        evidence,
      }
    } else {
      answers['language.present'] = false
      reasons['language.present'] = {
        rule: 'no-evidence',
        detail: `No swear words found in any script, name, or text — ${scanSummary(stats)}. Bloxable also does not switch on Roblox's player-chat strong-language setting.`,
        evidence: [],
      }
    }
  }

  noOrAsk(
    'romantic.present',
    ['romantic'],
    'romantic themes or private/adult settings (this includes the title)',
    sample(SIGNALS.romantic.tokens),
  )
  noOrAsk('alcohol.present', ['alcohol'], 'alcohol references', sample(SIGNALS.alcohol.tokens))
  noOrAsk(
    'hangout.primary',
    ['hangout'],
    'social-hangout theming (in the title or the game itself)',
    `${sample(SIGNALS.hangout.tokens)}, "hang out"`,
  )
  noOrAsk('hangout.privateSpaces', ['privateSpaces'], 'private spaces (bedrooms, bathroom stalls, small tents)', sample(SIGNALS.privateSpaces.tokens))
  noOrAsk(
    'freeform.present',
    ['freeform'],
    'free-form creation tools (drawing surfaces or free text input)',
    `${sample(SIGNALS.freeform.tokens)}, TextBox instances`,
  )
  noOrAsk('sensitive.primary', ['sensitive'], 'sensitive-issue theming', `${sample(SIGNALS.sensitive.tokens)}, "gun control"`)

  // --- Paid random items: a paid ANYTHING needs a purchase path ---------------
  {
    const purchases = get('purchases')
    const loot = get('randomReward')
    if (purchases.length === 0) {
      answers['randomItems.present'] = false
      reasons['randomItems.present'] = {
        rule: 'purchase-path-absent',
        detail: `Paid random items need code that charges Robux, and no script in your game calls any purchase API (MarketplaceService, PromptProductPurchase, …) — ${scanSummary(stats)}.`,
        evidence: [],
      }
    } else {
      ambiguous['randomItems.present'] = {
        rule: 'ambiguous-evidence',
        detail: 'Your game has purchase code. If anything players pay for gives a RANDOM item (a loot box), answer Yes.',
        evidence: purchases.concat(loot).slice(0, MAX_EVIDENCE),
      }
    }
  }

  // --- respects-policy pair: the whole codebase is in the tree, so this is
  // checkable for real. True only when the exact API name appears. ------------
  {
    const randomPolicy = get('policyRandom')
    answers['randomItems.respectsPolicy'] = randomPolicy.length > 0
    reasons['randomItems.respectsPolicy'] =
      randomPolicy.length > 0
        ? {
            rule: 'policy-api-present',
            detail: 'A script in your game checks the ArePaidRandomItemsRestricted policy.',
            evidence: randomPolicy,
          }
        : {
            rule: 'policy-api-absent',
            detail: 'No script in your game checks ArePaidRandomItemsRestricted via PolicyService, so the honest answer today is No. Ask Bloxable to add the check if you sell random items.',
            evidence: [],
          }
  }

  {
    const purchases = get('purchases')
    const trading = get('trading')
    if (trading.length === 0 && purchases.length === 0) {
      answers['trading.present'] = false
      reasons['trading.present'] = {
        rule: 'no-evidence',
        detail: `No trading system and no purchase code found in your game — ${scanSummary(stats)}.`,
        evidence: [],
      }
    } else if (trading.length === 0) {
      answers['trading.present'] = false
      reasons['trading.present'] = {
        rule: 'no-evidence',
        detail: `Your game has purchase code, but nothing that lets players trade items with each other — ${scanSummary(stats)} (looked for e.g. ${sample(SIGNALS.trading.tokens)}).`,
        evidence: [],
      }
    } else {
      ambiguous['trading.present'] = {
        rule: 'ambiguous-evidence',
        detail: 'Your game mentions trading. If players can trade items they PAID for, answer Yes.',
        evidence: trading.slice(0, MAX_EVIDENCE),
      }
    }
  }

  {
    const tradingPolicy = get('policyTrading')
    answers['trading.respectsPolicy'] = tradingPolicy.length > 0
    reasons['trading.respectsPolicy'] =
      tradingPolicy.length > 0
        ? {
            rule: 'policy-api-present',
            detail: 'A script in your game checks the IsPaidItemTradingAllowed policy.',
            evidence: tradingPolicy,
          }
        : {
            rule: 'policy-api-absent',
            detail: 'No script in your game checks IsPaidItemTradingAllowed via PolicyService, so the honest answer today is No. Ask Bloxable to add the check if you enable paid trading.',
            evidence: [],
          }
  }

  noOrAsk('media.share', ['mediaShare'], 'built-in tools for players to share media', `${sample(SIGNALS.mediaShare.tokens)}, CaptureService`)

  // --- Media feeds: auto-playing Sounds count as evidence, not as a No -------
  {
    const evidence = get('mediaFeeds').concat(autoplaySounds.map((s) => `${s} — Playing is true (starts automatically)`))
    if (evidence.length === 0) {
      answers['media.feeds'] = false
      reasons['media.feeds'] = {
        rule: 'no-evidence',
        detail: `No content feeds, no VideoFrames, and no audio or video that starts by itself — ${scanSummary(stats)}.`,
        evidence: [],
      }
    } else {
      ambiguous['media.feeds'] = {
        rule: 'ambiguous-evidence',
        detail: "Your game has media that may start automatically. Roblox's question covers feeds that keep loading AND audio/video that plays by itself — decide which applies.",
        evidence: evidence.slice(0, MAX_EVIDENCE),
      }
    }
  }

  noOrAsk(
    'media.crossExperience',
    ['mediaCross'],
    'viewers for content captured in other Roblox experiences',
    'capture, CaptureService, VideoFrame instances',
  )

  // --- AI interaction: building WITH Bloxable does not count ------------------
  {
    const evidence = get('ai')
    if (evidence.length === 0) {
      answers['ai.present'] = false
      reasons['ai.present'] = {
        rule: 'no-evidence',
        detail: `No script in your game talks to a generative AI service — ${scanSummary(stats)}. Using Bloxable to BUILD the game does not count; only AI that players interact with inside the game does.`,
        evidence: [],
      }
    } else {
      ambiguous['ai.present'] = {
        rule: 'ambiguous-evidence',
        detail: 'Your game mentions an AI service. If players can interact with a generative AI inside the game, answer Yes.',
        evidence: evidence.slice(0, MAX_EVIDENCE),
      }
    }
  }

  return { answers, reasons, ambiguous, stats }
}
