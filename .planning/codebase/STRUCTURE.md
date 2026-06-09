# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
email-delivery-agent/
├── cinatra/
│   └── oas.json              # WayFlow agent manifest (flow graph, nodes, I/O schema)
├── skills/
│   └── email-delivery/
│       └── SKILL.md          # LLM step-by-step instructions for the send agent
├── .github/
│   └── workflows/
│       ├── ci.yml            # Standalone CI: classify repo, typecheck, test, pack, kind-gate
│       └── release.yml       # Release workflow
├── extension-kind-gate.mjs   # Self-contained CI gate: OAS/BPMN validation (no deps)
├── package.json              # Package manifest with cinatra.kind = "agent"
├── tsconfig.json             # TypeScript config (for gate script; no TS sources in repo)
├── .npmrc                    # npm registry config
└── README.md                 # Project readme
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Cinatra platform artifacts consumed directly by the WayFlow runtime.
- Contains: `oas.json` — the declarative agent flow manifest.
- Key files: `cinatra/oas.json`

**`skills/email-delivery/`:**
- Purpose: Agent skill definition. The LLM bridge loads `SKILL.md` as authoritative instructions.
- Contains: `SKILL.md` — numbered steps, error codes, polling caps, output schema, known limitations, architecture context.
- Key files: `skills/email-delivery/SKILL.md`

**`.github/workflows/`:**
- Purpose: GitHub Actions CI/CD pipelines.
- Contains: `ci.yml` (baseline + kind-specific gate), `release.yml` (package release).
- Key files: `.github/workflows/ci.yml`

## Key File Locations

**Entry Points:**
- `cinatra/oas.json`: WayFlow flow definition — the runtime entry point. `start_node.$component_ref: "start"` is the execution entry.
- `extension-kind-gate.mjs`: CI entry point. `main()` at line 365 is invoked by `node extension-kind-gate.mjs --package-root .`.

**Configuration:**
- `package.json`: Package identity (`@cinatra-ai/email-delivery-agent`), `cinatra.kind: "agent"`, `cinatra.apiVersion: "cinatra.ai/v1"`.
- `tsconfig.json`: TypeScript configuration (present for the gate script; no application TS sources exist in this repo).
- `.npmrc`: npm/pnpm registry configuration. (Existence noted — contents not read.)

**Core Logic:**
- `cinatra/oas.json`: All agent flow logic (nodes, data-flow wiring, LLM prompt strings).
- `skills/email-delivery/SKILL.md`: All LLM behavioral logic (steps 1–4, error handling, polling strategy).

**CI:**
- `.github/workflows/ci.yml`: Two-job pipeline: `build` (classify, install, typecheck, test, pack) and `kind-gates` (OAS validation via `extension-kind-gate.mjs`).
- `extension-kind-gate.mjs`: Self-contained validator. Exported functions: `validateAgent`, `validateWorkflow`, `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`, `parseArgs`.

## Naming Conventions

**Files:**
- Cinatra platform artifacts: lowercase with extension matching type (`oas.json`, `workflow.bpmn`).
- Skills: `SKILL.md` (uppercase, Markdown) inside a subdirectory named after the skill (`email-delivery/`).
- CI gate script: kebab-case `.mjs` (`extension-kind-gate.mjs`).
- Workflows: kebab-case `.yml` (`ci.yml`, `release.yml`).

**Directories:**
- Platform artifacts directory: `cinatra/` (lowercase, singular).
- Skills directory: `skills/<skill-name>/` (lowercase, kebab-case).

## Where to Add New Code

**New LLM instructions or behavioral changes:**
- Edit `skills/email-delivery/SKILL.md`.

**New flow inputs/outputs or node changes:**
- Edit `cinatra/oas.json`. Update `inputs`, `outputs`, `$referenced_components`, `data_flow_connections`, and `control_flow_connections` as needed.

**Additional CI validation rules:**
- Add banned primitives or typehints to `extension-kind-gate.mjs` (`BANNED_PRIMITIVES` or `BANNED_TYPEHINTS` arrays).

**No application source files belong in this repo.** This is a content-only agent extension — business logic (use case implementations, email sending, dev-mode redirect) lives in the upstream Cinatra monorepo, not here.

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents (ARCHITECTURE.md, STRUCTURE.md, etc.).
- Generated: Yes (by GSD mapping agents).
- Committed: Up to operator preference; not part of the extension package payload.

**`cinatra/`:**
- Purpose: Cinatra platform manifest directory. Consumed at publish time by the marketplace and at runtime by WayFlow.
- Generated: No (hand-authored / maintained).
- Committed: Yes — required for the package to mount in WayFlow.

**`skills/`:**
- Purpose: Agent skill definitions loaded by the LLM bridge.
- Generated: No.
- Committed: Yes — required for correct LLM behavior.

---

*Structure analysis: 2026-06-09*
