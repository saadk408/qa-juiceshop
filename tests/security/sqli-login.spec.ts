import { test, expect } from '../../src/fixtures';

// Classic authentication-bypass payload: the closing quote ends the email literal, `OR
// 1=1` makes the WHERE clause always true, and `--` comments out the password check, so
// the query returns the first user (the seeded admin).
const SQLI_PAYLOAD = { email: "' OR 1=1;--", password: 'not-a-real-password' };

// (A) Confirmation: the login query is injectable today. Passes against stock Juice Shop;
// informational. Uses only `request`, so no browser launches under the security project.
test('SQLi in the email field authenticates without valid credentials', async ({
  request,
}) => {
  const res = await request.post('/rest/user/login', { data: SQLI_PAYLOAD });

  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    authentication?: { token?: string; umail?: string };
  };
  // A token means the injection authenticated us as the first user (the admin).
  expect(body.authentication?.token).toBeTruthy();
  expect(body.authentication?.umail).toContain('@');
});

// (B) Target state: once the query is parameterised, injection must be rejected with 401.
// Marked test.fail() -- it is an expected failure today (the app returns 200) and so
// reports as passed; it flips to a reported failure (unexpected pass) the day the fix
// lands, which is the signal to remove this marker.
test.fail('login rejects a SQL injection payload in the email field', async ({
  request,
}) => {
  const res = await request.post('/rest/user/login', { data: SQLI_PAYLOAD });
  expect(res.status()).toBe(401);
});
