import { test, expect } from '@playwright/test';

/**
 * Delete all sites on the current page
 */
async function deleteAllSites(page) {
  console.log('🧹 Deleting all sites...');
  
  // Wait 5 seconds for the page to fully load
  await page.waitForTimeout(5000);
  
  // Look for all "Delete site [name]" aria-label buttons (trash icon buttons)
  const siteDeleteButtons = page.getByRole('button', { name: /^Delete site / });
  const deleteCount = await siteDeleteButtons.count();
  
  if (deleteCount > 0) {
    console.log(`Found ${deleteCount} existing site(s) to delete`);
    
    // Delete all sites one by one
    for (let i = 0; i < deleteCount; i++) {
      try {
        // Click the trash icon button to show the inline alert
        await siteDeleteButtons.first().click();
        await page.waitForTimeout(500);
        
        // Click the "Delete" button in the inline alert to confirm (use first() to avoid strict mode)
        await page.getByRole('button', { name: 'Delete' }).first().click();
        console.log(`✅ Deleted site ${i + 1}/${deleteCount}`);
        
        // Wait for deletion to process and UI to update
        await page.waitForTimeout(2000);
      } catch (error) {
        console.log(`⚠️ Could not delete site ${i + 1}: ${error.message}`);
      }
    }
    console.log('🎯 Site cleanup completed');
  } else {
    console.log('✅ No existing sites found');
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
    await page.getByPlaceholder('Describe your app idea...').fill('Create a simple Hello World website very quickly', { timeout: 30000 });
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
    
    // Navigate to My Sites and delete the created site
    await page.goto('/sites');
    await page.waitForTimeout(2000); // Wait for sites page to load
    await deleteAllSites(page);
    
    console.log('🎉 Complete user journey with site creation and deletion finished successfully!');
  });
});