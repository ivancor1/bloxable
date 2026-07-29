# DESIGN.md — Visual & Interaction Contract (v2, light system)

Builders implement exactly this. When something is unspecified, choose the quietest option.
v2 (2026-07-28): Ivan pivoted the chrome to a LIGHT system modeled on a reference
travel-search UI he supplied. The values below are not eyeballed — they were
extracted from that site's shipped CSS: **Inter** (+ JetBrains Mono), indigo
**#2C4FF0**, ink **#141821**, grays #9AA1AB/#DFE3E8, `border-radius: 18px` cards
and full pills, glass = `backdrop-filter: blur(16px) saturate(135%)`.

## Reference analysis (what we captured and why)

- **Type does the branding.** Inter with tight tracking (-0.02em) at 700 for the
  hero, 600 for names/values, 400 for body. Labels are small (11–12px) gray above
  larger semibold values — the two-tier "label over value" pattern.
- **One saturated color.** Indigo #2C4FF0 appears ONLY on primary actions and
  active states; green means "good" (Direct/Live), red means warnings. Everything
  else is grayscale on white. Color scarcity is what makes the button feel alive.
- **The liquid button.** Vertical gradient (lighter top → deeper bottom), an inset
  top highlight (rgba(255,255,255,.35)), an inset bottom shade, and a colored
  halo shadow (rgba(accent,.35)). Pressed = translateY(1px) + smaller halo.
- **Glass pills.** Secondary controls are translucent white (≈.72 alpha) with
  blur(16px) saturate(135%), a hairline neutral border, and an inset white top
  highlight — they read as physical chips over the cloud wash.
- **Cards.** White, 18–24px radius, hairline #E6E9F0 border, soft double shadow
  (tight 1px + wide diffuse). Hover: 2px lift + deeper shadow. Badges sit ON the
  card ("BEST"/"LIVE") as tiny glass pills.
- **Atmosphere.** A soft periwinkle cloud wash on white gives color without
  weight; content floats above it. Whitespace is generous; borders are scarce.
- **Dashed = create.** Dashed-border pills/tiles mark "add" affordances.

## Tokens (`app/globals.css`)

```
--bg #FFFFFF   --bg-soft #F6F8FA   --bg-overlay rgba(255,255,255,.72)
--border #E6E9F0   --border-strong #CAD0D8   --glass-border rgba(20,24,33,.08)
--text #141821   --text-dim #667085   --text-faint #9AA1AB
--accent #2C4FF0  --accent-deep #2340D8  --accent-bright #4A66F5  --accent-soft #EEF2FE
--accent-cloud #C9D2F8   --ok #16A34A   --err #CF4444   --warn #D97706
--radius-card 20px  --radius-panel 18px  --radius-control 10px  --radius-pill 999px
--shadow-card / --shadow-float / --shadow-accent   --glass-blur blur(16px) saturate(135%)
Fonts: Inter (UI), JetBrains Mono (code, ids, file names).
```

Liquid accent recipe (`.btn-accent`): `linear-gradient(180deg, #4A66F5, #2C4FF0 55%, #2340D8)`,
border #2340D8, `inset 0 1px 0 rgba(255,255,255,.35)`, `inset 0 -1px 0 rgba(0,0,0,.12)`,
halo `0 8px 20px rgba(44,79,240,.35)`; hover brightness(1.06); active translateY(1px).

Glass pill recipe (`.btn`, composer, dock, chips): `--bg-overlay` + `--glass-blur`,
border `--glass-border`, `inset 0 1px 0 rgba(255,255,255,.9)`.

## Pages

### Home `/` — the catalog

- Cloud-wash background (layered periwinkle radial gradients on white).
- Nav: logo mark (indigo gradient rounded square) + wordmark left; glass gear pill right.
- Hero: H1 44px/700/-0.025em ("What will you build today?"), then the **hero bar**:
  a large white pill (input 16px + liquid Create button). Typing a description and
  hitting Create mints a project named from the prompt and lands in the editor with
  that prompt auto-sent (`/p/<id>?prompt=…`). One motion from idea to building.
- Below: "N games" count + card grid (`auto-fill minmax(250px,1fr)`).
  Project card: pastel gradient cover (deterministic per id) with a LIVE glass
  badge when published, name (14.5px/600) + "Edited Xh ago". Whole card navigates.
  Last tile: dashed **New game** tile → focuses the hero bar.
- No projects → hero + the dashed tile only. No illustrations, no tour.

### Editor `/p/[id]`

Layout unchanged from v1 (sidebar 264px / viewport hero / floating top bar /
bottom composer+dock) but every surface flips light: white sidebar, glass pills
over the sky, white sheets. The 3D viewport (sky, sun, studs) provides the
color; chrome stays paper-light. Topbar scrim = white fade (85% → 0, 92px).
Publish = liquid accent. Undo/redo = icon buttons, disabled at zero. Play link
appears after first publish. Selection outline + gizmo accents = indigo.

## Chat rendering (unchanged semantics)

User bubble = `--accent-soft` (indigo-50), radius 14. Assistant = plain left text.
Tool chips = mono 12px pills (`--bg-soft`, hairline). Pending = spinner row
("Thinking…"). Errors verbatim in red chips. >6 chips collapse to "n changes".

## States

- Working: spinner accent-colored; chips fill in as tools land.
- Out of credits: modal, honest copy, disabled "Upgrade — payments not wired in this build".
- Publish: idle → "Publishing…" → "Live — version N" toast with play link, or the
  real error verbatim. Unconfigured → settings sheet opens.
- Settings sheet: **one field** — API key — plus a liquid Connect button. Universe
  and places are derived from the key (lib/roblox/discover.ts), then shown as a
  read-only "Connected — experience N, M places" status row with a green dot. A
  multi-universe key renders a picker. Manual IDs live behind an Advanced
  disclosure for the all-universes-scoped case only. Roblox errors verbatim.

## Keyboard

Cmd+K composer · Cmd+B sidebar · Cmd+Z / Shift+Cmd+Z undo/redo · Esc deselect → close sheet → collapse dock.

## Anti-checklist (do not add)

Dark chrome (the viewport is the only dark thing) · onboarding tours · tooltips
everywhere · illustrations in empty states · badges beyond LIVE · template
galleries · notifications · social/marketing anything.
