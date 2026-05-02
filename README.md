# readme clew

audit your own receipts.

A stateless web tool for self-taught developers to audit their own GitHub repos. Paste a public GitHub URL. Clew extracts every factual claim your README makes, then verifies each one against your actual code. Returns findings in four buckets: verified, unverifiable, missing, contradicted.

Findings only. No rewrites. No grading. Nothing saved.

Built for the Replit 10 Year Buildathon, May 2-3 2026.

## What it checks

1. Declared dependencies — README says a package is used, we check package.json
2. Install and run commands — README documents a script, we verify it exists
3. Environment variables — README mentions an env var, we check code reads it
4. File and URL references — README points to a path or link, we verify it resolves
5. Code-vs-package coverage — imports in code cross-referenced with declared deps

## What it does not check

- Private repos (public only in v1)
- Runtime claims ("85 tests passing" requires running tests)
- Subjective claims ("blazingly fast" is not checkable)
- Non-JavaScript repos (JS/TS only in v1)
- Writing quality

## Setup

Set both secrets before running:

- `ANTHROPIC_API_KEY` — Claude API key for claim extraction
- `GITHUB_PAT` — GitHub personal access token (raises rate limit to 5,000/hr)

## Project layout

The server and frontend live in `artifacts/api-server/`. See `artifacts/api-server/package.json` for dependencies.

```
artifacts/api-server/src/     — Express server, TypeScript
artifacts/api-server/public/  — Vanilla HTML, CSS, JS frontend
fixtures/                     — Extraction prompt test fixtures
```

## Run

```bash
pnpm --filter @workspace/api-server run dev
```

## Test extraction prompt against fixtures

```bash
pnpm --filter @workspace/api-server run test:fixtures
```

## Architecture

Hybrid deterministic + AI. Claude extracts claims from the README (one API call per scan). Five deterministic verifiers check those claims against real repo data from the GitHub API. Nothing stored between requests.

## Environment variables read by this project

- `ANTHROPIC_API_KEY` — required for Claude API calls in `artifacts/api-server/src/extract.ts`
- `GITHUB_PAT` — optional but recommended, read in `artifacts/api-server/src/github.ts`

## References

- `artifacts/api-server/package.json` — server dependencies
- `artifacts/api-server/public/index.html` — frontend entry point
- `fixtures/run-extraction-tests.js` — extraction test runner
