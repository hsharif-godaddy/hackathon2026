export interface CommerceCheckoutGuardFile {
  path: string;
  content: string;
}

export type CommerceCheckoutGuardFindingCode =
  | 'payment_templates_missing'
  | 'checkout_response_redirect_url'
  | 'manual_checkout_route'
  | 'replacement_checkout_api';

export interface CommerceCheckoutGuardFinding {
  code: CommerceCheckoutGuardFindingCode;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
}

export interface CommerceCheckoutGuardInput {
  expectCheckout: boolean;
  paymentTemplatesInstalled: boolean;
  files: CommerceCheckoutGuardFile[];
}

export interface CommerceCheckoutGuardResult {
  status: 'passed' | 'failed';
  paymentTemplatesInstalled: boolean;
  findings: CommerceCheckoutGuardFinding[];
}

const CHECKOUT_ROUTE_PATH = 'src/server/api/commerce/checkout/POST.ts';
const ORDER_STATUS_ROUTE_PATH = 'src/server/api/commerce/order-status/GET.ts';
const CHECKOUT_HELPER_PATH = 'src/lib/commerce/create-checkout-session.ts';

export const GODADDY_PAYMENTS_TEMPLATE_PATHS = [
  CHECKOUT_ROUTE_PATH,
  ORDER_STATUS_ROUTE_PATH,
  CHECKOUT_HELPER_PATH,
] as const;

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
        'Cart checkout requires payment/godaddy-payments templates before checkout UI or server routes are written.',
    });
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
          'This file calls /api/commerce/checkout, but the GoDaddy Payments checkout templates are not installed.',
      });
    }

    if (isManualCheckoutRoute(path)) {
      findings.push({
        code: 'manual_checkout_route',
        severity: 'error',
        path,
        message:
          'Do not create Commerce checkout or order-status routes manually. Install payment/godaddy-payments templates instead.',
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
    findings,
  };
}
