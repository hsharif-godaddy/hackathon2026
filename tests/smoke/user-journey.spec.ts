import { test, expect } from '@playwright/test';

/**
 * Delete all sites on the current page
 * @returns number of sites deleted
 */
async function deleteAllSites(page) {
  console.log('🧹 Deleting all sites...');
  
  // Wait 20 seconds for the page to fully load
  await page.waitForTimeout(20000);
  
  // Debug: Log all buttons to see what's on the page
  const allButtons = await page.getByRole('button').all();
  console.log(`Found ${allButtons.length} total buttons on page`);
  for (const btn of allButtons) {
    const ariaLabel = await btn.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.includes('Delete')) {
      console.log(`  Delete button found: "${ariaLabel}"`);
    }
  }
  
  // Look for all delete buttons (trash icon with aria-label containing "Delete app")
  // The button name includes the app description, e.g. "Delete app Create a simple..."
  const siteDeleteButtons = page.getByRole('button', { name: /Delete app/i });
  const deleteCount = await siteDeleteButtons.count();
  
  if (deleteCount > 0) {
    console.log(`Found ${deleteCount} existing site(s) to delete`);
    
    // Delete all sites one by one
    for (let i = 0; i < deleteCount; i++) {
      try {
        // Click the trash icon button to show the inline alert
        await siteDeleteButtons.first().click();
        await page.waitForTimeout(500);
        
        // Click the "Delete" button in the inline alert to confirm
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        console.log(`✅ Deleted site ${i + 1}/${deleteCount}`);
        
        // Wait for deletion to process and UI to update
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

test.describe('Complete User Journey', () => {
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
    
    // Wait for SSO login page to load (redirected because not signed in)
    await page.waitForURL('**/login**', { timeout: 30000 });
    console.log('✅ Redirected to sign-in page');
    
    // Fill in credentials on SSO page
    const username = process.env.TEST_USERNAME;
    const password = process.env.TEST_PASSWORD;
    
    if (!username || !password) {
      throw new Error('TEST_USERNAME and TEST_PASSWORD environment variables must be set');
    }
    
    await page.getByRole('textbox', { name: 'Username or Customer #' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    console.log('✅ Signed in, should continue with building...');
    
    // Wait for redirect to creation page first
    await page.waitForURL('**/create/**', { timeout: 300000 });
    console.log('✅ Redirected to creation page, now waiting for site creation...');
    
    // Wait for automatic redirect to develop page (happens when site is ready)
    // The app automatically redirects from /create/[id] to /develop/[id] when complete
    console.log('⏳ Waiting for site creation to complete and auto-redirect to develop page (up to 5 minutes)...');
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
    
    // Navigate to My Apps and delete the created site
    await page.goto('/apps');
    await page.waitForTimeout(2000); // Wait for apps page to load
    const deletedCount = await deleteAllSites(page);
    
    // Verify at least one site was deleted (if none, the test failed to create a site)
    if (deletedCount === 0) {
      throw new Error('❌ Test failed: No sites found to delete. Site creation may have failed.');
    }
    console.log(`✅ Successfully deleted ${deletedCount} site(s)`);
    
    console.log('🎉 Complete user journey with site creation and deletion finished successfully!');
  });
});
