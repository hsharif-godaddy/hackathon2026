/**
 * l1-transcript-utils.ts
 * Utility functions for L1 transcript processing
 */

import crypto from 'crypto';

/**
 * Calculate SHA-256 hash of a file buffer
 */
export function hashFile(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate xlsx or csv file
 */
export function validateXlsxFile(file: File | Buffer, filename: string): { valid: boolean; error?: string } {
  // Check file extension (accept both .xlsx and .csv)
  const lowerName = filename.toLowerCase();
  if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.csv')) {
    return { valid: false, error: 'File must be .xlsx or .csv format' };
  }

  // Check file size (max 50MB)
  const maxSize = 50 * 1024 * 1024; // 50MB in bytes
  const size = Buffer.isBuffer(file) ? file.length : file.size;

  if (size > maxSize) {
    return { valid: false, error: `File too large (${(size / 1024 / 1024).toFixed(2)}MB). Max size: 50MB` };
  }

  if (size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  return { valid: true };
}

/**
 * Sanitize text field (remove null bytes, trim)
 */
export function sanitizeText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const str = String(value);
  // Remove null bytes and excessive whitespace
  return str.replace(/\0/g, '').trim() || null;
}

/**
 * Map country to language code
 */
export function mapCountryToLanguage(country: string | null): string | null {
  if (!country) return null;

  const countryLower = country.toLowerCase();

  const mapping: Record<string, string> = {
    'united states': 'en',
    'canada': 'en',
    'mexico': 'es',
    'spain': 'es',
    'france': 'fr',
    'germany': 'de',
    'italy': 'it',
    'brazil': 'pt',
    'portugal': 'pt',
    'china': 'zh',
    'japan': 'ja',
    'korea': 'ko',
    'india': 'en',
    'united kingdom': 'en',
    'australia': 'en',
    'new zealand': 'en',
  };

  return mapping[countryLower] || 'en'; // Default to English
}

/**
 * Map sentiment text to score
 */
export function mapSentimentToScore(sentiment: string | null): number | null {
  if (!sentiment) return null;

  const sentimentLower = sentiment.toLowerCase();

  if (sentimentLower.includes('positive')) return 0.8;
  if (sentimentLower.includes('neutral')) return 0.5;
  if (sentimentLower.includes('negative')) return 0.2;

  return 0.5; // Default to neutral
}

/**
 * Map issue resolution to interaction status
 */
export function mapResolutionToStatus(resolution: string | null): string | null {
  if (!resolution) return null;

  const resolutionLower = resolution.toLowerCase();

  if (resolutionLower === 'yes' || resolutionLower === 'resolved') return 'resolved';
  if (resolutionLower === 'no' || resolutionLower === 'unresolved') return 'unresolved';

  return 'unknown';
}

/**
 * Generate S3 key for uploads
 */
export function generateUploadS3Key(uploadId: string, filename: string): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');

  // Remove any path traversal attempts
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

  return `uploads/${timestamp}-${uploadId}-${safeName}`;
}

/**
 * Generate S3 key for backups
 */
export function generateBackupS3Key(type: 'pre' | 'post' | 'daily' | 'manual', uploadId?: string): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');

  // All backups go in flat structure with timestamp in filename
  if (type === 'daily') {
    return `backups/daily-${timestamp}.db`;
  }

  if (type === 'manual') {
    return `backups/manual-${timestamp}.db`;
  }

  // pre/post upload backups
  if (!uploadId) {
    throw new Error('uploadId required for pre/post backup type');
  }

  return `backups/${type}-${timestamp}-${uploadId}.db`;
}

/**
 * Parse CSV/xlsx column value safely
 */
export function parseColumnValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return sanitizeText(String(value));
}

/**
 * Chunk array into batches
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Validate CSV row structure and critical fields
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateCsvRows(rows: any[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    errors.push('No rows found in file');
    return { valid: false, errors, warnings };
  }

  // Check required columns exist in first row
  const firstRow = rows[0];
  const requiredColumns = [
    'interaction_id',
    'conversation_summary',
    'full_transcript',
    'shopper_id',
  ];

  const missingColumns = requiredColumns.filter(col => !(col in firstRow));
  if (missingColumns.length > 0) {
    errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
  }

  // Check expected columns exist (not required, but warn if missing)
  const expectedColumns = [
    'issue_resolution',
    'airo_product_line',
    'sales_consultation',
    'customer_sentiment',
    'country',
  ];

  const missingExpected = expectedColumns.filter(col => !(col in firstRow));
  if (missingExpected.length > 0) {
    warnings.push(`Missing expected columns: ${missingExpected.join(', ')}`);
  }

  // Validate data in sample rows (first 10)
  const sampleSize = Math.min(10, rows.length);
  let emptyInteractionIds = 0;
  let emptyShopperIds = 0;
  let emptyTranscripts = 0;
  let badInteractionIds = 0;
  let badShopperIds = 0;

  for (let i = 0; i < sampleSize; i++) {
    const row = rows[i];

    // Check interaction_id
    const interactionId = String(row.interaction_id || '').trim();
    if (!interactionId) {
      emptyInteractionIds++;
    } else {
      // Interaction IDs should be short identifiers, not long text
      // Check for signs of transcript data leaking into this field
      if (interactionId.length > 100 ||
          interactionId.includes('|||') ||
          /\b(agent|customer|bot):/i.test(interactionId)) {
        badInteractionIds++;
        errors.push(`Row ${i + 1}: interaction_id contains transcript text: "${interactionId.substring(0, 50)}..."`);
      }
    }

    // Check shopper_id
    const shopperId = String(row.shopper_id || '').trim();
    if (!shopperId) {
      emptyShopperIds++;
    } else {
      // Shopper IDs should be numeric or short alphanumeric, not Agent dialogue
      if (shopperId.length > 50 ||
          shopperId.includes('|||') ||
          /\b(agent|customer|bot):/i.test(shopperId)) {
        badShopperIds++;
        errors.push(`Row ${i + 1}: shopper_id contains transcript text: "${shopperId.substring(0, 50)}..."`);
      }
    }

    // Check full_transcript
    if (!row.full_transcript || String(row.full_transcript).trim() === '') {
      emptyTranscripts++;
    }

    // Validate issue_resolution values if column exists
    if ('issue_resolution' in row && row.issue_resolution) {
      const resolution = String(row.issue_resolution).toLowerCase();
      const validValues = ['yes', 'no', 'resolved', 'unresolved', 'unknown'];
      if (!validValues.some(v => resolution.includes(v))) {
        warnings.push(`Row ${i + 1}: unexpected issue_resolution value: "${row.issue_resolution}"`);
      }
    }

    // Validate sales_consultation values if column exists
    if ('sales_consultation' in row && row.sales_consultation) {
      const value = String(row.sales_consultation).toLowerCase();
      if (!['yes', 'no', 'true', 'false', '1', '0'].includes(value)) {
        warnings.push(`Row ${i + 1}: unexpected sales_consultation value: "${row.sales_consultation}"`);
      }
    }
  }

  // Report critical data issues
  if (emptyInteractionIds > sampleSize / 2) {
    errors.push(`${emptyInteractionIds}/${sampleSize} sample rows have empty interaction_id`);
  } else if (emptyInteractionIds > 0) {
    warnings.push(`${emptyInteractionIds}/${sampleSize} sample rows have empty interaction_id (will generate IDs)`);
  }

  if (emptyShopperIds > sampleSize / 2) {
    warnings.push(`${emptyShopperIds}/${sampleSize} sample rows have empty shopper_id (will use "unknown")`);
  }

  if (emptyTranscripts > sampleSize / 2) {
    errors.push(`${emptyTranscripts}/${sampleSize} sample rows have empty full_transcript`);
  } else if (emptyTranscripts > 0) {
    warnings.push(`${emptyTranscripts}/${sampleSize} sample rows have empty full_transcript`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
