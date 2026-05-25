import { VERTICAL_CATEGORIES, type LLMConfig, type VerticalCategory } from './config.js';
import { callOpenAI, parseJsonResponse } from './openai-client.js';
import { sanitize } from './text-utils.js';

export interface VerticalClassification {
  category: VerticalCategory;
  confidence: number;
  reasoning: string;
}

const MAX_MESSAGES = 20;
const MAX_TOTAL_CHARS = 4000;

const VERTICAL_PROMPT = `You are a senior product analyst specializing in business vertical classification.
You will receive a list of user messages from a single conversation session with an AI website builder (Airo Builder).
Your task is to classify the BUSINESS VERTICAL / INDUSTRY that best describes the website the user is building.

## Categories

### ecommerce_retail
The user is building a website for a retail store, online shop, or general e-commerce business
selling physical or digital products.
Signals: "store", "shop", "products", "retail", "merchandise", "inventory", "sell", "catalog",
"online store", "boutique", "apparel", "clothing", "accessories", "gifts", "handmade".

### photography_creative
The user is building a website for a photography business, creative studio, graphic design,
videography, art, or other creative professional services.
Signals: "photography", "photographer", "portfolio", "gallery", "studio", "creative",
"design", "artist", "videographer", "film", "illustration", "prints", "photo sessions".

### tech_saas
The user is building a website for a technology company, software product, SaaS platform,
app, startup, or IT services.
Signals: "software", "SaaS", "app", "platform", "tech", "startup", "IT", "cloud",
"API", "developer", "digital product", "subscription", "analytics", "dashboard".

### pet_services
The user is building a website for a pet-related business: grooming, boarding, veterinary,
pet sitting, dog walking, pet supplies, or animal rescue.
Signals: "pet", "dog", "cat", "grooming", "veterinary", "vet", "boarding", "pet sitting",
"dog walking", "animal", "pet store", "rescue", "adoption", "kennel".

### automotive
The user is building a website for an automotive business: car dealership, auto repair,
detailing, car wash, parts, or vehicle-related services.
Signals: "car", "auto", "vehicle", "dealership", "mechanic", "repair", "detailing",
"car wash", "parts", "tires", "body shop", "motorcycle", "truck", "fleet".

### beauty_salon
The user is building a website for a beauty salon, barbershop, spa, nail salon,
hair stylist, or cosmetics business.
Signals: "salon", "beauty", "hair", "barber", "spa", "nails", "makeup", "stylist",
"cosmetics", "skincare", "lashes", "brows", "facial", "waxing", "tanning".

### legal_professional_services
The user is building a website for a law firm, accounting firm, consulting agency,
or other professional services business.
Signals: "lawyer", "attorney", "law firm", "legal", "accountant", "CPA", "consulting",
"consultant", "advisory", "professional services", "tax", "bookkeeping", "audit".

### health_wellness_fitness
The user is building a website for a gym, fitness studio, personal trainer, yoga studio,
wellness center, chiropractor, therapist, or health-related business.
Signals: "gym", "fitness", "personal trainer", "yoga", "wellness", "health", "chiropractor",
"therapy", "mental health", "nutrition", "pilates", "crossfit", "martial arts", "coaching".

### wedding_events
The user is building a website for a wedding planner, event planning company, DJ,
florist, venue, or event-related services.
Signals: "wedding", "event", "planner", "venue", "DJ", "florist", "catering",
"party", "celebration", "ceremony", "reception", "bridal", "entertainment", "decoration".

### travel_hospitality
The user is building a website for a hotel, resort, travel agency, tour operator,
vacation rental, B&B, or hospitality business.
Signals: "hotel", "resort", "travel", "tour", "vacation", "rental", "B&B", "hostel",
"booking", "destination", "hospitality", "lodge", "airbnb", "guest house", "retreat".

### education
The user is building a website for a school, tutoring service, online course,
training center, educational institution, or learning platform.
Signals: "school", "education", "tutoring", "course", "training", "learning",
"academy", "teacher", "instructor", "curriculum", "classes", "students", "university".

### construction_trades
The user is building a website for a construction company, plumber, electrician,
HVAC, roofing, landscaping, or trades business.
Signals: "construction", "contractor", "plumber", "electrician", "HVAC", "roofing",
"landscaping", "renovation", "remodeling", "building", "handyman", "painting", "flooring".

### restaurant_food
The user is building a website for a restaurant, cafe, bakery, food truck,
catering company, or food-related business.
Signals: "restaurant", "cafe", "bakery", "food", "menu", "dining", "catering",
"food truck", "bar", "brewery", "pizzeria", "sushi", "cuisine", "delivery", "takeout".

### finance
The user is building a website for a financial services company, bank, insurance agency,
mortgage broker, financial advisor, or investment firm.
Signals: "finance", "financial", "bank", "insurance", "mortgage", "investment",
"advisor", "wealth", "credit", "loan", "trading", "fintech", "cryptocurrency".

### real_estate
The user is building a website for a real estate agency, realtor, property management,
or real estate development company.
Signals: "real estate", "realtor", "property", "homes", "listings", "agent",
"broker", "apartment", "housing", "land", "commercial property", "rental property".

### cleaning_services
The user is building a website for a cleaning company, janitorial service, maid service,
pressure washing, or sanitation business.
Signals: "cleaning", "clean", "janitorial", "maid", "housekeeping", "pressure washing",
"sanitation", "carpet cleaning", "window cleaning", "commercial cleaning", "residential cleaning".

### other
The session does not clearly indicate a specific business vertical,
or the vertical does not fit any of the above categories.
Use this only when you are genuinely uncertain or the conversation is too generic to classify.

## Instructions

1. Read user messages to understand the full conversation context.
2. Identify the BUSINESS VERTICAL — the industry or type of business the website is for.
   Focus on the business itself, not the technical features being requested.
3. Return your answer as a JSON object with exactly these fields:
   - "category": one of CATEGORIES
   - "confidence": a float between 0.0 and 1.0
   - "reasoning": 1-2 sentences explaining your classification decision

Return ONLY the JSON object, no markdown fences, no extra text.

## User Messages

USER_MESSAGES`;

function formatMessages(messages: string[]): string {
  const truncated = messages.slice(0, MAX_MESSAGES);
  const formatted: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < truncated.length; i++) {
    const prefix = `[Message ${i + 1}]: `;
    const overhead = prefix.length + (formatted.length ? 1 : 0);
    const remaining = MAX_TOTAL_CHARS - totalChars - overhead;
    if (remaining <= 0) break;
    const text = sanitize(truncated[i].slice(0, remaining));
    formatted.push(`${prefix}${text}`);
    totalChars += prefix.length + text.length + (formatted.length > 1 ? 1 : 0);
  }

  return formatted.join('\n');
}

const EMPTY_RESULT: VerticalClassification = {
  category: 'other',
  confidence: 1.0,
  reasoning: 'Empty or missing user messages.',
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
  category?: string;
  confidence?: number;
  reasoning?: string;
}

function validate(value: unknown): VerticalCategory | null {
  if (value == null) return null;
  return VERTICAL_CATEGORIES.includes(value as VerticalCategory)
    ? (value as VerticalCategory)
    : null;
}

export async function classify(
  messages: string[],
  llm: LLMConfig
): Promise<VerticalClassification> {
  if (!messages.length || messages.every(function empty(m) { return !m.trim(); })) return EMPTY_RESULT;

  const prompt = VERTICAL_PROMPT
    .replace('CATEGORIES', JSON.stringify([...VERTICAL_CATEGORIES]))
    .replace('USER_MESSAGES', formatMessages(messages));

  try {
    const raw = await callLLM(prompt, llm);
    const result = parseJsonResponse<RawLLMResponse>(raw);

    return {
      category: validate(result.category) ?? 'other',
      confidence: typeof result.confidence === 'number' ? result.confidence : 0.0,
      reasoning: result.reasoning ?? '',
    };
  } catch (error) {
    return {
      category: 'other',
      confidence: 0.0,
      reasoning: `Classification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
