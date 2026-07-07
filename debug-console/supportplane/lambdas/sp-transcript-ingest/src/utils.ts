/**
 * utils.ts — pure L1-transcript helpers.
 *
 * Vendored from debug-console `src/lib/l1-transcript-utils.ts` (the isolated
 * Lambda package has no workspace access). Behavior is identical; only the
 * S3-key / File-validation helpers that the Lambda does not need were dropped.
 */
import crypto from 'node:crypto';

/**
 * Calculate SHA-256 hash of a file buffer
 */
export function hashFile(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Sanitize text field (remove null bytes, trim)
 */
export function sanitizeText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const str: string = String(value);
  return str.replace(/\0/g, '').trim() || null;
}

/**
 * Map country to language code
 */
export function mapCountryToLanguage(country: string | null): string | null {
  if (!country) return null;

  const countryLower: string = country.toLowerCase();

  const mapping: Record<string, string> = {
    'united states': 'en',
    canada: 'en',
    mexico: 'es',
    spain: 'es',
    france: 'fr',
    germany: 'de',
    italy: 'it',
    brazil: 'pt',
    portugal: 'pt',
    china: 'zh',
    japan: 'ja',
    korea: 'ko',
    india: 'en',
    'united kingdom': 'en',
    australia: 'en',
    'new zealand': 'en',
  };

  return mapping[countryLower] || 'en';
}

/**
 * Map sentiment text to score
 */
export function mapSentimentToScore(sentiment: string | null): number | null {
  if (!sentiment) return null;

  const sentimentLower: string = sentiment.toLowerCase();

  if (sentimentLower.includes('positive')) return 0.8;
  if (sentimentLower.includes('neutral')) return 0.5;
  if (sentimentLower.includes('negative')) return 0.2;

  return 0.5;
}

/**
 * Map issue resolution to interaction status
 */
export function mapResolutionToStatus(resolution: string | null): string | null {
  if (!resolution) return null;

  const resolutionLower: string = resolution.toLowerCase();

  if (resolutionLower === 'yes' || resolutionLower === 'resolved') return 'resolved';
  if (resolutionLower === 'no' || resolutionLower === 'unresolved') return 'unresolved';
  if (resolutionLower === 'partially' || resolutionLower.includes('partial')) return 'partially_resolved';

  return 'unknown';
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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate CSV row structure and critical fields
 */
export function validateCsvRows(rows: Array<Record<string, unknown>>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    errors.push('No rows found in file');
    return { valid: false, errors, warnings };
  }

  const firstRow: Record<string, unknown> = rows[0];
  const requiredColumns: string[] = [
    'interaction_id',
    'conversation_summary',
    'full_transcript',
    'shopper_id',
  ];

  const missingColumns: string[] = requiredColumns.filter((col) => !(col in firstRow));
  if (missingColumns.length > 0) {
    errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
  }

  const expectedColumns: string[] = [
    'issue_resolution',
    'airo_product_line',
    'sales_consultation',
    'customer_sentiment',
    'country',
  ];

  const missingExpected: string[] = expectedColumns.filter((col) => !(col in firstRow));
  if (missingExpected.length > 0) {
    warnings.push(`Missing expected columns: ${missingExpected.join(', ')}`);
  }

  const sampleSize: number = Math.min(10, rows.length);
  let emptyInteractionIds = 0;
  let emptyShopperIds = 0;
  let emptyTranscripts = 0;

  for (let i = 0; i < sampleSize; i++) {
    const row: Record<string, unknown> = rows[i];

    const interactionId: string = String(row.interaction_id || '').trim();
    if (!interactionId) {
      emptyInteractionIds++;
    } else if (
      interactionId.length > 100 ||
      interactionId.includes('|||') ||
      /\b(agent|customer|bot):/i.test(interactionId)
    ) {
      errors.push(
        `Row ${i + 1}: interaction_id contains transcript text: "${interactionId.substring(0, 50)}..."`
      );
    }

    const shopperId: string = String(row.shopper_id || '').trim();
    if (!shopperId) {
      emptyShopperIds++;
    } else if (
      shopperId.length > 50 ||
      shopperId.includes('|||') ||
      /\b(agent|customer|bot):/i.test(shopperId)
    ) {
      errors.push(
        `Row ${i + 1}: shopper_id contains transcript text: "${shopperId.substring(0, 50)}..."`
      );
    }

    if (!row.full_transcript || String(row.full_transcript).trim() === '') {
      emptyTranscripts++;
    }

    if ('issue_resolution' in row && row.issue_resolution) {
      const resolution: string = String(row.issue_resolution).toLowerCase();
      const validValues: string[] = ['yes', 'no', 'resolved', 'unresolved', 'partially', 'unknown'];
      if (!validValues.some((v) => resolution.includes(v))) {
        warnings.push(`Row ${i + 1}: unexpected issue_resolution value: "${row.issue_resolution}"`);
      }
    }
  }

  if (emptyInteractionIds > sampleSize / 2) {
    errors.push(`${emptyInteractionIds}/${sampleSize} sample rows have empty interaction_id`);
  } else if (emptyInteractionIds > 0) {
    warnings.push(
      `${emptyInteractionIds}/${sampleSize} sample rows have empty interaction_id (will generate IDs)`
    );
  }

  if (emptyShopperIds > sampleSize / 2) {
    warnings.push(
      `${emptyShopperIds}/${sampleSize} sample rows have empty shopper_id (will use "unknown")`
    );
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
