/**
 * Interface for app ID adapters
 * 
 * Provides a consistent way to handle the job ID → app ID transition in V2 mode
 * and ensure file operations use the correct ID
 */
export interface IAppIdAdapter {
  /**
   * Resolves any ID (job ID or app ID) to the correct app ID for API operations
   * 
   * @param id - The original ID (could be job ID or app ID)
   * @param operation - The operation being performed (for logging)
   * @returns The resolved app ID to use for API calls
   */
  resolveAppId(id: string, operation: string): Promise<string>;
}
