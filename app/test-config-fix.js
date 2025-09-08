#!/usr/bin/env node

/**
 * Test the config endpoint fix
 */

console.log('🔧 Testing Config Endpoint Fix');
console.log('==============================');
console.log('');

console.log('📊 URL Construction:');
console.log('1. Agent URL: http://localhost:4000/apps/1bf19353-d77e-4254-bba7-b8089f4cdaea');
console.log('2. Remove app-specific path: http://localhost:4000');  
console.log('3. Add global config path: http://localhost:4000/apps/config');
console.log('');

console.log('🧪 Testing the fix:');
console.log('Now navigate to the develop page and check that:');
console.log('✅ No more "Failed to fetch config: 404" errors');
console.log('✅ App initialization completes successfully');
console.log('✅ showUsageCost configuration is loaded');
console.log('');

console.log('🎯 Expected behavior:');
console.log('The config endpoint should now resolve correctly and return:');
console.log('{"config":{"showUsageCost":true}}');
console.log('');

console.log('🚨 If it still fails, check:');
console.log('   📡 Is the agents server running on port 4000?');
console.log('   🌐 Is the URL construction logic working correctly?');