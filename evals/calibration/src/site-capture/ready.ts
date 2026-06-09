import type { Page } from 'playwright';

const READY_SELECTOR =
  '#app > *, #root > *, #__next > *, main *, [role="main"] *';

const READY_TIMEOUT_MS = 30_000;
const NETWORK_IDLE_TIMEOUT_MS = 5_000;

export async function wait(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: READY_TIMEOUT_MS }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

  await page.waitForSelector(READY_SELECTOR, { timeout: READY_TIMEOUT_MS }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const body = document.body;
        if (!body) return false;

        const interactive = body.querySelectorAll('a,button,input,select,textarea,main,h1,h2,h3').length;
        if (interactive > 0) return true;

        const text = body.innerText?.trim() ?? '';
        if (text.length >= 20) return true;

        const root = document.querySelector('#app,#root,#__next');
        const rootText = root?.textContent?.trim() ?? '';
        return rootText.length >= 20;
      },
      null,
      { timeout: READY_TIMEOUT_MS },
    )
    .catch(() => {});
}
