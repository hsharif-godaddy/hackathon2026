#!/usr/bin/env node

/**
 * Test script to verify the auto-send fix
 */

const siteId = '540bbfbd-e6f1-40be-8255-e4c55a4a58ea';

console.log('🧪 Testing Auto-Send Fix');
console.log('========================');
console.log(`🎯 Site ID: ${siteId}`);
console.log('');

async function testFix() {
  console.log('📋 Testing Steps:');
  console.log('1. Open browser dev tools (F12)');
  console.log(`2. Navigate to: http://localhost:3000/develop/${siteId}`);
  console.log('3. Watch console for these key logs:');
  console.log('');
  console.log('✅ Expected Success Sequence:');
  console.log('   🔗 Ensuring messages store currentAppId is set: 540bbfbd-e6f1-40be-8255-e4c55a4a58ea');
  console.log('   ✅ Messages store currentAppId set: 540bbfbd-e6f1-40be-8255-e4c55a4a58ea');
  console.log('   🚀 Auto-sending initial prompt: Create a landing page for a food truck...');
  console.log('   ✅ Auto-send completed');
  console.log('');
  console.log('❌ Previous Error (should NOT appear):');
  console.log('   ❌ Message rejected: no currentAppId');
  console.log('');
  console.log('🎯 Success Indicators:');
  console.log('   ✓ Messages store currentAppId is set early in initialization');
  console.log('   ✓ Auto-send completes without rejection error');
  console.log('   ✓ Initial prompt appears in chat and AI starts responding');
  console.log('');
  console.log('🚨 IMPORTANT: If you still see the rejection error, the fix needs refinement');
}

testFix();