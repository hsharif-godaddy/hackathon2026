#!/usr/bin/env node

/**
 * Test script to verify site name display functionality
 * This tests that the develop page correctly fetches and displays site names
 */

const siteId = '1bffe3a9-edc7-42d3-ae99-33fb7aef4ce1';
const expectedName = 'NameCraft';

console.log('🧪 Testing Site Name Display Functionality');
console.log('==========================================');
console.log(`🎯 Target Site ID: ${siteId}`);
console.log(`📝 Expected Name: ${expectedName}`);
console.log('');

async function testSiteAPI() {
  console.log('📡 Step 1: Testing /api/sites/[id] endpoint...');
  
  try {
    const response = await fetch(`http://localhost:3000/api/sites/${siteId}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const siteData = await response.json();
    console.log('✅ Site API Response:', {
      id: siteData.id,
      name: siteData.name,
      status: siteData.status,
      hasBackendUrl: !!siteData.backend_url,
      hasPreviewUrl: !!siteData.preview_url
    });
    
    if (siteData.name === expectedName) {
      console.log('✅ Site name matches expected value!');
      return true;
    } else {
      console.log(`❌ Site name mismatch! Expected: "${expectedName}", Got: "${siteData.name}"`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Site API test failed:', error.message);
    return false;
  }
}

async function testDevelopPageCanFetchSite() {
  console.log('');
  console.log('🔧 Step 2: Testing develop page site fetching...');
  console.log(`💡 Navigate to: http://localhost:3000/develop/${siteId}`);
  console.log('🔍 Check that the header shows "NameCraft" instead of "App 1bffe3a9-edc7-42d3-ae99-33fb7aef4ce1"');
  console.log('');
  console.log('📋 Manual Verification Steps:');
  console.log('   1. Open http://localhost:3000/develop/' + siteId);
  console.log('   2. Look at the header navigation area');
  console.log('   3. Verify it shows "NameCraft" as the app name');
  console.log('   4. Check browser console for site fetching logs');
  console.log('');
  return true;
}

async function runTests() {
  const apiTest = await testSiteAPI();
  const developTest = await testDevelopPageCanFetchSite();
  
  console.log('📊 Test Results:');
  console.log(`   Site API: ${apiTest ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Develop Page: ${developTest ? '✅ READY FOR MANUAL TEST' : '❌ FAIL'}`);
  
  if (apiTest) {
    console.log('');
    console.log('🎉 Site API is working correctly!');
    console.log('🔗 Test URL: http://localhost:3000/develop/' + siteId);
    console.log('👀 Expected header text: "NameCraft"');
  }
}

runTests().catch(console.error);