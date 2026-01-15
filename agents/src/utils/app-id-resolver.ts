/**
 * Resolve app ID (handles both job IDs and regular app IDs)
 * 
 * In the agents service, we expect that by the time requests arrive,
 * the app should already be registered. If a job ID is passed, it means
 * the frontend hasn't updated to use the real app ID yet.
 * 
 * For now, we just return the ID as-is since the app should be registered
 * by the time the agent URL is available and requests can be made.
 */
export async function resolveAppId(id: string): Promise<string> {
  // For now, just return the ID as-is
  // The frontend should be passing the real app ID once the agent URL is available
  return id;
}
