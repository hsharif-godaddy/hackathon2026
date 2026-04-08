/**
 * Shared Media Driver Interface
 *
 * Defines the common interface that all media search drivers implement.
 * This allows MediaSearchTool to use a single code path regardless of
 * which driver (Getty direct or Image Search Service) is being used.
 */

/**
 * Unified search options accepted by all media drivers.
 * Each driver maps these to its internal API format.
 */
export interface MediaDriverSearchOptions {
  query: string;
  mediaType?: 'image' | 'video';
  count?: number;

  // Filters supported by both Getty and the image search service
  orientations?: string[];
  compositions?: string[];
  moods?: string[];
  graphicalStyles?: string[];
  sortOrder?: string;
  color?: string;
  numberOfPeople?: string[];
  ethnicity?: string[];
  ageOfPeople?: string[];
  minimumSize?: string;

  // Search context hint for the image search service (e.g., "close-up product photo for gallery").
  // Enriches the query embedding with purpose/style context. Getty direct driver ignores this.
  context?: string;

  // Filters only supported by the image search service.
  // Getty direct driver silently ignores these.
  subjectCategory?: string[];
  copySpaceAmount?: string[];
  copySpaceLocation?: string[];
  usageContext?: string[];
  backgroundType?: string[];
  visualComplexity?: string[];
  tone?: string[];
  peopleFocus?: string[];
}

/**
 * A single media item returned by a driver
 */
export interface MediaItem {
  id: string;
  urls: {
    preview?: string;
    thumbnail?: string;
    standard?: string;
    highRes?: string;
  };
  dimensions?: {
    height?: number;
    width?: number;
  };
  title?: string;
  caption?: string;
}

/**
 * Result from a driver search operation
 */
export interface MediaResult {
  success: boolean;
  items?: MediaItem[];
  totalResults?: number;
  error?: string;
}

/**
 * Interface that all media search drivers must implement
 */
export interface MediaDriver {
  search(options: MediaDriverSearchOptions): Promise<MediaResult>;
}
