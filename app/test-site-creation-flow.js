#!/usr/bin/env node
/**
 * Integration test for the site creation flow
 * Tests the complete flow: quick-create -> deploy -> polling -> verification
 * 
 * Run with: node test-site-creation-flow.js
 */

const assert = require('assert');
const { setTimeout } = require('timers/promises');

const BASE_URL = 'http://localhost:3007';
const AGENTS_BASE_URL = 'http://localhost:4000';

// Test configuration
const TEST_PROMPT = 'Create a simple blog website with a homepage and about page';
const MAX_POLL_ATTEMPTS = 60; // 5 minutes max
const POLL_INTERVAL = 5000; // 5 seconds

console.log('🧪 Starting Site Creation Flow Integration Test');
console.log('================================================');

async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        // Add mock auth header for dev environment
        'X-Mock-User': JSON.stringify({
          accountId: 'test-account-123',
          shopperId: 'test-shopper-123'
        }),
        ...options.headers
      },
      ...options
    });

    const responseText = await response.text();
    let responseData = null;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = { rawText: responseText };
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: responseData,
      url: response.url
    };
  } catch (error) {
    console.error(`❌ Request to ${url} failed:`, error.message);
    throw error;
  }
}

async function testStep1_QuickCreate() {
  console.log('\n📝 Step 1: Testing quick site creation...');
  
  const response = await makeRequest(`${BASE_URL}/api/sites/quick-create`, {
    method: 'POST',
    body: JSON.stringify({
      initialPrompt: TEST_PROMPT
    })
  });

  console.log(`   Status: ${response.status} ${response.statusText}`);
  console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);

  assert.strictEqual(response.ok, true, 'Quick create should succeed');
  assert.ok(response.data.id, 'Should return a site ID');
  assert.ok(response.data.account_id, 'Should return an account ID');

  console.log(`✅ Quick create successful! Site ID: ${response.data.id}, Account ID: ${response.data.account_id}`);
  return response.data;
}

async function testStep2_TriggerDeployment(siteId) {
  console.log(`\n🚀 Step 2: Testing deployment trigger for site ${siteId}...`);
  
  const response = await makeRequest(`${BASE_URL}/api/sites/${siteId}/deploy`, {
    method: 'POST'
  });

  console.log(`   Status: ${response.status} ${response.statusText}`);
  console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);

  assert.strictEqual(response.ok, true, 'Deployment trigger should succeed');
  assert.ok(response.data.success, 'Should return success: true');
  
  console.log(`✅ Deployment triggered successfully!`);
  return response.data;
}

async function testStep3_PollForCompletion(siteId) {
  console.log(`\n⏳ Step 3: Polling for deployment completion (max ${MAX_POLL_ATTEMPTS * POLL_INTERVAL / 1000}s)...`);
  
  let attempts = 0;
  let lastStatus = 'unknown';
  
  while (attempts < MAX_POLL_ATTEMPTS) {
    attempts++;
    
    const response = await makeRequest(`${BASE_URL}/api/sites/${siteId}`);
    
    if (!response.ok) {
      console.log(`   ⚠️  Attempt ${attempts}: Failed to get site status (${response.status})`);
      await setTimeout(POLL_INTERVAL);
      continue;
    }

    const site = response.data;
    
    if (site.status !== lastStatus) {
      console.log(`   📊 Attempt ${attempts}: Status changed to '${site.status}'`);
      console.log(`      Agent URL: ${site.agent_url || 'Not set'}`);
      lastStatus = site.status;
    } else {
      process.stdout.write('.');
    }

    // Check if deployment is complete
    if (site.status === 'running' && site.agent_url) {
      console.log(`\n✅ Deployment completed! Site is running with agent URL: ${site.agent_url}`);
      return site;
    }

    // Check for failure
    if (site.status === 'failed') {
      throw new Error(`Deployment failed! Site status: ${site.status}`);
    }

    await setTimeout(POLL_INTERVAL);
  }
  
  throw new Error(`Timeout: Site did not become ready within ${MAX_POLL_ATTEMPTS * POLL_INTERVAL / 1000} seconds`);
}

async function testStep4_VerifyAgentEndpoint(site) {
  console.log(`\n🔍 Step 4: Verifying agent endpoint is working...`);
  
  const agentUrl = site.agent_url;
  const siteId = site.id;
  
  console.log(`   Testing: ${agentUrl}/ensure-running`);
  
  try {
    const response = await makeRequest(`${agentUrl}/ensure-running`, {
      method: 'POST'
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);

    assert.ok(response.ok, 'Agent endpoint should be accessible');
    assert.ok(response.data.success !== undefined, 'Should return a valid response');

    console.log(`✅ Agent endpoint is working correctly!`);
    return response.data;
  } catch (error) {
    console.error(`❌ Agent endpoint verification failed:`, error.message);
    throw error;
  }
}

async function testStep5_VerifyNameSuggestion(site) {
  console.log(`\n🏷️  Step 5: Testing AI name suggestion...`);
  
  const agentUrl = site.agent_url;
  
  console.log(`   Testing: ${AGENTS_BASE_URL}/apps/suggest-name`);
  
  try {
    const response = await makeRequest(`${AGENTS_BASE_URL}/apps/suggest-name`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: TEST_PROMPT
      })
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);

    assert.ok(response.ok, 'Name suggestion endpoint should work');
    assert.ok(response.data.name || response.data.suggestedName, 'Should return a suggested name');

    const suggestedName = response.data.name || response.data.suggestedName;
    console.log(`✅ AI suggested name: "${suggestedName}"`);
    return suggestedName;
  } catch (error) {
    console.error(`❌ Name suggestion failed:`, error.message);
    throw error;
  }
}

async function testStep6_UpdateSiteName(siteId, suggestedName) {
  console.log(`\n📝 Step 6: Testing site name update...`);
  
  const response = await makeRequest(`${BASE_URL}/api/sites/${siteId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: suggestedName
    })
  });

  console.log(`   Status: ${response.status} ${response.statusText}`);
  console.log(`   Response: ${JSON.stringify(response.data, null, 2)}`);

  assert.ok(response.ok, 'Site name update should succeed');
  assert.strictEqual(response.data.name, suggestedName, 'Site name should be updated');

  console.log(`✅ Site name updated successfully!`);
  return response.data;
}

async function testStep7_Cleanup(siteId) {
  console.log(`\n🧹 Step 7: Cleaning up test site...`);
  
  try {
    const response = await makeRequest(`${BASE_URL}/api/sites/${siteId}`, {
      method: 'DELETE'
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      console.log(`✅ Test site cleaned up successfully!`);
    } else {
      console.log(`⚠️  Cleanup warning: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`⚠️  Cleanup error: ${error.message}`);
  }
}

async function runIntegrationTest() {
  let siteId = null;
  
  try {
    // Step 1: Quick create
    const site = await testStep1_QuickCreate();
    siteId = site.id;

    // Step 2: Trigger deployment
    await testStep2_TriggerDeployment(siteId);

    // Step 3: Poll for completion
    const completedSite = await testStep3_PollForCompletion(siteId);

    // Step 4: Verify agent endpoint
    await testStep4_VerifyAgentEndpoint(completedSite);

    // Step 5: Test name suggestion
    const suggestedName = await testStep5_VerifyNameSuggestion(completedSite);

    // Step 6: Update site name
    await testStep6_UpdateSiteName(siteId, suggestedName);

    console.log('\n🎉 ALL TESTS PASSED! Site creation flow is working correctly.');
    console.log('================================================');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('================================================');
    
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    
    process.exit(1);
  } finally {
    // Always try to clean up
    if (siteId) {
      await testStep7_Cleanup(siteId);
    }
  }
}

// Check if both services are running
async function checkServices() {
  console.log('🔍 Checking if services are running...');
  
  try {
    const appResponse = await makeRequest(`${BASE_URL}/api/health`);
    console.log(`   App service (${BASE_URL}): ${appResponse.ok ? '✅ Running' : '❌ Down'}`);
  } catch (error) {
    console.error(`   App service (${BASE_URL}): ❌ Down - ${error.message}`);
    process.exit(1);
  }
  
  try {
    const agentsResponse = await makeRequest(`${AGENTS_BASE_URL}/health`);
    console.log(`   Agents service (${AGENTS_BASE_URL}): ${agentsResponse.ok ? '✅ Running' : '❌ Down'}`);
  } catch (error) {
    console.error(`   Agents service (${AGENTS_BASE_URL}): ❌ Down - ${error.message}`);
    process.exit(1);
  }
}

// Main execution
(async () => {
  await checkServices();
  console.log('');
  await runIntegrationTest();
})();