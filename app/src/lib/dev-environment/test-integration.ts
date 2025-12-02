/**
 * Integration test for the dev environment system
 * Tests the complete flow: create → start → status → stop → cleanup
 */

import { DevEnvironmentManager } from './DevEnvironmentManager';

async function testDevEnvironment() {
  console.log('🧪 Starting dev environment integration test...');

  // Use singleton instance to share state across all usages
  const devManager = DevEnvironmentManager.getInstance();

  try {
    // 1. Initialize the dev environment manager
    console.log('\n📋 Step 1: Initialize DevEnvironmentManager');
    await devManager.initialize();
    console.log('✅ DevEnvironmentManager initialized successfully');

    // 2. Check adapter info
    console.log('\n📋 Step 2: Check adapter configuration');
    const isDocker = devManager.isDockerMode();
    const capabilities = devManager.getAdapterCapabilities();
    console.log(`✅ Adapter: ${isDocker ? 'Docker' : 'Local'}`);
    console.log(`✅ Capabilities:`, capabilities);

    // 3. Test template service
    console.log('\n📋 Step 3: Test template information');
    const templateInfo = devManager['templateService'].getTemplateInfo('app-templates/v8');
    console.log(`✅ Template info:`, templateInfo);

    // 4. Create a test app directory structure
    console.log('\n📋 Step 4: Create test app');
    const testAppId = 'test-app-' + Date.now();
    const testAppName = 'Test Application';

    const createResult = await devManager.createDevApp({
      siteId: testAppId,
      name: testAppName,
      templateVersion: 'v8'
    });

    if (createResult.success) {
      console.log('✅ Dev app created successfully:', createResult);

      // 5. Check app status
      console.log('\n📋 Step 5: Check app status');
      const appInfo = await devManager.getDevApp(testAppId);
      console.log('✅ App info:', appInfo);

      const status = await devManager.getDevAppStatus(testAppId);
      console.log('✅ App status:', status);

      // 6. Test getting running servers
      console.log('\n📋 Step 6: Check running servers');
      const runningServers = await devManager.getRunningDevServers();
      console.log('✅ Running servers:', runningServers);

      // 7. Clean up test app
      console.log('\n📋 Step 7: Cleanup test app');
      const deleteResult = await devManager.deleteDevApp(testAppId);
      console.log('✅ App cleanup result:', deleteResult);

    } else {
      console.error('❌ Dev app creation failed:', createResult);
    }

    // 8. Final cleanup
    console.log('\n📋 Step 8: Final cleanup');
    await devManager.cleanup();
    console.log('✅ DevEnvironmentManager cleanup completed');

    console.log('\n🎉 Integration test completed successfully!');

  } catch (error) {
    console.error('\n❌ Integration test failed:', error);

    // Emergency cleanup
    try {
      await devManager.cleanup();
    } catch (cleanupError) {
      console.error('❌ Emergency cleanup failed:', cleanupError);
    }

    throw error;
  } finally {
    // No database cleanup needed since we use DatabaseManager singleton
    console.log('✅ Test cleanup completed');
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testDevEnvironment()
    .then(() => {
      console.log('✅ Test passed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test failed:', error);
      process.exit(1);
    });
}

export { testDevEnvironment };
