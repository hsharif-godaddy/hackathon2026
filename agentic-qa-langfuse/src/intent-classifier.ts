import { INTENT_CATEGORIES, type IntentCategory, type LLMConfig } from './config.js';
import { callOpenAI, parseJsonResponse } from './openai-client.js';
import { sanitize } from './text-utils.js';

export interface IntentClassification {
  primaryCategory: IntentCategory;
  primaryConfidence: number;
  secondaryCategory: IntentCategory | null;
  secondaryConfidence: number;
  reasoning: string;
}

const MAX_TOTAL_CHARS = 4000;

const INTENT_PROMPT = `You are a senior product analyst specializing in AI-powered website builder platforms.
You will receive a single user message sent to an AI website builder (Airo Builder).
Your task is to classify the PRIMARY and SECONDARY intents of this message.

## Categories

### new_site_creation
The user is requesting a brand-new website without focusing on a specific advanced feature.
They describe a business, idea, or purpose and want Airo to generate the initial site.
Signals: "build me a website", "create a site for", "make a website", "I need a website",
"new site", "website for my business", "landing page for", "start a site", "build a page".

### content_editing
The user is editing, updating, or changing text, images, or sections on an existing page.
No structural or functional changes — purely content and copy modifications.
Signals: "change the text", "update the heading", "replace the image", "edit the about section",
"rewrite", "add a paragraph", "remove this section", "update the copy", "fix the typo".

### design_styling
The user is making visual or aesthetic changes: colors, fonts, spacing, layout tweaks, themes,
or general look-and-feel adjustments without adding new functionality.
Signals: "change the color", "make it look modern", "update the font", "dark mode",
"bigger", "smaller", "spacing", "theme", "style", "make it look like", "brand colors",
"visual", "layout", "centered", "rounded corners".

### blog_content
The user is setting up a blog, CMS, news section, or article publishing system on their site.
Signals: "blog", "articles", "posts", "news section", "CMS", "publish", "content management",
"write posts", "blog page", "author", "categories", "tags".

### portfolio_showcase
The user is building a portfolio, gallery, or showcase to display work, projects, or services.
Distinct from ecommerce — the goal is to present, not sell.
Signals: "portfolio", "showcase", "display my work", "project gallery", "case studies",
"photography site", "artist", "freelancer", "my work", "examples", "samples".

### restaurant_food
The user is building a restaurant, cafe, bakery, or food-service website with menus,
online ordering, or food-related features.
Signals: "restaurant", "menu", "food", "cafe", "bakery", "order online", "delivery",
"catering", "food truck", "dine-in", "takeout", "cuisine", "recipes".

### user_authentication
The user is trying to build or integrate user authentication, login systems, sign-up flows,
password reset, OAuth, or customer account management.
Signals: "login", "sign up", "register", "authentication", "password", "OAuth", "SSO",
"user accounts", "customer portal", "member area".

### payment_integration
The user is adding payment processing, checkout flows, Stripe, PayPal, or other payment gateways.
Signals: "payment", "checkout", "Stripe", "PayPal", "credit card", "billing",
"subscription", "pricing", "invoice".

### ecommerce
The user is building an online store, product catalog, shopping cart, or general e-commerce functionality.
Signals: "store", "shop", "products", "cart", "catalog", "inventory", "orders",
"e-commerce", "sell online", "merchandise".

### booking_scheduling
The user is creating appointment booking, reservation systems, calendar scheduling, or event management.
Signals: "booking", "appointment", "schedule", "reservation", "calendar", "availability",
"time slot", "event".

### database_management
The user is working with databases, data storage, CRUD operations, or data management features.
Signals: "database", "data", "CRUD", "storage", "table", "records", "SQL", "MongoDB",
"backend data", "data model".

### site_migration
The user is migrating content or structure from an existing site to Airo Builder without
referencing a specific platform.
Signals: "migrate", "transfer", "move my site", "import content", "export",
"move from my current site".

### platform_migration
The user is specifically moving from another platform like WordPress, Shopify, Wix, Squarespace,
or other hosting/CMS providers.
Signals: "WordPress", "Shopify", "Wix", "Squarespace", "GoDaddy", "move from",
"switch from", "replace my", "currently on", "hosted on".

### site_rebuild
The user is redesigning, improving, updating, or rebuilding an existing website.
Signals: "redesign", "rebuild", "update", "improve", "modernize", "refresh",
"new look", "revamp", "overhaul", "make it better".

### admin_dashboard
The user is building an admin panel, dashboard, analytics view, or back-office management interface.
Signals: "dashboard", "admin panel", "admin", "analytics", "management console",
"back office", "control panel", "metrics".

### api_integration
The user is integrating external APIs, webhooks, third-party services, or building API endpoints.
Signals: "API", "webhook", "integrate", "third-party", "REST", "GraphQL", "endpoint",
"connect to", "fetch data from".

### seo_marketing
The user is working on SEO, search engine optimization, meta tags, social media integration,
Google Analytics, marketing pages, or promotional content.
Signals: "SEO", "meta tags", "Google Analytics", "sitemap", "social media", "marketing",
"landing page", "conversion", "tracking", "open graph", "schema markup".

### contact_forms
The user is adding contact forms, lead capture forms, feedback forms, newsletter sign-ups,
or CRM integration for collecting user information.
Signals: "contact form", "form", "lead", "newsletter", "subscribe", "feedback",
"inquiry", "get in touch", "email form", "CRM".

### mobile_pwa
The user is building a Progressive Web App or optimizing their site for mobile with PWA features.
Signals: "PWA", "progressive web app", "offline", "service worker", "installable",
"mobile responsive", "responsive design".

### mobile_app
The user is building a native mobile application or a mobile-first experience.
Signals: "mobile app", "iOS", "Android", "native app", "app store", "React Native",
"Flutter", "mobile application".

### troubleshooting
The user is debugging errors, fixing broken pages, resolving console errors, or asking for help
with code that is not working as expected. The site exists but something is wrong.
Signals: "error", "bug", "broken", "not working", "blank page", "console error", "crash",
"white screen", "debug", "fix", "merge conflict", "undefined", "TypeError", "500".

### domain_hosting
The user is connecting a domain, configuring DNS, publishing their site, or dealing with
hosting and deployment issues.
Signals: "domain", "DNS", "publish", "deploy", "hosting", "SSL", "HTTPS", "custom domain",
"nameserver", "CNAME", "A record", "go live", "launch", "connect domain".

### other
The message intent does not clearly fit any of the above categories.
Use this only when you are genuinely uncertain or the message is too generic to classify.

## Instructions

1. Read the user message carefully to understand what they are requesting.
2. Identify the PRIMARY intent -- the main goal the user is trying to achieve.
3. Identify the SECONDARY intent -- a supporting or secondary goal, if one exists.
   If the message has only one clear intent, set secondary_category to null.
   The secondary intent MUST be different from the primary intent.
4. Return your answer as a JSON object with exactly these fields:
   - "primary_category": one of CATEGORIES
   - "primary_confidence": a float between 0.0 and 1.0
   - "secondary_category": one of CATEGORIES, or null if no secondary intent
   - "secondary_confidence": a float between 0.0 and 1.0 (0.0 if null)
   - "reasoning": 1-2 sentences explaining your classification decision

Return ONLY the JSON object, no markdown fences, no extra text.

## User Message

USER_MESSAGE`;

const EMPTY_RESULT: IntentClassification = {
  primaryCategory: 'other',
  primaryConfidence: 1.0,
  secondaryCategory: null,
  secondaryConfidence: 0.0,
  reasoning: 'Empty or missing user message.',
};

async function callLLM(prompt: string, llm: LLMConfig): Promise<string> {
  return callOpenAI(prompt, {
    apiKey: llm.apiKey,
    baseUrl: llm.baseUrl,
    model: llm.model,
    maxTokens: 16_384,
  });
}

interface RawLLMResponse {
  primary_category?: string;
  primary_confidence?: number;
  secondary_category?: string | null;
  secondary_confidence?: number;
  reasoning?: string;
}

function validateCategory(value: unknown): IntentCategory | null {
  if (value == null) return null;
  return INTENT_CATEGORIES.includes(value as IntentCategory)
    ? (value as IntentCategory)
    : null;
}

export async function classify(
  message: string,
  llm: LLMConfig
): Promise<IntentClassification> {
  if (!message.trim()) return EMPTY_RESULT;

  const prompt = INTENT_PROMPT
    .replace('CATEGORIES', JSON.stringify([...INTENT_CATEGORIES]))
    .replace('USER_MESSAGE', sanitize(message.slice(0, MAX_TOTAL_CHARS)));

  try {
    const raw = await callLLM(prompt, llm);
    const result = parseJsonResponse<RawLLMResponse>(raw);

    const primaryCategory = validateCategory(result.primary_category) ?? 'other';
    const secondaryRaw = validateCategory(result.secondary_category);
    const secondaryCategory = secondaryRaw && secondaryRaw !== primaryCategory
      ? secondaryRaw
      : null;

    return {
      primaryCategory,
      primaryConfidence: typeof result.primary_confidence === 'number' ? result.primary_confidence : 0.0,
      secondaryCategory,
      secondaryConfidence: secondaryCategory && typeof result.secondary_confidence === 'number'
        ? result.secondary_confidence
        : 0.0,
      reasoning: result.reasoning ?? '',
    };
  } catch (error) {
    return {
      primaryCategory: 'other',
      primaryConfidence: 0.0,
      secondaryCategory: null,
      secondaryConfidence: 0.0,
      reasoning: `Classification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
