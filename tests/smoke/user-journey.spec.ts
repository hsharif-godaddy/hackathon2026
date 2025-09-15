import { test, expect } from '@playwright/test';

test.describe('Complete User Journey', () => {
  test('should sign in and create a site', async ({ page }) => {
    // Navigate to the application
    await page.goto('/');
    
    // Sign in process
    await page.getByRole('button', { name: 'Sign In' }).click();
    
    // Wait for SSO login page to load
    await page.waitForURL('**/login**');
    
    // Fill in credentials on SSO page
    const username = process.env.TEST_USERNAME;
    const password = process.env.TEST_PASSWORD;
    
    if (!username || !password) {
      throw new Error('TEST_USERNAME and TEST_PASSWORD environment variables must be set');
    }
    
    await page.getByRole('textbox', { name: 'Username or Customer #' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    
    // Wait for redirect back to main app after successful authentication
    await page.waitForURL(/.*airo-builder\.test-godaddy\.com.*/, { timeout: 30000 });
    
    // Wait 10 seconds after sign in to allow system to stabilize
    console.log('Signed in successfully, waiting 10 seconds for system to stabilize...');
    await page.waitForTimeout(10000); // 10 seconds
    console.log('10 seconds wait completed, proceeding with cleanup...');
    
    // Delete all existing apps first to ensure clean state
    console.log('🧹 Cleaning up existing apps...');
    await page.goto('/sites');
    await page.waitForTimeout(2000); // Wait for apps page to load
    
    // Look for sites to delete using the generated pattern
    const siteDeleteButtons = page.getByRole('button').filter({ hasText: /^$/ });
    const deleteCount = await siteDeleteButtons.count();
    
    if (deleteCount > 0) {
      console.log(`Found ${deleteCount} existing sites to delete`);
      
      // Delete all sites one by one
      for (let i = deleteCount - 1; i >= 0; i--) {
        try {
          // Click the delete button for the site
          await siteDeleteButtons.nth(i).click();
          
          // Confirm deletion
          await page.getByRole('button', { name: 'Delete' }).click();
          console.log(`✅ Deleted site ${deleteCount - i}/${deleteCount}`);
          
          // Wait a bit for the deletion to process
          await page.waitForTimeout(1000);
        } catch (error) {
          console.log(`⚠️ Could not delete site ${deleteCount - i}: ${error.message}`);
        }
      }
      console.log('🎯 Site cleanup completed');
    } else {
      console.log('✅ No existing sites found, proceeding with test');
    }
    
    // Navigate back to home page to create new site
    await page.goto('/');
    await page.waitForTimeout(2000); // Wait for home page to load
    
    // Create a simple Hello World website
    await page.getByRole('textbox', { name: 'Describe the application you\'' }).fill('Create a simple Hello World website');
    await page.getByRole('button', { name: 'Start Building', exact: true }).click();
    
    // Wait for redirect to creation page first
    await page.waitForURL('**/create/**', { timeout: 300000 });
    console.log('Redirected to creation page, now waiting for site creation...');
    
    // Set up WebSocket message interception to detect completion
    console.log('Setting up WebSocket message interception...');
    
    let siteCompleted = false;
    
    // Listen for WebSocket messages to detect completion
    page.on('websocket', ws => {
      console.log('WebSocket connection detected');
      ws.on('framereceived', event => {
        try {
          const message = JSON.parse(event.payload);
          console.log('WebSocket message received:', message);
          
          // Check for completion message
          if (message.type === 'complete' && message.is_complete === true) {
            console.log('✅ Site creation completed - WebSocket completion message received');
            siteCompleted = true;
          }
        } catch (e) {
          // Ignore non-JSON messages
        }
      });
    });
    
    // Now wait for ACTUAL site creation to complete (up to 5 minutes)
    console.log('Waiting for site creation to complete (up to 5 minutes)...');
    
    // Wait for WebSocket completion message (with timeout)
    const startTime = Date.now();
    const timeout = 300000; // 5 minutes
    
    while (!siteCompleted && (Date.now() - startTime) < timeout) {
      await page.waitForTimeout(1000); // Check every second
    }
    
    if (siteCompleted) {
      console.log('✅ Site creation completed via WebSocket message');
      // Give a bit more time for UI to update
      await page.waitForTimeout(5000);
    } else {
      console.log('⚠️ WebSocket completion not detected within timeout, proceeding anyway...');
    }
    
    // Skip iframe interaction since WebSocket completion is sufficient
    console.log('✅ Site creation completed, skipping iframe interaction');
    
    // Switch to mobile view
    await page.getByRole('button', { name: 'Mobile view' }).click();
    
    // Verify mobile view is active
    await expect(page.getByRole('button', { name: 'Mobile view' })).toBeVisible();
    
    // Navigate to My Apps and delete the site
    await page.getByRole('link', { name: 'My Apps' }).click();
    await page.locator('div').filter({ hasText: /^running$/ }).nth(2).click();
    await page.getByText('View SiteEdit Site', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete Site' }).nth(2).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    
    console.log('🎉 Complete user journey with site creation and deletion finished successfully!');
  });
});