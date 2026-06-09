import type { Frame, Locator, Page } from 'playwright';

const CLICK_TIMEOUT_MS = 1_000;
const HIDE_WAIT_MS = 1_500;

const SPECIFIC_SELECTORS: readonly string[] = [
  '#onetrust-accept-btn-handler',
  '#cookieConsentDismiss',
  '#cookie-accept',
  '[data-testid="cookie-accept"]',
  '[data-testid="accept-cookies"]',
  '[data-cookie-action="accept"]',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("ACCEPT ALL")',
  'button:has-text("Accept Cookies")',
  'button:has-text("I Accept")',
  'button:has-text("Agree All")',
  'button:has-text("Allow All")',
  'button:has-text("Allow all")',
  'a:has-text("Accept All")',
  'a:has-text("Accept")',
  'a:has-text("Got it")',
  '.cookie-consent-accept',
  '.cookie-banner__accept',
  '.cc-btn.cc-allow',
  '.cc-accept',
];

const BANNER_CONTAINER_SELECTORS: readonly string[] = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '#cookiebanner',
  '#cookie-banner',
  '#cookie-notice',
  '#cookie-consent',
  '#cookie-bar',
  '#cookie-popup',
  '#cookie-modal',
  '#cookie-alert',
  '#cookie-law-info-bar',
  '#gdpr-consent-tool-wrapper',
  '#cookieConsentContainer',
  '.cookie-banner',
  '.cookie-consent',
  '.cookie-notice',
  '.cookie-popup',
  '.cookie-bar',
  '.cc-window',
  '.cc-banner',
  '[data-cookie-banner]',
  '[data-cookie-consent]',
  '[data-testid="cookie-banner"]',
  '[role="dialog"][aria-label*="cookie" i]',
  '[role="dialog"][aria-label*="consent" i]',
  '[role="dialog"][aria-label*="privacy" i]',
];

const ACCEPT_BUTTON_SELECTORS: readonly string[] = [
  'button:has-text("Accept")',
  'button:has-text("ACCEPT")',
  'button:has-text("Agree")',
  'button:has-text("Allow")',
  'button:has-text("Got it")',
  'button:has-text("Got It")',
  'button:has-text("OK")',
  'button:has-text("Ok")',
  'button:has-text("Continue")',
  '[aria-label*="Accept"]',
  '[aria-label*="accept"]',
  '[aria-label*="cookies"]',
  '[aria-label*="Cookies"]',
];

const FRAME_URL_HINT = /cookie|consent|onetrust|cookiebot|trust|gdpr/i;

async function tryClickLocator(locator: Locator): Promise<boolean> {
  let count: number;
  try {
    count = await locator.count();
  } catch {
    return false;
  }
  if (count === 0) return false;

  let visible = false;
  try {
    visible = await locator.isVisible();
  } catch {
    return false;
  }
  if (!visible) return false;

  try {
    await locator.click({ timeout: CLICK_TIMEOUT_MS });
  } catch {
    return false;
  }

  await locator.waitFor({ state: 'hidden', timeout: HIDE_WAIT_MS }).catch(() => {});
  return true;
}

async function tryDismissIn(scope: Page | Frame): Promise<boolean> {
  for (const sel of SPECIFIC_SELECTORS) {
    let locator: Locator;
    try {
      locator = scope.locator(sel).first();
    } catch {
      continue;
    }
    if (await tryClickLocator(locator)) return true;
  }

  for (const containerSel of BANNER_CONTAINER_SELECTORS) {
    let container: Locator;
    try {
      container = scope.locator(containerSel).first();
    } catch {
      continue;
    }
    try {
      const count = await container.count();
      if (count === 0) continue;
      const visible = await container.isVisible();
      if (!visible) continue;
    } catch {
      continue;
    }

    for (const btnSel of ACCEPT_BUTTON_SELECTORS) {
      let btnLocator: Locator;
      try {
        btnLocator = container.locator(btnSel).first();
      } catch {
        continue;
      }
      if (await tryClickLocator(btnLocator)) return true;
    }
  }

  return false;
}

export async function dismissCookieConsent(page: Page): Promise<void> {
  if (await tryDismissIn(page)) return;

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (!FRAME_URL_HINT.test(frame.url())) continue;
    if (await tryDismissIn(frame)) return;
  }
}

