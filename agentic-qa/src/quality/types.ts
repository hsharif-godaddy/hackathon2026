import { z } from 'zod';

import type { PlaywrightPage } from './playwright-types.js';

// Rating type for Core Web Vitals metrics
export type MetricRating = 'good' | 'needs-improvement' | 'poor';

// Performance metrics based on Lighthouse/Core Web Vitals
export interface MetricValue {
  value: number;
  rating: MetricRating;
}

export interface PerformanceScore {
  score: number;
  lcp: MetricValue;  // Largest Contentful Paint (ms)
  inp: MetricValue;  // Interaction to Next Paint (ms)
  cls: MetricValue;  // Cumulative Layout Shift (score)
  fcp: MetricValue;  // First Contentful Paint (ms)
  tbt: MetricValue;  // Total Blocking Time (ms)
  speedIndex: MetricValue;  // Speed Index (ms)
}

// Accessibility based on axe-core
export interface AccessibilityViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  helpUrl: string;
  nodes: number;
}

export interface AccessibilityScore {
  score: number;
  violations: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  passedChecks: number;
  details: AccessibilityViolation[];
}

// SEO fundamentals
export interface SEOChecks {
  hasTitle: boolean;
  titleLength: number;
  hasMetaDescription: boolean;
  metaDescriptionLength: number;
  hasSingleH1: boolean;
  h1Count: number;
  hasCanonical: boolean;
  hasViewport: boolean;
  imageAltRate: number;
  imagesWithoutAlt: number;
  totalImages: number;
  hasStructuredData: boolean;
  isHttps: boolean;
  hasRobotsMeta: boolean;
}

export interface SEOScore {
  score: number;
  checks: SEOChecks;
}

// Functional integrity
export interface FunctionalScore {
  score: number;
  jsErrors: string[];
  brokenLinks: string[];
  failedResources: string[];
  brokenImages: string[];
  totalLinks: number;
  totalImages: number;
}

// Visual quality
export interface VisualScore {
  score: number;
  placeholders: string[];
  responsiveIssues: string[];
  aiAestheticScore: number;  // 1-10 from AI vision
  aiAestheticFeedback?: string;
}

// Content quality (LLM-as-Judge)
export interface ContentScore {
  score: number;
  relevance: number;      // 1-10
  coherence: number;      // 1-10
  completeness: number;   // 1-10
  professionalism: number; // 1-10
  uniqueness: number;     // 1-10
  issues: string[];
}

// Security basics
export interface SecurityHeaders {
  xFrameOptions: boolean;
  contentSecurityPolicy: boolean;
  xContentTypeOptions: boolean;
  strictTransportSecurity: boolean;
}

export interface SecurityScore {
  score: number;
  isHttps: boolean;
  mixedContent: string[];
  securityHeaders: SecurityHeaders;
}

// Usability (Nielsen heuristics)
export interface UsabilityIssue {
  heuristic: number;
  severity: 0 | 1 | 2 | 3 | 4;
  description: string;
}

export interface UsabilityHeuristics {
  h1: number;  // Visibility of system status
  h2: number;  // Match between system and real world
  h3: number;  // User control and freedom
  h4: number;  // Consistency and standards
  h5: number;  // Error prevention
  h6: number;  // Recognition rather than recall
  h7: number;  // Flexibility and efficiency
  h8: number;  // Aesthetic and minimalist design
  h9: number;  // Help users recover from errors
  h10: number; // Help and documentation
}

export interface UsabilityScore {
  score: number;
  issues: UsabilityIssue[];
  heuristics: Partial<UsabilityHeuristics>;
}

// Business-fit (site-type specific)
export type SiteType =
  | 'landing-page'
  | 'ecommerce'
  | 'portfolio'
  | 'restaurant'
  | 'blog'
  | 'service-business'
  | 'nonprofit'
  | 'medical'
  | 'legal'
  | 'fitness'
  | 'event-planner'
  | 'generic';

export interface BusinessFitScore {
  score: number;
  siteType: SiteType;
  criteria: Record<string, number>;
  missingElements: string[];
  presentElements: string[];
}

// Overall quality evaluation
export interface QualityEvaluation {
  performance?: PerformanceScore;
  accessibility?: AccessibilityScore;
  seo?: SEOScore;
  functional?: FunctionalScore;
  visual?: VisualScore;
  content?: ContentScore;
  security?: SecurityScore;
  usability?: UsabilityScore;
  businessFit?: BusinessFitScore;
  overall: {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    criticalIssues: string[];
    recommendations: string[];
  };
  metadata: {
    url: string;
    evaluatedAt: string;
    duration: number;
    categoriesEvaluated: string[];
    categoriesSkipped: string[];
  };
}

// Evaluation categories
export type EvaluationCategory =
  | 'performance'
  | 'accessibility'
  | 'seo'
  | 'functional'
  | 'visual'
  | 'content'
  | 'security'
  | 'usability'
  | 'businessFit';

// Configuration for quality evaluation
export const QualityEvalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  siteType: z.enum([
    'landing-page', 'ecommerce', 'portfolio', 'restaurant',
    'blog', 'service-business', 'nonprofit', 'medical', 'legal',
    'fitness', 'event-planner', 'generic'
  ]).optional(),
  skipCategories: z.array(z.enum([
    'performance', 'accessibility', 'seo', 'functional',
    'visual', 'content', 'security', 'usability', 'businessFit'
  ])).default([]),
  thresholds: z.object({
    minOverallScore: z.number().min(0).max(100).default(70),
    minPerformance: z.number().min(0).max(100).default(50),
    minAccessibility: z.number().min(0).max(100).default(80),
  }).default({}),
  // For content evaluation - the original prompt/request
  originalPrompt: z.string().optional(),
});

export type QualityEvalConfig = z.infer<typeof QualityEvalConfigSchema>;

// Options for running quality evaluation
export interface QualityEvaluationOptions {
  url: string;
  config: QualityEvalConfig;
  // Playwright-compatible page object (if already have browser context)
  page?: PlaywrightPage;
  // Screenshots for AI vision analysis
  screenshots?: Array<{ path: string; type: string }>;
  // Chrome debugging port for Lighthouse
  chromePort?: number;
  // Anthropic API key for AI evaluations
  anthropicApiKey?: string;
  // Anthropic model to use
  anthropicModel?: string;
  // Timeout for individual evaluators (ms)
  timeout?: number;
  // Run in headless mode (for standalone evaluation)
  headless?: boolean;
}

// Result of a single evaluator
export interface EvaluatorResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

// Standalone evaluation request (for CLI or API)
export interface StandaloneEvalRequest {
  url: string;
  siteType?: SiteType;
  originalPrompt?: string;
  skipCategories?: EvaluationCategory[];
  anthropicApiKey?: string;
  anthropicModel?: string;
  outputDir?: string;
  format?: 'json' | 'html' | 'both';
  headless?: boolean;
  timeout?: number;
}

// Evaluation mode
export type EvaluationMode = 'standalone' | 'post-build';

// Weights for composite scoring
export const CATEGORY_WEIGHTS: Record<EvaluationCategory, number> = {
  functional: 0.25,
  content: 0.20,
  visual: 0.15,
  performance: 0.10,
  accessibility: 0.10,
  usability: 0.10,
  seo: 0.05,
  security: 0.03,
  businessFit: 0.02,
};

// Thresholds for Core Web Vitals ratings
export const METRIC_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },      // milliseconds
  inp: { good: 200, poor: 500 },        // milliseconds
  cls: { good: 0.1, poor: 0.25 },       // score
  fcp: { good: 1800, poor: 3000 },      // milliseconds
  tbt: { good: 200, poor: 600 },        // milliseconds
  speedIndex: { good: 3400, poor: 5800 }, // milliseconds
};

// Business criteria for different site types
export const BUSINESS_CRITERIA: Record<SiteType, string[]> = {
  'ecommerce': ['product-display', 'prices', 'add-to-cart', 'checkout-flow', 'search', 'categories'],
  'restaurant': ['menu', 'hours', 'location', 'reservation-cta', 'food-photos', 'contact'],
  'portfolio': ['work-samples', 'about-section', 'contact-info', 'skills', 'testimonials'],
  'blog': ['articles', 'dates', 'authors', 'categories', 'search', 'recent-posts'],
  'landing-page': ['value-proposition', 'cta-button', 'testimonials', 'features', 'pricing'],
  'service-business': ['services-list', 'pricing', 'contact', 'testimonials', 'about'],
  'nonprofit': ['mission-statement', 'donate-button', 'impact-stats', 'team', 'events'],
  'medical': ['services', 'doctors', 'appointments', 'location', 'insurance', 'contact'],
  'legal': ['practice-areas', 'attorneys', 'contact', 'testimonials', 'case-results'],
  'fitness': ['classes', 'schedule', 'pricing', 'trainers', 'membership', 'location'],
  'event-planner': ['services', 'portfolio', 'testimonials', 'contact', 'pricing', 'about'],
  'generic': ['navigation', 'contact', 'about', 'content', 'footer'],
};
