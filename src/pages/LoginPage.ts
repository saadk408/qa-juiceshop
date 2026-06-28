import { expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page Object for the Juice Shop login flow (`/#/login`).
 *
 * Locators prefer role/label over CSS so they survive markup churn; the few selectors
 * that map to stable, confirmed Angular ids are matched by their accessible name. All
 * selector knowledge lives here so specs stay free of raw selectors.
 */
export class LoginPage extends BasePage {
  /** Open the login page and clear any banners overlaying the form. */
  async open(): Promise<void> {
    await this.goto('/#/login');
    await this.dismissBanners();
  }

  async fillCredentials(email: string, password: string): Promise<void> {
    // Match by the `textbox` role, not a bare label: `getByLabel(/password/i)` also
    // matches the "Button to display the password" toggle (a button), tripping strict
    // mode. The role narrows each locator to the single input.
    await this.page.getByRole('textbox', { name: /email/i }).fill(email);
    await this.page.getByRole('textbox', { name: /password/i }).fill(password);
  }

  async submit(): Promise<void> {
    // Exact "Login": the submit button's accessible name is "Login" (visible text
    // "Log in"). A non-exact name (e.g. /log\s?in/i) also matches "Login with Google"
    // -- "Login" is a substring of it -- which would trip strict mode.
    await this.page.getByRole('button', { name: 'Login', exact: true }).click();
    // Wait on a real signal: a successful login navigates the SPA off the /login route.
    await this.page.waitForURL((url) => !url.hash.includes('/login'));
  }

  /** Convenience: open + fill + submit. */
  async login(email: string, password: string): Promise<void> {
    await this.open();
    await this.fillCredentials(email, password);
    await this.submit();
  }

  async openAccountMenu(): Promise<void> {
    await this.page.getByRole('button', { name: /show\/hide account menu/i }).click();
  }

  /**
   * Open the account menu and assert it shows the logged-in user's email -- proof of
   * identity, not just an authenticated session. `toContainText` (not `toHaveText`)
   * because the same menu item also renders the `account_circle` icon ligature as text.
   */
  async assertLoggedInAs(email: string): Promise<void> {
    await this.openAccountMenu();
    await expect(
      this.page.getByRole('menuitem', { name: /go to user profile/i }),
    ).toContainText(email);
  }
}
