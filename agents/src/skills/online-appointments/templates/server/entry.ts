import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { readFileSync } from "node:fs";

// <api-imports>
import healthGet from "./api/health/GET";
// Admin coupon APIs
import adminCouponsListGet from "./api/appointments/admin/coupons/GET";
import adminCouponsCreatePost from "./api/appointments/admin/coupons/POST";
import adminCouponsGetGet from "./api/appointments/admin/coupons/[id]/GET";
import adminCouponsUpdatePut from "./api/appointments/admin/coupons/[id]/PUT";
import adminCouponsDeleteDelete from "./api/appointments/admin/coupons/[id]/DELETE";
// Customer coupon APIs (internal operations)
import customerCouponsIncrementPost from "./api/appointments/customer/coupons/[code]/incrementUse/POST";
import customerCouponsDecrementPost from "./api/appointments/customer/coupons/[code]/decrementUse/POST";
// Public coupon APIs
import publicCouponsValidatePost from "./api/appointments/public/coupons/validate/POST";
import publicServicesGet from "./api/appointments/public/services/GET";
import publicServiceGet from "./api/appointments/public/services/[id]/GET";
import publicServiceSlugGet from "./api/appointments/public/services/slug/[slug]/GET";
import publicServiceAvailableDatesGet from "./api/appointments/public/services/[id]/available-slots-by-date-range/GET";
import publicServiceAvailabilityTimesGet from "./api/appointments/public/services/[id]/availability-times/GET";
import publicServiceStaffGet from "./api/appointments/public/services/[id]/staff/GET";
import publicCategoriesGet from "./api/appointments/public/categories/GET";
import publicCategoryServicesGet from "./api/appointments/public/categories/[id]/services/GET";
import publicQuestionsGet from "./api/appointments/public/questions/GET";
import publicConfigGet from "./api/appointments/public/config/GET";
import publicCountriesGet from "./api/appointments/public/countries/GET";
import publicCountryStatesGet from "./api/appointments/public/countries/[id]/states/GET";
import publicBookingsPost from "./api/appointments/public/bookings/POST";
// admin — auth
import adminAuthLoginPost from "./api/appointments/admin/auth/login/POST";
import adminAuthLogoutPost from "./api/appointments/admin/auth/logout/POST";
import adminAuthSetupGet from "./api/appointments/admin/auth/setup/GET";
import adminAuthSetupPost from "./api/appointments/admin/auth/setup/POST";
// admin — bookings
import adminBookingsGet from "./api/appointments/admin/bookings/GET";
import adminBookingPost from "./api/appointments/admin/bookings/POST";
import adminBookingSummaryGet from "./api/appointments/admin/bookings/summary/GET";
import adminBookingUpcomingGet from "./api/appointments/admin/bookings/upcoming/GET";
import adminBookingGet from "./api/appointments/admin/bookings/[id]/GET";
import adminBookingPatch from "./api/appointments/admin/bookings/[id]/PATCH";
import adminBookingDelete from "./api/appointments/admin/bookings/[id]/DELETE";
import adminBookingMarkAsPaidPatch from "./api/appointments/admin/bookings/[id]/mark-as-paid/PATCH";
// admin — services
import adminServicesGet from "./api/appointments/admin/services/GET";
import adminServicePost from "./api/appointments/admin/services/POST";
import adminServiceAppointmentPost from "./api/appointments/admin/services/appointment/POST";
import adminServiceOneTimeEventPost from "./api/appointments/admin/services/one-time-event/POST";
import adminServiceRecurringEventPost from "./api/appointments/admin/services/recurring-event/POST";
import adminServiceGet from "./api/appointments/admin/services/[id]/GET";
import adminServicePatch from "./api/appointments/admin/services/[id]/PATCH";
import adminServiceDelete from "./api/appointments/admin/services/[id]/DELETE";
import adminServiceAvailableDatesGet from "./api/appointments/admin/services/[id]/available-slots-by-date-range/GET";
import adminServiceAvailabilityTimesGet from "./api/appointments/admin/services/[id]/availability-times/GET";
import adminServiceBookingsCountGet from "./api/appointments/admin/services/[id]/bookings-count/GET";
// admin — clients
import adminClientsGet from "./api/appointments/admin/clients/GET";
import adminClientPost from "./api/appointments/admin/clients/POST";
import adminClientGet from "./api/appointments/admin/clients/[id]/GET";
import adminClientPatch from "./api/appointments/admin/clients/[id]/PATCH";
import adminClientDelete from "./api/appointments/admin/clients/[id]/DELETE";
import adminClientBookingsGet from "./api/appointments/admin/clients/[id]/bookings/GET";
// admin — business settings
import adminBusinessSettingsGet from "./api/appointments/admin/business-settings/GET";
import adminBusinessSettingsBatchUpsertPost from "./api/appointments/admin/business-settings/batch-upsert/POST";
// admin — availability (business hours)
import adminAvailabilityGet from "./api/appointments/admin/availability/GET";
import adminAvailabilityPut from "./api/appointments/admin/availability/PUT";
// admin — staff
import adminStaffListGet from "./api/appointments/admin/staff/GET";
import adminStaffPost from "./api/appointments/admin/staff/POST";
import adminStaffGet from "./api/appointments/admin/staff/[id]/GET";
import adminStaffPatch from "./api/appointments/admin/staff/[id]/PATCH";
import adminStaffDelete from "./api/appointments/admin/staff/[id]/DELETE";
// admin — categories
import adminCategoriesGet from "./api/appointments/admin/categories/GET";
// customer — lookup & my-bookings
import customerLookupGet from "./api/appointments/customer/lookup/GET";
import customerMyBookingsGet from "./api/appointments/customer/my-bookings/GET";
import customerMyBookingGet from "./api/appointments/customer/my-bookings/[id]/GET";
// auth — signup / login / logout / me
import authSignupPost from "./api/auth/signup/POST";
import authLoginPost from "./api/auth/login/POST";
import authLogoutPost from "./api/auth/logout/POST";
import authMeGet from "./api/auth/me/GET";
// payments
import paymentsCheckoutPost from "./api/appointments/payments/create-checkout-session/POST";
import paymentsWebhookPost from "./api/appointments/payments/webhook/POST";
import { requirePaymentProvider } from "./api/appointments/payments/middleware";
// admin — payments
import adminPaymentsTransactionsGet from "./api/appointments/admin/payments/transactions/GET";
// admin — payment providers
import adminPaymentProvidersGet from "./api/appointments/admin/payment-providers/GET";
import adminPaymentProvidersPost from "./api/appointments/admin/payment-providers/POST";
import adminPaymentProviderPatch from "./api/appointments/admin/payment-providers/[id]/PATCH";
import adminPaymentProviderDelete from "./api/appointments/admin/payment-providers/[id]/DELETE";
// </api-imports>
import cookieParser from "cookie-parser";
import { requireAdmin } from "./api/appointments/admin/auth/middleware";
import { requireAuth, requireRole } from "./api/appointments/shared/auth";
import { sessionMiddleware } from "./api/appointments/shared/auth";
import { requireFeature } from "./api/appointments/shared/feature-guard";
import { ALL_FEATURES } from "../lib/features";
import { seoRoutes } from "../lib/seo-routes";
import { isSystemHost } from "./seo-host";
import { startReminderScheduler } from "./api/appointments/services/reminder-scheduler";

function normalizeCommerceApiBaseUrlEnv() {
  if (process.env.GODADDY_API_BASE_URL) return;
  const hostOnly = process.env.VITE_GODADDY_API_HOST;
  if (!hostOnly) return;
  const normalizedHost = hostOnly.replace(/^https?:\/\//, "").trim();
  if (!normalizedHost) return;
  process.env.GODADDY_API_BASE_URL = `https://${normalizedHost}`;
}

normalizeCommerceApiBaseUrlEnv();

type RequestWithRawBody = Request & { rawBody?: Buffer };

const app = express();

// Honour x-forwarded-* from the load balancer so req.protocol/req.hostname
// reflect the public-facing values. Express-maintained parsing respects the
// existing trust-proxy config; direct header reads would let a client spoof
// the sitemap origin in robots.txt.
app.set("trust proxy", true);

app.use(cookieParser());

// Stripe webhook needs raw body for signature verification — must come BEFORE express.json()
app.post(
  "/api/appointments/payments/webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    (req as RequestWithRawBody).rawBody = req.body as Buffer;
    next();
  },
  paymentsWebhookPost,
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as RequestWithRawBody).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
// Resolve the session cookie → req.authUser for all downstream handlers
app.use(sessionMiddleware);


// <api-registrations>
app.get("/api/health", healthGet);
// Admin coupon endpoints (protected)
app.get("/api/appointments/admin/coupons", requireAdmin, adminCouponsListGet);
app.post("/api/appointments/admin/coupons", requireAdmin, adminCouponsCreatePost);
app.get("/api/appointments/admin/coupons/:id", requireAdmin, adminCouponsGetGet);
app.put("/api/appointments/admin/coupons/:id", requireAdmin, adminCouponsUpdatePut);
app.delete("/api/appointments/admin/coupons/:id", requireAdmin, adminCouponsDeleteDelete);
// Public coupon endpoints
app.post("/api/appointments/public/coupons/validate", publicCouponsValidatePost);
// Customer coupon endpoints (called during customer checkout/cancellation flow)
app.post("/api/appointments/customer/coupons/:code/incrementUse", customerCouponsIncrementPost);
app.post("/api/appointments/customer/coupons/:code/decrementUse", customerCouponsDecrementPost);
// auth — customer signup / login / logout / me
app.post("/api/auth/signup", authSignupPost);
app.post("/api/auth/login", authLoginPost);
app.post("/api/auth/logout", authLogoutPost);
app.get("/api/auth/me", authMeGet);
// public — services (slug must come before :id)
app.get(
  "/api/appointments/public/services/slug/:slug",
  requireFeature("public.services_browse"),
  publicServiceSlugGet,
);
app.get(
  "/api/appointments/public/services/:id/staff",
  requireFeature("customer.booking_flow.staff_selection"),
  publicServiceStaffGet,
);
app.get(
  "/api/appointments/public/services/:id/available-slots-by-date-range",
  requireFeature("customer.booking_flow"),
  publicServiceAvailableDatesGet,
);
app.get(
  "/api/appointments/public/services/:id/availability-times",
  requireFeature("customer.booking_flow"),
  publicServiceAvailabilityTimesGet,
);
app.get(
  "/api/appointments/public/services/:id",
  requireFeature("public.services_browse"),
  publicServiceGet,
);
app.get(
  "/api/appointments/public/services",
  requireFeature("public.services_browse"),
  publicServicesGet,
);
// public — categories
app.get(
  "/api/appointments/public/categories/:id/services",
  requireFeature("public.services_browse"),
  publicCategoryServicesGet,
);
app.get(
  "/api/appointments/public/categories",
  requireFeature("public.services_browse"),
  publicCategoriesGet,
);
// public — misc
app.get("/api/appointments/public/questions", publicQuestionsGet);
app.get("/api/appointments/public/config", publicConfigGet);
app.get("/api/appointments/public/countries/:id/states", publicCountryStatesGet);
app.get("/api/appointments/public/countries", publicCountriesGet);
// public — bookings
app.post(
  "/api/appointments/public/bookings",
  requireFeature("customer.booking_flow"),
  publicBookingsPost,
);
// admin — auth (no middleware)
app.get("/api/appointments/admin/auth/setup", adminAuthSetupGet);
app.post("/api/appointments/admin/auth/setup", adminAuthSetupPost);
app.post("/api/appointments/admin/auth/login", adminAuthLoginPost);
app.post("/api/appointments/admin/auth/logout", adminAuthLogoutPost);
// admin — bookings (protected)
app.get(
  "/api/appointments/admin/bookings/summary",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingSummaryGet,
);
app.get(
  "/api/appointments/admin/bookings/upcoming",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingUpcomingGet,
);
app.get(
  "/api/appointments/admin/bookings/:id/mark-as-paid",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingMarkAsPaidPatch,
);
app.patch(
  "/api/appointments/admin/bookings/:id/mark-as-paid",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingMarkAsPaidPatch,
);
app.get(
  "/api/appointments/admin/bookings/:id",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingGet,
);
app.patch(
  "/api/appointments/admin/bookings/:id",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingPatch,
);
app.delete(
  "/api/appointments/admin/bookings/:id",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingDelete,
);
app.get(
  "/api/appointments/admin/bookings",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingsGet,
);
app.post(
  "/api/appointments/admin/bookings",
  requireAdmin,
  requireFeature("admin.bookings"),
  adminBookingPost,
);
// admin — services (type-specific creation — must come before :id)
app.post(
  "/api/appointments/admin/services/appointment",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceAppointmentPost,
);
app.post(
  "/api/appointments/admin/services/one-time-event",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceOneTimeEventPost,
);
app.post(
  "/api/appointments/admin/services/recurring-event",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceRecurringEventPost,
);
// admin — services
app.get(
  "/api/appointments/admin/services/:id/available-slots-by-date-range",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceAvailableDatesGet,
);
app.get(
  "/api/appointments/admin/services/:id/availability-times",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceAvailabilityTimesGet,
);
app.get(
  "/api/appointments/admin/services/:id/bookings-count",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceBookingsCountGet,
);
app.get(
  "/api/appointments/admin/services/:id",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceGet,
);
app.patch(
  "/api/appointments/admin/services/:id",
  requireAdmin,
  requireFeature("admin.services"),
  adminServicePatch,
);
app.delete(
  "/api/appointments/admin/services/:id",
  requireAdmin,
  requireFeature("admin.services"),
  adminServiceDelete,
);
app.get(
  "/api/appointments/admin/services",
  requireAdmin,
  requireFeature("admin.services"),
  adminServicesGet,
);
app.post(
  "/api/appointments/admin/services",
  requireAdmin,
  requireFeature("admin.services"),
  adminServicePost,
);
// admin — clients
app.get(
  "/api/appointments/admin/clients/:id/bookings",
  requireAdmin,
  requireFeature("admin.clients"),
  adminClientBookingsGet,
);
app.get(
  "/api/appointments/admin/clients/:id",
  requireAdmin,
  requireFeature("admin.clients"),
  adminClientGet,
);
app.patch(
  "/api/appointments/admin/clients/:id",
  requireAdmin,
  requireFeature("admin.clients"),
  adminClientPatch,
);
app.delete(
  "/api/appointments/admin/clients/:id",
  requireAdmin,
  requireFeature("admin.clients"),
  adminClientDelete,
);
app.get(
  "/api/appointments/admin/clients",
  requireAdmin,
  requireFeature("admin.clients"),
  adminClientsGet,
);
app.post(
  "/api/appointments/admin/clients",
  requireAdmin,
  requireFeature("admin.clients"),
  adminClientPost,
);
// admin — business settings
app.get("/api/appointments/admin/business-settings", requireAdmin, adminBusinessSettingsGet);
app.post(
  "/api/appointments/admin/business-settings/batch-upsert",
  requireAdmin,
  adminBusinessSettingsBatchUpsertPost,
);
// admin — availability (business hours)
app.get(
  "/api/appointments/admin/availability",
  requireAdmin,
  requireFeature("admin.availability"),
  adminAvailabilityGet,
);
app.put(
  "/api/appointments/admin/availability",
  requireAdmin,
  requireFeature("admin.availability"),
  adminAvailabilityPut,
);
// admin — staff
app.get(
  "/api/appointments/admin/staff/:id",
  requireAdmin,
  requireFeature("admin.staff"),
  adminStaffGet,
);
app.patch(
  "/api/appointments/admin/staff/:id",
  requireAdmin,
  requireFeature("admin.staff"),
  adminStaffPatch,
);
app.delete(
  "/api/appointments/admin/staff/:id",
  requireAdmin,
  requireFeature("admin.staff"),
  adminStaffDelete,
);
app.get(
  "/api/appointments/admin/staff",
  requireAdmin,
  requireFeature("admin.staff"),
  adminStaffListGet,
);
app.post(
  "/api/appointments/admin/staff",
  requireAdmin,
  requireFeature("admin.staff"),
  adminStaffPost,
);
// admin — categories
app.get(
  "/api/appointments/admin/categories",
  requireAdmin,
  requireFeature("admin.categories"),
  adminCategoriesGet,
);
// customer — lookup & my-bookings
app.get(
  "/api/appointments/customer/lookup",
  requireAuth,
  requireRole("customer"),
  customerLookupGet,
);
app.get(
  "/api/appointments/customer/my-bookings/:id",
  requireAuth,
  requireRole("customer"),
  requireFeature("customer.my_bookings"),
  customerMyBookingGet,
);
app.get(
  "/api/appointments/customer/my-bookings",
  requireAuth,
  requireRole("customer"),
  requireFeature("customer.my_bookings"),
  customerMyBookingsGet,
);
// payments
app.post(
  "/api/appointments/payments/create-checkout-session",
  requirePaymentProvider("stripe"),
  paymentsCheckoutPost,
);
// admin — payments
app.get(
  "/api/appointments/admin/payments/transactions",
  requireAdmin,
  requireFeature("admin.payments"),
  adminPaymentsTransactionsGet,
);
// admin — payment providers
app.get("/api/appointments/admin/payment-providers", requireAdmin, adminPaymentProvidersGet);
app.post("/api/appointments/admin/payment-providers", requireAdmin, adminPaymentProvidersPost);
app.patch("/api/appointments/admin/payment-providers/:id", requireAdmin, adminPaymentProviderPatch);
app.delete("/api/appointments/admin/payment-providers/:id", requireAdmin, adminPaymentProviderDelete);
// </api-registrations>

// ── Feature flag startup summary ───────────────────────────────────────────
{
  const on = ALL_FEATURES.filter((f) => f.enabled);
  const off = ALL_FEATURES.filter((f) => !f.enabled);
  const maxLen = Math.max(...ALL_FEATURES.map((f) => f.key.length));
  const lines = ALL_FEATURES.map((f) => {
    // dots - 1 = nesting depth below the top-level feature
    // "admin.bookings" → 0 extra levels, "admin.settings.tz" → 1 extra, etc.
    const depth = (f.key.match(/\./g) ?? []).length - 1;
    const indent = "  ".repeat(depth + 1);
    const padded = f.key.padEnd(maxLen, " ");
    return `${indent}${f.enabled ? "[ON] " : "[OFF]"} ${padded}`;
  });
  console.warn(`\nFeature flags (${on.length} on, ${off.length} off):\n${lines.join("\n")}\n`);
}

// Error middleware must be registered AFTER the routes it protects; Express
// only passes errors to middleware defined later in the stack.
app.use("/api", (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  // Always respond JSON on /api so clients parsing response.json() don't
  // receive Express's default HTML error page for non-Error throws.
  console.error("ssr.api.error", {
    url: req.url,
    error: err instanceof Error ? err.stack : String(err),
  });
  res.status(500).json({ error: "Internal server error" });
});

function baseUrl(req: Request): string {
  return `${req.protocol}://${req.hostname}`;
}

const XML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPE[c] ?? c);
}

app.get("/robots.txt", (req, res) => {
  if (isSystemHost(req)) {
    res
      .type("text/plain")
      .set("Cache-Control", "public, max-age=60, must-revalidate")
      .set("Vary", "Host")
      .send("User-agent: *\nDisallow: /\n");
    return;
  }
  const base = baseUrl(req);
  const body = ["User-agent: *", "Allow: /", "", `Sitemap: ${base}/sitemap.xml`, ""].join("\n");
  res
    .type("text/plain")
    .set("Cache-Control", "public, max-age=60, must-revalidate")
    .set("Vary", "Host")
    .send(body);
});

app.get("/sitemap.xml", (req, res) => {
  if (isSystemHost(req)) {
    const empty = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>\n`;
    res
      .type("application/xml")
      .set("Cache-Control", "public, max-age=60, must-revalidate")
      .set("Vary", "Host")
      .send(empty);
    return;
  }
  const base = baseUrl(req);
  const urls = seoRoutes
    .filter((r) => typeof r.path === "string" && r.path.startsWith("/"))
    .map((r) => {
      const loc = `${base}${r.path}`;
      const parts = [`    <loc>${escapeXml(loc)}</loc>`];
      if (r.lastmod) parts.push(`    <lastmod>${escapeXml(r.lastmod)}</lastmod>`);
      if (r.changefreq) parts.push(`    <changefreq>${r.changefreq}</changefreq>`);
      if (r.priority !== undefined) parts.push(`    <priority>${r.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join("\n")}\n  </url>`;
    })
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  res
    .type("application/xml")
    .set("Cache-Control", "public, max-age=60, must-revalidate")
    .set("Vary", "Host")
    .send(body);
});

if (import.meta.env.PROD) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const clientDir = join(__dirname, "client");

  app.use(
    express.static(clientDir, {
      index: false,
      setHeaders(res, filePath) {
        res.set(
          "Cache-Control",
          filePath.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    }),
  );

  app.use((_req, res, next) => {
    res.set("Cache-Control", "no-cache");
    next();
  });

  let template: string;
  try {
    template = readFileSync(join(clientDir, "index.html"), "utf-8");
  } catch (err) {
    console.error("ssr.template.load-failed", {
      path: join(clientDir, "index.html"),
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
  if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) {
    // Fail fast at boot, same as a template load failure above: without
    // markers, every .replace() call on the render path is a no-op and we
    // would serve a shell with no <head> content and no rendered body on
    // every request. Preferring process.exit over a degraded mode ensures
    // an operator notices and fixes the build rather than serving broken
    // SEO-invisible pages indefinitely.
    console.error("ssr.template.markers-missing", {
      hasHead: template.includes("<!--app-head-->"),
      hasHtml: template.includes("<!--app-html-->"),
    });
    process.exit(1);
  }
  const fallbackShell = template.replace("<!--app-head-->", "").replace("<!--app-html-->", "");

  // Resolve the SSR module once into a stable render function. A failed
  // load is unrecoverable at runtime - exiting lets the container
  // scheduler restart with a clean slate rather than leaving the server
  // to serve silent 503s indefinitely against a single startup log.
  type RenderResult = {
    html: string;
    head: string;
    status: number;
    redirect?: string;
  };
  let renderFn: ((url: string) => Promise<RenderResult>) | null = null;
  const SSR_MODULE_LOAD_TIMEOUT_MS = 30_000;
  const loadTimeout = setTimeout(() => {
    if (renderFn !== null) return;
    console.error("ssr.module.load-timeout", {
      timeoutMs: SSR_MODULE_LOAD_TIMEOUT_MS,
    });
    process.exit(1);
  }, SSR_MODULE_LOAD_TIMEOUT_MS);
  loadTimeout.unref();
  import("../entry-server").then(
    (mod) => {
      clearTimeout(loadTimeout);
      renderFn = mod.render;
    },
    (err) => {
      clearTimeout(loadTimeout);
      console.error("ssr.module.load-failed", {
        error: err instanceof Error ? err.stack : String(err),
      });
      process.exit(1);
    },
  );

  app.get(/.*/, async (req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    if (extname(req.path)) return next();
    const sendFallback = () =>
      res
        .status(503)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "no-store")
        .send(fallbackShell);
    if (renderFn === null) {
      // Module not yet resolved; fall back without logging to avoid startup
      // noise before the first render is even possible. A terminal load
      // failure (import reject or 30s timeout) process.exit(1)s from the
      // loader above, so this branch is only the brief warmup window.
      return sendFallback();
    }
    try {
      const result = await renderFn(req.url);
      if (result.redirect) {
        // Redirect thrown from a loader/action surfaces as a Response.
        // Forward it so the browser actually navigates to the new URL
        // instead of seeing an empty shell with a stale status.
        res.redirect(result.status, result.redirect);
        return;
      }
      if (!result.html) {
        // A non-redirect Response was thrown from a loader (e.g.
        // `throw new Response(null, { status: 404 })`). renderToString
        // produced no markup, so we have a real status but no body.
        // Log so the case is observable in ops dashboards, and mark
        // no-store so CDNs don't cache an empty page as a valid hit.
        // User-visible 404 / error pages should come from a route
        // errorElement, not from this fallback path.
        console.error("ssr.render.error-response", {
          url: req.url,
          status: result.status,
        });
        res
          .status(result.status)
          .set("Content-Type", "text/html; charset=utf-8")
          .set("Cache-Control", "no-store")
          .send(fallbackShell);
        return;
      }
      // Per-host SEO injection. System URLs get a noindex meta so
      // crawlers drop them from the index over time; customer-attached
      // hosts get a self-canonical link so search engines treat them
      // as authoritative for the rendered content.
      const seoHead = isSystemHost(req)
        ? `<meta name="robots" content="noindex,nofollow">`
        : `<link rel="canonical" href="${escapeXml(`${req.protocol}://${req.hostname}${req.path}`)}">`;
      // Function replacements disable String.replace's $-special sequences
      // ($&, $', $`, $$) so user-authored titles / JSON-LD like
      // "Save $& today" insert literally instead of being interpolated.
      const out = template
        .replace("<!--app-head-->", () => seoHead + result.head)
        .replace("<!--app-html-->", () => result.html);
      res
        .status(result.status)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "no-cache")
        .send(out);
    } catch (err) {
      // 503 surfaces the failure in CDN/monitoring without caching a broken
      // page as success. console.error (not warn) puts it at the right log
      // level for the observability pipeline to alert on.
      console.error("ssr.render.failed", {
        url: req.url,
        // Log the full stack — React's renderToString annotates it with
        // the failing component's call tree, which the message alone
        // discards.
        error: err instanceof Error ? err.stack : String(err),
      });
      sendFallback();
    }
  });

  const shutdown = async (signal: string) => {
    console.warn(`Got ${signal}, shutting down gracefully...`);
    // Scope the ERR_MODULE_NOT_FOUND suppression to the import() only.
    // A closeConnection() failure that happens to carry the same code
    // (unlikely but possible for wrapped errors) must not be silently
    // swallowed - it indicates a real db-close failure worth logging.
    let mod: { closeConnection?: () => Promise<void> | void } | null = null;
    try {
      const dbClient = "./db/client" + ".js";
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, no-unsanitized/method
      mod = await import(/* @vite-ignore */ dbClient);
    } catch (error: unknown) {
      const code = (error as { code?: string } | null)?.code;
      if (code !== "ERR_MODULE_NOT_FOUND") {
        console.error("ssr.shutdown.db-import-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (mod && typeof mod.closeConnection === "function") {
      try {
        await mod.closeConnection();
        console.warn("Database connections closed");
      } catch (error: unknown) {
        console.error("ssr.shutdown.db-close-failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    process.exit(0);
  };

  (["SIGTERM", "SIGINT"] as const).forEach((signal) => {
    process.once(signal, () => {
      void shutdown(signal);
    });
  });

  const rawPort = process.env.PORT ?? "3000";
  const port = parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    // parseInt("abc") returns NaN; passing that to app.listen throws
    // synchronously before the server.on("error") handler below can catch
    // it. Fail fast with an actionable log rather than a cryptic crash.
    console.error("ssr.server.invalid-port", { rawPort });
    process.exit(1);
  }
  const host = process.env.HOST ?? "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.warn(`Server listening on http://${host}:${port}`);
    startReminderScheduler();
  });
  server.on("error", (err: Error & { code?: string }) => {
    console.error("ssr.server.listen-failed", {
      port,
      host,
      code: err.code,
      error: err.message,
    });
    process.exit(1);
  });
}

export default app;
