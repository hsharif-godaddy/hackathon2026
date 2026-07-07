/**
 * Enrichment provider abstraction. The worker runs a ladder of providers
 * (Beacon supplementary → GoCode primary extraction) and takes the first
 * non-null result.
 *
 * v2: resolution-ready extraction — dynamic vocabularies (PLAN §9.2) +
 * resolution fuel (symptoms, search_keywords, where_airo_went_wrong).
 * All facet fields are plain strings — vocabulary consistency is enforced
 * at the prompt level (dedup via seed injection), not TypeScript types.
 */

export interface EnrichableRecord {
  interaction_id: string;
  full_transcript: string;
  conversation_summary?: string;
}

export interface EnrichmentResult {
  /** Which provider produced this result (written to `enrichment_provider`). */
  provider: string;

  // --- Dynamic vocabulary facets (aggregatable, PLAN §9.2) ---

  /** Top-level customer goal (dynamic vocab). */
  goal?: string;
  /** Normalized intent (dynamic vocab). */
  intent?: string;
  /** Sub-intent scoped to the parent intent (dynamic vocab). */
  sub_intent?: string;
  /** Product area where the issue occurred (Resolution Skill facet router). */
  platform_area?: string;
  /** Technical error classification (dynamic vocab). */
  error_type?: string;
  /** Sentiment: positive | neutral | negative. */
  customer_sentiment?: string;
  /** How the issue was resolved (dynamic vocab). */
  issue_resolution?: string;
  /** Primary friction/pain point (dynamic vocab). */
  friction_point?: string;
  /** Whether this contact was preventable. */
  preventable_contact?: boolean;
  /** Fix category (Sankey right column, dynamic vocab). */
  fix_category?: string;

  // --- Resolution fuel (descriptive, PLAN §9.3) ---

  /** Where the Airo product/agent went wrong — empty if NOT Airo's fault. */
  where_airo_went_wrong?: string;
  /** ≥3 observable symptoms the customer described (semantic search fuel). */
  symptoms?: string[];
  /** ≥5 technical terms, error codes, feature names (lexical search fuel). */
  search_keywords?: string[];
  /** Human-readable root cause (free-text). */
  root_cause?: string;
  /** Concrete fix or next action (free-text). */
  recommended_fix?: string;
  /** Backward-compat alias for where_airo_went_wrong. */
  airo_failure?: string;
  /** 1-2 sentence factual summary. */
  conversation_summary?: string;
  /** Tags derived from friction_point + platform_area. */
  tags?: string[];
}

export interface EnrichmentProvider {
  readonly name: string;
  /** Cheap, side-effect-free check: is this provider usable in this env? */
  isConfigured(): boolean;
  /** Returns the enrichment, or null when the provider can't produce one. */
  enrich(record: EnrichableRecord): Promise<EnrichmentResult | null>;
}
