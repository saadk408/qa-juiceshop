import type { APIRequestContext, Page } from '@playwright/test';

/** A freshly registered and authenticated Juice Shop user. */
export interface TestUser {
  /** JWT bearer token from `authentication.token`. */
  token: string;
  /** Basket id from `authentication.bid`. */
  basketId: number;
  email: string;
  password: string;
}

/** Optional overrides for {@link loginAsUser}. */
export interface LoginOverrides {
  email?: string;
  password?: string;
}

// Monotonic counter so two calls within the same millisecond still get unique emails.
// Safe under the suite's serial execution (workers:1); the per-restart reseed wipes any
// users from a prior run, so there is never a cross-run collision either.
let seq = 0;

// Satisfies Juice Shop's registration password policy.
const DEFAULT_PASSWORD = 'Sup3r-Str0ng-Pw!';

// securityQuestion id 1 ("Your eldest siblings middle name?") was confirmed valid on the
// pinned v20 instance via GET /api/SecurityQuestions. The id is instance-specific.
const SECURITY_QUESTION_ID = 1;

/**
 * Registers a brand-new, unique user via `POST /api/Users`, logs in via
 * `POST /rest/user/login`, and returns the auth material.
 *
 * Registering a fresh user on every call keeps each test self-contained and avoids
 * hardcoding seeded credentials, which shift between Juice Shop versions. There are
 * deliberately no stored seed credentials.
 *
 * Throws (with status + body) on a non-OK register or login response so failures are
 * loud and immediate rather than surfacing later as an undefined token.
 */
export async function loginAsUser(
  request: APIRequestContext,
  overrides: LoginOverrides = {},
): Promise<TestUser> {
  const email = overrides.email ?? `qa+${Date.now()}-${seq++}@example.com`;
  const password = overrides.password ?? DEFAULT_PASSWORD;

  const register = await request.post('/api/Users', {
    data: {
      email,
      password,
      passwordRepeat: password,
      securityQuestion: { id: SECURITY_QUESTION_ID },
      securityAnswer: 'qa-fixture-answer',
    },
  });
  if (!register.ok()) {
    throw new Error(
      `Registration failed for ${email}: ${register.status()} ${await register.text()}`,
    );
  }

  const login = await request.post('/rest/user/login', { data: { email, password } });
  if (!login.ok()) {
    throw new Error(`Login failed for ${email}: ${login.status()} ${await login.text()}`);
  }

  const body = (await login.json()) as {
    authentication?: { token?: string; bid?: number };
  };
  const auth = body.authentication;
  if (!auth?.token || typeof auth.bid !== 'number') {
    throw new Error(
      `Login response missing authentication.token/bid: ${JSON.stringify(body)}`,
    );
  }

  return { token: auth.token, basketId: auth.bid, email, password };
}

/**
 * Logs the given credentials in through the UI at `/#/login`, leaving the app
 * authenticated. Waits for the SPA to leave the login route -- a real signal of a
 * successful login -- instead of a fixed sleep.
 */
export async function loginViaUi(
  page: Page,
  creds: { email: string; password: string },
): Promise<void> {
  await page.goto('/#/login');
  await page.getByLabel(/email/i).fill(creds.email);
  await page.getByLabel(/password/i).fill(creds.password);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((url) => !url.hash.includes('/login'));
}
