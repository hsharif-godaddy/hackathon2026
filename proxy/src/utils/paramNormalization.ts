/**
 * Normalizes page parameter for pagination
 * @param page - The page number from query params
 * @returns Normalized page number (minimum 1)
 */
export function normalizePage(page: string | undefined): number {
  return Math.max(1, parseInt(page as string) || 1);
}

/**
 * Normalizes pageSize parameter for pagination
 * @param pageSize - The page size from query params
 * @returns Normalized page size (minimum 1, maximum 100, default 25)
 */
export function normalizePageSize(pageSize: string | undefined): number {
  return Math.min(100, Math.max(1, parseInt(pageSize as string) || 25));
}
