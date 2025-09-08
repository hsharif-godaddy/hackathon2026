#!/usr/bin/env node

/**
 * Test script to verify the complete auto-send functionality on develop page
 */

const siteId = '540bbfbd-e6f1-40be-8255-e4c55a4a58ea';
const expectedPrompt = 'Create a simple todo list app with React';

console.log('🧪 Testing Develop Page Auto-Send Functionality');
console.log('===============================================');
console.log(`🎯 Site ID: ${siteId}`);
console.log(`📝 Expected Initial Prompt: ${expectedPrompt}`);
console.log('');

async function verifySiteData() {
  console.log('📡 Step 1: Verifying site data...');
  
  try {
    const response = await fetch(`http://localhost:3000/api/sites/${siteId}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const siteData = await response.json();
    
    console.log('✅ Site data retrieved:', {
      id: siteData.id,
      name: siteData.name,
      status: siteData.status,
      hasInitialPrompt: !!siteData.initial_prompt,
      initialPrompt: siteData.initial_prompt,
      hasPreviewUrl: !!siteData.preview_url
    });
    
    if (siteData.status !== 'running') {
      console.log('❌ Site is not running. Current status:', siteData.status);
      return false;
    }
    
    if (!siteData.initial_prompt) {
      console.log('❌ Site does not have initial_prompt');
      return false;
    }
    
    if (siteData.initial_prompt !== expectedPrompt) {
      console.log(`❌ Initial prompt mismatch. Expected: "${expectedPrompt}", Got: "${siteData.initial_prompt}"`);
      return false;
    }
    
    console.log('✅ Site data verification passed!');
    return true;
    
  } catch (error) {
    console.error('❌ Site data verification failed:', error.message);
    return false;
  }
}

async function checkExistingConversations() {
  console.log('');
  console.log('💬 Step 2: Checking existing conversations...');
  
  try {
    const response = await fetch(`http://localhost:4000/apps/${siteId}/conversations`);
    
    if (!response.ok) {
      console.log('🔍 No conversations endpoint or conversations not accessible');
      return true; // This is expected for new sites
    }
    
    const conversations = await response.json();
    
    if (Array.isArray(conversations) && conversations.length > 0) {
      console.log(`⚠️  Site already has ${conversations.length} conversations. Auto-send may not trigger.`);
      console.log('   Conversations:', conversations.map(c => ({ id: c.id, messageCount: c.messages?.length || 0 })));
      return false;
    }
    
    console.log('✅ No existing conversations found. Auto-send should trigger.');
    return true;
    
  } catch (error) {
    console.log('🔍 Could not check conversations (this is expected for new sites)');
    return true;
  }
}

function explainAutoSendLogic() {
  console.log('');
  console.log('🤖 Step 3: Auto-send logic explanation...');
  console.log('');
  console.log('When you navigate to the develop page, this should happen:');
  console.log('');
  console.log('1. ⏳ Page loads and initializes stores');
  console.log('2. 🌐 useSite hook fetches site data');
  console.log('3. 🔍 Initial prompt check useEffect runs');
  console.log('4. 📝 Sets inputValue to site.initial_prompt');
  console.log('5. 🚀 Auto-send useEffect detects conditions and triggers send');
  console.log('');
  console.log('Auto-send conditions (all must be true):');
  console.log('  ✓ loadingState === "ready"');
  console.log('  ✓ site?.initial_prompt exists');
  console.log('  ✓ site.status === "running"');
  console.log('  ✓ conversations.length === 0');
  console.log('  ✓ !autoSendTriggered.current');
  console.log('  ✓ !isLoading');
  console.log('  ✓ !isInitialAppCreation (to avoid conflict with app-based flow)');
  console.log('');
}

function generateTestInstructions() {
  console.log('🧪 Step 4: Manual test instructions...');
  console.log('');
  console.log('Open browser dev tools (F12) and navigate to:');
  console.log(`🔗 http://localhost:3000/develop/${siteId}`);
  console.log('');
  console.log('Watch the console for these logs:');
  console.log('');
  console.log('📋 Expected log sequence:');
  console.log('1. "🌐 Fetching site data for appId: ' + siteId + '"');
  console.log('2. "✅ Site data fetched: Create a simple todo list app with React"');
  console.log('3. "🔍 Initial prompt check: {...}" (multiple times)');
  console.log('4. "📝 Setting initial prompt from site: Create a simple todo list app with React"');
  console.log('5. "🚀 Auto-sending message for new site with initial prompt: Create a simple todo list app with React..."');
  console.log('6. "✅ Auto-send completed"');
  console.log('');
  console.log('Visual indicators:');
  console.log('✅ Chat input should populate with the initial prompt');
  console.log('✅ After ~500ms, a message should appear in the chat');
  console.log('✅ The AI should start responding to build the todo app');
  console.log('');
  console.log('If auto-send doesn\'t work, check:');
  console.log('❓ Are there any errors in the console?');
  console.log('❓ Did all the auto-send conditions get met?');
  console.log('❓ Did the site data fetch successfully?');
  console.log('❓ Are there existing conversations preventing auto-send?');
  console.log('');
}

async function runTest() {
  const siteVerified = await verifySiteData();
  if (!siteVerified) {
    console.log('❌ Site verification failed. Cannot proceed with test.');
    return;
  }
  
  const conversationsOk = await checkExistingConversations();
  if (!conversationsOk) {
    console.log('⚠️  Existing conversations may prevent auto-send from triggering.');
  }
  
  explainAutoSendLogic();
  generateTestInstructions();
  
  console.log('🎉 Test setup complete! Ready for manual testing.');
  console.log('');
  console.log('🚨 IMPORTANT: Open browser dev tools BEFORE navigating to the develop page!');
}

runTest();