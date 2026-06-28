# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A QA automation suite that tests **OWASP Juice Shop** (a deliberately insecure e-commerce app, run as the system under test) across four layers — UI, API, database, and security regression — using Playwright + TypeScript, with an OWASP ZAP DAST scan in CI.

The authoritative design document is **`docs/test-strategy.md`** — read it before doing substantive work. It defines scope, the risk matrix, and the reasoning behind the decisions below. `docs/security-regression.md` specifies the five curated security cases in full (with example code).

## Current state: scaffold vs. documented design

**This repo is mostly scaffold.** The README and `docs/` describe a complete suite, but only the structure and one smoke test (`tests/ui/smoke.spec.ts`) are actually committed. When building features out, the docs are the spec for *what* to build; do not assume the following already exist:

- `src/pages`, `src/fixtures`, `src/api`, `src/schemas` contain only `.gitkeep` — no Page Objects, fixtures, API clients, or Zod schemas yet.
- `tests/security/` is **not committed**, yet `playwright.config.ts` and `.github/workflows/ci.yml` both reference it. Its tests are fully specified in `docs/security-regression.md`.
- `.env.example` is referenced by the README but is **not committed**.
- `package.json` `scripts` is **empty** — there is no `npm test` or `npm run lint`. Run Playwright via `npx` directly. CI's lint job calls `npm run lint` (expects eslint), which will fail until that script is added.
- `postman/collection.json` exists and the docs lean on Newman, but **CI has no Newman step** — the API collection is not wired into any pipeline yet.

The seed credentials and helpers the planned tests rely on are in `docs/security-regression.md`: regular user `jim@juice-sh.op` / `ncc-1701`, and `src/fixtures/auth.ts` helpers (`loginAsUser`, `loginViaUi`).

## Commands

```bash
docker compose up -d                         # start Juice Shop on :3000 (pinned bkimminich/juice-shop:v20.0.0)
npm ci && npx playwright install --with-deps  # install deps + browsers

npx playwright test                          # run everything
npx playwright test --project=ui             # one project: ui | api | db | security
npx playwright test tests/ui                 # one layer by path
npx playwright test tests/ui/smoke.spec.ts   # one file
npx playwright test --grep "home page"       # one test by title
npx playwright show-report                   # open the HTML report
docker compose down                          # stop the app
```

`BASE_URL` (default `http://localhost:3000`) overrides where tests point. Tests should use **relative paths** so this works; note `tests/ui/smoke.spec.ts` currently hardcodes the absolute URL.

## Architecture

**Four Playwright projects** in `playwright.config.ts`, each bound to a `testDir`: `ui` and `security` launch Desktop Chrome; `api` and `db` run without a browser (HTTP via the request fixture / SQLite file reads). CI runs the gating functional layers (`ui api db`) separately from the informational `security` layer.

**Serial execution is deliberate.** `workers: 1, fullyParallel: false` — Juice Shop is single-user-per-instance, so parallel workers against one running app corrupt shared state (baskets, score board). To scale, shard with **one container per shard**; do not raise the worker count.

**Test-data strategy hinges on the reseed.** Juice Shop wipes and repopulates its DB on every restart, so a fresh container per run gives deterministic, known-good data. Consequences: no test may assume state survives a restart; read paths use documented seed entities, write paths create their own data via the API for isolation.

**Database layer reads a copy, not the live file.** Do **not** bind-mount Juice Shop's data dir (it shadows seed files the app needs at boot). Instead the db fixture copies the SQLite file out of the container and reads the copy — see the worked command and path caveats in `docker-compose.yml`.

**Security tests are paired (A/B).** Each case is written twice: **(A)** a confirmation test asserting the vulnerability is present (passes against stock Juice Shop, informational only) and **(B)** a target-state spec asserting the secure behavior, marked `test.fail()` — currently an expected failure that flips green the day the issue is fixed. Full convention and per-case code in `docs/security-regression.md`.

## CI (`.github/workflows/ci.yml`)

Jobs: `lint` (gating) → `functional-tests` (gating: ui+api+db) · `security-tests` (`continue-on-error`, informational) · `zap-baseline` (informational DAST; alert allowlist in `.zap/rules.tsv`) → `publish-report`. Each test job emits a `blob` report; `publish-report` merges them into one HTML report deployed to GitHub Pages, and runs even on failure. Vulnerability-confirmation tests and ZAP alerts never gate the build (the app is vulnerable by design).

## Conventions

- **Security scope:** run security tests only against your own local/CI container — never a system you don't own. Running in a container also auto-disables the genuinely dangerous challenges.
- **AI-in-the-loop:** when generating tests, validate every case against the app's real behavior before committing, and log any miss (wrong locator, invented endpoint, assertion that doesn't match reality) in `docs/ai-validation-log.md`. That log is a deliberate project artifact.
- **Bug reports** go in `docs/bugs/` using `docs/bugs/BUG-template.md`.
- **Flaky tests** are quarantined and tracked, not masked by stacking retries (CI uses exactly one retry to absorb infra flake).
