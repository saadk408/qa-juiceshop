import { test, expect } from '../../src/fixtures';

// A05 Security Misconfiguration — sensitive data exposure via error leakage.
// /rest/products/search builds its SQL by string interpolation, so a malformed
// `q` breaks the generated query: the closing quote ends the LIKE literal and
// the extra ')' unbalances the WHERE parentheses, throwing a syntax error the
// API hands straight back to the client. That detail maps the engine and schema
// for an attacker — the reconnaissance step behind Case 1 (SQLi login).
//
// Verified on v20: a lone single quote `'` returns 200 with an empty result set
// (NOT an error), so the doc's `q: "'"` does not trigger the leak — `')` does.
// The leaked body is a raw HTML error page (not the JSON envelope) whose title/
// heading carry the engine name `SQLITE_ERROR`; the full `SELECT ... FROM
// Products` text is not echoed, so we assert on the engine token observed.
const MALFORMED_QUERY = { q: "')" };

// The database engine name must never reach the client. Shared by both tests so
// the (A) leak and the (B) target-state absence assert on the same token.
const ENGINE_LEAK = /SQLITE_ERROR/i;

// (A) Confirmation: the malformed search provokes an unhandled DB error whose
// raw HTML page leaks the engine name. Passes against stock Juice Shop;
// informational. Uses only `request`, so no browser launches under the security
// project.
test('search error response leaks SQL engine internals', async ({ request }) => {
  const res = await request.get('/rest/products/search', { params: MALFORMED_QUERY });

  // The API abandons its JSON contract and returns a raw 500 error page.
  expect(res.status()).toBe(500);
  expect(res.headers()['content-type']).toContain('text/html');

  const body = await res.text();
  expect(body).toMatch(ENGINE_LEAK);
});

// (B) Target state: the same input returns a safe, generic message with no
// engine, query, or schema detail. Marked test.fail() -- it is an expected
// failure today (the body still leaks `SQLITE_ERROR`) and so reports as passed;
// it flips to a reported failure (unexpected pass) the day a global error
// handler lands, the signal to remove this marker. Plain HTTP body assertion --
// the SPA assert-absence race caveat is UI-only and does not apply here.
test.fail('error responses do not leak SQL engine or query detail', async ({ request }) => {
  const res = await request.get('/rest/products/search', { params: MALFORMED_QUERY });
  const body = await res.text();
  expect(body).not.toMatch(ENGINE_LEAK);
});
