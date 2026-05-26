/**
 * Check if a development server is responding on the given port.
 * Returns true if the server responds with a non-5xx status, false otherwise.
 */
export async function checkPreviewHealth(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(3000),
    })
    await response.body?.cancel()
    return response.status < 500
  } catch {
    return false
  }
}
