/**
 * RFC 4180 CSV formatting utilities
 */

/**
 * Escape a single field value per RFC 4180.
 * Uses a quote-all strategy for strings/numbers for maximum interop
 * with Excel, Numbers, and Google Sheets.
 */
export function escapeCSVField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return `"${value}"`;
  }

  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return `"${json.replace(/"/g, '""')}"`;
  }

  const str = String(value);
  // Quote all values — safest for interop
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Format the CSV header line from column names.
 */
export function formatCSVHeader(columns: string[]): string {
  return columns.map(col => escapeCSVField(col)).join(',');
}

/**
 * Format a row object as a CSV line using column ordering from schema.
 */
export function formatCSVRow(row: Record<string, unknown>, columns: string[]): string {
  return columns.map(col => escapeCSVField(row[col])).join(',');
}
