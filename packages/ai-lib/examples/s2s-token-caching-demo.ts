#!/usr/bin/env node

/**
 * S2S Token Caching Demo
 * 
 * Demonstrates JWT token caching behavior to optimize performance
 * by avoiding unnecessary SSO calls on every request.
 */

import { 
  isS2SAuthEnabled, 
  getS2SToken, 
  clearTokenCache, 
  getTokenCacheInfo 
} from '../src/index.js'

async function demonstrateTokenCaching() {
  console.log('🔬 S2S Token Caching Behavior Demo')
  console.log('=' .repeat(50))
  
  if (!isS2SAuthEnabled()) {
    console.log('❌ S2S authentication is not enabled')
    console.log('   Set GOCODE_USE_S2S_AUTH=true to run this demo')
    return
  }
  
  console.log('✅ S2S Authentication is enabled')
  console.log()
  
  // Clear any existing cache to start fresh
  clearTokenCache()
  console.log('🧹 Cleared token cache to start fresh')
  
  // Check initial cache state
  let cacheInfo = getTokenCacheInfo()
  console.log('📊 Initial cache state:', {
    hasCachedToken: cacheInfo.hasCachedToken
  })
  console.log()
  
  // First token fetch - should hit SSO service
  console.log('🔄 First token fetch (should hit SSO service)...')
  const start1 = Date.now()
  
  try {
    const token1 = await getS2SToken()
    const elapsed1 = Date.now() - start1
    
    console.log('✅ Token received in', elapsed1, 'ms')
    console.log('   Token preview:', token1.substring(0, 50) + '...')
    
    // Check cache state after first fetch
    cacheInfo = getTokenCacheInfo()
    console.log('📊 Cache state after first fetch:', {
      hasCachedToken: cacheInfo.hasCachedToken,
      expiresAt: cacheInfo.expiresAt?.toISOString(),
      timeUntilExpiration: cacheInfo.timeUntilExpiration ? Math.round(cacheInfo.timeUntilExpiration / 1000 / 60) + ' minutes' : 'N/A'
    })
    console.log()
    
    // Second token fetch - should use cache
    console.log('🔄 Second token fetch (should use cache)...')
    const start2 = Date.now()
    
    const token2 = await getS2SToken()
    const elapsed2 = Date.now() - start2
    
    console.log('✅ Token received in', elapsed2, 'ms')
    console.log('   Token matches:', token1 === token2 ? '✅ Same token (from cache)' : '❌ Different token')
    console.log('   Speed improvement:', Math.round((elapsed1 / elapsed2) * 100) / 100 + 'x faster')
    console.log()
    
    // Third token fetch - should still use cache
    console.log('🔄 Third token fetch (should still use cache)...')
    const start3 = Date.now()
    
    const token3 = await getS2SToken()
    const elapsed3 = Date.now() - start3
    
    console.log('✅ Token received in', elapsed3, 'ms')
    console.log('   Token matches:', token1 === token3 ? '✅ Same token (from cache)' : '❌ Different token')
    console.log()
    
    // Demonstrate cache clearing
    console.log('🧹 Clearing token cache...')
    clearTokenCache()
    
    cacheInfo = getTokenCacheInfo()
    console.log('📊 Cache state after clearing:', {
      hasCachedToken: cacheInfo.hasCachedToken
    })
    console.log()
    
    // Fourth token fetch - should hit SSO again
    console.log('🔄 Fourth token fetch (should hit SSO again)...')
    const start4 = Date.now()
    
    const token4 = await getS2SToken()
    const elapsed4 = Date.now() - start4
    
    console.log('✅ Token received in', elapsed4, 'ms')
    console.log('   Token matches original:', token1 === token4 ? '✅ Same token' : '❌ Different token (expected)')
    console.log()
    
    // Summary
    console.log('📈 Performance Summary:')
    console.log('   First fetch (SSO call):', elapsed1, 'ms')
    console.log('   Cached fetch #1:', elapsed2, 'ms')
    console.log('   Cached fetch #2:', elapsed3, 'ms')
    console.log('   After cache clear:', elapsed4, 'ms')
    console.log()
    console.log('💡 Cache Benefits:')
    console.log('   - Reduces SSO API calls from every request to once per 24 hours')
    console.log('   - Improves response time by ~' + Math.round((elapsed1 / elapsed2) * 100) / 100 + 'x')
    console.log('   - Maintains security with automatic expiration handling')
    
  } catch (error) {
    console.error('❌ Token caching demo failed:', error instanceof Error ? error.message : String(error))
  }
}

async function main() {
  await demonstrateTokenCaching()
}

main().catch(console.error)