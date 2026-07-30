# Installer trust plan — packaging, signing, and the no-silent-behavior contract

Bloxable's audience is the Roblox community, where a random desktop `.exe` reads as a
cookie-stealer until proven otherwise — and "proven otherwise" is earned with
transparency, not assertions. This document is the honest state of the world and the
plan: what exists today, what a signed desktop build actually requires, what the
install-time screen will say, and the guarantees any installer we ship must keep.
Nothing here is scaffolded or faked in the repo — there is no placeholder installer,
because a fake installer is exactly the trust failure this plan exists to avoid.

## Current state (2026-07-30)

- Bloxable is a **local-first Next.js web app**. It runs with `npm install`,
  `npm run setup`, `npm run dev` and is used in the browser at `localhost`.
- There is **no desktop packaging** — no Electron, no Tauri, no installer artifacts,
  and therefore nothing to sign yet. Claiming a "signed installer" today would be a
  lie; this document is the plan for making it true.
- The one thing that ever leaves the app's own folder is the optional Studio helper
  plugin (`plugin/BloxableHelper.luau`), and only through the explicit-consent flow:
  the app shows what the plugin does, what it never does, its full source verbatim,
  and the exact destination path **before** the Install button does anything
  (`components/ui/HelperPluginConsent.tsx` → `POST /api/studio-plugin/install`).
  Removal is one click (`POST /api/studio-plugin/remove`) or deleting the file by
  hand — the UI prints the path either way.

## What a signed desktop build requires

### macOS

| Requirement | Reality |
| --- | --- |
| Apple Developer Program | $99/year, real legal identity (person or company). |
| Developer ID Application certificate | Issued through the program; signs the `.app` outside the Mac App Store. |
| Hardened runtime + `codesign` | Sign every binary in the bundle — including our pinned `rojo` and `lune` helper binaries — with the hardened runtime and any needed entitlements. |
| Notarization | Submit the signed artifact with `notarytool`, then staple the ticket. Without it, Gatekeeper shows the "unidentified developer" scare screen — the exact screen that costs us the community's trust. |
| Distribution | Signed + notarized `.dmg` or `.pkg`. |

### Windows

| Requirement | Reality |
| --- | --- |
| Authenticode certificate (OV) | ~$100–400/year. SmartScreen reputation builds slowly with download volume — early users still see "Windows protected your PC". |
| Authenticode certificate (EV) | ~$300–600/year, hardware token or cloud signing (e.g. Azure Trusted Signing). Immediate SmartScreen reputation — this is the one that actually removes the scare screen on day one. |
| `signtool` in CI | Every shipped `.exe`/`.msi`/MSIX gets signed, including bundled helper binaries. |
| Microsoft Store (alternative) | MSIX package; the Store handles signing and identity. Slower iteration, but the strongest "this is not a trojan" signal Windows offers. |

### Packaging technology (decision needed)

Bloxable is not a static page: it needs a Node.js runtime for the Next server, disk
access for `data/`, and the ability to spawn the pinned `rojo`/`lune` binaries. The
two credible options:

- **Electron** — bundles Node outright; the Next server runs in-process or as a child.
  Bigger download (~100 MB+), the very artifact shape the community distrusts most,
  so signing + notarization become non-negotiable.
- **Tauri** — smaller shell, but the Next server and rojo/lune must ship as sidecar
  binaries (each of which must also be signed/notarized).

Either way, **all tool downloads move to build time**: the packaged app ships with
`rojo`, `lune`, and the API dump inside the bundle. The installed app must never
fetch tools on first run the way `npm run setup` does for developers.

## The install-time explanation screen (draft)

Shown before anything is written, in plain language. This reuses the shipped consent
copy from `components/ui/HelperPluginConsent.tsx`, which is the same standard the
installer must meet:

> **Bloxable is about to be installed.**
>
> Here is everything that happens, before it happens:
>
> - Bloxable is copied into your Applications folder (macOS) or Program Files
>   (Windows). That is the only copy.
> - Bloxable runs **only when you open it**. It does not start with your computer,
>   does not install any background service, and does not check for updates without
>   telling you.
> - Everything you build is saved **on this computer**, in Bloxable's own folder.
>   Nothing is uploaded anywhere unless you press Publish or Send to Roblox.
> - Bloxable **never asks for your Roblox password or cookies**, and never reads
>   them. Publishing uses Roblox's official sign-in page (OAuth) or an API key you
>   paste yourself.
> - The optional **Studio helper plugin is NOT installed now.** If you ever want it,
>   Bloxable will show you what it does, its complete code, and the exact file path —
>   and install it only when you click Install. It answers one question — *which
>   Roblox account is signed into Studio?* — by sending that account's public user ID
>   to Bloxable on this computer. No cookies, no passwords, no login tokens, no
>   reading your games, no internet — it talks to this computer only. Removing it is
>   one click, or delete the one file yourself.
> - Uninstalling Bloxable is the standard way on your system (drag to Trash /
>   Add & Remove Programs) and removes what was installed. The uninstaller lists any
>   file it leaves behind (your saved games) and where the helper plugin lives if you
>   installed it.

## No-silent-behavior guarantees the installer must keep

These hold in the web app today (see the audit in PR "Installer trust") and are the
bar for any packaged build:

1. **No autostart.** No login items, launch agents/daemons, registry Run keys, or
   scheduled tasks. Bloxable runs when opened and stops when closed.
2. **No background services.** Nothing survives quitting the app. The local server
   dies with the window.
3. **No silent network traffic.** At runtime the app calls external services only on
   explicit user action (Publish, Send to Roblox, Connect, chat — each documented).
   The packaged build sets `NEXT_TELEMETRY_DISABLED=1` so Next.js's anonymous
   telemetry never runs on a user machine, and ships with no analytics of any kind.
4. **No silent writes outside its own folders.** The single exception is the Studio
   helper plugin, which is written only through the consent flow above, to a path
   shown in advance, with one-click removal.
5. **Visible uninstall.** Standard OS uninstall for the app itself; in-app one-click
   removal for the helper plugin; every path the app writes is documented (app data,
   the helper plugin file).
6. **No self-updating without consent.** If an updater ever ships, it asks first,
   shows what changed, and can be turned off. Until then: no updater.
7. **Signed, or clearly labeled.** Every shipped binary is signed and (on macOS)
   notarized. If we ever distribute an unsigned dev build, it is labeled as exactly
   that — never presented as a release.

## Decisions needed (tracked in the "Desktop packaging + code signing" issue)

1. Legal identity to sign under (personal vs LLC) — affects both cert purchases.
2. Apple Developer Program enrollment ($99/yr) — prerequisite for any macOS story.
3. Windows path: EV Authenticode (~$300–600/yr, instant SmartScreen reputation) vs
   OV (cheaper, months of scare screens) vs Microsoft Store (strongest signal,
   slowest iteration) — or Store + EV both.
4. Electron vs Tauri, given the Node server + rojo/lune sidecar requirement.
5. CI signing infrastructure (where certs/tokens live, who can cut a release).
