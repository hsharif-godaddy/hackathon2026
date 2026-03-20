/**
 * Configure these IDs from Commerce handoff context.
 *
 * Runtime reads VITE_GODADDY_STORE_ID / VITE_GODADDY_CHANNEL_ID first,
 * then falls back to these constants for compatibility.
 */
export const STOREFRONT_STORE_ID = 'REPLACE_WITH_STORE_ID';
export const STOREFRONT_CHANNEL_ID = 'REPLACE_WITH_CHANNEL_ID';

export function getStorefrontRuntimeConfig() {
  const clientId = import.meta.env.VITE_GODADDY_CLIENT_ID;
  const apiHost = import.meta.env.VITE_GODADDY_API_HOST;
  const storeId = import.meta.env.VITE_GODADDY_STORE_ID || STOREFRONT_STORE_ID;
  const channelId = import.meta.env.VITE_GODADDY_CHANNEL_ID || STOREFRONT_CHANNEL_ID;

  if (!clientId) {
    throw new Error('Missing VITE_GODADDY_CLIENT_ID. Add it to .env.');
  }

  if (!apiHost) {
    throw new Error('Missing VITE_GODADDY_API_HOST. Add it to .env (hostname only, no protocol).');
  }

  if (!storeId || storeId === 'REPLACE_WITH_STORE_ID') {
    throw new Error('Storefront store ID is not configured. Set VITE_GODADDY_STORE_ID or update src/lib/commerce/storefront-config.ts');
  }

  if (!channelId || channelId === 'REPLACE_WITH_CHANNEL_ID') {
    throw new Error('Storefront channel ID is not configured. Set VITE_GODADDY_CHANNEL_ID or update src/lib/commerce/storefront-config.ts');
  }

  return {
    storeId,
    channelId,
    clientId,
    apiHost,
  };
}

export function getCommercePreviewUrl() {
  if (import.meta.env.VITE_PREVIEW_URL) return import.meta.env.VITE_PREVIEW_URL;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://placeholder.godaddy.com';
}
