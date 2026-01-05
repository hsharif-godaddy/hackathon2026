import { test, expect } from '@playwright/test';

/**
 * Fill in sign-in credentials
 */
async function fillCredentials(locatorOrPage, username, password) {
  await locatorOrPage.getByRole('textbox', { name: 'Username or Customer #' }).fill(username);
  await locatorOrPage.getByRole('textbox', { name: 'Password' }).fill(password);
  await locatorOrPage.getByRole('button', { name: 'Sign In', exact: true }).click();
}

async function getIframeFrame(iframeLocator) {
  const frame = await iframeLocator.contentFrame();
  if (!frame) {
    throw new Error('Sign-in iframe content frame not accessible');
  }
  return frame;
}

/**
 * Delete all sites via UI navigation
 * Used as fallback when API cleanup isn't possible
 */
async function deleteAllSitesViaUI(page) {
  console.log('🧹 Deleting all sites via UI...');

  await page.goto('/apps');
  await page.waitForTimeout(20000);

  const allButtons = await page.getByRole('button').all();
  console.log(`Found ${allButtons.length} total buttons on page`);
  for (const btn of allButtons) {
    const ariaLabel = await btn.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.includes('Delete')) {
      console.log(`  Delete button found: "${ariaLabel}"`);
    }
  }

  const siteDeleteButtons = page.getByRole('button', { name: /Delete app/i });
  const deleteCount = await siteDeleteButtons.count();

  if (deleteCount > 0) {
    console.log(`Found ${deleteCount} existing site(s) to delete`);

    for (let i = 0; i < deleteCount; i++) {
      try {
        await siteDeleteButtons.first().click();
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        console.log(`✅ Deleted site ${i + 1}/${deleteCount}`);
        await page.waitForTimeout(2000);
      } catch (error) {
        console.log(`⚠️ Could not delete site ${i + 1}: ${error.message}`);
      }
    }
    console.log('🎯 Site cleanup completed');
    return deleteCount;
  } else {
    console.log('⚠️ No existing sites found');
    return 0;
  }
}

/**
 * Delete all test sites via API using the browser's authenticated context
 * Uses page.evaluate to make fetch calls with the browser's auth cookies
 */
async function deleteAllSitesViaAPI(page) {
  console.log('🧹 Cleaning up test sites via API...');

  try {
    // Use the browser context to make authenticated API calls
    const result = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/sites');
        if (!response.ok) {
          return { error: `Could not fetch sites: ${response.status}`, deletedCount: 0 };
        }

        const sites = await response.json();
        if (!Array.isArray(sites) || sites.length === 0) {
          return { message: 'No sites found to clean up', deletedCount: 0 };
        }

        let deletedCount = 0;
        const errors = [];

        for (const site of sites) {
          try {
            const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
            if (deleteResponse.ok) {
              deletedCount++;
            } else {
              errors.push(`Failed to delete ${site.id}: ${deleteResponse.status}`);
            }
          } catch (err) {
            errors.push(`Error deleting ${site.id}: ${String(err)}`);
          }
        }

        return { deletedCount, total: sites.length, errors };
      } catch (err) {
        return { error: String(err), deletedCount: 0 };
      }
    });

    if (result.error) {
      console.log(`⚠️ ${result.error}`);
    } else if (result.message) {
      console.log(`⚠️ ${result.message}`);
    } else {
      console.log(`🎯 API cleanup completed: ${result.deletedCount}/${result.total} sites deleted`);
      if (result.errors?.length > 0) {
        result.errors.forEach(err => console.log(`  ⚠️ ${err}`));
      }
    }

    return result.deletedCount || 0;
  } catch (error) {
    console.log(`⚠️ API cleanup failed: ${error.message}`);
    return 0;
  }
}

test.describe('Complete User Journey', () => {
  /**
   * Post-test cleanup - runs after each test regardless of pass/fail
   * Ensures orphaned apps are cleaned up even if test fails mid-flow
   * (e.g., budget exceeded errors, timeouts, network failures)
   * Uses browser context to make authenticated API calls
   */
  test.afterEach(async ({ page }) => {
    console.log('🧹 Running post-test cleanup...');
    await deleteAllSitesViaAPI(page);
  });

  test('should sign in and create a site', async ({ page }) => {
    // Navigate to the application
    await page.goto('/');
    
    // Wait for the input field to be visible and ready
    await page.getByPlaceholder('Describe your app idea...').waitFor({ state: 'visible', timeout: 30000 });
    console.log('✅ Home page loaded');
    
    // Fill in app description BEFORE signing in
    console.log('📝 Filling in app description...');
    await page.getByPlaceholder('Describe your app idea...').fill('Create a simple Hello World website very quickly using less tokens and using red color scheme and dont ask for any additional information like color scheme', { timeout: 30000 });
    console.log('🚀 Clicking Start building button...');
    await page.getByRole('button', { name: 'Start building' }).click({ timeout: 30000 });
    console.log('✅ Start building clicked, should redirect to sign in...');
    
    // Wait for sign-in - could be a modal (prod) or redirect (test env)
    const username = process.env.TEST_USERNAME;
    const password = process.env.TEST_PASSWORD;
    
    if (!username || !password) {
      throw new Error('TEST_USERNAME and TEST_PASSWORD environment variables must be set');
    }
    
    // Check for sign-in: could be iframe modal (prod) or URL redirect (test env)
    console.log('⏳ Waiting for sign-in (iframe modal or redirect)...');
    
    // Production: Sign-in is inside an iframe
    const signInIframe = page.locator('iframe[title="Container for sign in"]');
    
    const signInType = await Promise.race([
      signInIframe.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'iframe' as const),
      page.waitForURL('**/login**', { timeout: 30000 }).then(() => 'redirect' as const)
    ]).catch(() => null);
    
    if (signInType === 'iframe') {
      console.log('✅ Sign-in iframe modal detected (production mode)');
      await fillCredentials(await getIframeFrame(signInIframe), username, password);
    } else if (signInType === 'redirect') {
      console.log('✅ Redirected to sign-in page (test environment)');
      await fillCredentials(page, username, password);
    } else {
      throw new Error('❌ Sign-in failed: Timed out waiting for either iframe modal or login redirect (30s)');
    }
    console.log('✅ Signed in, should continue with building...');
    
    // Wait for direct redirect to develop page (create route removed)
    console.log('⏳ Waiting for site creation and redirect to develop page (up to 5 minutes)...');
    await page.waitForURL('**/develop/**', { timeout: 300000 });
    console.log('✅ Site creation completed - redirected to develop page');
    
    // Wait 2 minutes for site to fully stabilize and complete building
    console.log('⏳ Waiting 2 minutes for site to fully stabilize...');
    await page.waitForTimeout(120000); // 2 minutes
    console.log('✅ 2 minute wait completed');
    
        
    // Verify the site contains "Hello World" by checking the preview iframe
    console.log('🔍 Verifying site contains "Hello World" (anywhere in the page)...');
    // Use a dynamic selector that matches any Preview iframe (with or without app ID)
    const previewFrame = page.locator('iframe[title^="Preview"]').first().contentFrame();
    
    // Try multiple ways to find "Hello World" - could be in heading, paragraph, div, or anywhere
    try {
      // First try to find it as a heading
      await expect(previewFrame.getByRole('heading', { name: /hello\s*world/i })).toBeVisible({ timeout: 5000 });
      console.log('✅ Site verified - found "Hello World" in heading');
    } catch {
      // If not in heading, search anywhere in the body content
      await expect(previewFrame.locator('body')).toContainText(/hello\s*world/i, { timeout: 5000 });
      console.log('✅ Site verified - found "Hello World" in page content');
    }
    
    // Cleanup is handled by afterEach hook via API, which runs even if test fails
    console.log('🎉 Complete user journey with site creation finished successfully!');
  });
});
