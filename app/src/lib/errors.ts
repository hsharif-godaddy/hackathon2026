/**
 * General error handling utilities
 */

/**
 * Extracts a string error message from an unknown error value
 * @param error - The error value (typically from a catch block)
 * @returns A string representation of the error
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
