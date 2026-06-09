import type { Page } from '@playwright/test';

type SwitchboardPatch = Record<string, boolean>;

export async function isDomainConnectEnabled(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as unknown as { gasketData?: { switchboard?: Record<string, unknown> } })
        .gasketData?.switchboard?.['appbuilder-domain-connect'] === true,
  );
}

export async function installSwitchboardFlagOverride(
  page: Page,
  flags: SwitchboardPatch,
): Promise<void> {
  await page.addInitScript((patch) => {
    const merge = (value: Record<string, unknown> | undefined) => ({
      ...value,
      switchboard: {
        ...(value?.switchboard as Record<string, unknown> | undefined),
        ...patch,
      },
    });

    let gasketData = (window as unknown as { gasketData?: Record<string, unknown> }).gasketData;
    if (gasketData) {
      gasketData = merge(gasketData);
    }

    Object.defineProperty(window, 'gasketData', {
      configurable: true,
      enumerable: true,
      get() {
        return gasketData;
      },
      set(value: Record<string, unknown> | undefined) {
        gasketData = merge(value);
      },
    });
  }, flags);
}

export async function openDomainSettingsPanel(page: Page, appId: string): Promise<void> {
  const url = new URL(page.url());
  url.pathname = `/develop/${appId}`;
  url.search = `?siteId=${appId}&tab=settings&settings=domain`;
  await page.goto(url.toString(), { waitUntil: 'load' });
}

export async function mockCustomerDomainsRoute(
  page: Page,
  domains: Array<{ domain: string; name?: string }>,
): Promise<void> {
  await page.route('**/api/domains**', async (route, request) => {
    if (request.method() !== 'GET') {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        domains: domains.map((entry) => ({
          domain: entry.domain,
          name: entry.name ?? entry.domain,
          hasInternalNameservers: true,
          nameservers: ['ns31.domaincontrol.com', 'ns32.domaincontrol.com'],
        })),
        totalInSearch: domains.length,
      }),
    });
  });
}

export async function mockSiteRoute(
  page: Page,
  appId: string,
  mutate: (body: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  await page.route(`**/api/sites/${appId}`, async (route, request) => {
    if (request.method() !== 'GET') {
      return route.continue();
    }
    try {
      const upstream = await route.fetch();
      const body = (await upstream.json()) as Record<string, unknown>;
      await route.fulfill({
        response: upstream,
        body: JSON.stringify(mutate(body)),
      });
    } catch {
      await route.continue();
    }
  });
}

export function asPublishedSite(
  body: Record<string, unknown>,
  domains: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  return {
    ...body,
    variants: ['preview', 'publish'],
    published_url: body.published_url ?? 'https://example.airobuilder.dev-godaddy.com',
    domains,
  };
}

export async function mockDomainValidationRoute(page: Page, appId: string): Promise<void> {
  await page.route(`**/api/apps/${appId}/domain/check**`, async (route, request) => {
    if (request.method() !== 'GET') {
      return route.continue();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true, errors: [] }),
    });
  });
}

export async function waitForDomainPanelData(page: Page, appId: string): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (resp) => resp.url().includes(`/api/sites/${appId}`) && resp.status() === 200,
    ),
    page.waitForResponse(
      (resp) => resp.url().includes('/api/domains') && resp.status() === 200,
    ),
  ]);
}

export async function selectDomainAttachTab(
  page: Page,
  tab: 'connect' | 'buy' | 'external',
): Promise<void> {
  const tabButton = page.locator(`#${tab}`);
  if (await tabButton.count()) {
    await tabButton.click();
    return;
  }

  const tabPatterns: Record<'connect' | 'buy' | 'external', RegExp> = {
    connect: /GoDaddy Domains|builder_domain_attach_tab_domains/i,
    buy: /Buy a Domain|builder_domain_attach_tab_buy/i,
    external: /External Domain Name|builder_domain_attach_tab_external/i,
  };
  await page.getByRole('tab', { name: tabPatterns[tab] }).click();
}
