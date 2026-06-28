# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A QA automation suite that tests **OWASP Juice Shop** (a deliberately insecure e-commerce app, run as the system under test) across four layers — UI, API, database, and security regression — using Playwright + TypeScript, with an OWASP ZAP DAST scan in CI. This repo holds the *tests*; the app under test runs as a pinned Docker container.

Two docs are authoritative — read them before substantive work:
- **`docs/test-strategy.md`** — scope, the risk matrix, goals/non-goals, and the reasoning behind every decision below.
- **`docs/security-regression.md`** — the five curated security cases in full, with example code and the fix each documents.

## Current state: scaffold vs. documented design

**This repo is mostly scaffold.** The README and `docs/` describe a complete suite, but only the structure and one smoke test (`tests/ui/smoke.spec.ts`) are committed. The docs are the spec for *what* to build — do not assume the following already exist:

- `src/{pages,fixtures,api,schemas}` and `tests/{api,db}` contain only `.gitkeep` — no Page Objects, fixtures, API clients, or Zod schemas yet.
- `tests/security/` is **not committed at all**, yet `playwright.config.ts` declares it as a project `testDir` and `ci.yml` runs it. Every case is fully specified in `docs/security-regression.md`.
- `package.json` `scripts` is **empty**, and there is **no `tsconfig.json` and no eslint config**. Run Playwright via `npx` directly. CI's `lint` job calls `npm run lint` (expects eslint) and will fail until that script + eslint are added.
- `postman/collection.json` exists and the docs mention Newman, but **CI has no Newman step** — the collection isn't wired into any pipeline.
- `tests/ui/smoke.spec.ts` hardcodes `http://localhost:3000`; new tests should use **relative paths** so `BASE_URL` applies.

## Commands

```bash
docker compose up -d --wait                    # start Juice Shop on :3000 (pinned bkimminich/juice-shop:v20.0.0), wait for healthcheck
npm ci && npx playwright install --with-deps   # install deps + browsers

npx playwright test                            # run everything
npx playwright test --project=ui               # one project: ui | api | db | security
npx playwright test tests/ui                   # one layer by path
npx playwright test tests/ui/smoke.spec.ts     # one file
npx playwright test --grep "home page"         # one test by title
npx playwright show-report                     # open the HTML report
docker compose down                            # stop the app
```

`BASE_URL` (default `http://localhost:3000`) is the only config the suite needs; `.env.example` documents it. There is deliberately no DB connection string and no stored credentials (see Fixture contract).

## Architecture

**Four Playwright projects** in `playwright.config.ts`, each bound to a `testDir`: `ui` and `security` launch Desktop Chrome; `api` and `db` run with no browser (HTTP via the request fixture / SQLite file reads).

**Serial execution is deliberate** (`workers: 1, fullyParallel: false`). Juice Shop is single-user-per-instance, so parallel workers against one running app corrupt shared state (baskets, score board). To scale, shard with **one container per shard** — do not raise the worker count.

**Test data hinges on the reseed.** Juice Shop wipes and repopulates its DB on every restart, so a fresh container per run gives deterministic, known-good seed data. Consequences: no test may assume state survives a restart; read paths use documented seed entities (e.g. the low-numbered baskets `1`/`2` the IDOR case targets), and write paths create their own data for isolation.

**The DB layer reads a copy, not the live file.** Do **not** bind-mount Juice Shop's data dir — it shadows seed files the app needs at boot. Instead the db fixture copies the SQLite file out of the container and reads the copy (`docker compose cp juiceshop:/juice-shop/data/juiceshop.sqlite ./.tmp/db.sqlite`). This is why there is no DB connection string.

**Security tests are paired (A/B).** Each case is written twice: **(A)** a confirmation test asserting the vulnerability is present (passes against stock Juice Shop; informational), and **(B)** a target-state spec asserting secure behavior, marked `test.fail()` — an expected failure today that flips green the day the issue is fixed. Per-case code is in `docs/security-regression.md`.

## Fixture contract (`src/fixtures/auth.ts`)

`docs/security-regression.md` defers to CLAUDE.md as the source of truth for these helpers, and every security case imports them. Not yet implemented — build to this contract:

- `loginAsUser(request: APIRequestContext)` — **registers a fresh, unique user every call** (`POST /api/Users`, then `POST /rest/user/login`) and returns `{ token, basketId, email, password }`. Registering per call keeps each test self-contained and avoids hardcoding seeded passwords, which shift between Juice Shop versions. **There are no stored seed credentials** — do not reintroduce a hardcoded account like `jim@juice-sh.op` (that was an AI miss already corrected; see `docs/ai-validation-log.md`).
- `loginViaUi(page, { email, password })` — logs the same user in through the UI at `/#/login`.

The `securityQuestion` id sent to `POST /api/Users` is instance-specific; confirm a valid id on your v20 instance.

## CI (`.github/workflows/ci.yml`)

Parallel jobs, each on its own runner spinning its own fresh container (`docker compose up -d --wait`, backed by the healthcheck in `docker-compose.yml`); tests run serially *within* each job:

- `lint` — **gating** (fails until a `lint` script + eslint exist).
- `functional-tests` — **gating**: `ui` + `api` + `db`.
- `security-tests` — informational (`continue-on-error`).
- `zap-baseline` — informational DAST; alert allowlist in `.zap/rules.tsv`.
- `publish-report` — merges each job's `blob` report into one HTML report deployed to GitHub Pages; runs even on failure.

Only functional failures gate the build. Vulnerability-confirmation tests and ZAP alerts never gate — the app is vulnerable by design.

## Conventions

- **AI-in-the-loop:** validate every AI-generated case against the app's real behavior before committing, and log any miss (wrong locator, invented endpoint, assertion that doesn't match reality) as a row in `docs/ai-validation-log.md`. That log is a deliberate portfolio artifact.
- **Confirm instance-specific values against the running v20 app** before relying on them (flagged TODO in the docs): chatbot selectors / response endpoint / coupon format, the `securityQuestion` id, and the in-container SQLite path.
- **No fixed sleeps** — wait on real signals (a response, an attached node, the transcript growing) so cases stay deterministic.
- **Bug reports** go in `docs/bugs/` using `docs/bugs/BUG-template.md`.
- **Flaky tests** are quarantined and tracked, not masked by stacking retries (CI uses exactly one retry to absorb infra flake).
- **Security scope:** run security tests only against your own local/CI container, never a system you don't own. Running in a container also auto-disables the genuinely dangerous challenges.
