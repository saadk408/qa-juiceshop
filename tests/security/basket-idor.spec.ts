import { test, expect } from '../../src/fixtures';

// OWASP A01 Broken Access Control. Juice Shop's GET /rest/basket/:id authorizes on a valid
// JWT alone -- it never checks the basket belongs to the caller -- so any logged-in user
// can read a low-numbered seeded basket by guessing its id. Basket 1 belongs to a seeded
// account (its data.UserId is 1) and is never owned by a freshly registered user.
const SEEDED_BASKET_ID = 1;

// (A) Confirmation: a fresh user reads a basket they do not own. Passes against stock Juice
// Shop; informational. `user` is our own fresh account and `authedRequest` carries its
// bearer token -- both from the shared fixtures, no credentials hardcoded.
test('IDOR: a logged-in user can read a seeded basket they do not own', async ({
  user,
  authedRequest,
}) => {
  // Precondition: basket 1 is not ours, so a 200 here is genuine cross-account access.
  expect(SEEDED_BASKET_ID).not.toBe(user.basketId);

  const res = await authedRequest.get(`/rest/basket/${SEEDED_BASKET_ID}`);

  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data?: { id?: number } };
  expect(body.data?.id).toBe(SEEDED_BASKET_ID); // we received a basket that is not ours
});

// (B) Target state: the same cross-account read must be refused (401/403). Marked
// test.fail() -- it fails today (the app returns 200) and so reports as passed; it flips to
// a reported failure (unexpected pass) the day the endpoint checks basket ownership, the
// signal to remove this marker. The fix: derive ownership from the session and return 403
// on a mismatch, never trusting the client-supplied basket id for authorization.
test.fail('IDOR target state: reading a basket the caller does not own is refused', async ({
  user,
  authedRequest,
}) => {
  expect(SEEDED_BASKET_ID).not.toBe(user.basketId);

  const res = await authedRequest.get(`/rest/basket/${SEEDED_BASKET_ID}`);
  expect([401, 403]).toContain(res.status());
});
