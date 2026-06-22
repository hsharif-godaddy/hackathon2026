import { send } from "./eventBus";
import type { BusUnsupportedFeature } from "./eventBus";

const INSTALLED = Symbol("airo-unsupported-api-wrappers-installed");

// Payment SDK script URL patterns — loading any of these in preview is a
// reliable signal that a payment flow is being attempted. We emit on script
// insertion rather than on API calls because each SDK has its own surface and
// the script load is the earliest detectable moment.
const PAYMENT_SDK_PATTERNS: RegExp[] = [
  /\bjs\.stripe\.com\b/,          // Stripe.js v2/v3
  /\bpoynt\.net\b/,               // GoDaddy Payments (Poynt)
  /\bpayments\.godaddy\.com\b/,   // GoDaddy Payments hosted
  /\bpaypal\.com\/sdk\b/,         // PayPal JS SDK
];

// Payment redirect hosts — Stripe redirectToCheckout() navigates via
// window.location rather than window.open, so the OAuth wrapper misses it.
const PAYMENT_REDIRECT_HOSTS = new Set([
  "checkout.stripe.com",
  "www.paypal.com",
  "paypal.com",
]);

const OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "www.facebook.com",
  "facebook.com",
  "github.com",
]);

function isOAuthUrl(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    // github.com and facebook.com host non-OAuth traffic too; only their
    // login paths are auth flows — avoid false-positives on other routes.
    if (hostname === "github.com" && !pathname.startsWith("/login")) return false;
    if ((hostname === "www.facebook.com" || hostname === "facebook.com") && !pathname.includes("login")) return false;
    return OAUTH_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

function emitWarning(feature: BusUnsupportedFeature): void {
  try {
    send({ type: "PREVIEW_UNSUPPORTED_FEATURE", feature });
  } catch {
    // never propagate — a throw here would trigger AiroErrorBoundary
  }
}

export function installUnsupportedApiWrappers(): void {
  // @ts-expect-error — Symbol used as an installation marker
  if (window[INSTALLED]) return;
  // @ts-expect-error
  window[INSTALLED] = true;

  // ── Payment SDK script detection ──────────────────────────────────────
  // Scan scripts already in the DOM (static <script> tags parsed before
  // dev-tools mounted) then watch for future dynamic insertions.
  function isPaymentScript(src: string): boolean {
    return PAYMENT_SDK_PATTERNS.some((p) => p.test(src));
  }
  try {
    for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))) {
      if (isPaymentScript(script.src)) {
        emitWarning("payment");
        break;
      }
    }
    const scriptObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeName !== "SCRIPT") continue;
          const src = (node as HTMLScriptElement).src;
          if (src && isPaymentScript(src)) emitWarning("payment");
        }
      }
    });
    scriptObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    // never propagate — a throw here would trigger AiroErrorBoundary
  }

  // ── Payment redirect detection (Stripe redirectToCheckout etc.) ────────
  // stripe.redirectToCheckout() navigates via window.location, not window.open.
  // Intercept both assignment paths so the warning fires before the iframe
  // navigates away to the checkout domain.
  function isPaymentRedirect(url: string): boolean {
    try {
      return PAYMENT_REDIRECT_HOSTS.has(new URL(url, window.location.href).hostname);
    } catch {
      return false;
    }
  }
  try {
    const origAssign = window.location.assign.bind(window.location);
    window.location.assign = function assign(url: string) {
      if (isPaymentRedirect(url)) emitWarning("payment");
      try { origAssign(url); } catch { /* never propagate */ }
    };
  } catch {
    // never propagate — a throw here would trigger AiroErrorBoundary
  }
  try {
    const locProto = Object.getPrototypeOf(window.location) as object;
    const hrefDesc = Object.getOwnPropertyDescriptor(locProto, "href");
    if (hrefDesc?.set) {
      const origSet = hrefDesc.set;
      Object.defineProperty(locProto, "href", {
        ...hrefDesc,
        set(url: string) {
          if (isPaymentRedirect(url)) emitWarning("payment");
          origSet.call(this, url);
        },
      });
    }
  } catch {
    // never propagate — a throw here would trigger AiroErrorBoundary
  }

  // ── Notification.requestPermission ────────────────────────────────────
  if (typeof Notification !== "undefined" && typeof Notification.requestPermission === "function") {
    const origRequestPermission = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = function requestPermission(callback?: NotificationPermissionCallback) {
      emitWarning("push-notification");
      try {
        return origRequestPermission(callback);
      } catch {
        // never propagate — a throw here would trigger AiroErrorBoundary
        return Promise.resolve("denied" as NotificationPermission);
      }
    };
  }

  // ── window.open (OAuth popups) ─────────────────────────────────────────
  const origOpen = window.open.bind(window);
  window.open = function open(url?: string | URL, target?: string, features?: string): WindowProxy | null {
    if (url && isOAuthUrl(typeof url === "string" ? url : url.toString())) {
      emitWarning("oauth-popup");
    }
    try {
      return origOpen(url, target, features);
    } catch {
      // never propagate — a throw here would trigger AiroErrorBoundary
      return null;
    }
  };
}
