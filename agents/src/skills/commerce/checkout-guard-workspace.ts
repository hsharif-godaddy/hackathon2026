import { createForWorkspace } from '../../workspace/index.js';
import { logger } from '../../logging/index.js';
import {
  GODADDY_PAYMENTS_TEMPLATE_PATHS,
  GODADDY_PAYMENTS_LIB_TEMPLATE_PATHS,
  COMMERCE_UI_TEMPLATE_PATHS,
  COMMERCE_UI_ROUTE_MARKERS,
  validateCommerceCheckoutImplementation,
  type CommerceCheckoutGuardFile,
  type CommerceCheckoutGuardResult,
} from './checkout-guard.js';

export async function runCheckoutGuardOnWorkspace(
  appId: string,
  expectCheckout = true,
): Promise<CommerceCheckoutGuardResult | null> {
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) return null;

  const allTemplatePaths: string[] = [
    ...GODADDY_PAYMENTS_TEMPLATE_PATHS,
    ...GODADDY_PAYMENTS_LIB_TEMPLATE_PATHS,
    ...COMMERCE_UI_TEMPLATE_PATHS,
    ...COMMERCE_UI_ROUTE_MARKERS.map((m) => m.routeFile),
  ];

  const statResult = await workspace.files.stat({ paths: allTemplatePaths });
  const foundTemplatePaths = new Set(
    statResult.entries
      .filter((entry) => !('error' in entry))
      .map((entry) => entry.path.replace(/\\/g, '/').replace(/^\.?\//, '')),
  );

  const paymentTemplatesInstalled = GODADDY_PAYMENTS_TEMPLATE_PATHS.every((p) =>
    foundTemplatePaths.has(p),
  );
  const commerceUiTemplatesInstalled = COMMERCE_UI_TEMPLATE_PATHS.every((p) =>
    foundTemplatePaths.has(p),
  );

  const tree = await workspace.files.tree({
    path: 'src',
    recursive: true,
    kindFilter: 'file',
    includeGlobs: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.js', 'src/**/*.jsx'],
  });

  const files: CommerceCheckoutGuardFile[] = [];
  for (const entry of tree.entries.filter((e) => e.kind === 'file')) {
    try {
      const content = await workspace.files.readText({ path: entry.path });
      files.push({ path: entry.path, content });
    } catch (err) {
      logger.warn('commerce_checkout_guard.view_failed', {
        appId,
        path: entry.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return validateCommerceCheckoutImplementation({
    expectCheckout,
    paymentTemplatesInstalled,
    commerceUiTemplatesInstalled,
    installedTemplatePaths: foundTemplatePaths,
    files,
  });
}
