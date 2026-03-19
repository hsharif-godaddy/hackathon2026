/**
 * Image Search Service Driver
 *
 * Calls the Go image search service for semantic image search with
 * AI analysis-enriched results, as an alternative to direct Getty API calls.
 * Implements the shared MediaDriver interface for unified access.
 */
import { Logger } from '../../../logging/index.js';
import type { MediaDriver, MediaDriverSearchOptions, MediaResult, MediaItem } from './media-driver.js';

/**
 * Response from the image search service
 */
interface ServiceSearchResponse {
  results: ServiceSearchResult[];
  meta: {
    total: number;
    cached: number;
    analyzed: number;
    filtered: number;
    complete: boolean;
    pendingAnalysis: number;
  };
}

interface ServiceSearchResult {
  gettyId: string;
  urls: {
    thumbnail?: string;
    preview?: string;
    highRes?: string;
  };
  relevanceScore: number;
  analysis?: {
    primarySubject?: string;
    subjectCategory?: string;
    activity?: string;
    composition?: string;
    copySpaceLocation?: string;
    copySpaceAmount?: string;
    tone?: string[];
    peopleCount?: string;
    dominantColors?: string[];
  };
  fromCache: boolean;
}

/**
 * Driver that routes image search through the Go image search service
 * for semantic search with AI-enriched metadata.
 * Implements MediaDriver for unified access from MediaSearchTool.
 */
export class ImageSearchServiceDriver implements MediaDriver {
  private baseUrl: string;
  private logger: Logger;

  constructor() {
    this.baseUrl = process.env.IMAGE_SEARCH_SERVICE_URL || 'http://localhost:8080';
    this.logger = Logger.create({ service: 'image-search-service-driver' });
  }

  /**
   * Search for images via the image search service
   */
  async search(options: MediaDriverSearchOptions): Promise<MediaResult> {
    if (!options.query || typeof options.query !== 'string' || options.query.trim().length === 0) {
      return {
        success: false,
        error: 'A valid search query is required',
      };
    }

    const count = options.count || 10;

    this.logger.info('image-search-service.request', {
      query: options.query,
      count,
      hasFilters: this.hasFilters(options),
    });

    try {
      const filters = this.buildFilters(options);

      const response = await fetch(`${this.baseUrl}/api/v1/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: options.query,
          count,
          ...(filters && { filters }),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('image-search-service.request.failed', {
          status: response.status,
          errorText,
        });
        return {
          success: false,
          error: `Image search service error: ${response.status} ${errorText}`,
        };
      }

      const data = (await response.json()) as ServiceSearchResponse;

      this.logger.info('image-search-service.response', {
        resultCount: data.results?.length || 0,
        meta: data.meta,
      });

      const items: MediaItem[] = (data.results || []).map((r) => ({
        id: r.gettyId,
        urls: {
          preview: r.urls?.preview || undefined,
          thumbnail: r.urls?.thumbnail || undefined,
          highRes: r.urls?.highRes || undefined,
        },
        title: r.analysis?.primarySubject,
        caption: r.analysis
          ? (() => {
              const parts = [r.analysis.subjectCategory, r.analysis.composition].filter(Boolean);
              return parts.length > 0 ? parts.join(' - ') : undefined;
            })()
          : undefined,
        dimensions: undefined,
      }));

      if (items.length === 0) {
        return {
          success: false,
          error: 'No images found matching your search criteria',
        };
      }

      return {
        success: true,
        items,
        totalResults: data.meta?.total || items.length,
      };
    } catch (error) {
      this.logger.error('image-search-service.request.error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        error: `Image search service failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Build the filters object for the service API from unified search options
   */
  private buildFilters(options: MediaDriverSearchOptions): Record<string, unknown> | undefined {
    const filters: Record<string, unknown> = {};

    // Getty-native filters
    if (options.orientations?.length) {filters.orientations = options.orientations;}
    if (options.compositions?.length) {filters.compositions = options.compositions;}
    if (options.moods?.length) {filters.moods = options.moods;}
    if (options.graphicalStyles?.length) {filters.graphicalStyles = options.graphicalStyles;}
    if (options.numberOfPeople?.length) {filters.numberOfPeople = options.numberOfPeople;}
    if (options.ethnicity?.length) {filters.ethnicity = options.ethnicity;}
    if (options.ageOfPeople?.length) {filters.ageOfPeople = options.ageOfPeople;}
    if (options.minimumSize) {filters.minimumSize = options.minimumSize;}
    if (options.sortOrder) {filters.sortOrder = options.sortOrder;}
    if (options.color) {filters.color = options.color;}

    // Analysis-enriched filters (service-only)
    if (options.subjectCategory?.length) {filters.subjectCategory = options.subjectCategory;}
    if (options.copySpaceAmount?.length) {filters.copySpaceAmount = options.copySpaceAmount;}
    if (options.copySpaceLocation?.length) {filters.copySpaceLocation = options.copySpaceLocation;}
    if (options.usageContext?.length) {filters.usageContext = options.usageContext;}
    if (options.backgroundType?.length) {filters.backgroundType = options.backgroundType;}
    if (options.visualComplexity?.length) {filters.visualComplexity = options.visualComplexity;}
    if (options.tone?.length) {filters.tone = options.tone;}
    if (options.peopleFocus?.length) {filters.peopleFocus = options.peopleFocus;}

    return Object.keys(filters).length > 0 ? filters : undefined;
  }

  /**
   * Check if any filters are present in the options
   */
  private hasFilters(options: MediaDriverSearchOptions): boolean {
    return !!(
      options.orientations?.length ||
      options.compositions?.length ||
      options.moods?.length ||
      options.graphicalStyles?.length ||
      options.sortOrder ||
      options.color ||
      options.numberOfPeople?.length ||
      options.ethnicity?.length ||
      options.ageOfPeople?.length ||
      options.minimumSize ||
      options.subjectCategory?.length ||
      options.usageContext?.length
    );
  }
}
