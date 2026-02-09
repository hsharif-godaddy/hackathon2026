import type { PlaywrightPage } from '../playwright-types.js';
import type { BusinessFitScore, EvaluatorResult, SiteType } from '../types.js';
import { BUSINESS_CRITERIA } from '../types.js';
import { callAnthropic, parseJsonResponse } from '../utils/anthropic-client.js';

interface BusinessFitAnalysisResult {
  scores: Record<string, number>;
  missingElements: string[];
  presentElements: string[];
}

/**
 * Evaluates how well the website fits its intended business type
 */
export async function evaluate(
  page: PlaywrightPage,
  options: {
    siteType?: SiteType;
    originalPrompt?: string;
    anthropicApiKey?: string;
    anthropicModel?: string;
  } = {}
): Promise<EvaluatorResult<BusinessFitScore>> {
  const startTime = Date.now();

  try {
    // Determine site type: explicit > inferred from prompt > 'generic'
    const siteType = options.siteType || inferSiteType(options.originalPrompt);

    // Get the criteria for this site type
    const criteria = BUSINESS_CRITERIA[siteType] || BUSINESS_CRITERIA['generic'];

    // Extract page content for analysis
    const pageContent = await extractPageContent(page);

    // If no API key, do basic checks
    if (!options.anthropicApiKey) {
      return evaluateBasic(pageContent, siteType, criteria, startTime);
    }

    // Use AI for comprehensive evaluation
    const prompt = buildBusinessFitPrompt(siteType, criteria, pageContent);

    const response = await callAnthropic(prompt, {
      apiKey: options.anthropicApiKey,
      model: options.anthropicModel,
    });

    const result = parseJsonResponse<BusinessFitAnalysisResult>(response);

    // Calculate overall score from individual criteria scores
    const scores = Object.values(result.scores).filter(v => typeof v === 'number');
    const avgScore = scores.length > 0
      ? scores.reduce((a, b) => a + b, 0) / scores.length * 10
      : 50;

    const data: BusinessFitScore = {
      score: Math.round(avgScore),
      siteType,
      criteria: result.scores,
      missingElements: result.missingElements || [],
      presentElements: result.presentElements || [],
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during business-fit evaluation',
      duration: Date.now() - startTime,
    };
  }
}

const TYPE_KEYWORDS: Record<SiteType, string[]> = {
  'ecommerce': ['store', 'shop', 'ecommerce', 'e-commerce', 'sell', 'product', 'cart', 'checkout'],
  'restaurant': [
    'restaurant', 'cafe', 'food', 'menu', 'dining', 'bistro', 'eatery',
    'cuisine', 'kitchen', 'trattoria', 'pizzeria', 'bakery', 'bar & grill', 'diner',
  ],
  'portfolio': ['portfolio', 'designer', 'photographer', 'artist', 'freelance', 'work samples'],
  'blog': ['blog', 'articles', 'posts', 'news', 'magazine', 'publication'],
  'landing-page': ['landing', 'startup', 'saas', 'app', 'launch', 'product page'],
  'service-business': ['service', 'consulting', 'agency', 'contractor', 'plumber', 'electrician'],
  'nonprofit': ['nonprofit', 'charity', 'foundation', 'donate', 'cause', 'volunteer'],
  'medical': ['medical', 'doctor', 'clinic', 'healthcare', 'dental', 'hospital', 'physician'],
  'legal': ['law', 'lawyer', 'attorney', 'legal', 'law firm'],
  'fitness': ['fitness', 'gym', 'yoga', 'personal trainer', 'workout', 'health club'],
  'event-planner': ['event', 'wedding', 'party', 'planner', 'catering', 'venue'],
  'generic': [],
};

/**
 * Try to infer site type from the original prompt
 */
function inferSiteType(prompt?: string): SiteType {
  if (!prompt) return 'generic';

  const promptLower = prompt.toLowerCase();

  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some(keyword => promptLower.includes(keyword))) {
      return type as SiteType;
    }
  }

  return 'generic';
}

/**
 * Extract relevant content from the page
 */
async function extractPageContent(page: PlaywrightPage): Promise<{
  text: string;
  headings: string[];
  links: string[];
  buttons: string[];
  forms: number;
  images: number;
}> {
  return page.evaluate(() => {
    const body = document.body;

    // Get text content
    const text = body.innerText.substring(0, 8000);

    // Get headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.textContent?.trim())
      .filter(Boolean) as string[];

    // Get link texts
    const links = Array.from(document.querySelectorAll('a'))
      .map(a => a.textContent?.trim())
      .filter(Boolean) as string[];

    // Get button texts
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map(b => b.textContent?.trim() || (b as HTMLInputElement).value)
      .filter(Boolean) as string[];

    // Count forms and images
    const forms = document.querySelectorAll('form').length;
    const images = document.querySelectorAll('img').length;

    return { text, headings, links, buttons, forms, images };
  });
}

/**
 * Build the AI evaluation prompt
 */
function buildBusinessFitPrompt(
  siteType: SiteType,
  criteria: string[],
  pageContent: {
    text: string;
    headings: string[];
    links: string[];
    buttons: string[];
    forms: number;
    images: number;
  }
): string {
  return `Evaluate this ${siteType} website against business-specific criteria.

Expected elements for a ${siteType} website:
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Website Content:
- Headings: ${pageContent.headings.slice(0, 10).join(', ')}
- Navigation/Links: ${pageContent.links.slice(0, 15).join(', ')}
- Buttons/CTAs: ${pageContent.buttons.slice(0, 10).join(', ')}
- Forms: ${pageContent.forms}
- Images: ${pageContent.images}

Main Text (truncated):
${pageContent.text.substring(0, 3000)}

For each criterion, rate how well it's implemented (0-10):
- 0 = Completely missing
- 5 = Present but poorly implemented
- 10 = Excellent implementation

Respond with JSON only:
{
  "scores": {
    "${criteria[0]}": <0-10>,
    "${criteria[1]}": <0-10>,
    ${criteria.slice(2).map(c => `"${c}": <0-10>`).join(',\n    ')}
  },
  "missingElements": ["<element that should be present but isn't>"],
  "presentElements": ["<element that is well implemented>"]
}`;
}

/**
 * Basic evaluation without AI
 */
function evaluateBasic(
  pageContent: {
    text: string;
    headings: string[];
    links: string[];
    buttons: string[];
    forms: number;
    images: number;
  },
  siteType: SiteType,
  criteria: string[],
  startTime: number
): EvaluatorResult<BusinessFitScore> {
  const textLower = pageContent.text.toLowerCase();
  const allContent = [
    ...pageContent.headings,
    ...pageContent.links,
    ...pageContent.buttons,
  ].join(' ').toLowerCase();

  const scores: Record<string, number> = {};
  const presentElements: string[] = [];
  const missingElements: string[] = [];

  // Check each criterion with keyword matching
  const criteriaKeywords: Record<string, string[]> = {
    'product-display': ['product', 'item', 'shop'],
    'prices': ['$', 'price', 'cost', '£', '€'],
    'add-to-cart': ['cart', 'add', 'buy', 'purchase'],
    'checkout': ['checkout', 'pay', 'order'],
    'search': ['search', 'find'],
    'categories': ['category', 'categories', 'filter'],
    'menu': ['menu', 'dishes', 'appetizer', 'entree', 'dessert'],
    'hours': ['hours', 'open', 'closed', 'am', 'pm'],
    'location': ['address', 'location', 'map', 'directions'],
    'reservation': ['reservation', 'book', 'table'],
    'food-photos': [], // Check images count
    'contact': ['contact', 'email', 'phone', 'call'],
    'work-samples': ['project', 'work', 'portfolio', 'case study'],
    'about-section': ['about', 'bio', 'story'],
    'contact-info': ['contact', 'email', 'phone'],
    'skills': ['skill', 'expertise', 'service'],
    'testimonials': ['testimonial', 'review', 'client', 'customer'],
    'articles': ['article', 'post', 'blog', 'read'],
    'dates': ['date', 'published', 'posted'],
    'authors': ['author', 'written by', 'by'],
    'value-proposition': ['solution', 'benefit', 'help', 'transform'],
    'cta-button': [], // Check buttons count
    'features': ['feature', 'benefit', 'why'],
    'pricing': ['price', 'plan', 'cost', 'tier'],
    'services-list': ['service', 'what we do', 'offer'],
    'mission-statement': ['mission', 'purpose', 'believe'],
    'donate-button': ['donate', 'give', 'support'],
    'impact-stats': ['impact', 'helped', 'served', 'raised'],
    'team': ['team', 'staff', 'people'],
    'events': ['event', 'upcoming', 'calendar'],
    'services': ['service', 'treatment', 'procedure'],
    'doctors': ['doctor', 'physician', 'dr.', 'md'],
    'appointments': ['appointment', 'schedule', 'book'],
    'insurance': ['insurance', 'accept', 'coverage'],
    'practice-areas': ['practice', 'area', 'specialize'],
    'attorneys': ['attorney', 'lawyer', 'counsel'],
    'case-results': ['case', 'result', 'verdict', 'settlement'],
    'classes': ['class', 'session', 'workout'],
    'schedule': ['schedule', 'timetable', 'calendar'],
    'trainers': ['trainer', 'instructor', 'coach'],
    'membership': ['member', 'join', 'membership'],
    'navigation': ['home', 'about', 'contact'],
    'content': [], // Any substantial text
    'footer': [], // Check if footer exists
  };

  for (const criterion of criteria) {
    const keywords = criteriaKeywords[criterion] || [criterion.replace(/-/g, ' ')];

    // Special cases
    if (criterion === 'food-photos' || criterion === 'images') {
      scores[criterion] = pageContent.images >= 3 ? 8 : pageContent.images >= 1 ? 5 : 0;
    } else if (criterion === 'cta-button') {
      scores[criterion] = pageContent.buttons.length >= 2 ? 8 : pageContent.buttons.length >= 1 ? 5 : 0;
    } else if (criterion === 'content') {
      scores[criterion] = pageContent.text.length > 500 ? 8 : pageContent.text.length > 200 ? 5 : 2;
    } else if (keywords.length === 0) {
      scores[criterion] = 5; // Default for criteria without keywords
    } else {
      const found = keywords.some(kw => textLower.includes(kw) || allContent.includes(kw));
      scores[criterion] = found ? 7 : 0;
    }

    if (scores[criterion] >= 5) {
      presentElements.push(criterion);
    } else {
      missingElements.push(criterion);
    }
  }

  // Calculate overall score
  const scoreValues = Object.values(scores);
  const avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length * 10;

  return {
    success: true,
    data: {
      score: Math.round(avgScore),
      siteType,
      criteria: scores,
      missingElements,
      presentElements,
    },
    duration: Date.now() - startTime,
  };
}
