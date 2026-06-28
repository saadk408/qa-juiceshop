# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A QA automation suite that tests **OWASP Juice Shop** (a deliberately insecure e-commerce app, run as the system under test) across four layers — UI, API, database, and security regression — using Playwright + TypeScript on Node 24+, with an OWASP ZAP DAST scan in CI. This repo holds the *tests*; the app under test runs as a pinned Docker container.

Two docs are authoritative — read them before substantive work:
- **`docs/test-strategy.md`** — scope, the risk matrix, goals/non-goals, and the reasoning behind every decision below.
- **`docs/security-regression.md`** — the five curated security cases in full, with example code and the fix each documents.

## Current state: scaffold vs. documented design

**This repo is mostly scaffold.** The README and `docs/` describe a complete suite, but only the structure and one smoke test (`tests/ui/smoke.spec.ts`) are committed. The docs are the spec for *what* to build — do not assume the following already exist:

- **A login vertical slice is on `main` — use it as the pattern for new work:** `src/pages/{BasePage,LoginPage}.ts` (first POM), `src/schemas/login.ts` (Zod, validated with `.parse()`), and one spec per layer (`tests/{ui,api,db}/*.spec.ts` + `tests/security/sqli-login.spec.ts`). `src/fixtures/` is implemented (`auth.ts`, `db.ts`, `index.ts`).
- Still scaffold (`.gitkeep`/TODO): `src/api/` (typed clients) and the other four cases in `docs/security-regression.md` (basket IDOR, DOM XSS, error leakage, chatbot prompt injection).
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

The pinned v20 image is **distroless**: `node` is at `/nodejs/bin/node` (not on `PATH`) and there's no `/bin/sh`. So `docker exec juiceshop …` can't run `sh`/`node`/`ls`, and the `docker-compose.yml` healthcheck must be **exec-form with the absolute path** (`["CMD","/nodejs/bin/node","-e",…]`) — a `CMD-SHELL` probe never starts and makes `--wait` fail.

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

**The DB layer reads a copy, not the live file.** Do **not** bind-mount Juice Shop's data dir — it shadows seed files the app needs at boot. `src/fixtures/db.ts` copies it out with `docker cp juiceshop:/juice-shop/data/juiceshop.sqlite <copy>` (container name → cwd-independent) into an `os.tmpdir()` copy (not `.tmp/`, which `.gitignore` does **not** ignore), opens it **read-only**, and deletes it in teardown. Juice Shop's SQLite is rollback-journal mode (confirmed), so the main file alone is complete — don't copy `-wal`/`-shm`.

- **Load `node:sqlite` via `process.getBuiltinModule('node:sqlite')` (+ `import type`), never a static `import`/`require`** — Playwright's TS loader returns a null source for the experimental builtin and crashes. `better-sqlite3` stays the documented fallback (`test-strategy.md` §8) but is **not yet wired in**.

**Security tests are paired (A/B).** Each case is written twice: **(A)** a confirmation test asserting the vulnerability is present (passes against stock Juice Shop; informational), and **(B)** a target-state spec asserting secure behavior, marked `test.fail()` — it runs and must fail today, so it reports as **passed** (an expected failure); it turns **red as an unexpected pass** the day the issue is fixed (the signal to remove the marker). Per-case code is in `docs/security-regression.md`. Exclude the challenges Juice Shop disables in a container (XXE, SSTI, insecure deserialization, NoSQL DoS).

## Fixture contract (`src/fixtures/auth.ts`)

`docs/security-regression.md` defers to CLAUDE.md as the source of truth for these helpers. **Implemented** in `src/fixtures/`; specs import `{ test, expect }` from `src/fixtures` (not `@playwright/test`) to get the `user` / `authedRequest` / `db` fixtures. The contract:

- `loginAsUser(request: APIRequestContext)` — **registers a fresh, unique user every call**, then logs in, returning `{ token, basketId, email, password }`:
  - `POST /api/Users` with a unique email per run, a password meeting the policy, and `securityQuestion: { id }` + `securityAnswer`.
  - `POST /rest/user/login` with `{ email, password }`; take `token` from `authentication.token` and `basketId` from `authentication.bid`.
  - Registering per call keeps each test self-contained and avoids hardcoding seeded passwords, which shift between Juice Shop versions. **There are no stored seed credentials** — do not reintroduce a hardcoded account like `jim@juice-sh.op` (that was an AI miss already corrected; see `docs/ai-validation-log.md`).
- `loginViaUi(page, { email, password })` — logs the same user in through the UI at `/#/login`.

The `securityQuestion` id sent to `POST /api/Users` is instance-specific; **id `1` is confirmed valid on v20** (`GET /api/SecurityQuestions`).

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

**Gotchas:** CI triggers only on `push`/`pull_request` to `main`/`master`, so a PR based on another branch runs no Actions jobs until it targets `main`. `publish-report` deploys to the `github-pages` environment, which is **restricted to `main`** — it fails fast on every PR/non-`main` ref **by design** (green only on push-to-`main`, not a real failure). Pin actions to node24 majors (`upload-artifact@v7`, `download-artifact@v8`, `deploy-pages@v5`, etc.).

## Conventions

- **AI-in-the-loop:** validate every AI-generated case against the app's real behavior before committing, and log any miss (wrong locator, invented endpoint, assertion that doesn't match reality) as a row in `docs/ai-validation-log.md`. That log is a deliberate portfolio artifact.
- **Confirm instance-specific values against the running v20 app** before relying on them.
  - To live-verify, use a throwaway Playwright probe (`chromium.launch()`) run from the **project root** (`@playwright/test` won't resolve elsewhere) and capture the injected node's `outerHTML` to pin the exact locator. An isolated Playwright browser **auto-dismisses dialogs**, so `alert()`/XSS payloads are safe to navigate to — unlike the claude-in-chrome MCP against the real browser, which can freeze on a modal.
  - Confirmed so far: `securityQuestion` id `1`; SQLite path `/juice-shop/data/juiceshop.sqlite`, rollback-journal mode; DB table **`Users`**, column **`email`** (BINARY — exact `=`).
  - Login page (`/#/login`) locators (used by `LoginPage`): inputs `getByRole('textbox', { name: /email|password/i })` — **not** `getByLabel(/password/i)`, which also matches the show-password toggle (strict-mode); submit `getByRole('button', { name: 'Login', exact: true })` — non-exact `Login` also matches "Login with Google"; account menu `name: /show\/hide account menu/i`; logged-in email in the `Go to user profile` menuitem.
  - SQLi login bypass: `' OR 1=1;--` in the email field of `POST /rest/user/login` → 200 with `authentication.token` (seeded admin).
  - Basket IDOR: `GET /rest/basket/1` with any valid bearer token → 200 with the seeded basket of a user the caller is not (`data.id` is the basket id, `data.UserId` its owner — `1` for basket `1`); the endpoint authorizes on JWT validity alone, not ownership. A freshly registered user's `basketId` is well above the low seeded ids (e.g. `9`), so basket `1` is never theirs.
  - DOM XSS via search: navigating directly to `/#/search?q=<encoded payload>` reflects the term into `<span id="searchValue">` of the "Search Results - " heading **unescaped** — `<iframe src="javascript:alert(`xss`)">` survives verbatim (src is **not** rewritten to `unsafe:javascript:` or stripped), so locator `iframe[src^="javascript:"]` matches. Exactly one iframe on the page (ours). For the (B) absence assertion, **anchor on `#searchValue` being attached before `toHaveCount(0)`** — a bare count-0 right after `goto` races the SPA render and passes spuriously (zero iframes during the load→render window).
  - Still TODO: chatbot selectors / response endpoint / coupon format.
- **No fixed sleeps** — rely on Playwright auto-waiting and web-first assertions, waiting on real signals (a response, an attached node, the transcript growing) so cases stay deterministic. **Caveat: auto-waiting does *not* save an assert-*absence*** (`toHaveCount(0)`, `not.toBeVisible`) — right after `page.goto` the SPA hasn't rendered, so the node is legitimately absent and the assertion passes spuriously. Anchor on a positive render signal (an attached node) *before* asserting absence. This bites every (B) UI target-state spec.
- **ESLint:** `tseslint.configs.recommended` (not type-checked); `eslint-plugin-playwright` covers `tests/**` only. In `src/`: dep-less Playwright fixtures need `// eslint-disable-next-line no-empty-pattern` for `({}, use)`; a `throw` inside a `catch` needs `{ cause }` (`preserve-caught-error`); no `any` (`no-explicit-any`).
- **Bug reports** go in `docs/bugs/` using `docs/bugs/BUG-template.md`.
- **Flaky tests** are quarantined and tracked, not masked by stacking retries (CI uses exactly one retry to absorb infra flake).
- **Security scope:** run security tests only against your own local/CI container, never a system you don't own. Running in a container also auto-disables the genuinely dangerous challenges.
