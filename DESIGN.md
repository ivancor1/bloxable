# DESIGN.md — Visual & Interaction Contract

Builders implement exactly this. When something is unspecified, choose the quietest option.

## Principles

- The game is the interface. The 3D viewport dominates; chrome recedes.
- Almost no words. Labels are one or two words. Full sentences appear only in errors and empty states, one line max.
- One accent color, used rarely: primary action, selection, focus.
- Nothing decorative. If a control doesn't create, manage, preview, or publish, it doesn't exist.
- Honesty: unfinished capabilities are labeled as such in the UI, never simulated.

## Tokens (define as CSS vars in `app/globals.css`)

```
--bg:          #0B0B0C   /* app base */
--bg-raised:   #111113   /* sidebar, sheets */
--bg-overlay:  rgba(17,17,19,0.85)  /* floating panels; pair with backdrop-blur 12px */
--border:      rgba(255,255,255,0.08)
--border-strong: rgba(255,255,255,0.15)
--text:        #EDEDEF
--text-dim:    #9A9AA1
--text-faint:  #5F5F66
--accent:      #FF5A47   /* coral-red, Roblox-adjacent */
--accent-hover:#FF7061
--ok:  #4ADE80   --err: #F87171   --warn: #FBBF24
```

Type: Geist Sans (already in scaffold); Geist Mono for file names, ids, and code. UI 13px, secondary 12px, chat 14px, code 12.5px, line-height comfortable. Radius: panels 12px, controls 8px, composer pill 999px. 1px borders everywhere; shadows only on floating layers (`0 8px 30px rgba(0,0,0,0.35)`).

## Layout — 100vh app, no page scroll

- **Sidebar**: 264px fixed left, `--bg-raised`, 1px right border. Collapsible (Cmd+B).
- **Main**: the three.js canvas fills the entire remaining area, edge to edge. The canvas IS the background.
- **Top bar**: floating row over the canvas, 48px, with a subtle dark-to-transparent scrim gradient (~88px tall) so text stays readable over the bright sky. Left: project name (`--text-dim`). Right: credits pill ("18 left") · Export · **Publish** (accent) · gear icon.
- **Composer**: floating pill, bottom center, width min(640px, 90%). Placeholder: `Describe your game…`. Send on Enter.
- **Transcript dock**: same width, stacked directly above the composer. Glass panel (`--bg-overlay` + blur), max-height 42vh, internal scroll, small collapse chevron. Shows the active thread. Opens on send.

## Sidebar contents (only these)

- Top: project switcher — current project name + chevron; menu lists projects + "New project".
- **Threads**: list rows (title, relative time). "+" to start new. Active row gets a 2px accent left tick.
- **Files**: tree of the real project — services at root (Workspace, Lighting, ReplicatedStorage, ServerScriptService, …), instances beneath, scripts shown with mono names (e.g. `Rounds.server.luau` style naming for display). Clicking a script opens a read-only code sheet from the right (mono, dark, Esc closes). No editing surface.
- Section labels: 11px uppercase, tracked wide, `--text-faint`. Exactly two labels: THREADS, FILES.

## Chat rendering

- User message: right-aligned bubble, `--bg-raised`, radius 12.
- Assistant: plain left-aligned text. No avatars, no names, no timestamps in the flow.
- Tool activity renders as one-line chips within the assistant turn: `+ 14 parts · Workspace`, `✎ RoundLoop (Script)`, `− 2 instances`. More than 6 chips collapses to `n changes`. While streaming: a single working row with a small spinner.
- Errors: `--err`-tinted chip carrying the real message (including verbatim Roblox API errors). Never a fake success.

## Viewer

- Sky: vertical gradient approximating the default Roblox sky (exact hexes from RESEARCH.md). The actual Baseplate part renders as the ground — no fake grid floor.
- Selection: click → accent outline; a small chip appears bottom-left of the canvas: `Name · ClassName` with ✕. The selection is attached to the next prompt as context; the composer shows a removable `@Name` chip.
- Camera: orbit drag, wheel zoom, shift-drag pan. WASD+right-drag fly if cheap to add.
- Target: 60fps at 5k parts (instancing allowed later; correctness first).

## States

- **No projects**: one centered card — name input (placeholder `Name your game`) + Create (accent). Nothing else on screen. The placeholder is load-bearing: without it the page reads as blank and gives a first-time user nothing to act on.
- **Empty thread**: composer only, no dock.
- **Out of credits**: modal — "You're out of free credits." / "Resets daily · 25/25 used" / disabled button labeled `Upgrade — payments not wired in this build`. Honest, minimal.
- **Publish**: idle → "Publishing…" → success toast `Live — version N` (with link to the experience) or error toast with the real message. If no Roblox connection configured, the settings sheet opens instead.

## Settings sheet (gear icon; the only settings surface)

Roblox connection only: API key (password field), Universe ID, Place ID, a "Where do I find these?" disclosure containing the exact steps (from RESEARCH.md), and a **Test connection** button that calls a real read endpoint and reports the real result. Server stores the key; it never reaches the client after save.

## Keyboard

Cmd+K focus composer · Cmd+B toggle sidebar · Esc deselect / close sheet / collapse dock.

## Anti-checklist (do not add)

Light theme · onboarding tours · tooltips everywhere · empty-state illustrations · badges · gradients on chrome · template galleries · notifications · marketing copy of any kind.
