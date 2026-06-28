import { test, expect } from '../../src/fixtures';

// OWASP A03 Injection / Cross-Site Scripting. Juice Shop writes the search term into the
// results header (the `#searchValue` span) without encoding it, so markup in `q` renders as
// live HTML. Confirmed against v20: navigating directly to /#/search?q=<payload> reflects the
// payload verbatim as `<iframe src="javascript:alert(`xss`)">` -- Angular's escaping is bypassed.
//
// We assert on the PRESENCE of the injected node, not on a fired alert() dialog: it is fully
// deterministic, needs no dialog handling, and proves the encoding failed without depending on
// arbitrary script actually executing. Banner dismissal is intentionally omitted -- toBeAttached
// checks DOM connection, not visibility, so the welcome/cookie overlays are irrelevant here.
const PAYLOAD = '<iframe src="javascript:alert(`xss`)">';
// The `src^="javascript:"` qualifier ties the match to our injected node so a legitimate iframe
// elsewhere could never satisfy (A) nor keep (B)'s count above zero. v20 renders exactly one
// iframe on this page -- ours.
const INJECTED = 'iframe[src^="javascript:"]';

test.describe('DOM XSS via search (A03)', () => {
  // (A) Confirmation: the search term renders as unescaped markup. Passes against stock Juice
  // Shop; informational. An iframe sourced from our input means it was rendered as HTML, not text.
  test('search reflects an unescaped iframe payload into the DOM', async ({ page }) => {
    await page.goto(`/#/search?q=${encodeURIComponent(PAYLOAD)}`);
    await expect(page.locator(INJECTED)).toBeAttached();
  });

  // (B) Target state: the payload must be rendered as inert text. Marked test.fail() -- it fails
  // today (the iframe IS injected) and so reports as passed; it flips to a reported failure
  // (unexpected pass) the day Angular's escaping is no longer bypassed, the signal to remove this
  // marker. The fix: render user input via safe interpolation, never raw [innerHTML] binding; add
  // a Content-Security-Policy as defense in depth.
  test.fail('search renders the payload as inert text, not markup', async ({ page }) => {
    await page.goto(`/#/search?q=${encodeURIComponent(PAYLOAD)}`);
    // Anchor on the search-term container before asserting absence. Without this, toHaveCount(0)
    // wins a race against the SPA: page.goto resolves on `load`, when the page momentarily has
    // zero iframes, so the assertion passes before Angular injects the result. #searchValue
    // co-renders with the bound term (its [innerHTML] is set atomically on attach) and exists in
    // both the vulnerable (iframe child) and fixed (escaped text) states, so it is a stable anchor.
    await expect(page.locator('#searchValue')).toBeAttached();
    await expect(page.locator(INJECTED)).toHaveCount(0);
  });
});
