/**
 * HTTP client for the AAB agents REST API.
 * Used by eval scenarios to register and clean up per-trial apps.
 */
export class AABAgentsApiClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Registers a new app via POST /apps/register, using siteId as
   * the app's ID. Returns the registered app ID.
   */
  async registerApp(id: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/apps/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: id, name: `eval-${id}` }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to register app '${id}': HTTP ${response.status}`,
      );
    }

    const data = await response.json() as { app: { id: string } };
    return data.app.id;
  }

  /**
   * Deletes an app by ID via DELETE /apps/:id.
   * Silently ignores 404 (app already removed).
   */
  async deleteApp(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/apps/${id}`, {
      method: 'DELETE',
    });

    if (response.ok || response.status === 404) return;

    throw new Error(
      `Failed to delete app '${id}': HTTP ${response.status}`,
    );
  }
}
