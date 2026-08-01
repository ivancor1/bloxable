#!/usr/bin/env node
// Pins the published-game finder (lib/roblox/published.ts): the name/time
// matcher that identifies the game the user just published from Studio, the
// paste-input parser (only shapes Roblox itself hands out), and the share
// link. The live endpoints behind fetchUserGames/verifyPlace were verified
// against Roblox on 2026-07-31 (games.roblox.com/v2 users games,
// apis.roblox.com place→universe, games.roblox.com/v1 games) — these tests
// stay pure so the suite never depends on the network.
//
// Same TS-resolve hook as test-engine.mjs.

import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL)
      if (!/\.[a-z]+$/i.test(url.pathname)) {
        for (const ext of ['.ts', '/index.ts']) {
          if (existsSync(fileURLToPath(url) + ext)) return nextResolve(specifier + ext, context)
        }
      }
    }
    return nextResolve(specifier, context)
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
  if (actual !== expected) failures.push(`${message} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

function section(title) {
  process.stdout.write(`\n— ${title}\n`)
}

const { matchPublishedGame, parsePlaceIdInput, shareLink } = await import('../lib/roblox/published.ts')

// --- share link ----------------------------------------------------------------

section('share link')
eq(shareLink('123456789'), 'https://www.roblox.com/games/start?placeId=123456789', 'start deep link')

// --- matcher -------------------------------------------------------------------

section('published-game matcher')

const T0 = '2026-07-31T12:00:00.000Z'
const game = (over) => ({
  universeId: 'u1',
  rootPlaceId: 'p1',
  name: 'Sword Arena',
  created: '2026-07-31T12:10:00.000Z',
  updated: '2026-07-31T12:10:00.000Z',
  ...over,
})
const args = { acceptableNames: ['Sword Arena', 'Sword Arena'], since: T0 }

eq(matchPublishedGame([game()], args)?.rootPlaceId, 'p1', 'exact name, after since → found')
eq(matchPublishedGame([game({ name: 'sword arena' })], args)?.rootPlaceId, 'p1', 'case-insensitive')
eq(matchPublishedGame([game({ name: '  Sword   Arena ' })], args)?.rootPlaceId, 'p1', 'whitespace-normalized')
eq(matchPublishedGame([game({ name: 'Sword Arena 2' })], args), null, 'different name → null')
eq(matchPublishedGame([], args), null, 'no games → null')

// The filename-safe form is acceptable too — Studio titles the experience
// after the .rbxl file, which went through safeFilename.
const fancy = { acceptableNames: ["Sword Arena: Zack's!", 'Sword Arena Zacks'], since: T0 }
eq(
  matchPublishedGame([game({ name: 'Sword Arena Zacks' })], fancy)?.rootPlaceId,
  'p1',
  'safeFilename variant matches',
)

// Time window: older than since (minus slack) is someone's OLD game, not this publish.
eq(
  matchPublishedGame([game({ created: '2026-07-30T00:00:00.000Z', updated: '2026-07-30T00:00:00.000Z' })], args),
  null,
  'stale game rejected',
)
// ...but a fresh UPDATE to an old experience counts (re-publish into it).
eq(
  matchPublishedGame(
    [game({ created: '2026-07-01T00:00:00.000Z', updated: '2026-07-31T12:15:00.000Z' })],
    args,
  )?.rootPlaceId,
  'p1',
  'old experience with fresh update counts',
)
// Slack: created 3 minutes BEFORE since still passes (clock drift, publish-before-eject-stamp).
eq(
  matchPublishedGame(
    [game({ created: '2026-07-31T11:57:00.000Z', updated: '2026-07-31T11:57:00.000Z' })],
    args,
  )?.rootPlaceId,
  'p1',
  '5-minute slack honored',
)

// Newest match wins when several qualify.
eq(
  matchPublishedGame(
    [
      game({ rootPlaceId: 'older', created: '2026-07-31T12:05:00.000Z', updated: '2026-07-31T12:05:00.000Z' }),
      game({ rootPlaceId: 'newer', created: '2026-07-31T12:20:00.000Z', updated: '2026-07-31T12:20:00.000Z' }),
    ],
    args,
  )?.rootPlaceId,
  'newer',
  'newest qualifying match wins',
)

// Garbage input never throws.
eq(matchPublishedGame([game()], { acceptableNames: ['Sword Arena'], since: 'not-a-date' }), null, 'bad since → null')
eq(
  matchPublishedGame([game({ created: '', updated: '' })], args),
  null,
  'game with no parsable dates → rejected, not crashed',
)

// --- paste parser ---------------------------------------------------------------

section('paste parser')

eq(parsePlaceIdInput('123456789'), '123456789', 'bare id')
eq(parsePlaceIdInput('  123456789  '), '123456789', 'trimmed')
eq(parsePlaceIdInput('12'), null, 'too short to be a place id')
eq(
  parsePlaceIdInput('https://www.roblox.com/games/6504969480/Crossroads-but-with-a-million'),
  '6504969480',
  'game page URL',
)
eq(parsePlaceIdInput('https://www.roblox.com/games/6504969480'), '6504969480', 'game page URL, no slug')
eq(
  parsePlaceIdInput('https://www.roblox.com/games/start?placeId=6504969480&launchData=x'),
  '6504969480',
  'start deep link with extra params',
)
eq(parsePlaceIdInput('https://roblox.com/games/start?placeId=6504969480'), '6504969480', 'bare-domain start link')
eq(parsePlaceIdInput('https://evil.com/games/123456?placeId=123456'), null, 'non-roblox host rejected')
eq(parsePlaceIdInput('https://ro.blox.com/Ebh5?x=1'), null, 'short link rejected (redirect, not followed blind)')
eq(parsePlaceIdInput('https://www.roblox.com/users/261/profile'), null, 'non-game roblox URL rejected')
eq(parsePlaceIdInput('my cool game'), null, 'prose rejected')
eq(parsePlaceIdInput(''), null, 'empty rejected')

// --- report ------------------------------------------------------------------

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} of ${checks} checks failed:\n`)
  for (const failure of failures) process.stdout.write(`  ✗ ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${checks} checks passed\n`)
