# README Clew

## What this is

README Clew is a stateless web tool for self-taught developers to audit their own GitHub repos. Paste a public GitHub URL. Clew extracts every factual claim from the README using Claude, then deterministically verifies each claim against the actual code. Returns findings in four buckets: verified, unverifiable, missing, contradicted.

**Findings only. No rewrites. No grading. Nothing saved.**

Built for the Replit 10 Year Buildathon, May 2-3 2026.

## Stack (locked)

- **Server**: Node.js + Express 5, TypeScript, esbuild
- **Frontend**: Vanilla HTML + CSS + JS (no framework)
- **LLM**: Claude Sonnet 4.5 via `@anthropic-ai/sdk`
- **Code parsing**: regex + acorn (installed, used for future AST work)
- **Hosting**: Replit Deployments

## Required secrets

Set both in Replit Secrets before scanning:

- `ANTHROPIC_API_KEY` — Claude API key (for claim extraction)
- `GITHUB_PAT` — GitHub personal access token (for 5,000 req/hr instead of 60)

## Project structure

```
artifacts/api-server/
├── src/
│   ├── app.ts              ← Express setup, static serving, routes
│   ├── index.ts            ← server entry point
│   ├── validate.ts         ← GitHub URL validation
│   ├── github.ts           ← GitHub API: readme, package.json, file tree, source files
│   ├── extract.ts          ← Claude API: claim extraction
│   ├── orchestrator.ts     ← runs all 5 verifiers, aggregates results
│   ├── routes/
│   │   ├── health.ts       ← GET /api/healthz
│   │   └── scan.ts         ← POST /api/scan (rate-limited: 10/hr per IP)
│   └── verifiers/
│       ├── types.ts        ← shared types (Claim, Finding, RepoData, etc.)
│       ├── dependencies.ts ← check README dep claims vs package.json
│       ├── commands.ts     ← check README script claims vs package.json scripts
│       ├── references.ts   ← check file refs (file tree) and URL refs (HEAD request)
│       ├── envvars.ts      ← check env var claims vs process.env.* in source files
│       └── coverage.ts     ← check code-vs-package coverage claims
└── public/
    ├── index.html          ← three-state SPA: landing, loading, results
    ├── style.css           ← design tokens, layout, all components
    ├── app.js              ← state machine, form handling, results rendering
    └── cover-artwork.jpg   ← illuminated manuscript cover art

fixtures/
├── 01-clean-minimal.md ... 10-edge-malformed.md
├── expected/01.json, 06.json, 07.json
└── run-extraction-tests.js  ← node fixtures/run-extraction-tests.js
```

## API

### POST /api/scan

```json
{ "repoUrl": "github.com/owner/repo" }
```

Response:
```json
{
  "verified":      [{ "category", "claimText", "verbatimQuote", "evidence" }],
  "unverifiable":  [...],
  "missing":       [...],
  "contradicted":  [...],
  "meta": { "owner", "repo", "claimsExtracted", "extractionError?" }
}
```

## Key commands

```bash
# Full typecheck
pnpm run typecheck

# Build + start server
pnpm --filter @workspace/api-server run dev

# Run fixture extraction tests (requires ANTHROPIC_API_KEY)
node fixtures/run-extraction-tests.js

# Self-scan (after server is running)
curl -X POST localhost:80/api/scan \
  -H "Content-Type: application/json" \
  -d '{"repoUrl":"https://github.com/earlgreyhot1701D/readme-clew"}'
```

## Design system

See `attached_assets/01-DESIGN-BRIEF.md` for full tokens, layout primitives, and QA checklist.
Palette: parchment paper (#F4EFD9), ink blue (#1E3A8A), rubrication gold (#C8A24B), teal verified (#00838A), gold missing (#FFB511), oxblood contradicted (#993556).

## Build phases

- Phase 1 (done): Backend skeleton, GitHub fetch, Express server, static frontend serving
- Phase 2 (done): Claim extraction via Claude (extract.ts + system prompt)
- Phase 3 (done): Five verifiers (dependencies, commands, references, envvars, coverage)
- Phase 4 (done): Frontend (landing/loading/results states, marginal-gloss layout)
- Phase 5: Polish, edge cases, 11-point pre-deploy checklist
- Phase 5.5: Public deploy via Replit Deployments
- Phase 6: Demo + submission
