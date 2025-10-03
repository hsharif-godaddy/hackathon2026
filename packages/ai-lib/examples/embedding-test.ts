import { config } from 'dotenv';
import { resolve } from 'path';
import { getEmbeddingModel } from '../src/providers/unified-provider.js';
import { generateEmbeddings } from '../src/utils/embeddings.js';

config({ path: resolve(process.cwd(), '../../agents/.env') });

async function testEmbeddings() {
  console.log('Testing OpenAI embeddings generation...');
  console.log('API Key present:', !!process.env.OPENAI_API_KEY);
  console.log('Base URL present:', !!process.env.OPENAI_BASE_URL);
  console.log('Base URL:', process.env.OPENAI_BASE_URL);
  
  const testTexts = [
    'Modern minimalist design with clean lines',
    'Retro 80s aesthetic with vibrant colors',
    'Natural organic textures and earthy tones'
  ];

  try {
    console.log('\nGenerating embeddings for test texts...');
    
    const embeddingModel = await getEmbeddingModel('text-embedding-3-small');
    
    const result = await generateEmbeddings(testTexts, embeddingModel);

    console.log('\n✓ Success!');
    console.log(`Generated ${result.embeddings.length} embeddings`);
    if (result.embeddings.length === 0) {
      console.error('No embeddings were generated.');
      process.exit(1);
    }
    console.log(`Each embedding has ${result.embeddings[0].embedding.length} dimensions`);
    console.log(`First few values of first embedding: [${result.embeddings[0].embedding.slice(0, 5).join(', ')}...]`);
    
    if (result.usage) {
      console.log(`\nToken usage: ${result.usage.totalTokens} tokens`);
    }
  } catch (error) {
    console.error('\n✗ Error generating embeddings:');
    console.error(error);
    process.exit(1);
  }
}

testEmbeddings();
