const COOKIE_NAME = 'airo_returning_user';
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/**
 * Returns true if the browser has the returning-user cookie set.
 * Used to decide whether to show the login or create-account SSO page.
 */
export function isReturningUser(): boolean {
  if (typeof document === 'undefined') return false;

  return document.cookie.split(';').some((cookie) => {
    const [name] = cookie.trim().split('=');
    return name === COOKIE_NAME;
  });
}

/**
 * Sets a long-lived cookie marking this browser as belonging to a returning user.
 * Called on any authenticated page load via ReturningUserCookieSync.
 */
export function setReturningUserCookie(): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${COOKIE_NAME}=1; Max-Age=${ONE_YEAR_SECONDS}; Path=/; SameSite=Lax; Secure`;
}
