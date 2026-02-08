#!/usr/bin/env npx tsx
/**
 * Generate a search report for font pairings
 * Runs 50 queries and outputs results in markdown format
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { KnowBClient } from '../src/knowb-client.js';

// Load .env files
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: resolve(__dirname, '../.env.local') });
config({ path: resolve(__dirname, '../.env') });

// These queries simulate how an LLM would describe a business when searching for fonts
// Format: brief description of business type + target market/audience
const QUERIES = [
  // Food & Beverage
  'family-owned bakery serving neighborhood families with fresh pastries',
  'upscale farm-to-table restaurant targeting affluent food enthusiasts',
  'trendy bubble tea shop for Gen Z customers',
  'craft brewery with taproom for beer enthusiasts and locals',
  'organic juice bar targeting health-conscious millennials',
  'artisan chocolate shop for gift buyers and luxury treat seekers',
  'cozy neighborhood coffee roaster for remote workers',
  'fast-casual poke bowl restaurant for young urban professionals',
  'authentic Italian pizzeria for families and date nights',
  'vegan cafe targeting environmentally conscious consumers',

  // Professional Services
  'established law firm serving corporate clients and high-net-worth individuals',
  'boutique accounting firm for small business owners',
  'financial planning practice for pre-retirees and families',
  'modern dental practice targeting families with children',
  'executive coaching business for C-suite professionals',
  'immigration law office serving first-generation families',
  'pediatric therapy clinic for parents of special needs children',
  'architecture firm specializing in sustainable residential design',
  'management consulting for mid-market B2B companies',
  'real estate agency targeting first-time homebuyers',

  // Health & Wellness
  'boutique yoga studio for stressed professionals seeking mindfulness',
  'crossfit gym targeting competitive fitness enthusiasts',
  'holistic wellness center for women seeking self-care',
  'physical therapy practice for athletes and active adults',
  'meditation app for busy professionals with anxiety',
  'chiropractic clinic for office workers with back pain',
  'luxury day spa targeting brides and special occasions',
  'nutrition coaching for busy moms wanting healthy families',
  'pilates studio for postpartum mothers',
  'mental health practice for young adults and college students',

  // Creative & Lifestyle
  'wedding photography studio for romantic couples',
  'tattoo parlor with artistic custom designs for young adults',
  'interior design firm for affluent homeowners',
  'handmade jewelry brand for women who value unique accessories',
  'vintage furniture store for design-conscious millennials',
  'pet grooming salon for suburban dog owners',
  'independent bookstore for literary community',
  'floral design studio for weddings and events',
  'custom framing shop for art collectors',
  'music lessons studio for children and hobbyist adults',

  // Tech & Modern Business
  'B2B SaaS startup targeting enterprise customers',
  'mobile app development agency for startups',
  'cybersecurity consulting for small businesses',
  'e-commerce brand selling sustainable home goods',
  'digital marketing agency for local service businesses',
  'AI-powered HR platform for mid-size companies',
  'fintech app for young professionals managing money',
  'edtech platform for K-12 teachers and students',
  'subscription box service for pet owners',
  'online course platform for creative professionals'
];

function formatFontName(kbNodeId: string): string {
  // Extract filename from path and format nicely
  const filename = kbNodeId.split('/').pop()?.replace('.md', '') || '';
  return filename
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function main() {
  const client = new KnowBClient();

  console.log('# Font Pairing RAG Search Results');
  console.log('');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('');
  console.log('KB Node: `/airo_design_system/fonts`');
  console.log(`Total queries: ${QUERIES.length}`);
  console.log('');
  console.log('---');
  console.log('');

  for (const query of QUERIES) {
    console.log(`## Query: "${query}"`);
    console.log('');

    const result = await client.search({
      query,
      kbNodeIds: ['/airo_design_system/fonts'],
      maxResults: 3,
      scoreThreshold: 0.3
    });

    if (!result.success || !result.results || result.results.length === 0) {
      console.log('_No results found_');
    } else {
      // Sort by score descending
      const sorted = [...result.results].sort((a, b) => b.score - a.score);

      console.log('| Score | Font Pairing |');
      console.log('|-------|--------------|');

      for (const item of sorted) {
        const fontName = formatFontName(item.kbNodeId);
        console.log(`| ${item.score.toFixed(4)} | ${fontName} |`);
      }
    }

    console.log('');
  }

  console.log('---');
  console.log('');
  console.log('## Summary');
  console.log('');
  console.log(
    `This report shows search results for ${QUERIES.length} different queries against the font pairing knowledge base.`
  );
  console.log('Each query returns up to 3 results with a minimum score threshold of 0.30.');
  console.log('');
  console.log('### How to Read Results');
  console.log('');
  console.log('- **Score**: Similarity score (0-1). Higher = better match.');
  console.log('- **Font Pairing**: The recommended header + body font combination.');
  console.log('');
  console.log('### Query Categories');
  console.log('');
  console.log('These queries simulate how an LLM would describe a business when searching for appropriate fonts.');
  console.log('Each query includes business type + target market/audience context.');
  console.log('');
  console.log('1. **Food & Beverage** (1-10): Restaurants, cafes, bakeries, bars');
  console.log('2. **Professional Services** (11-20): Law, finance, healthcare, consulting');
  console.log('3. **Health & Wellness** (21-30): Gyms, spas, therapy, wellness');
  console.log('4. **Creative & Lifestyle** (31-40): Photography, design, retail, arts');
  console.log('5. **Tech & Modern Business** (41-50): SaaS, apps, digital services');
}

main().catch(console.error);
