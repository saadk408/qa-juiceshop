import { test, expect } from '../../src/fixtures';
import { LoginPage } from '../../src/pages/LoginPage';

test('a registered user can log in through the UI', async ({ page, user }) => {
  const loginPage = new LoginPage(page);
  await loginPage.login(user.email, user.password);

  // Selector-free assertion in the spec: a successful login leaves the /login route.
  await expect(page).not.toHaveURL(/\/login/);
  // The meaningful check -- the account menu shows the logged-in user's email -- is owned
  // by the POM so no raw selectors leak into the spec.
  await loginPage.assertLoggedInAs(user.email);
});
