import { config } from 'dotenv';
import { resolve } from 'path';
import { RagTool } from '../src/tools/rag-tool.js';

config({ path: resolve(process.cwd(), '.env') });

async function importDesignData() {
  const ragTool = new RagTool();

  console.log('Initializing RAG tool and loading design data...');
  
  try {
    await ragTool.initialize();
    
    const allDesigns = await ragTool.getAll();
    
    console.log('\n=== Import Summary ===');
    console.log(`Total designs loaded: ${allDesigns.length}`);
    
    const classicStyles = await ragTool.getByType('classic-style');
    const designTrends = await ragTool.getByType('design-trend');
    
    console.log(`Classic styles: ${classicStyles.length}`);
    console.log(`Design trends: ${designTrends.length}`);
    
    console.log('\n=== Testing Search ===');
    const testSearch = await ragTool.search({ query: 'minimalist modern design', limit: 5, score_threshold: 0.5 });
    
    if (testSearch.success && testSearch.results) {
      console.log(`Found ${testSearch.results.length} results for "minimalist modern design":`);
      testSearch.results.forEach((result, i) => {
        console.log(`\n${i + 1}. ${result.key} (score: ${result.score.toFixed(3)})`);
        if (result.value && typeof result.value === 'object') {
          const design = result.value as any;
          console.log(`   Name: ${design.name}`);
          console.log(`   Type: ${design.type}`);
          console.log(`   Description: ${design.description.substring(0, 150)}...`);
          console.log(`   Use Cases: ${design.useCases?.slice(0, 3).join(', ')}`);
        }
      });
    } else {
      console.error('Search failed:', testSearch.error);
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

importDesignData();
