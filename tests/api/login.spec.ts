import { test, expect } from '../../src/fixtures';
import { LoginResponseSchema } from '../../src/schemas/login';

test('valid credentials return a token and a numeric basket id', async ({
  request,
  user,
}) => {
  const res = await request.post('/rest/user/login', {
    data: { email: user.email, password: user.password },
  });
  expect(res.status()).toBe(200);

  // parse() throws a ZodError (with the offending path) on any shape drift -- a loud
  // failure with no conditional branch.
  const body = LoginResponseSchema.parse(await res.json());
  // toBeTruthy (not just the schema's z.string()): z.string() accepts "", so this pins
  // the token to non-empty. toBeGreaterThan(0): z.number() would accept 0 or a negative
  // value, but a real basket id is a positive integer -- both checks add value the
  // schema's shape validation cannot.
  expect(body.authentication.token).toBeTruthy();
  expect(body.authentication.bid).toBeGreaterThan(0);
});

test('invalid credentials are rejected with 401', async ({ request }) => {
  const res = await request.post('/rest/user/login', {
    data: { email: `no-such-${Date.now()}@example.com`, password: 'wrong-password' },
  });
  expect(res.status()).toBe(401);
});
