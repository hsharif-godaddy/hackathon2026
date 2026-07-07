export interface CommerceCheckoutGuardFile {
  path: string;
  content: string;
}

export type CommerceCheckoutGuardFindingCode =
  | 'payment_templates_missing'
  | 'commerce_ui_templates_missing'
  | 'checkout_response_redirect_url'
  | 'manual_checkout_route'
  | 'replacement_checkout_api'
  | 'order_status_not_wired'
  | 'success_page_missing_paid_status_gate';

export interface CommerceCheckoutGuardFinding {
  code: CommerceCheckoutGuardFindingCode;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
}

export interface CommerceCheckoutGuardInput {
  expectCheckout: boolean;
  paymentTemplatesInstalled: boolean;
  commerceUiTemplatesInstalled: boolean;
  /** Paths of installed template files to exclude from user-code checks (prevents false negatives). */
  installedTemplatePaths?: Set<string>;
  files: CommerceCheckoutGuardFile[];
}

export interface CommerceCheckoutGuardResult {
  status: 'passed' | 'failed';
  paymentTemplatesInstalled: boolean;
  commerceUiTemplatesInstalled: boolean;
  findings: CommerceCheckoutGuardFinding[];
}

const CHECKOUT_ROUTE_PATH = 'src/server/api/commerce/checkout/POST.ts';
const ORDER_STATUS_ROUTE_PATH = 'src/server/api/commerce/order-status/GET.ts';
const CHECKOUT_HELPER_PATH = 'src/lib/commerce/create-checkout-session.ts';

const COMMERCE_UI_CART_ROUTE_PATH = 'src/server/api/commerce/cart/POST.ts';
const COMMERCE_UI_PRODUCTS_ROUTE_PATH = 'src/server/api/commerce/products/GET.ts';

export const GODADDY_PAYMENTS_TEMPLATE_PATHS = [
  CHECKOUT_ROUTE_PATH,
  ORDER_STATUS_ROUTE_PATH,
  CHECKOUT_HELPER_PATH,
] as const;

/** Lib helpers installed by payment/godaddy-payments that are NOT in GODADDY_PAYMENTS_TEMPLATE_PATHS. */
export const GODADDY_PAYMENTS_LIB_TEMPLATE_PATHS = [
  'src/lib/commerce/get-order-status.ts',
  'src/lib/commerce/checkout-subgraph.ts',
  'src/lib/commerce/config.ts',
  'src/lib/commerce/gql.ts',
  'src/lib/commerce/order-subgraph.ts',
] as const;

export const COMMERCE_UI_TEMPLATE_PATHS = [
  COMMERCE_UI_CART_ROUTE_PATH,
  COMMERCE_UI_PRODUCTS_ROUTE_PATH,
] as const;

export const COMMERCE_UI_ROUTE_MARKERS: { pattern: string; routeFile: string }[] = [
  { pattern: '/api/commerce/cart', routeFile: COMMERCE_UI_CART_ROUTE_PATH },
  { pattern: '/api/commerce/products', routeFile: COMMERCE_UI_PRODUCTS_ROUTE_PATH },
  { pattern: '/api/commerce/skus', routeFile: 'src/server/api/commerce/skus/[id]/GET.ts' },
];

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function isManualCheckoutRoute(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith('src/server/api/commerce/')) return false;
  if (normalized === CHECKOUT_ROUTE_PATH || normalized === ORDER_STATUS_ROUTE_PATH) return false;
  return /\/(?:checkout|order-status)\//i.test(normalized);
}

function isReplacementCheckoutApi(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith('src/server/api/commerce/')) return false;
  return /(?:shipping|place-order|place_order|complete-order|complete_order)/i.test(normalized);
}

function usesCheckoutRoute(content: string): boolean {
  return content.includes('/api/commerce/checkout');
}

function usesOrderStatusRoute(content: string): boolean {
  return content.includes('/api/commerce/order-status') || content.includes('getOrderStatus');
}

function hasOrderStatusPaidGate(content: string): boolean {
  // Accept any casing of "paid"/"fulfilled" — the GoDaddy API returns uppercase
  // ("PAID", "FULFILLED") but client code often normalizes with toLowerCase/toUpperCase.
  return /['"](?:paid|fulfilled)['"]/i.test(content);
}

function usesCatalogOrCartRoute(content: string): boolean {
  return (
    content.includes('/api/commerce/cart') ||
    content.includes('/api/commerce/products') ||
    content.includes('/api/commerce/skus')
  );
}

function stripJavaScriptComments(content: string): string {
  let result = '';
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (quote) {
      result += char;

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < content.length && content[index] !== '\n') {
        index += 1;
      }
      if (index < content.length) {
        result += '\n';
      }
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < content.length) {
        if (content[index] === '\n') {
          result += '\n';
        }
        if (content[index] === '*' && content[index + 1] === '/') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    result += char;
  }

  return result;
}

export function validateCommerceCheckoutImplementation(
  input: CommerceCheckoutGuardInput
): CommerceCheckoutGuardResult {
  const findings: CommerceCheckoutGuardFinding[] = [];

  if (input.expectCheckout && !input.paymentTemplatesInstalled) {
    findings.push({
      code: 'payment_templates_missing',
      severity: 'error',
      message:
        'Commerce cart checkout is currently supported only through GoDaddy Payments templates for confirmed US/CA merchants. If the merchant is outside the US/Canada, do not build Commerce checkout UI; block before checkout and recommend Stripe or another third-party processor for a non-Commerce payment flow.',
    });
  }

  if (input.installedTemplatePaths) {
    for (const { pattern, routeFile } of COMMERCE_UI_ROUTE_MARKERS) {
      const callers = input.files.filter((file) =>
        stripJavaScriptComments(file.content).includes(pattern)
      );
      if (callers.length > 0 && !input.installedTemplatePaths.has(routeFile)) {
        findings.push({
          code: 'commerce_ui_templates_missing',
          severity: 'error',
          message: `Files call ${pattern} but the required commerce/ui route ${routeFile} is not installed. Install commerce/ui templates first: skill({ action: "install", skill: "commerce/ui" }). These templates provide the cart, product, and SKU API routes the UI depends on.`,
        });
      }
    }
  } else {
    const filesUsingCatalogOrCart = input.files.filter((file) =>
      usesCatalogOrCartRoute(stripJavaScriptComments(file.content))
    );
    if (filesUsingCatalogOrCart.length > 0 && !input.commerceUiTemplatesInstalled) {
      findings.push({
        code: 'commerce_ui_templates_missing',
        severity: 'error',
        message:
          'Files call /api/commerce/cart, /api/commerce/products, or /api/commerce/skus but commerce/ui templates are not installed. Install commerce/ui templates first: skill({ action: "install", skill: "commerce/ui" }). These templates provide the cart and product API routes the UI depends on.',
      });
    }
  }

  if (input.expectCheckout && input.paymentTemplatesInstalled) {
    const userFiles = input.installedTemplatePaths
      ? input.files.filter((file) => !input.installedTemplatePaths!.has(normalizePath(file.path)))
      : input.files;
    const filesCallingOrderStatus = userFiles.filter((file) =>
      usesOrderStatusRoute(stripJavaScriptComments(file.content))
    );
    if (filesCallingOrderStatus.length === 0) {
      findings.push({
        code: 'order_status_not_wired',
        severity: 'error',
        message:
          'The checkout success page must call GET /api/commerce/order-status (or import getOrderStatus) to verify payment server-side before fulfilling the order. A success-page redirect alone is not payment confirmation.',
      });
    } else {
      const anyHasPaidGate = filesCallingOrderStatus.some((file) =>
        hasOrderStatusPaidGate(stripJavaScriptComments(file.content))
      );
      if (!anyHasPaidGate) {
        findings.push({
          code: 'success_page_missing_paid_status_gate',
          severity: 'warning',
          message:
            'The success page calls order-status but never checks order.status against "PAID" or "FULFILLED". A "PENDING" order returns a 200 response — showing confirmation when status is "PENDING" means any user who abandons payment and revisits the success URL will see "Order Confirmed" without having paid.',
        });
      }
    }
  }

  for (const file of input.files) {
    const path = normalizePath(file.path);
    const codeContent = stripJavaScriptComments(file.content);
    const usesInstalledCheckoutRoute = usesCheckoutRoute(codeContent);

    if (usesInstalledCheckoutRoute && codeContent.includes('redirectUrl')) {
      findings.push({
        code: 'checkout_response_redirect_url',
        severity: 'error',
        path,
        message:
          'Checkout UI must redirect to data.url. The installed /api/commerce/checkout route does not return redirectUrl.',
      });
    }

    if (!input.paymentTemplatesInstalled && usesInstalledCheckoutRoute) {
      findings.push({
        code: 'payment_templates_missing',
        severity: 'error',
        path,
        message:
          'This file calls /api/commerce/checkout, but the confirmed US/CA GoDaddy Payments checkout templates are not installed. For non-US/CA merchants, do not build Commerce checkout UI; block before checkout and recommend Stripe or another third-party processor for a non-Commerce payment flow.',
      });
    }

    if (isManualCheckoutRoute(path)) {
      findings.push({
        code: 'manual_checkout_route',
        severity: 'error',
        path,
        message:
          'Do not create Commerce checkout or order-status routes manually. Use confirmed US/CA GoDaddy Payments templates, or block Commerce checkout for non-US/CA merchants and recommend Stripe or another third-party processor for a non-Commerce payment flow.',
      });
    }

    if (isReplacementCheckoutApi(path)) {
      findings.push({
        code: 'replacement_checkout_api',
        severity: 'error',
        path,
        message:
          'Do not build replacement shipping, place-order, or order completion APIs for Commerce checkout. Use the installed GoDaddy Payments checkout route.',
      });
    }
  }

  return {
    status: findings.some((finding) => finding.severity === 'error') ? 'failed' : 'passed',
    paymentTemplatesInstalled: input.paymentTemplatesInstalled,
    commerceUiTemplatesInstalled: input.commerceUiTemplatesInstalled,
    findings,
  };
}
