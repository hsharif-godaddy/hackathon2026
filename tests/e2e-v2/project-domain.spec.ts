/**
 * Project Domain card — verify the built-in URL card renders, displays the
 * current project subdomain, supports inline editing with validation, and
 * provides copy/open actions.
 *
 * Gated by `appbuilder-project-domain` Switchboard flag.
 *
 * Concurrency: serial within file — tests share the `[e2e-pool:publish-domain]`
 * pool app (pre-published). The edit tests intentionally DO NOT save (Cancel
 * only) to avoid mutating pool state. The save-state test uses route
 * interception to stall the mutation and verify button states without
 * completing the rename.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';

import { ensureAuthenticated, loginViaSsoDirect } from '../helpers/auth';
import {
  DEFAULT_TIMEOUT,
  getEnvConfig,
} from '../helpers/constants';
import { getCachedPoolAppId } from '../helpers/pool-cache';
import {
  dismissOverlays,
  logTestResult,
  logTestStart,
  waitForDevelopPage,
} from '../helpers/ui';

const { env } = getEnvConfig();

test.describe.configure({ mode: 'serial' });

/**
 * Navigate to the Domain panel and locate the Project Domain card.
 * Returns the card locator, or calls test.skip() if the required
 * feature flags are off.
 */
async function navigateToProjectDomainCard(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await dismissOverlays(page);
  await ensureAuthenticated(page);

  const airoHeader = page.getByTestId('airo-header');
  const domainViewButton = airoHeader.getByRole('button', {
    name: /^Domain$|builder_domain_title/i,
  });

  const domainButtonVisible = await domainViewButton
    .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
    .then(() => true)
    .catch(() => false);

  if (!domainButtonVisible) {
    test.skip(true, 'appbuilder-domain-top-level flag is off');
  }

  await domainViewButton.click();

  const projectDomainCard = page.getByTestId('project-domain-card');
  const cardVisible = await projectDomainCard
    .waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT })
    .then(() => true)
    .catch(() => false);

  if (!cardVisible) {
    test.skip(true, 'appbuilder-project-domain flag is off');
  }

  return projectDomainCard;
}

test.describe('E2E v2 - Project Domain card', () => {
  let appId: string;

  test.beforeAll(() => {
    appId = getCachedPoolAppId(env, 'publish-domain');
    console.log(`  project-domain pool app (cached): ${appId}`);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    logTestStart(testInfo);
    await page.addInitScript(() => {
      localStorage.setItem('airo-intro-tour-shown', 'true');
    });
    await loginViaSsoDirect(page);
    await page.goto(`/develop/${appId}`);
    await waitForDevelopPage(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await logTestResult(page, testInfo);
  });

  test('Project Domain card renders with URL bar', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Verify URL bar is present
    const urlBar = page.getByTestId('project-domain-url-bar');
    await expect(urlBar).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Verify the URL display shows an airoapp.ai domain
    const urlDisplay = page.getByTestId('project-domain-url-display');
    await expect(urlDisplay).toBeVisible();

    const displayText = await urlDisplay.textContent();
    const expectedAiroDomain = env === 'prod' ? 'airoapp.ai' : 'test-airoapp.ai';
    expect(displayText).toContain(expectedAiroDomain);

    // Verify copy and open buttons
    await expect(page.getByTestId('project-domain-copy')).toBeVisible();
    await expect(page.getByTestId('project-domain-open')).toBeVisible();

    // Verify "Edit URL" button
    const editButton = projectDomainCard.getByRole('button', {
      name: /Edit URL|builder_project_domain_edit_url_button/i,
    });
    await expect(editButton).toBeVisible();
    await expect(editButton).toBeEnabled();
  });

  test('Edit URL opens inline editor with input and actions', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Click Edit URL
    const editButton = projectDomainCard.getByRole('button', {
      name: /Edit URL|builder_project_domain_edit_url_button/i,
    });
    await expect(editButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await editButton.click();

    // Verify the input field appears
    const domainInput = page.locator('#project-domain-name');
    await expect(domainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(domainInput).toBeFocused();

    // Verify edit actions (Save/Cancel) appear
    const editActions = page.getByTestId('project-domain-edit-actions');
    await expect(editActions).toBeVisible();

    // Cancel should be enabled
    const cancelButton = editActions.getByRole('button', {
      name: /Cancel|builder_project_domain_button_cancel/i,
    });
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeEnabled();

    // Save should be disabled (no changes yet)
    const saveButton = editActions.getByRole('button', {
      name: /Save|builder_project_domain_save/i,
    });
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // Cancel and verify return to view mode
    await cancelButton.click();
    await expect(page.getByTestId('project-domain-url-bar')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(domainInput).not.toBeVisible();
  });

  test('Save disables Cancel and shows saving state', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Intercept the project-domain rename API and stall it so we can assert
    // button states mid-flight without actually mutating the pool app.
    // The real endpoint is PUT /api/apps/{appId}/project-domain.
    await page.route('**/api/apps/*/project-domain', async (route) => {
      // Hold the request open indefinitely; the test asserts button states
      // while it hangs. The route is never fulfilled, so no pool mutation occurs.
      await new Promise(() => {});
    });

    // Intercept domain validation to return available immediately so Save
    // enables without depending on the live backend.
    // The real endpoint is GET /api/apps/{appId}/domain/check?...
    await page.route('**/api/apps/*/domain/check*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true, errors: [] }),
      });
    });

    // Enter edit mode
    const editButton = projectDomainCard.getByRole('button', {
      name: /Edit URL|builder_project_domain_edit_url_button/i,
    });
    await editButton.click();

    const domainInput = page.locator('#project-domain-name');
    await expect(domainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Type a valid new prefix (different from current) to enable Save.
    // Triple-click selects the existing value; pressSequentially fires per-keystroke
    // input events so React's controlled onChange actually receives each character.
    // fill() sets the DOM value directly and bypasses @ux/text-input's synthetic
    // onChange, leaving currentProjectName unchanged and Save permanently disabled.
    await domainInput.click({ clickCount: 3 });
    await domainInput.pressSequentially('e2e-save-test-prefix');

    // Wait for Save to become enabled (debounce + validation response)
    const editActions = page.getByTestId('project-domain-edit-actions');
    const saveButton = editActions.getByRole('button', {
      name: /Save|builder_project_domain_save/i,
    });
    await expect(saveButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });

    const cancelButton = editActions.getByRole('button', {
      name: /Cancel|builder_project_domain_button_cancel/i,
    });
    await expect(cancelButton).toBeEnabled();

    // Click Save — the stalled route keeps the mutation in-flight
    await saveButton.click();

    // Save should show "Saving..." text and Cancel should be disabled
    await expect(editActions.getByRole('button', {
      name: /Saving|builder_project_domain_button_saving/i,
    })).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    await expect(cancelButton).toBeDisabled();
  });

  test('Validation: too short input shows error', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Enter edit mode
    const editButton = projectDomainCard.getByRole('button', {
      name: /Edit URL|builder_project_domain_edit_url_button/i,
    });
    await editButton.click();

    const domainInput = page.locator('#project-domain-name');
    await expect(domainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Clear and type a value that's too short (< 5 chars).
    // See "Save disables Cancel" test for why pressSequentially is required here.
    await domainInput.click({ clickCount: 3 });
    await domainInput.pressSequentially('ab');

    // Error message about minimum length should appear
    await expect(
      page.getByText(/at least 5 characters|builder_project_domain_error_min_length/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Save should remain disabled
    const editActions = page.getByTestId('project-domain-edit-actions');
    const saveButton = editActions.getByRole('button', {
      name: /Save|Checking|builder_project_domain_save|builder_project_domain_button_checking/i,
    });
    await expect(saveButton).toBeDisabled();

    // Cancel to restore state
    const cancelButton = editActions.getByRole('button', {
      name: /Cancel|builder_project_domain_button_cancel/i,
    });
    await cancelButton.click();
  });

  test('Validation: invalid characters shows error', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Enter edit mode
    const editButton = projectDomainCard.getByRole('button', {
      name: /Edit URL|builder_project_domain_edit_url_button/i,
    });
    await editButton.click();

    const domainInput = page.locator('#project-domain-name');
    await expect(domainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Type invalid characters (underscores). Input must start and end with
    // alphanumeric so only hasInvalidCharacters fires; if the last character
    // were non-alphanumeric (e.g. '!'), hasInvalidBounds would trigger first
    // and the wrong error message would appear (bounds is checked before chars).
    // See "Save disables Cancel" test for why pressSequentially is required here.
    await domainInput.click({ clickCount: 3 });
    await domainInput.pressSequentially('my_invalid_domain');

    // Error about invalid characters
    await expect(
      page.getByText(/letters, numbers, periods.*and hyphens|builder_project_domain_error_invalid_characters/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Save should be disabled
    const editActions = page.getByTestId('project-domain-edit-actions');
    const saveButton = editActions.getByRole('button', {
      name: /Save|Checking|builder_project_domain_save|builder_project_domain_button_checking/i,
    });
    await expect(saveButton).toBeDisabled();

    // Cancel to restore state
    const cancelButton = editActions.getByRole('button', {
      name: /Cancel|builder_project_domain_button_cancel/i,
    });
    await cancelButton.click();
  });

  test('Validation: invalid bounds shows error', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Enter edit mode
    const editButton = projectDomainCard.getByRole('button', {
      name: /Edit URL|builder_project_domain_edit_url_button/i,
    });
    await editButton.click();

    const domainInput = page.locator('#project-domain-name');
    await expect(domainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Type a value starting with a hyphen (invalid bounds).
    // See "Save disables Cancel" test for why pressSequentially is required here.
    await domainInput.click({ clickCount: 3 });
    await domainInput.pressSequentially('-invalid-start');

    // Error about invalid bounds
    await expect(
      page.getByText(/start and end with a letter or number|builder_project_domain_error_invalid_bounds/i),
    ).toBeVisible({ timeout: DEFAULT_TIMEOUT });

    // Save should be disabled
    const editActions = page.getByTestId('project-domain-edit-actions');
    const saveButton = editActions.getByRole('button', {
      name: /Save|Checking|builder_project_domain_save|builder_project_domain_button_checking/i,
    });
    await expect(saveButton).toBeDisabled();

    // Cancel to restore state
    const cancelButton = editActions.getByRole('button', {
      name: /Cancel|builder_project_domain_button_cancel/i,
    });
    await cancelButton.click();
  });

  test('URL bar click activates edit mode', { tag: ['@thorough', '@publish'] }, async ({ page }, testInfo) => {
    testInfo.setTimeout(120_000);

    const projectDomainCard = await navigateToProjectDomainCard(page);

    // Click the URL display area to enter edit mode
    const urlDisplay = page.getByTestId('project-domain-url-display');
    await expect(urlDisplay).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await urlDisplay.click();

    // Input should appear and be focused
    const domainInput = page.locator('#project-domain-name');
    await expect(domainInput).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    await expect(domainInput).toBeFocused();

    // Edit actions should be visible
    await expect(page.getByTestId('project-domain-edit-actions')).toBeVisible();

    // Cancel to restore
    const editActions = page.getByTestId('project-domain-edit-actions');
    const cancelButton = editActions.getByRole('button', {
      name: /Cancel|builder_project_domain_button_cancel/i,
    });
    await cancelButton.click();
  });
});
