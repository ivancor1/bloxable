# Bloxable — Agent Rules

Read before touching code: `PRODUCT.md` (locked spec) · `DESIGN.md` (visual contract) · `ARCHITECTURE.md` (ownership + contracts) · `RESEARCH.md` (verified Roblox facts, when present).

@AGENTS.md — this Next.js (16.2) may differ from your training data; read `node_modules/next/dist/docs/` guides before writing App Router code.

1. Real Roblox ecosystem only: exact class names, exact property names, real Luau, real place files. Never invent formats or fake integrations. If a capability isn't real yet, build the honest foundation and label it incomplete in the UI.
2. Do not add product surface (pages, features, sections, controls) beyond PRODUCT.md. When in doubt, leave it out.
3. Respect module ownership in ARCHITECTURE.md. `lib/rbx/types.ts` and `lib/protocol.ts` are LOCKED contracts — report friction instead of drifting.
4. UI follows DESIGN.md tokens and layout exactly. Dark only. Minimal text.
5. `data/` is runtime state (gitignored). The Roblox API key is server-only — never send it to the client. Never commit secrets.
6. Roblox facts come from RESEARCH.md citations, not memory.
