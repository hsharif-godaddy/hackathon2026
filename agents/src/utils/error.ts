/**
 * Utility functions for safe error handling with TypeScript strict mode
 */

/**
 * Safely extracts error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Safely extracts error details for logging
 */
export function getErrorDetails(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    const result: { name: string; message: string; stack?: string } = {
      name: error.name,
      message: error.message
    };
    if (error.stack) {
      result.stack = error.stack;
    }
    return result;
  }
  
  const message = typeof error === 'string' ? error : String(error);
  return {
    name: 'UnknownError',
    message
  };
}

/**
 * Type guard to check if an unknown value is an Error
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}