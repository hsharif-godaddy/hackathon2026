function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function load() {
  return {
    langfuse: {
      publicKey: required('LANGFUSE_PUBLIC_KEY'),
      secretKey: required('LANGFUSE_SECRET_KEY'),
      baseUrl: process.env['LANGFUSE_BASE_URL'] ?? 'https://agentobser-langfuse.int.godaddy.com',
    },
    llm: {
      apiKey: required('JWT_TOKEN'),
      baseUrl: process.env['OPENAI_BASE_URL'] ?? 'https://api.gocode.caas.test-gdcorp.tools/v1',
      model: process.env['OPENAI_MODEL'] ?? 'gpt-5',
    } satisfies LLMConfig,
  };
}

export type Config = ReturnType<typeof load>;

export const BATCH_SIZE = 50;
export const DEFAULT_WORKERS = 10;
export const ERROR_EVENT_PREFIX = 'agent_error_trace';
export const MAX_VERTICAL_MESSAGES = 2;
export const TRACES_ENVIRONMENT = 'default';

export const ERROR_CATEGORIES = [
  'content_policy_restriction',
  'edit_hallucination',
  'invalid_json',
  'bad_request',
  'file_not_found',
  'quota_exceeded',
  'other',
] as const;

export type ErrorCategory = typeof ERROR_CATEGORIES[number];

export const INTENT_CATEGORIES = [
  'new_site_creation',
  'content_editing',
  'design_styling',
  'blog_content',
  'portfolio_showcase',
  'restaurant_food',
  'user_authentication',
  'payment_integration',
  'ecommerce',
  'booking_scheduling',
  'database_management',
  'site_migration',
  'platform_migration',
  'site_rebuild',
  'admin_dashboard',
  'api_integration',
  'seo_marketing',
  'contact_forms',
  'mobile_pwa',
  'mobile_app',
  'troubleshooting',
  'domain_hosting',
  'other',
] as const;

export type IntentCategory = typeof INTENT_CATEGORIES[number];

export const VERTICAL_CATEGORIES = [
  'ecommerce_retail',
  'photography_creative',
  'tech_saas',
  'pet_services',
  'automotive',
  'beauty_salon',
  'legal_professional_services',
  'health_wellness_fitness',
  'wedding_events',
  'travel_hospitality',
  'education',
  'construction_trades',
  'restaurant_food',
  'finance',
  'real_estate',
  'cleaning_services',
  'other',
] as const;

export type VerticalCategory = typeof VERTICAL_CATEGORIES[number];
