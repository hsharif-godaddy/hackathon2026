/**
 * Design RAG - Experimental RAG data processing pipelines
 *
 * This package provides tools for:
 * - Uploading content to KnowB knowledge base
 * - Searching KnowB for semantic similarity
 * - Processing and transforming data for RAG pipelines
 */

export {
  KnowBClient,
  type SearchOptions,
  type SearchResult,
  type SearchResultItem,
  type UploadOptions,
  type UploadResult,
  type DeleteOptions,
  type DeleteResult
} from './knowb-client.js';
