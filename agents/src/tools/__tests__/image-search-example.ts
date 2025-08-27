/**
 * Example usage of the updated ImageSearchTool with multiple image support
 * 
 * This example demonstrates how to use the new functionality to search for multiple images.
 * 
 * Usage:
 * ```bash
 * cd agents
 * pnpm exec ts-node src/tools/__tests__/image-search-example.ts
 * ```
 * 
 * Note: This requires proper API keys to be configured in the environment.
 */

import { ImageSearchTool, findImage } from '../image-search-tool.js';

async function demonstrateImageSearch() {
  console.log('🔍 Image Search Tool - Multiple Images Demo\n');

  // Create the tool instance
  const imageSearchTool = new ImageSearchTool();

  try {
    // Example 1: Single image search (backward compatible)
    console.log('1. Single image search (traditional usage):');
    const singleResult = await imageSearchTool.searchImage('sunset over mountains');
    
    if (singleResult.success) {
      console.log(`✅ Found single image: ${singleResult.url}\n`);
    } else {
      console.log(`❌ Single image search failed: ${singleResult.error}\n`);
    }

    // Example 2: Multiple images search
    console.log('2. Multiple images search (new functionality):');
    const multipleResult = await imageSearchTool.searchImage('ocean waves', 3);
    
    if (multipleResult.success && multipleResult.urls) {
      console.log(`✅ Found ${multipleResult.urls.length} images:`);
      multipleResult.urls.forEach((url, index) => {
        console.log(`   ${index + 1}. ${url}`);
      });
      console.log();
    } else {
      console.log(`❌ Multiple images search failed: ${multipleResult.error}\n`);
    }

    // Example 3: Using the legacy function interface with multiple images
    console.log('3. Legacy function interface with multiple images:');
    const legacyResult = await findImage({ 
      prompt: 'forest landscape', 
      count: 2 
    });
    
    if (legacyResult.success && legacyResult.urls) {
      console.log(`✅ Found ${legacyResult.urls.length} images via legacy interface:`);
      legacyResult.urls.forEach((url, index) => {
        console.log(`   ${index + 1}. ${url}`);
      });
    } else if (legacyResult.success && legacyResult.url) {
      console.log(`✅ Found single image via legacy interface: ${legacyResult.url}`);
    } else {
      console.log(`❌ Legacy interface search failed: ${legacyResult.error}`);
    }

  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateImageSearch().catch(console.error);
}

export { demonstrateImageSearch };