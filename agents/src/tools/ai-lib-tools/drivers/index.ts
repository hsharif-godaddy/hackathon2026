/**
 * API Drivers Index
 *
 * Centralized exports for all API drivers
 */

export { BaseDriverV2 } from './base-driver-v2.js';
export type { BaseDriverV2Config } from './base-driver-v2.js';

// Shared media driver interface and types
export type {
  MediaDriver,
  MediaDriverSearchOptions,
  MediaResult,
  MediaItem,
} from './media-driver.js';

export { GettyMediaDriver } from './getty-media-driver.js';
// Re-export legacy type aliases for backward compatibility
export type {
  MediaType,
  GettyMediaOptions,
  GettyMediaResult,
  GettyMediaItem,
} from './getty-media-driver.js';

export { ImageSearchServiceDriver } from './image-search-service-driver.js';

export { KnowBDriver, knowBDriver } from './knowb-driver.js';
export type {
  KnowBSearchOptions,
  KnowBResultItem,
  KnowBSearchResult,
} from './knowb-driver.js';

export { WebsiteScraperDriver } from './website-scraper-driver.js';
export type {
  WebsiteScraperOptions,
  WebsiteScraperResult,
} from './website-scraper-driver.js';
