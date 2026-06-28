// Place this file at the repo root: playwright.config.ts
//
// Single source of truth for how the suite runs. It defines the four projects
// the CI workflow invokes (ui, api, db, security) and the settings that keep
// runs deterministic against a single Juice Shop instance.

import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',

  // Fail the build if a stray test.only is committed.
  forbidOnly: isCI,

  // Juice Shop is single-user per instance: parallel workers hitting one running
  // app corrupt shared state (baskets, the score board). So we run serially
  // against a single fresh container. The way to scale later is one container
  // per shard, not raising the worker count here.
  fullyParallel: false,
  workers: 1,

  // One retry in CI absorbs transient infrastructure flake. Genuinely flaky
  // tests are quarantined per the test strategy, not masked by stacking retries.
  retries: isCI ? 1 : 0,

  timeout: 30_000,
  expect: { timeout: 10_000 },

  // In CI we emit a blob report that the workflow merges into one HTML report
  // and publishes to Pages. (ci.yml also passes --reporter=blob on the command
  // line; remove that flag if you want the github reporter's inline PR
  // annotations as well.) Locally we get a list view plus an HTML report.
  reporter: isCI
    ? [['blob'], ['github']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    // Tests use relative paths; BASE_URL lets CI point at the same local app.
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      // UI end-to-end. Needs a real browser.
      name: 'ui',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // API. HTTP-level checks via the request fixture. No browser is launched
      // because these tests never touch the page fixture.
      name: 'api',
      testDir: './tests/api',
    },
    {
      // Database. Reads a copy of Juice Shop's SQLite file pulled out by the db
      // fixture (see docker-compose.yml). No browser is launched.
      name: 'db',
      testDir: './tests/db',
    },
    {
      // Security regression. Mixes UI cases (XSS, chatbot) with request-based
      // cases (SQLi, IDOR, error leakage), so it runs under a browser project.
      name: 'security',
      testDir: './tests/security',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
