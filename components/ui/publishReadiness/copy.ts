// Every user-facing string for the publish-readiness surface, in one file, so
// the words can be audited (and changed) without touching state logic. Rules
// these strings live by — they mirror lib/roblox/eligibility.ts, the source
// of truth this surface renders:
//
//   - Plain language a 12-year-old understands. Lead with what they CAN do.
//   - 'unknown' reads as "we don't know yet — here's how to find out",
//     never as failure.
//   - idVerified === false from Roblox means NOT CONFIRMED (a known API bug
//     under-reports it) — never "confirmed unverified".
//   - No creator age floor is stated in either direction. Roblox's docs for
//     16+ publishing list steps, not a creator age (the tier object carries
//     creatorAgeFloorDocumented: false); creatorAgeNote() takes that flag so
//     the copy flips cleanly if Roblox ever documents one.
//   - 2FA and the questionnaire are checkable by no app — say so and link
//     out; never infer.
//   - Fee-refund fine print is linked out, never hard-coded (Roblox's own
//     pages disagree on the timing).
//   - No workarounds, ever. If Roblox's flow says no, that is the answer.

export const SIDEBAR_LABEL = 'Publish readiness'

export const PANEL_TITLE = 'Publish readiness'
export const PANEL_SUB = 'What your Roblox account can do today — checked, never guessed.'

export const LOAD = {
  checking: 'Checking…',
  entryError: "Couldn't check",
  /** The real message renders verbatim next to this — DESIGN.md: errors verbatim. */
  errorLead: "We couldn't finish checking. Nothing is wrong with your game — the check itself failed:",
  retry: 'Try again',
} as const

// ---------------------------------------------------------------------------
// 16+ (age-checked players) — the open path. Lead with it.
// ---------------------------------------------------------------------------

export const SIXTEEN_PLUS = {
  title: 'Players 16+ (age-checked)',
  hookHeadline: 'You can publish this game to real players — and it takes less than most people think.',
  hookIntro:
    'To publish for players 16 and up (players whose age Roblox has checked), Roblox asks for exactly three things:',
  hookSteps: [
    'A Roblox account in good standing that is at least 2 days old.',
    'One age check — a quick face estimate, a phone number, or an ID. Any one of the three works.',
    "A short questionnaire about what's in your game, filled out in Roblox's Creator Hub.",
  ],
  pill: {
    eligible: 'Ready',
    'likely-eligible': 'Looking good',
    'needs-steps': 'Steps left',
    unknown: 'Not checked yet',
  },
  statusLine: {
    eligible: 'Every requirement Roblox documents is confirmed.',
    'likely-eligible':
      'Looking good — Roblox confirmed the big checks. Roblox still makes the final call when you publish.',
    'needs-steps': 'A few steps left. Every one of them is doable.',
    unknown: "We can't see enough to say yet. Nothing is wrong — the rows below say how to find out.",
  },
  factsTitle: 'What we could check',
  nextStepsTitle: 'Your next steps',
} as const

export const FACTS = {
  account: {
    label: 'Roblox account',
    notConnected:
      "Not connected yet — and that's normal. Bloxable asks to connect your Roblox account when you hit Publish, not before.",
    oauth: 'Connected. The checks below ran against your account.',
    studio: 'We used the account signed into Roblox Studio (reported by the Bloxable helper plugin).',
    idPrefix: 'Account ID',
  },
  accountAge: {
    label: 'Account age',
    oldEnough: (days: number) => `${days} days old — that covers Roblox's "at least 2 days" rule.`,
    tooNew: (days: number) =>
      `${days} ${days === 1 ? 'day' : 'days'} old. Roblox wants at least 2 days — this one fixes itself by waiting.`,
    unknown:
      "We don't know yet. Once a Roblox account is connected (or Studio is signed in with the helper plugin), we can read it.",
  },
  ageCheck: {
    label: 'Age check',
    confirmed: 'Roblox confirmed an age check on this account.',
    notConfirmed:
      'Roblox did not confirm an age check. That means "not confirmed" — not "failed": Roblox\'s own status is known to lag behind. If you already did one, check your Roblox settings; if not, any of the three methods works.',
    unknownNeedsConsent:
      "We can't see this yet. When you move to publish, Bloxable asks Roblox for one extra permission so it can check for real — it never guesses.",
    unknownError:
      "We couldn't check this right now. That says nothing about your account — the lookup just didn't happen.",
  },
  questionnaire: {
    label: 'Content questionnaire',
    text: "No app can read whether you've finished it — so we won't pretend to. You fill it out once in Roblox's Creator Hub.",
    linkLabel: "Roblox's publishing steps",
  },
} as const

/**
 * The creator-age answer. Roblox documents NO minimum creator age for 16+
 * publishing (verified in its primary docs, 2026-07-30), and the tier object
 * pins that as `creatorAgeFloorDocumented: false`. This copy therefore states
 * only what the documented steps are — it never asserts a floor OR the
 * absence of one as a promise. If Roblox later documents a floor, flipping
 * the flag flips the copy without touching any component.
 */
export function creatorAgeNote(documentedFloor: boolean): { title: string; body: string } {
  if (documentedFloor) {
    return {
      title: 'How old do you have to be?',
      body: "Roblox documents a minimum creator age for this tier — read its publishing docs (linked below) for the current rule before you plan around it.",
    }
  }
  return {
    title: 'How old do you have to be?',
    body: "Roblox's published steps for 16+ publishing are the three above — its docs don't list a separate minimum age for the creator, so we won't claim one either way. Roblox makes the final call inside its own publish flow, and whatever it says there is the real answer.",
  }
}

// ---------------------------------------------------------------------------
// Under-16 audiences — closed, and we say why instead of hiding it.
// ---------------------------------------------------------------------------

export const UNDER_16 = {
  title: 'Younger audiences — Roblox Select (9–15) and Kids (5–8)',
  pill: 'Closed for now',
  intro:
    "Straight answer: Roblox set a much higher bar for games aimed at younger players, and today it effectively closes this path. Its documented requirements:",
  // The requirement list itself renders verbatim from the tier object
  // (audiences.underSixteen.reasons) — one source of truth, no paraphrase.
  twoFactorText:
    "One of those is 2FA — and no app can check 2FA, not us, not anyone. See it yourself in your Roblox security settings.",
  twoFactorLinkLabel: 'Your Roblox security settings',
  premiumNote:
    "Roblox reports a Premium subscription on this account — that can matter for the fee alternative above. The exact terms are on Roblox's page below.",
  feeDetailsText:
    "The fee is refundable, and the play-count evaluation is tracked on Roblox's Audience Reach dashboard. For the exact refund terms and timing, read Roblox's own page:",
  feeDetailsLinkLabel: 'Kids & Select publishing — Roblox docs',
  noWorkaround:
    "There's no trick around any of this, and Bloxable will never help look for one. Faking a verification — with anyone's ID — breaks Roblox's rules and can cost the whole account.",
} as const

// ---------------------------------------------------------------------------
// Footer — whose game this is, and where our facts come from.
// ---------------------------------------------------------------------------

export const FOOTER = {
  assistive:
    'Bloxable helps you build. The game is yours — it publishes from your Roblox account, under your name, and Roblox always has the final say.',
  docsTitle: 'Straight from Roblox',
  docLabels: {
    publishing: 'Publishing games and places',
    accountVerification: 'Account verification & age checks',
    kidsAndSelect: 'Kids & Select audiences',
  },
  checkedPrefix: 'Checked',
  checkAgain: 'Check again',
} as const
