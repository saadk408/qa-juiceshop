# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A QA automation suite that tests **OWASP Juice Shop** (a deliberately insecure e-commerce app, run as the system under test) across four layers — UI, API, database, and security regression — using Playwright + TypeScript on Node 24+, with an OWASP ZAP DAST scan in CI. This repo holds the *tests*; the app under test runs as a pinned Docker container.

Two docs are authoritative — read them before substantive work:
- **`docs/test-strategy.md`** — scope, the risk matrix, goals/non-goals, and the reasoning behind every decision below.
- **`docs/security-regression.md`** — the five curated security cases in full, with example code and the fix each documents.

## Current state: scaffold vs. documented design

**This repo is mostly scaffold.** The README and `docs/` describe a complete suite, but only the structure and one smoke test (`tests/ui/smoke.spec.ts`) are committed. The docs are the spec for *what* to build — do not assume the following already exist:

- `src/{pages,fixtures,api,schemas}` and `tests/{api,db}` contain only `.gitkeep` — no Page Objects, fixtures, API clients, or Zod schemas yet.
- `tests/security/` is **not committed at all**, yet `playwright.config.ts` declares it as a project `testDir` and `ci.yml` runs it. Every case is fully specified in `docs/security-regression.md`.
- **Now in place** (tooling phase): `package.json` has the `lint`/`typecheck`/`validate` + `test`/`test:*` scripts, `engines.node >=24`, and the eslint/typescript dev deps; the repo root has `eslint.config.mjs` (flat config — typescript-eslint + eslint-plugin-playwright) and a minimal `tsconfig.json`. CI's gating job runs `npm run validate` (eslint + `tsc --noEmit`), green on the current tree.
- `postman/collection.json` exists and the docs mention Newman, but **CI has no Newman step** — the collection isn't wired into any pipeline.
- `tests/ui/smoke.spec.ts` hardcodes `http://localhost:3000`; new tests should use **relative paths** so `BASE_URL` applies.

## Commands

**Prereqs:** Docker and Node 24+. Always start the app first:

```bash
docker compose up -d --wait                    # Juice Shop on :3000 (pinned bkimminich/juice-shop:v20.0.0), waits for healthcheck
npm ci && npx playwright install --with-deps   # install deps + browsers
docker compose down                            # stop the app when done
```

**Run** — the npm scripts now exist (see the contract below); these `npx` forms are their underlying equivalents:

```bash
npx playwright test                            # all projects
npx playwright test --project=ui               # one project: ui | api | db | security
npx playwright test tests/ui/smoke.spec.ts     # one file
npx playwright test --grep "home page"         # one test by title
npx playwright show-report                     # open the HTML report
```

**Command contract** — implemented as `package.json` scripts:

```bash
npm run lint            # → eslint .
npm run typecheck       # → tsc --noEmit
npm run validate        # → npm run lint && npm run typecheck   (CI's gating check)
npm test                # → npx playwright test                 (all four projects)
npm run test:ui         # → npx playwright test --project=ui
npm run test:api        # → npx playwright test --project=api
npm run test:db         # → npx playwright test --project=db
npm run test:security   # → npx playwright test --project=security
```

`BASE_URL` (default `http://localhost:3000`) is the only config the suite needs; `.env.example` documents it. There is deliberately no DB connection string and no stored credentials (see Fixture contract).

CI does **not** use the `test:*` scripts: it runs path-scoped `npx playwright test tests/ui tests/api tests/db` (functional) and `tests/security` (security) as separate jobs, plus `npm run validate` (lint + typecheck). So `npm test` (all four projects in one run) intentionally differs from CI's split.

## Architecture

**Four Playwright projects** in `playwright.config.ts`, each bound to a `testDir` (`tests/<project>/`): `ui` and `security` launch Desktop Chrome; `api` and `db` run with no browser (HTTP via the request fixture / SQLite file reads).

**Serial execution is deliberate** (`workers: 1, fullyParallel: false`). Juice Shop is single-user-per-instance, so parallel workers against one running app corrupt shared state (baskets, score board). To scale, shard with **one container per shard** — do not raise the worker count.

**Test data hinges on the reseed.** Juice Shop wipes and regenerates its SQLite database on every restart, so a fresh container per run gives deterministic, known-good seed data. Consequences: no test may assume state survives a restart; read paths use documented seed entities (e.g. the low-numbered baskets `1`/`2` the IDOR case targets), and write paths create their own data for isolation.

**The DB layer reads a copy, not the live file.** Do **not** bind-mount Juice Shop's data dir — it shadows seed files the app needs at boot. Instead the db fixture copies the SQLite file out of the container and opens the copy **read-only** via `node:sqlite` (`import { DatabaseSync } from 'node:sqlite'`):

```bash
docker compose cp juiceshop:/juice-shop/data/juiceshop.sqlite ./.tmp/db.sqlite
```

This is why there is no DB connection string. Two caveats for the next-phase fixture: **delete the temp copy in teardown** — `.gitignore` ignores `/test-results/` but **not** `.tmp/`, so `./.tmp/db.sqlite` is currently committable (write it under an already-ignored path or add `.tmp/` to `.gitignore`); and **`node:sqlite` is experimental but unflagged on Node 24** — it loads without `--experimental-sqlite`, emitting only an experimental warning; keep **`better-sqlite3`** as a fallback (named in `test-strategy.md` §8) for the unlikely load failure.

**Security tests are paired (A/B).** Each case is written twice: **(A)** a confirmation test asserting the vulnerability is present (passes against stock Juice Shop; informational), and **(B)** a target-state spec asserting secure behavior, marked `test.fail()` — an expected failure today that flips green the day the issue is fixed. Per-case code is in `docs/security-regression.md`. Exclude the challenges Juice Shop disables in a container (XXE, SSTI, insecure deserialization, NoSQL DoS).

## Fixture contract (`src/fixtures/auth.ts`)

`docs/security-regression.md` defers to CLAUDE.md as the source of truth for these helpers, and every security case imports them. Not yet implemented — build to this contract:

- `loginAsUser(request: APIRequestContext)` — **registers a fresh, unique user every call**, then logs in, returning `{ token, basketId, email, password }`:
  - `POST /api/Users` with a unique email per run, a password meeting the policy, and `securityQuestion: { id }` + `securityAnswer`.
  - `POST /rest/user/login` with `{ email, password }`; take `token` from `authentication.token` and `basketId` from `authentication.bid`.
  - Registering per call keeps each test self-contained and avoids hardcoding seeded passwords, which shift between Juice Shop versions. **There are no stored seed credentials** — do not reintroduce a hardcoded account like `jim@juice-sh.op` (that was an AI miss already corrected; see `docs/ai-validation-log.md`).
- `loginViaUi(page, { email, password })` — logs the same user in through the UI at `/#/login`.

The `securityQuestion` id sent to `POST /api/Users` is instance-specific; confirm a valid id on your v20 instance.

## API endpoints

- REST endpoints live under `/rest`; the app's CRUD API lives under `/api`.
- Login: `POST /rest/user/login` `{ email, password }` → `{ authentication: { token, bid, umail } }`.

## CI (`.github/workflows/ci.yml`)

Parallel jobs, each on its own runner spinning its own fresh container (`docker compose up -d --wait`, backed by the healthcheck in `docker-compose.yml`); tests run serially *within* each job:

- `lint + typecheck` — **gating**: runs `npm run validate` (eslint + `tsc --noEmit`).
- `functional-tests` — **gating**: `ui` + `api` + `db`.
- `security-tests` — informational (`continue-on-error`).
- `zap-baseline` — informational DAST; alert allowlist in `.zap/rules.tsv`.
- `publish-report` — merges each job's `blob` report into one HTML report deployed to GitHub Pages; runs even on failure.

Lint, type errors, and functional failures gate the build. Vulnerability-confirmation tests and ZAP alerts never gate — the app is vulnerable by design.

## Conventions

- **AI-in-the-loop:** validate every AI-generated case against the app's real behavior before committing, and log any miss (wrong locator, invented endpoint, assertion that doesn't match reality) as a row in `docs/ai-validation-log.md`. That log is a deliberate portfolio artifact.
- **Confirm instance-specific values against the running v20 app** before relying on them (flagged TODO in the docs): chatbot selectors / response endpoint / coupon format, the `securityQuestion` id, and the in-container SQLite path.
- **No fixed sleeps** — rely on Playwright auto-waiting and web-first assertions, waiting on real signals (a response, an attached node, the transcript growing) so cases stay deterministic.
- **Bug reports** go in `docs/bugs/` using `docs/bugs/BUG-template.md`.
- **Flaky tests** are quarantined and tracked, not masked by stacking retries (CI uses exactly one retry to absorb infra flake).
- **Security scope:** run security tests only against your own local/CI container, never a system you don't own. Running in a container also auto-disables the genuinely dangerous challenges.
