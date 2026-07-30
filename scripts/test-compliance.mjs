#!/usr/bin/env node
// Tests for the guided Maturity & Compliance flow (lib/compliance/*).
//
//   question model  -> 15 categories, verbatim wording pinned, follow-up logic
//   predictor       -> EXHAUSTIVE sweep of every maturity-relevant answer combo
//                      against an independent oracle built from the doc tables
//   gates           -> independent 16+/18+ gates never move the label
//   pre-fill        -> real trees; the non-understatement property (ambiguous
//                      tree => unanswered, never a guessed "No")
//   staleness       -> tree hash stability + change detection
//
// Verbatim strings come from the canonical doc, fetched as markdown 2026-07-30:
//   create.roblox.com/docs/production/promotion/content-maturity
// (production/promotion/experience-guidelines is stale and ignored.)
//
// Same resolve-hook trick as test-eligibility.mjs (Node strips types natively;
// the hook adds extensions and the `@/` alias).

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier
    if (spec.startsWith('@/')) spec = pathToFileURL(path.join(ROOT, spec.slice(2))).href
    if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[a-z]+$/i.test(spec)) {
      const url = new URL(spec, context.parentURL)
      for (const ext of ['.ts', '/index.ts']) {
        if (existsSync(fileURLToPath(url) + ext)) return nextResolve(spec + ext, context)
      }
    }
    return nextResolve(spec, context)
  },
})

const failures = []
let checks = 0

function ok(condition, message) {
  checks += 1
  if (!condition) failures.push(message)
}

function eq(actual, expected, message) {
  checks += 1
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) failures.push(`${message} (got ${a}, expected ${b})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const {
  CATEGORIES,
  ALL_QUESTIONS,
  MOST_EXTREME_INSTRUCTION,
  cleanAnswers,
  getQuestion,
  isAsked,
  isComplete,
  unansweredQuestions,
} = await import('../lib/compliance/questions.ts')
const { predictLabel, LABEL_ORDER, labelRank, maxLabel } = await import('../lib/compliance/predict.ts')
const { prefillFromTree, tokenize } = await import('../lib/compliance/prefill.ts')
const { treeHash } = await import('../lib/compliance/hash.ts')
const { defaultBaseplateTree } = await import('../lib/rbx/template.ts')

// --- 1. question model: structure + verbatim wording ---------------------------

section('question model')

eq(CATEGORIES.length, 15, '15 categories, one per doc section')
eq(ALL_QUESTIONS.length, 29, '29 questions total')
eq(
  CATEGORIES.map((c) => c.questions.length),
  [3, 4, 3, 2, 1, 1, 1, 1, 2, 1, 1, 2, 2, 3, 2],
  'question count per category',
)
eq(
  CATEGORIES.map((c) => c.title),
  [
    'Violence', 'Blood', 'Fear', 'Crude humor', 'Unplayable gambling content', 'Strong language',
    'Romantic themes', 'Alcohol', 'Social hangout', 'Free-form user creation', 'Sensitive issues',
    'Paid random items', 'Paid item trading', 'Media', 'AI interaction',
  ],
  'category titles match the doc headings',
)

// Verbatim wording pinned against the doc (fetched 2026-07-30). If one of
// these fails, the UI is no longer showing what Roblox will actually ask.
const VERBATIM = {
  'violence.depicted': 'Does this experience depict violence and/or violent content?',
  'violence.intensity': 'How intense is the violence?',
  'violence.frequency': 'How frequent is the violence?',
  'blood.present': 'Does this experience depict any blood?',
  'blood.realism': 'How realistic is the blood?',
  'blood.unrealisticInfrequent': 'Are the depictions of blood infrequent and/or fleeting?',
  'blood.realisticLevel': 'What level of blood and/or gore is depicted?',
  'fear.present': 'Does this experience include scary elements that may trigger fear?',
  'fear.intensity': 'What level of scary elements are there?',
  'fear.frequency': 'How frequently do the scary elements occur?',
  'crude.present': 'Does this experience depict, reference, or encourage crude humor?',
  'crude.level': 'What is the level of crude humor?',
  'gambling.present': 'Does this experience contain unplayable gambling content?',
  'language.present': 'Do you depict and/or want to allow strong language in your experience?',
  'romantic.present':
    'Does this experience depict or reference (including in the title) romantic themes and/or primarily take place in private spaces (e.g. shower stalls, hotel rooms) or settings intended for adults (e.g. clubs, bars)?',
  'alcohol.present': 'Does this experience depict, reference, or include use of alcohol?',
  'hangout.primary': 'Is the primary theme or activity of this experience a social hangout?',
  'hangout.privateSpaces': 'Does your experience include private spaces?',
  'freeform.present': 'Does this experience include free-form user creation?',
  'sensitive.primary': 'Is the primary theme of this experience a sensitive issue?',
  'randomItems.present': 'Does this experience contain paid random items?',
  'randomItems.respectsPolicy': 'Does this experience respect the ArePaidRandomItemsRestricted policy API?',
  'trading.present': 'Does this experience contain the ability for users to trade items that they paid for?',
  'trading.respectsPolicy': 'Does this experience respect the IsPaidItemTradingAllowed policy API?',
  'media.share':
    'Does your experience allow users to share media content (videos, images, text, audio, 3D models) from their gameplay that other users can see?',
  'media.feeds':
    'Does your experience contain content feeds with continuous loading or audio/video that plays automatically?',
  'media.crossExperience':
    'Does your experience allow users to view content that was captured from other experiences on Roblox?',
  'ai.present': 'Does your experience allow users to interact with generative AI components?',
  'ai.type': 'What type of interactions does your experience allow between users and a generative AI model?',
}
for (const [id, text] of Object.entries(VERBATIM)) {
  eq(getQuestion(id).text, text, `verbatim wording: ${id}`)
}

ok(
  MOST_EXTREME_INSTRUCTION ===
    'base your answers on the most mature or extreme content players can encounter within your experience',
  'the standing "most extreme content" instruction is carried verbatim',
)

// Option vocabulary matches the doc's tables.
eq(getQuestion('violence.intensity').options.map((o) => o.value), ['Mild', 'Moderate', 'Restricted'], 'violence intensity options')
eq(getQuestion('violence.frequency').options.map((o) => o.value), ['Occasional', 'Repeated'], 'violence frequency options')
eq(getQuestion('blood.realism').options.map((o) => o.value), ['Unrealistic', 'Realistic'], 'blood realism options')
eq(getQuestion('blood.realisticLevel').options.map((o) => o.value), ['Light', 'Heavy'], 'blood level options')
eq(getQuestion('fear.intensity').options.map((o) => o.value), ['Mild', 'Moderate'], 'fear intensity options')
eq(getQuestion('crude.level').options.map((o) => o.value), ['Mild', 'Moderate'], 'crude level options')
eq(getQuestion('ai.type').options.map((o) => o.value), ['Extended', 'Limited'], 'AI interaction type options')
ok(
  getQuestion('violence.intensity').options[2].note?.includes('age-verified players that are at least 18'),
  'Restricted violence carries the 18+ note',
)

// --- follow-up (askedWhen) logic ----------------------------------------------

section('follow-up logic')

eq(isAsked('violence.intensity', {}), false, 'intensity not asked before depicted')
eq(isAsked('violence.intensity', { 'violence.depicted': false }), false, 'intensity not asked on No')
eq(isAsked('violence.intensity', { 'violence.depicted': true }), true, 'intensity asked on Yes')
eq(isAsked('blood.unrealisticInfrequent', { 'blood.present': true, 'blood.realism': 'Unrealistic' }), true, 'unrealistic follow-up asked')
eq(isAsked('blood.unrealisticInfrequent', { 'blood.present': true, 'blood.realism': 'Realistic' }), false, 'unrealistic follow-up hidden for realistic')
eq(isAsked('blood.realisticLevel', { 'blood.present': true, 'blood.realism': 'Realistic' }), true, 'realistic follow-up asked')
eq(isAsked('hangout.privateSpaces', { 'hangout.primary': false }), false, 'private spaces only asked for hangouts')
eq(isAsked('randomItems.respectsPolicy', { 'randomItems.present': true }), true, 'policy question asked when items present')
eq(isAsked('ai.type', { 'ai.present': true }), true, 'AI type asked when present')

eq(cleanAnswers({ 'violence.intensity': 'Mild' }), {}, 'orphaned follow-up is dropped')
eq(cleanAnswers({ 'violence.depicted': true, 'violence.intensity': 'Extreme' }), { 'violence.depicted': true }, 'invalid option value dropped')
eq(cleanAnswers({ nonsense: true }), {}, 'unknown question id dropped')
eq(
  cleanAnswers({ 'blood.present': false, 'blood.realism': 'Unrealistic', 'blood.unrealisticInfrequent': true }),
  { 'blood.present': false },
  'flipping a parent to No drops the whole follow-up chain',
)
eq(
  cleanAnswers({ 'blood.present': true, 'blood.realism': 'Unrealistic', 'blood.unrealisticInfrequent': true }),
  { 'blood.present': true, 'blood.realism': 'Unrealistic', 'blood.unrealisticInfrequent': true },
  'a valid chain survives cleaning',
)

// --- 2. predictor: exhaustive sweep against an independent oracle --------------

section('predictor — exhaustive sweep')

// Every non-maturity answer pinned to No so gates stay quiet.
const BASE_NO = {
  'violence.depicted': false,
  'blood.present': false,
  'fear.present': false,
  'crude.present': false,
  'gambling.present': false,
  'language.present': false,
  'romantic.present': false,
  'alcohol.present': false,
  'hangout.primary': false,
  'freeform.present': false,
  'sensitive.primary': false,
  'randomItems.present': false,
  'trading.present': false,
  'media.share': false,
  'media.feeds': false,
  'media.crossExperience': false,
  'ai.present': false,
}

const VIOLENCE = ['none', ['Mild', 'Occasional'], ['Mild', 'Repeated'], ['Moderate', 'Occasional'], ['Moderate', 'Repeated'], ['Restricted', 'Occasional'], ['Restricted', 'Repeated']]
const BLOOD = ['none', ['Unrealistic', true], ['Unrealistic', false], ['Realistic', 'Light'], ['Realistic', 'Heavy']]
const FEAR = ['none', ['Mild', 'Occasional'], ['Mild', 'Repeated'], ['Moderate', 'Occasional'], ['Moderate', 'Repeated']]
const CRUDE = ['none', 'Mild', 'Moderate']
const BOOL = [false, true]

// Independent oracle: re-derived from the doc's label table, NOT from the
// implementation. Rank: Minimal 0, Mild 1, Moderate 2, Restricted 3.
function oracle(v, b, f, c, gambling, language, romantic, alcohol) {
  let rank = 0
  if (v !== 'none') {
    const [intensity, frequency] = v
    if (intensity === 'Restricted') rank = Math.max(rank, 3)
    else if (intensity === 'Moderate') rank = Math.max(rank, 2)
    else if (intensity === 'Mild' && frequency === 'Repeated') rank = Math.max(rank, 1)
  }
  if (b !== 'none') {
    const [realism, extra] = b
    if (realism === 'Realistic') rank = Math.max(rank, extra === 'Heavy' ? 3 : 2)
    else if (extra === false) rank = Math.max(rank, 1) // frequent/lasting unrealistic blood
  }
  if (f !== 'none') rank = Math.max(rank, f[0] === 'Moderate' ? 2 : 1)
  if (c !== 'none') rank = Math.max(rank, c === 'Moderate' ? 2 : 1)
  if (gambling) rank = Math.max(rank, 2)
  if (language) rank = Math.max(rank, 3)
  if (romantic) rank = Math.max(rank, 3)
  if (alcohol) rank = Math.max(rank, 3)
  return ['Minimal', 'Mild', 'Moderate', 'Restricted'][rank]
}

let combos = 0
for (const v of VIOLENCE)
  for (const b of BLOOD)
    for (const f of FEAR)
      for (const c of CRUDE)
        for (const gambling of BOOL)
          for (const language of BOOL)
            for (const romantic of BOOL)
              for (const alcohol of BOOL) {
                combos += 1
                const answers = { ...BASE_NO }
                if (v !== 'none') {
                  answers['violence.depicted'] = true
                  answers['violence.intensity'] = v[0]
                  answers['violence.frequency'] = v[1]
                }
                if (b !== 'none') {
                  answers['blood.present'] = true
                  answers['blood.realism'] = b[0]
                  if (b[0] === 'Unrealistic') answers['blood.unrealisticInfrequent'] = b[1]
                  else answers['blood.realisticLevel'] = b[1]
                }
                if (f !== 'none') {
                  answers['fear.present'] = true
                  answers['fear.intensity'] = f[0]
                  answers['fear.frequency'] = f[1]
                }
                if (c !== 'none') {
                  answers['crude.present'] = true
                  answers['crude.level'] = c
                }
                answers['gambling.present'] = gambling
                answers['language.present'] = language
                answers['romantic.present'] = romantic
                answers['alcohol.present'] = alcohol

                const expected = oracle(v, b, f, c, gambling, language, romantic, alcohol)
                const p = predictLabel(answers)
                const key = JSON.stringify([v, b, f, c, gambling, language, romantic, alcohol])
                eq(p.label, expected, `label for ${key}`)
                eq(p.gates.requiresVerifiedCreator, expected === 'Restricted', `creator 18+ gate for ${key}`)
                ok(p.complete, `complete for ${key}`)
                ok(
                  p.label === 'Minimal' ? p.decidedBy.length === 0 : p.decidedBy.length > 0,
                  `decidedBy explains a non-Minimal label for ${key}`,
                )
              }
eq(combos, 7 * 5 * 5 * 3 * 2 * 2 * 2 * 2, 'sweep covered the full cross product (8400 combos)')

// --- 3. independent gates never move the label ---------------------------------

section('independent gates')

const HANGOUT = ['none', 'no-private', 'private']
for (const freeform of BOOL)
  for (const hangout of HANGOUT)
    for (const sensitive of BOOL) {
      const answers = { ...BASE_NO, 'freeform.present': freeform, 'sensitive.primary': sensitive }
      if (hangout !== 'none') {
        answers['hangout.primary'] = true
        answers['hangout.privateSpaces'] = hangout === 'private'
      }
      const p = predictLabel(answers)
      const key = `freeform=${freeform} hangout=${hangout} sensitive=${sensitive}`
      eq(p.label, 'Minimal', `gates do not raise the label (${key})`)
      eq(p.gates.requiresVerifiedCreator, false, `no creator gate without Restricted (${key})`)
      eq(
        p.gates.sixteenPlus.length,
        (freeform ? 1 : 0) + (hangout === 'no-private' ? 1 : 0) + (sensitive ? 1 : 0),
        `16+ gate count (${key})`,
      )
      eq(p.gates.eighteenPlus.length, hangout === 'private' ? 1 : 0, `18+ gate count (${key})`)
      ok(p.complete, `gate sweep answers complete (${key})`)
    }

{
  const p = predictLabel({ ...BASE_NO, 'freeform.present': true })
  ok(p.gates.sixteenPlus[0].includes('Free-form user creation'), '16+ gate names free-form creation')
}
{
  const p = predictLabel({ ...BASE_NO, 'hangout.primary': true, 'hangout.privateSpaces': true })
  ok(p.gates.eighteenPlus[0].includes('private spaces'), '18+ gate names private spaces')
}
{
  const p = predictLabel({ ...BASE_NO, 'sensitive.primary': true })
  ok(p.gates.sixteenPlus[0].includes('sensitive issue'), '16+ gate names sensitive issues')
}

// --- 4. floor + partial answers -------------------------------------------------

section('floor + partial answers')

{
  const p = predictLabel(BASE_NO)
  eq(p.label, 'Minimal', 'all-No answers floor at Minimal')
  ok(p.complete, 'all-No answers are complete')
  eq(p.decidedBy, [], 'Minimal floor needs no explanation')
  eq(p.gates, { sixteenPlus: [], eighteenPlus: [], requiresVerifiedCreator: false }, 'no gates on all-No')
}

{
  const p = predictLabel({})
  eq(p.label, 'Minimal', 'empty answers predict the floor')
  eq(p.complete, false, 'empty answers are incomplete')
  eq(p.unanswered.length, 17, 'all 17 unconditional questions unanswered')
}

{
  // A partial prediction is a floor: answering the missing questions can only
  // keep or raise the label.
  const partial = { ...BASE_NO }
  delete partial['alcohol.present']
  const p = predictLabel(partial)
  eq(p.label, 'Minimal', 'partial prediction is a floor')
  eq(p.complete, false, 'missing alcohol answer marks incomplete')
  eq(p.unanswered, ['alcohol.present'], 'the missing question is named')
  eq(predictLabel({ ...partial, 'alcohol.present': true }).label, 'Restricted', 'answering up raises the floor')
}

{
  const p = predictLabel({ ...BASE_NO, 'violence.depicted': true })
  eq(p.complete, false, 'Yes without follow-ups is incomplete')
  eq(p.unanswered, ['violence.intensity', 'violence.frequency'], 'the revealed follow-ups are the gap')
  eq(p.label, 'Minimal', 'no label movement until the follow-ups say how bad it is')
}

ok(labelRank('Restricted') === 3 && labelRank('Minimal') === 0, 'label ranks ordered')
eq(maxLabel('Mild', 'Moderate'), 'Moderate', 'maxLabel picks the higher label')
eq(LABEL_ORDER, ['Minimal', 'Mild', 'Moderate', 'Restricted'], 'label order matches the doc table')

// --- 5. pre-fill: fixtures + the non-understatement property ---------------------

section('pre-fill')

let nextId = 0
const inst = (className, name, props = {}, children = []) => ({
  id: `t${(nextId++).toString(36).padStart(7, '0')}`,
  className,
  name,
  props,
  children,
})
const str = (value) => ({ type: 'string', value })
const src = (value) => ({ type: 'ProtectedString', value })
const wrap = (children) => ({ formatVersion: 1, services: [inst('Workspace', 'Workspace', {}, children)] })

eq(tokenize('SwordHandler'), ['sword', 'handler'], 'camelCase names split into words')
eq(tokenize('ClipsDescendants'), ['clips', 'descendants'], 'tokenizer sanity')
ok(tokenize('deadline!').includes('deadline') && !tokenize('deadline').includes('dead'), 'no substring false positives')

/** Non-understatement property + reason discipline, applied to every fixture. */
function checkInvariants(result, label) {
  for (const id of Object.keys(result.answers)) {
    ok(result.reasons[id] !== undefined, `${label}: pre-fill ${id} carries a reason`)
    const r = result.reasons[id]
    ok(
      r && typeof r.rule === 'string' && typeof r.detail === 'string' && Array.isArray(r.evidence),
      `${label}: reason for ${id} is machine-readable (rule/detail/evidence)`,
    )
    ok(result.ambiguous[id] === undefined, `${label}: ${id} is not both answered and ambiguous`)
  }
  for (const id of Object.keys(result.ambiguous)) {
    ok(result.answers[id] === undefined, `${label}: ambiguous ${id} stays unanswered`)
    ok(result.ambiguous[id].evidence.length > 0, `${label}: ambiguity for ${id} cites tree evidence`)
  }
}

// Clean tree: the default baseplate has no maturity signals at all, so every
// content question pre-fills to No, each with a reason and zero ambiguity.
{
  const result = prefillFromTree(defaultBaseplateTree(), 'Obby Adventure')
  checkInvariants(result, 'clean tree')
  eq(Object.keys(result.ambiguous), [], 'clean tree: nothing ambiguous')
  const expectedNo = [
    'violence.depicted', 'blood.present', 'fear.present', 'crude.present', 'gambling.present',
    'language.present', 'romantic.present', 'alcohol.present', 'hangout.primary', 'hangout.privateSpaces',
    'freeform.present', 'sensitive.primary', 'randomItems.present', 'randomItems.respectsPolicy',
    'trading.present', 'trading.respectsPolicy', 'media.share', 'media.feeds', 'media.crossExperience',
    'ai.present',
  ]
  for (const id of expectedNo) eq(result.answers[id], false, `clean tree: ${id} pre-filled No`)
  ok(result.stats.instances > 10, 'clean tree: scan actually walked the tree')
  ok(
    result.reasons['ai.present'].detail.includes('does not count'),
    'AI reason says building WITH AI does not count',
  )
  // Judgment questions are never pre-filled.
  for (const id of ['violence.intensity', 'violence.frequency', 'blood.realism', 'fear.intensity', 'crude.level', 'ai.type']) {
    eq(result.answers[id], undefined, `clean tree: judgment question ${id} never pre-filled`)
  }
}

// Damage-dealing script: violence provably depicted -> pre-filled YES (never an
// understatement), with the script cited; intensity/frequency left to the user.
{
  const tree = wrap([
    inst('Part', 'Arena'),
    inst('Script', 'SwordHandler', { Source: src('local h = hit.Parent:FindFirstChild("Humanoid")\nif h then h:TakeDamage(25) end') }),
  ])
  const result = prefillFromTree(tree, 'Sword Duels')
  checkInvariants(result, 'sword tree')
  eq(result.answers['violence.depicted'], true, 'sword tree: violence pre-filled Yes')
  eq(result.reasons['violence.depicted'].rule, 'evidence-found', 'sword tree: positive rule id')
  ok(
    result.reasons['violence.depicted'].evidence.some((e) => e.includes('SwordHandler')),
    'sword tree: evidence cites the script',
  )
  eq(result.answers['violence.intensity'], undefined, 'sword tree: intensity left to the user')
  eq(result.answers['blood.present'], false, 'sword tree: blood still cleanly No')
}

// Health-subtraction damage (what generated code actually writes instead of
// TakeDamage) is also proof of dealt damage -> pre-filled Yes.
{
  const tree = wrap([
    inst('Script', 'ArenaSwordDamage', {
      Source: src('targetHumanoid.Health = math.max(0, targetHumanoid.Health - DAMAGE)'),
    }),
  ])
  const result = prefillFromTree(tree, 'Arena')
  checkInvariants(result, 'health-subtraction tree')
  eq(result.answers['violence.depicted'], true, 'health subtraction: violence pre-filled Yes')
  ok(
    result.reasons['violence.depicted'].evidence.some((e) => e.includes('lowers a character')),
    'health subtraction: evidence explains the damage code',
  )
}

// Healing/setup code that only RAISES Health is not damage evidence.
{
  const tree = wrap([inst('Script', 'Setup', { Source: src('humanoid.MaxHealth = 150\nhumanoid.Health = 150') })])
  const result = prefillFromTree(tree, 'Calm Park')
  checkInvariants(result, 'healing tree')
  eq(result.answers['violence.depicted'], false, 'plain Health assignment is not violence evidence')
}

// An Explosion instance is proof by itself.
{
  const result = prefillFromTree(wrap([inst('Explosion', 'Boom')]), 'Fireworks')
  checkInvariants(result, 'explosion tree')
  eq(result.answers['violence.depicted'], true, 'Explosion instance: violence pre-filled Yes')
}

// Name-only violence signal: ambiguous -> UNANSWERED, never a guessed No.
{
  const result = prefillFromTree(wrap([inst('Part', 'KillBrick')]), 'Tower Climb')
  checkInvariants(result, 'kill-brick tree')
  eq(result.answers['violence.depicted'], undefined, 'kill-brick: violence NOT answered (no understating)')
  ok(result.ambiguous['violence.depicted'] !== undefined, 'kill-brick: violence flagged for the user')
  ok(
    result.ambiguous['violence.depicted'].evidence.some((e) => e.toLowerCase().includes('kill')),
    'kill-brick: ambiguity cites the "kill" hit',
  )
}

// Blood-named decal: ambiguous, unanswered.
{
  const result = prefillFromTree(wrap([inst('Decal', 'BloodSplatter')]), 'Cave Explorer')
  checkInvariants(result, 'blood tree')
  eq(result.answers['blood.present'], undefined, 'blood decal: not pre-filled No')
  ok(result.ambiguous['blood.present'] !== undefined, 'blood decal: left for the user with evidence')
}

// Obscenity in generated text IS depicted strong language -> pre-filled Yes.
{
  const tree = wrap([inst('TextLabel', 'Sign', { Text: str('well shit, you made it') })])
  const result = prefillFromTree(tree, 'Plain Sign')
  checkInvariants(result, 'profanity tree')
  eq(result.answers['language.present'], true, 'profanity: strong language pre-filled Yes')
  ok(
    result.reasons['language.present'].evidence.some((e) => e.includes('Sign')),
    'profanity: evidence cites the TextLabel',
  )
}

// Purchase code without a policy check: paid-random-items is the user's call,
// respects-policy is provably No, trading is provably absent.
{
  const tree = wrap([
    inst('Script', 'Shop', {
      Source: src('local MarketplaceService = game:GetService("MarketplaceService")\nMarketplaceService:PromptProductPurchase(player, 12345)'),
    }),
  ])
  const result = prefillFromTree(tree, 'Tycoon')
  checkInvariants(result, 'purchase tree')
  eq(result.answers['randomItems.present'], undefined, 'purchase code: paid random items left to the user')
  ok(result.ambiguous['randomItems.present'] !== undefined, 'purchase code: flagged with the purchase evidence')
  eq(result.answers['randomItems.respectsPolicy'], false, 'no policy call -> respects-policy honestly No')
  eq(result.reasons['randomItems.respectsPolicy'].rule, 'policy-api-absent', 'policy absence rule id')
  eq(result.answers['trading.present'], false, 'purchase without trading -> trading No')
  eq(result.answers['trading.respectsPolicy'], false, 'no trading policy call -> honestly No')
}

// Policy API present: respects-policy is provably Yes, script cited.
{
  const tree = wrap([
    inst('Script', 'Shop', {
      Source: src(
        'local PolicyService = game:GetService("PolicyService")\nlocal info = PolicyService:GetPolicyInfoForPlayerAsync(player)\nif info.ArePaidRandomItemsRestricted then return end\ngame:GetService("MarketplaceService"):PromptProductPurchase(player, 1)',
      ),
    }),
  ])
  const result = prefillFromTree(tree, 'Tycoon Two')
  checkInvariants(result, 'policy tree')
  eq(result.answers['randomItems.respectsPolicy'], true, 'policy call found -> respects-policy Yes')
  eq(result.reasons['randomItems.respectsPolicy'].rule, 'policy-api-present', 'policy presence rule id')
  ok(
    result.reasons['randomItems.respectsPolicy'].evidence.some((e) => e.includes('Shop')),
    'policy evidence cites the script',
  )
}

// Auto-playing Sound: the media-feeds question covers auto-playing audio, so it
// must NOT silently pre-fill to No.
{
  const tree = wrap([inst('Sound', 'AmbientMusic', { Playing: { type: 'bool', value: true } })])
  const result = prefillFromTree(tree, 'Lobby')
  checkInvariants(result, 'autoplay tree')
  eq(result.answers['media.feeds'], undefined, 'autoplay sound: media feeds left to the user')
  ok(
    result.ambiguous['media.feeds'].evidence.some((e) => e.includes('AmbientMusic')),
    'autoplay sound: evidence cites the Sound',
  )
}

// The project TITLE is scanned too (Roblox classifies hangouts by title).
{
  const result = prefillFromTree(defaultBaseplateTree(), 'Chill Hangout Spot')
  checkInvariants(result, 'hangout title')
  eq(result.answers['hangout.primary'], undefined, 'hangout title: not pre-filled No')
  ok(
    result.ambiguous['hangout.primary'].evidence.some((e) => e.includes('project title')),
    'hangout title: evidence cites the title',
  )
}

// A script that talks to a generative AI service: user decides, never a silent No.
{
  const tree = wrap([
    inst('Script', 'NpcBrain', { Source: src('HttpService:PostAsync("https://api.openai.com/v1/chat/completions", body)') }),
  ])
  const result = prefillFromTree(tree, 'Talking NPC')
  checkInvariants(result, 'ai tree')
  eq(result.answers['ai.present'], undefined, 'genAI call: left to the user')
  ok(result.ambiguous['ai.present'] !== undefined, 'genAI call: flagged with evidence')
}

// TextBox = possible free-form creation -> ambiguous, not No.
{
  const result = prefillFromTree(wrap([inst('TextBox', 'GuestBook')]), 'Museum')
  checkInvariants(result, 'textbox tree')
  eq(result.answers['freeform.present'], undefined, 'TextBox: free-form left to the user')
}

// --- 6. staleness: tree hash ------------------------------------------------------

section('staleness')

{
  const tree = defaultBaseplateTree()
  const h1 = treeHash(tree)
  eq(treeHash(tree), h1, 'hash is deterministic')
  eq(treeHash(structuredClone(tree)), h1, 'hash depends on content, not identity')

  const renamed = structuredClone(tree)
  renamed.services[0].children[0].name = 'RenamedBaseplate'
  ok(treeHash(renamed) !== h1, 'renaming an instance changes the hash')

  const propChanged = structuredClone(tree)
  propChanged.services[0].children[0].props.Anchored = { type: 'bool', value: false }
  ok(treeHash(propChanged) !== h1, 'changing a property changes the hash')

  ok(treeHash(defaultBaseplateTree()) !== h1, 'two independent trees (fresh ids) hash differently')

  // The staleness rule the API + UI apply:
  const record = { treeHash: h1 }
  eq(record.treeHash !== treeHash(tree), false, 'unchanged tree -> record fresh')
  eq(record.treeHash !== treeHash(renamed), true, 'changed tree -> record stale, prompt retake')
}

// completeness helpers used by the flow gate
{
  ok(!isComplete({}), 'empty answers incomplete')
  ok(isComplete(BASE_NO), 'all-No complete')
  eq(unansweredQuestions({ ...BASE_NO, 'crude.present': true }), ['crude.level'], 'revealed follow-up reported')
}

// --- summary --------------------------------------------------------------------

process.stdout.write(`\n${checks} checks, ${failures.length} failures\n`)
if (failures.length > 0) {
  for (const f of failures.slice(0, 40)) process.stderr.write(`  ✗ ${f}\n`)
  if (failures.length > 40) process.stderr.write(`  … and ${failures.length - 40} more\n`)
  process.exit(1)
}
process.stdout.write('OK\n')
