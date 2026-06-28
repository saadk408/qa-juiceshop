import { test as base } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loginAsUser, type TestUser } from './auth';
import { openJuiceShopDb, type JuiceShopDb } from './db';

interface Fixtures {
  /** The fresh, authenticated user ({ token, basketId, email, password }) for this test. */
  user: TestUser;
  /** An APIRequestContext that sends `Authorization: Bearer <token>` as `user`. */
  authedRequest: APIRequestContext;
  /** Read-only query access to a snapshot of Juice Shop's SQLite database. */
  db: JuiceShopDb;
}

/**
 * The shared test harness. All specs import `{ test, expect }` from here so they share
 * one fresh authenticated user per test plus read-only DB access.
 */
export const test = base.extend<Fixtures>({
  user: async ({ request }, use) => {
    await use(await loginAsUser(request));
  },

  authedRequest: async ({ playwright, baseURL, user }, use) => {
    // A manually created context must be disposed; the built-in `request` fixture is not.
    const context = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${user.token}` },
    });
    await use(context);
    await context.dispose();
  },

  // The db fixture needs no other fixtures, but Playwright still requires the
  // fixtures-destructure parameter, hence the empty object pattern.
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const handle = openJuiceShopDb();
    await use(handle);
    handle.dispose();
  },
});

export { expect } from '@playwright/test';
