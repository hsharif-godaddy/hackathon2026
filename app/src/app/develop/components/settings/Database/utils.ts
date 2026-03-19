/**
 * Format column name for display
 * Replaces underscores with spaces and capitalizes each word
 *
 * @param name - Column name from database
 * @returns Formatted display name
 */
export function formatColumnName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Format database type for human-readable display
 *
 * @param type - Database column type (e.g., "varchar(255)", "int", "datetime")
 * @returns Human-readable type description
 */
export function formatColumnType(type: string): string {
  const lowerType = type.toLowerCase();

  // Extract length from varchar/char types
  const varcharMatch = lowerType.match(/^varchar\((\d+)\)$/);
  if (varcharMatch) {
    return `Text (up to ${varcharMatch[1]} characters)`;
  }

  const charMatch = lowerType.match(/^char\((\d+)\)$/);
  if (charMatch) {
    return `Text (${charMatch[1]} characters)`;
  }

  // Handle text types
  if (lowerType === 'text') {return 'Long text';}
  if (lowerType === 'tinytext') {return 'Short text';}
  if (lowerType === 'mediumtext') {return 'Medium text';}
  if (lowerType === 'longtext') {return 'Very long text';}

  // Handle numeric types
  if (lowerType.includes('int')) {return 'Number';}
  if (lowerType.includes('decimal') || lowerType.includes('numeric')) {return 'Decimal number';}
  if (lowerType.includes('float') || lowerType.includes('double')) {return 'Decimal number';}

  // Handle date/time types
  if (lowerType === 'datetime') {return 'Date and time';}
  if (lowerType === 'date') {return 'Date';}
  if (lowerType === 'time') {return 'Time';}
  if (lowerType.includes('timestamp')) {return 'Timestamp';}

  // Handle boolean
  if (lowerType === 'tinyint(1)' || lowerType === 'boolean') {return 'True/False';}

  // Handle enum/set
  if (lowerType.startsWith('enum(')) {return 'Selection';}
  if (lowerType.startsWith('set(')) {return 'Multiple selection';}

  // Default: return original type
  return type;
}

/**
 * Trigger a browser-native file download via a temporary <a> element.
 * The server responds with Content-Disposition: attachment, so the browser
 * streams directly to disk without buffering in memory.
 */
export function triggerTableExport(appId: string, tableName: string, format: 'csv' | 'json'): void {
  const url = `/api/database/${appId}/tables/${encodeURIComponent(tableName)}/export?format=${format}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tableName}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Get responsive grid classes based on column count
 * Determines optimal grid layout for forms based on number of fields
 *
 * @param columnCount - Number of columns to display
 * @returns Tailwind grid classes for responsive layout
 */
export function getGridClasses(columnCount: number): string {
  if (columnCount <= 4) {return 'grid-cols-1';}
  if (columnCount <= 11) {return 'grid-cols-1 md:grid-cols-2';}
  return 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
}

