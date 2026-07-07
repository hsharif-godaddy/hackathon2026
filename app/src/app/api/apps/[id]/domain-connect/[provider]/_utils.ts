export function buildNonceCookieName(appId: string): string {
  return `dc_nonce_${appId}`;
}
