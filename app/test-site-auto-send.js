#!/usr/bin/env node

/**
 * Test script for auto-send initial prompt functionality on develop page
 */

console.log('🧪 Testing Site Auto-Send Initial Prompt Functionality');
console.log('====================================================');
console.log('');

const testPrompt = 'Create a simple todo list app with React';

async function createTestSite() {
  console.log('📝 Step 1: Creating test site with initial prompt...');
  console.log('   Prompt:', testPrompt);
  
  try {
    const response = await fetch('http://localhost:3000/api/sites/quick-create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        initialPrompt: testPrompt
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const siteData = await response.json();
    console.log('✅ Site created:', {
      id: siteData.id,
      name: siteData.name,
      status: siteData.status
    });
    
    return siteData.id;
    
  } catch (error) {
    console.error('❌ Site creation failed:', error.message);
    return null;
  }
}

async function deploySite(siteId) {
  console.log('');
  console.log('🚀 Step 2: Deploying site...');
  console.log('   Site ID:', siteId);
  
  try {
    const response = await fetch(`http://localhost:3000/api/sites/${siteId}/deploy`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const deployData = await response.json();
    console.log('✅ Deployment started:', deployData.message);
    
    return true;
    
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    return false;
  }
}

async function pollForRunning(siteId) {
  console.log('');
  console.log('⏳ Step 3: Waiting for site to be running...');
  
  const maxAttempts = 60; // 5 minutes
  const intervalMs = 5000; // 5 seconds
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:3000/api/sites/${siteId}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const siteData = await response.json();
      
      console.log(`   📊 Attempt ${attempt}: Status = ${siteData.status}`);
      
      if (siteData.status === 'running') {
        console.log('✅ Site is now running!');
        console.log('   Site data:', {
          id: siteData.id,
          name: siteData.name,
          status: siteData.status,
          hasInitialPrompt: !!siteData.initial_prompt,
          initialPrompt: siteData.initial_prompt?.substring(0, 50) + (siteData.initial_prompt?.length > 50 ? '...' : ''),
          hasPreviewUrl: !!siteData.preview_url
        });
        return siteData;
      }
      
      if (siteData.status === 'failed') {
        console.log('❌ Site deployment failed');
        return null;
      }
      
      // Wait before next attempt
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      
    } catch (error) {
      console.error(`   ❌ Attempt ${attempt} failed:`, error.message);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  console.log('❌ Timeout waiting for site to become running');
  return null;
}

async function testAutoSendBehavior(siteId) {
  console.log('');
  console.log('🧪 Step 4: Testing auto-send behavior...');
  console.log('');
  console.log('Expected behavior when navigating to develop page:');
  console.log('');
  console.log('1. 🌐 useSite hook should fetch site data');
  console.log('2. 📝 Should detect site.initial_prompt:', testPrompt);
  console.log('3. 📝 Should set inputValue to the initial prompt');
  console.log('4. 🚀 Should auto-send the initial prompt after 500ms');
  console.log('5. 💬 Should create first conversation with the prompt');
  console.log('');
  console.log('🔗 Test URL: http://localhost:3000/develop/' + siteId);
  console.log('');
  console.log('🔍 Console logs to look for:');
  console.log('   "🔍 Initial prompt check: {...}"');
  console.log('   "📝 Setting initial prompt from site: ' + testPrompt + '"');
  console.log('   "🚀 Auto-sending message for new site with initial prompt: ' + testPrompt.substring(0, 50) + '..."');
  console.log('   "✅ Auto-send completed"');
  console.log('');
}

async function runTest() {
  try {
    // Step 1: Create site with initial prompt
    const siteId = await createTestSite();
    if (!siteId) {
      console.log('❌ Test failed at site creation');
      return;
    }
    
    // Step 2: Deploy site
    const deployStarted = await deploySite(siteId);
    if (!deployStarted) {
      console.log('❌ Test failed at deployment');
      return;
    }
    
    // Step 3: Wait for running status
    const runningSite = await pollForRunning(siteId);
    if (!runningSite) {
      console.log('❌ Test failed waiting for running status');
      return;
    }
    
    // Step 4: Explain manual testing
    await testAutoSendBehavior(siteId);
    
    console.log('🎉 Test setup complete! Ready for manual testing.');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  }
}

runTest();