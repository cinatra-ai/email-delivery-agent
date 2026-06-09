# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- JSON — agent flow definition (`cinatra/oas.json`), package manifest (`package.json`)
- Markdown — skill instructions (`skills/email-delivery/SKILL.md`)

**Secondary:**
- TypeScript — tsconfig.json is present and targets `src/` but no `src/` directory exists yet; the agent is a content-only extension with no tracked TS sources at this time
- JavaScript (ESM) — `extension-kind-gate.mjs` (self-contained CI validation script, no external dependencies)

## Runtime

**Environment:**
- Node.js 24 (pinned in `.github/workflows/ci.yml`)

**Package Manager:**
- pnpm via corepack (enforced in CI with `corepack enable` + `corepack pnpm`)
- Lockfile: not present (CI runs `--no-frozen-lockfile`; standalone install is skipped because the package declares host-internal `@cinatra-ai/*` peers)

## Frameworks

**Core:**
- Cinatra agentspec v26.1.0 — agent flow runtime; the agent is declared as a `Flow` with `StartNode`, `ApiNode`, and `EndNode` components (`cinatra/oas.json`)
- WayFlow — execution host that mounts this agent and enforces `max_steps` on the `ApiNode`

**Testing:**
- Not applicable — no test scripts or test files present; tests run inside the Cinatra monorepo

**Build/Dev:**
- TypeScript compiler (tsc) — configured via `tsconfig.json`, targets ES2023/ESNext with `bundler` module resolution; no `src/` sources currently exist so tsc is skipped in CI
- `extension-kind-gate.mjs` — zero-dependency validation gate run in CI to scan `cinatra/oas.json` for retired agentspec primitives

## Key Dependencies

**Critical:**
- `@cinatra-ai/*` packages — declared as optional peerDependencies (not devDependencies); resolved exclusively by the Cinatra monorepo, not installable standalone
- OpenAI GPT-5.5 — preferred LLM provider/model declared in `cinatra/oas.json` metadata and used by the `ApiNode` via the Cinatra LLM bridge

**Infrastructure:**
- `{{CINATRA_BASE_URL}}/api/llm-bridge` — HTTP POST endpoint the `ApiNode` calls at runtime; URL is a runtime-injected template variable

## Configuration

**Environment:**
- `CINATRA_BASE_URL` — runtime template variable injected into the `ApiNode` URL; controls which Cinatra instance the agent calls
- `.env` / `.env.*` — not present in repo
- `.npmrc` — present; note existence only, contents not read

**Build:**
- `tsconfig.json` — strict TypeScript, ES2023 target, `bundler` moduleResolution, outputs to `dist/`, roots at `src/`
- `cinatra/oas.json` — primary agent specification; defines flow shape, nodes, data-flow edges, inputs/outputs, LLM preference, and HITL screen renderer

## Platform Requirements

**Development:**
- Node.js 24
- pnpm (via corepack)
- Cinatra monorepo workspace — required for type-checking and testing because `@cinatra-ai/*` peers are not published to any registry

**Production:**
- Cinatra WayFlow runtime — mounts the agent via the `cinatra/oas.json` flow definition
- OpenAI API access — agent requests GPT-5.5 via the Cinatra LLM bridge

---

*Stack analysis: 2026-06-09*
