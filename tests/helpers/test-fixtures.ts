/**
 * Shared Playwright `test`/`expect` for the E2E + regression suites.
 *
 * The only customization is a `page`-fixture override that seeds the
 * returning-user cookie before any navigation. As of PR #4561 the app routes a
 * fresh sign-in without that cookie to the SSO deck's create-account view
 * instead of login (see `app/src/lib/ssoPageRoute.ts`), and Playwright always
 * starts from a clean browser profile — so without this seed every SSO login
 * lands on a form with no username/password fields and `fillCredentials` times
 * out. See `seedReturningUserCookie` for the full rationale.
 *
 * Specs should import `test` and `expect` from here instead of
 * `@playwright/test` so the seed applies uniformly without per-spec beforeEach
 * edits.
 */
import { test as base, expect } from '@playwright/test';

import { seedReturningUserCookie } from './auth';

export const test = base.extend({
  page: async ({ page }, use) => {
    await seedReturningUserCookie(page);
    await use(page);
  },
});

export { expect };
