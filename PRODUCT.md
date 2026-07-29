# Bloxable — Product Spec (LOCKED)

Working title **Bloxable** ("Lovable for Roblox"). The name is one constant — trivially renameable, and should be revisited before any public launch (Roblox brand rules around "blox"). Everything else in this file is locked.

Source: Ivan's spec, 2026-07-27. **Do not expand or reinterpret the product.** Creative freedom exists for technical implementation, architecture, and visual polish. It does NOT exist for new product features, workflows, pages, tools, or game-building systems. Do not build what you imagine a Roblox creation platform should be — build what is described here.

## What this is

A web app where a nontechnical person creates and modifies a REAL Roblox game primarily by describing what they want in an AI chat. It should feel like Lovable / Cursor / Codex — extremely simple, prompt-first, visually minimal, dark. The platform handles the technical work.

## The interface — exactly three areas

1. **Center** — the working view of the Roblox project being created: a real renderer of the real place data. Not a generic lookalike preview.
2. **Bottom** — the AI chat composer. Most project changes happen here, not through menus or coding tools.
3. **Left sidebar** — chat history / conversation threads + project files. Nothing else. Keep it simple.

## AI interaction model

The user says things like: "create a map", "add an NPC", "change this building", "add a game mechanic", "fix something that is not working." The AI makes the requested changes directly to the Roblox project via tools. Users never need to understand code, file structures, plugins, or Studio workflows. Manual code editing is never required for normal game-building tasks (read-only code viewing is acceptable).

## Roblox compatibility (the most important requirement)

- No invented engine, object system, asset format, building system, scripting language, or visual style.
- Real Roblox instance classes, real property names, real Luau, real place files.
- Official Roblox documentation and officially supported tools are the primary source of truth. Never guess how Roblox systems work — verified facts live in `RESEARCH.md`.
- Games built here must not look or behave differently simply because they were built here.
- **Never fake important Roblox integrations.** When a capability cannot be fully implemented, build the closest real foundation and clearly mark what is incomplete.

## Publishing — order of preference

1. Directly create/upload/publish/update the Roblox game from this platform (Open Cloud).
2. The closest officially supported workflow that keeps the user primarily outside Roblox Studio.
3. Export a fully compatible place file that opens in Roblox Studio, as fallback.

Clearly separate what works today from what requires Studio or another official tool.

## Usage & payment

Lovable-like: a limited number of free AI credits per day; after that, pay to continue. A functional usage-limit structure matters more than exact pricing. Payment wiring may be a stub, but it must be clearly labeled as not wired — never simulated.

## Visual direction

Dark theme. Clean, minimal, easy to understand, little text, no clutter, no excessive buttons, no complicated developer interface. Do not fill empty space. Only text and controls that help the user create, manage, preview, or publish. Details in `DESIGN.md`.

## Explicit non-goals

No dashboards, analytics, community features, tutorials, social features, marketplaces, marketing sections, onboarding tours, or template galleries.

## Definition of success

A nontechnical user can:

1. Work inside a simple, dark interface.
2. Describe a Roblox game or change through chat.
3. Have the AI modify the underlying Roblox-compatible project.
4. See the project in the central preview.
5. Access previous chats, threads, and project files from the left sidebar.
6. Continue modifying the game primarily through prompting.
7. Publish, update, or export through the most direct officially supported Roblox workflow.
8. Use a limited free AI allowance before being required to pay.
