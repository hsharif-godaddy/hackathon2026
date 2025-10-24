/**
 * Custom error for when an app is not found in the repository
 * This typically happens during race conditions when an app is being registered
 */
export class AppNotFoundError extends Error {
  readonly errorType = 'APP_NOT_FOUND'
  readonly appId: string

  /**
   * Create an AppNotFoundError
   * 
   * @param appId - The ID of the app that was not found
   */
  constructor(appId: string) {
    super(`App with ID '${appId}' not found`)
    this.name = 'AppNotFoundError'
    this.appId = appId
  }
}

