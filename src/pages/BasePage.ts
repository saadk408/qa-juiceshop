import type { Page } from '@playwright/test';

/**
 * Shared base for Page Objects. Holds the `page` handle and the cross-cutting concerns
 * every Juice Shop page inherits -- navigation and dismissing the welcome/cookie banners
 * that otherwise overlay the UI on a fresh load.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  /** Navigate to a relative SPA path; BASE_URL (playwright.config) supplies the origin. */
  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  /**
   * Best-effort dismissal of the welcome modal and cookie bar. Tolerant by design: a
   * banner that is absent (already dismissed, or not shown this load) must not fail the
   * test. No fixed sleeps -- each click has a short timeout and swallows the rejection,
   * so a missing banner costs at most that per-click timeout rather than a default hang.
   */
  async dismissBanners(): Promise<void> {
    // Welcome modal: its close button overlays and blocks the form until dismissed.
    await this.page
      .getByRole('button', { name: /close welcome banner/i })
      .click({ timeout: 2000 })
      .catch(() => {
        /* welcome banner not present this load */
      });

    // Cookie bar: a button whose accessible name is "dismiss cookie message" (visible
    // text "Me want it!"), injected by the cookieconsent vendor lib. A no-match is a
    // harmless no-op.
    await this.page
      .getByRole('button', { name: /dismiss cookie message/i })
      .click({ timeout: 2000 })
      .catch(() => {
        /* cookie bar not present this load */
      });
  }
}
