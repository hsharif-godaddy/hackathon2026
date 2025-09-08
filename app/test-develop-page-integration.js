#!/usr/bin/env node

/**
 * Integration test to verify the complete develop page site name display flow
 */

const siteId = '1bffe3a9-edc7-42d3-ae99-33fb7aef4ce1';
const expectedName = 'NameCraft';

console.log('🧪 Testing Complete Develop Page Integration');
console.log('===========================================');
console.log(`🎯 Target Site: ${siteId} ("${expectedName}")`);
console.log('');

async function testSiteStoreFlow() {
  console.log('🔄 Step 1: Testing site store data flow...');
  
  // Test the API endpoint that the site store will call
  try {
    const response = await fetch(`http://localhost:3000/api/sites/${siteId}`);
    
    if (!response.ok) {
      throw new Error(`Site API failed: ${response.status}`);
    }
    
    const siteData = await response.json();
    
    console.log('✅ Site data retrieved:', {
      id: siteData.id,
      name: siteData.name,
      status: siteData.status
    });
    
    // Verify it has the expected generated name
    if (siteData.name === expectedName) {
      console.log(`✅ Site name is correct: "${expectedName}"`);
    } else {
      console.log(`❌ Site name mismatch: expected "${expectedName}", got "${siteData.name}"`);
      return false;
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Site store flow test failed:', error.message);
    return false;
  }
}

async function testDevelopPageExpectedBehavior() {
  console.log('');
  console.log('📱 Step 2: Expected develop page behavior...');
  console.log('');
  console.log('When navigating to the develop page, the following should happen:');
  console.log('');
  console.log('1. 🌐 useSite hook triggers fetchSite() for appId:', siteId);
  console.log('2. 📡 Site store calls GET /api/sites/' + siteId);
  console.log('3. 📦 Store receives site data with name "NameCraft"');
  console.log('4. 🎨 Header component receives app object with site name');
  console.log('5. 📝 Header displays "NameCraft" instead of "App ' + siteId + '"');
  console.log('');
  console.log('🔍 Browser console should show:');
  console.log('   "🌐 Fetching site data for appId: ' + siteId + '"');
  console.log('   "✅ Site data fetched: NameCraft"');
  console.log('');
  return true;
}

async function generateTestInstructions() {
  console.log('');
  console.log('🧪 Manual Test Instructions:');
  console.log('============================');
  console.log('');
  console.log('1. Open browser and navigate to:');
  console.log('   🔗 http://localhost:3000/develop/' + siteId);
  console.log('');
  console.log('2. Check the header (top navigation bar):');
  console.log('   ✅ Should show: "NameCraft"');
  console.log('   ❌ Should NOT show: "App ' + siteId + '"');
  console.log('');
  console.log('3. Open browser developer tools (F12) and check console:');
  console.log('   ✅ Should see site fetching logs');
  console.log('   ✅ Should see "Site data fetched: NameCraft"');
  console.log('');
  console.log('4. If you see the raw app ID instead of "NameCraft":');
  console.log('   🔍 Check if site store is properly fetching data');
  console.log('   🔍 Check if Header is receiving the site name');
  console.log('   🔍 Look for any errors in console');
  console.log('');
}

async function runTest() {
  const storeTest = await testSiteStoreFlow();
  const behaviorTest = await testDevelopPageExpectedBehavior();
  
  console.log('📊 Pre-flight Test Results:');
  console.log(`   Site Store API: ${storeTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Expected Behavior: ${behaviorTest ? '✅ DOCUMENTED' : '❌ FAIL'}`);
  
  if (storeTest && behaviorTest) {
    await generateTestInstructions();
    console.log('🎉 All pre-flight checks passed! Ready for manual testing.');
  } else {
    console.log('❌ Pre-flight checks failed. Fix issues before manual testing.');
  }
}

runTest().catch(console.error);