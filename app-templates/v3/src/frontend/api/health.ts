const API_URL = import.meta.env.VITE_API_URL || `http://localhost:${import.meta.env.VITE_BACKEND_PORT || '3000'}/api`;

export async function checkHealth() {
  const response = await globalThis.fetch(`${API_URL}/health`);
  if (!response.ok) {
    throw new Error('Health check failed');
  }
  return response.json();
}
