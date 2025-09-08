#!/usr/bin/env node

/**
 * Test script to verify the site-based flow fixes
 */

const siteId = '1bf19353-d77e-4254-bba7-b8089f4cdaea';

console.log('🔧 Testing Site-Based Flow Fixes');
console.log('=================================');
console.log(`🎯 Site ID: ${siteId}`);
console.log('');

console.log('📋 Fixed Issues:');
console.log('1. ✅ AppService.getConfig() - removed double /apps/ path');
console.log('2. ✅ Created /api/apps/[id]/git/return route for git operations');
console.log('3. ✅ Updated messageService to use buildDynamicWsUrl for WebSocket connections');
console.log('4. ✅ Updated messageService to use Next.js API route for git operations');
console.log('');

console.log('🧪 Manual Test Instructions:');
console.log('1. Open browser dev tools (F12)');
console.log(`2. Navigate to: http://localhost:3000/develop/${siteId}`);
console.log('3. Watch for these SUCCESS indicators:');
console.log('');
console.log('✅ Expected Success Logs:');
console.log('   🔗 Ensuring messages store currentAppId is set: 1bf19353-d77e-4254-bba7-b8089f4cdaea');
console.log('   ✅ Messages store currentAppId set: 1bf19353-d77e-4254-bba7-b8089f4cdaea');
console.log('   📱 Loading app data: 1bf19353-d77e-4254-bba7-b8089f4cdaea');
console.log('   ✅ Site data fetched: TruckBite Spot');
console.log('   🚀 Auto-sending initial prompt: Create a landing page for a food truck...');
console.log('   🔌 Connecting to WebSocket: wss://...');
console.log('   ✅ Auto-send completed');
console.log('');
console.log('❌ Previous Errors (should NOT appear):');
console.log('   ❌ GET .../apps/config 404 (Not Found)');
console.log('   ❌ POST .../git/return 404 (Not Found)');
console.log('   ❌ Static WebSocket URLs are no longer supported');
console.log('   ❌ Failed to build WebSocket URL');
console.log('');
console.log('🎯 Success Criteria:');
console.log('   ✓ Auto-send triggers without API errors');
console.log('   ✓ WebSocket connection established');
console.log('   ✓ No 404 errors in console');
console.log('   ✓ AI starts responding to build the food truck landing page');
console.log('');
console.log('🚨 If you still see errors, check:');
console.log('   📡 Is the agents server running on port 4000?');
console.log('   🌐 Is the site deployment completed and agent_url available?');
console.log('   🔌 Are WebSocket connections supported?');