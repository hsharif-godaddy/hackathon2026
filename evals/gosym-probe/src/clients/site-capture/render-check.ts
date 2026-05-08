import type { Page } from 'playwright';

import type { RenderedSignals } from './types.js';

export async function captureRenderedSignals(
  page: Page,
): Promise<RenderedSignals> {
  const raw = await page.evaluate(() => {
    const title = document.title || '';
    const h1El = document.querySelector('h1');
    const h1 = h1El ? (h1El.textContent || '').trim() : null;
    const headingTexts = Array.from(document.querySelectorAll('h1, h2'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 6);
    const bodyPreview = (document.body.innerText || '').slice(0, 300);
    return {
      title,
      h1,
      headingText: headingTexts.join(' | '),
      bodyPreview,
    };
  });

  return {
    title: raw.title,
    h1: raw.h1,
    headingText: raw.headingText,
    bodyPreview: raw.bodyPreview,
  };
}

export function isRouteEmpty(signals: RenderedSignals): boolean {
  return !signals.title
    && !signals.h1
    && !signals.headingText
    && !signals.bodyPreview.trim();
}
