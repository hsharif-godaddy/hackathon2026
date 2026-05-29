src/server/entry.ts [308 lines]
     1|import express, { type NextFunction, type Request, type Response } from "express";
     2|import { fileURLToPath } from "node:url";
     3|import { dirname, extname, join } from "node:path";
     4|import { readFileSync } from "node:fs";
     5|
     6|// <api-imports>
     7|import healthGet from "./api/health/GET";
     8|// </api-imports>
     9|import { seoRoutes } from "../lib/seo-routes";
    10|
    11|function normalizeCommerceApiBaseUrlEnv() {
    12|	if (process.env.GODADDY_API_BASE_URL) return;
    13|	const hostOnly = process.env.VITE_GODADDY_API_HOST;
    14|	if (!hostOnly) return;
    15|	const normalizedHost = hostOnly.replace(/^https?:\/\//, "").trim();
    16|	if (!normalizedHost) return;
    17|	process.env.GODADDY_API_BASE_URL = `https://${normalizedHost}`;
    18|}
    19|
    20|normalizeCommerceApiBaseUrlEnv();
    21|
    22|const app = express();
    23|
    24|// Honour x-forwarded-* from the load balancer so req.protocol/req.hostname
    25|// reflect the public-facing values. Express-maintained parsing respects the
    26|// existing trust-proxy config; direct header reads would let a client spoof
    27|// the sitemap origin in robots.txt.
    28|app.set("trust proxy", true);
    29|
    30|app.use(express.json());
    31|app.use(express.urlencoded({ extended: true }));
    32|
    33|// <api-registrations>
    34|app.get("/api/health", healthGet);
    35|// </api-registrations>
    36|
    37|// Error middleware must be registered AFTER the routes it protects; Express
    38|// only passes errors to middleware defined later in the stack.
    39|app.use("/api", (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    40|	// Always respond JSON on /api so clients parsing response.json() don't
    41|	// receive Express's default HTML error page for non-Error throws.
    42|	console.error("ssr.api.error", {
    43|		url: req.url,
    44|		error: err instanceof Error ? err.stack : String(err),
    45|	});
    46|	res.status(500).json({ error: "Internal server error" });
    47|});
    48|
    49|function baseUrl(req: Request): string {
    50|	const env = process.env.PUBLIC_URL || process.env.SITE_URL;
    51|	if (env) return env.replace(/\/+$/, "");
    52|	return `${req.protocol}://${req.hostname}`;
    53|}
    54|
    55|function escapeXml(s: string): string {
    56|	return s.replace(/[&<>"']/g, (c) =>
    57|		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
    58|	);
    59|}
    60|
    61|app.get("/robots.txt", (req, res) => {
    62|	const base = baseUrl(req);
    63|	const body = [
    64|		"User-agent: *",
    65|		"Allow: /",
    66|		"",
    67|		`Sitemap: ${base}/sitemap.xml`,
    68|		"",
    69|	].join("\n");
    70|	res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(body);
    71|});
    72|
    73|app.get("/sitemap.xml", (req, res) => {
    74|	const base = baseUrl(req);
    75|	const urls = seoRoutes
    76|		.filter((r) => typeof r.path === "string" && r.path.startsWith("/"))
    77|		.map((r) => {
    78|			const loc = `${base}${r.path}`;
    79|			const parts = [`    <loc>${escapeXml(loc)}</loc>`];
    80|			if (r.lastmod) parts.push(`    <lastmod>${escapeXml(r.lastmod)}</lastmod>`);
    81|			if (r.changefreq) parts.push(`    <changefreq>${r.changefreq}</changefreq>`);
    82|			if (r.priority !== undefined)
    83|				parts.push(`    <priority>${r.priority.toFixed(1)}</priority>`);
    84|			return `  <url>\n${parts.join("\n")}\n  </url>`;
    85|		})
    86|		.join("\n");
    87|	const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
    88|	res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(body);
    89|});
    90|
    91|if (import.meta.env.PROD) {
    92|	const __dirname = dirname(fileURLToPath(import.meta.url));
    93|	const clientDir = join(__dirname, "client");
    94|
    95|	app.use(
    96|		express.static(clientDir, {
    97|			index: false,
    98|			setHeaders(res, filePath) {
    99|				res.set(
   100|					"Cache-Control",
   101|					filePath.includes("/assets/")
   102|						? "public, max-age=31536000, immutable"
   103|						: "no-cache",
   104|				);
   105|			},
   106|		}),
   107|	);
   108|
   109|	app.use((_req, res, next) => {
   110|		res.set("Cache-Control", "no-cache");
   111|		next();
   112|	});
   113|
   114|	let template: string;
   115|	try {
   116|		template = readFileSync(join(clientDir, "index.html"), "utf-8");
   117|	} catch (err) {
   118|		console.error("ssr.template.load-failed", {
   119|			path: join(clientDir, "index.html"),
   120|			error: err instanceof Error ? err.message : String(err),
   121|		});
   122|		process.exit(1);
   123|	}
   124|	if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) {
   125|		// Fail fast at boot, same as a template load failure above: without
   126|		// markers, every .replace() call on the render path is a no-op and we
   127|		// would serve a shell with no <head> content and no rendered body on
   128|		// every request. Preferring process.exit over a degraded mode ensures
   129|		// an operator notices and fixes the build rather than serving broken
   130|		// SEO-invisible pages indefinitely.
   131|		console.error("ssr.template.markers-missing", {
   132|			hasHead: template.includes("<!--app-head-->"),
   133|			hasHtml: template.includes("<!--app-html-->"),
   134|		});
   135|		process.exit(1);
   136|	}
   137|	const fallbackShell = template
   138|		.replace("<!--app-head-->", "")
   139|		.replace("<!--app-html-->", "");
   140|
   141|	// Resolve the SSR module once into a stable render function. A failed
   142|	// load is unrecoverable at runtime - exiting lets the container
   143|	// scheduler restart with a clean slate rather than leaving the server
   144|	// to serve silent 503s indefinitely against a single startup log.
   145|	type RenderResult = {
   146|		html: string;
   147|		head: string;
   148|		status: number;
   149|		redirect?: string;
   150|	};
   151|	let renderFn: ((url: string) => Promise<RenderResult>) | null = null;
   152|	const SSR_MODULE_LOAD_TIMEOUT_MS = 30_000;
   153|	const loadTimeout = setTimeout(() => {
   154|		if (renderFn !== null) return;
   155|		console.error("ssr.module.load-timeout", {
   156|			timeoutMs: SSR_MODULE_LOAD_TIMEOUT_MS,
   157|		});
   158|		process.exit(1);
   159|	}, SSR_MODULE_LOAD_TIMEOUT_MS);
   160|	loadTimeout.unref();
   161|	import("../entry-server").then(
   162|		(mod) => {
   163|			clearTimeout(loadTimeout);
   164|			renderFn = mod.render;
   165|		},
   166|		(err) => {
   167|			clearTimeout(loadTimeout);
   168|			console.error("ssr.module.load-failed", {
   169|				error: err instanceof Error ? err.stack : String(err),
   170|			});
   171|			process.exit(1);
   172|		},
   173|	);
   174|
   175|	app.get(/.*/, async (req, res, next) => {
   176|		if (req.method !== "GET") return next();
   177|		if (req.path.startsWith("/api")) return next();
   178|		if (extname(req.path)) return next();
   179|		const sendFallback = () =>
   180|			res
   181|				.status(503)
   182|				.set("Content-Type", "text/html; charset=utf-8")
   183|				.set("Cache-Control", "no-store")
   184|				.send(fallbackShell);
   185|		if (renderFn === null) {
   186|			// Module not yet resolved; fall back without logging to avoid startup
   187|			// noise before the first render is even possible. A terminal load
   188|			// failure (import reject or 30s timeout) process.exit(1)s from the
   189|			// loader above, so this branch is only the brief warmup window.
   190|			return sendFallback();
   191|		}
   192|		try {
   193|			const result = await renderFn(req.url);
   194|			if (result.redirect) {
   195|				// Redirect thrown from a loader/action surfaces as a Response.
   196|				// Forward it so the browser actually navigates to the new URL
   197|				// instead of seeing an empty shell with a stale status.
   198|				res.redirect(result.status, result.redirect);
   199|				return;
   200|			}
   201|			if (!result.html) {
   202|				// A non-redirect Response was thrown from a loader (e.g.
   203|				// `throw new Response(null, { status: 404 })`). renderToString
   204|				// produced no markup, so we have a real status but no body.
   205|				// Log so the case is observable in ops dashboards, and mark
   206|				// no-store so CDNs don't cache an empty page as a valid hit.
   207|				// User-visible 404 / error pages should come from a route
   208|				// errorElement, not from this fallback path.
   209|				console.error("ssr.render.error-response", {
   210|					url: req.url,
   211|					status: result.status,
   212|				});
   213|				res
   214|					.status(result.status)
   215|					.set("Content-Type", "text/html; charset=utf-8")
   216|					.set("Cache-Control", "no-store")
   217|					.send(fallbackShell);
   218|				return;
   219|			}
   220|			// Function replacements disable String.replace's $-special sequences
   221|			// ($&, $', $`, $$) so user-authored titles / JSON-LD like
   222|			// "Save $& today" insert literally instead of being interpolated.
   223|			const out = template
   224|				.replace("<!--app-head-->", () => result.head)
   225|				.replace("<!--app-html-->", () => result.html);
   226|			res
   227|				.status(result.status)
   228|				.set("Content-Type", "text/html; charset=utf-8")
   229|				.set("Cache-Control", "no-cache")
   230|				.send(out);
   231|		} catch (err) {
   232|			// 503 surfaces the failure in CDN/monitoring without caching a broken
   233|			// page as success. console.error (not warn) puts it at the right log
   234|			// level for the observability pipeline to alert on.
   235|			console.error("ssr.render.failed", {
   236|				url: req.url,
   237|				// Log the full stack — React's renderToString annotates it with
   238|				// the failing component's call tree, which the message alone
   239|				// discards.
   240|				error: err instanceof Error ? err.stack : String(err),
   241|			});
   242|			sendFallback();
   243|		}
   244|	});
   245|
   246|	const shutdown = async (signal: string) => {
   247|		console.log(`Got ${signal}, shutting down gracefully...`);
   248|		// Scope the ERR_MODULE_NOT_FOUND suppression to the import() only.
   249|		// A closeConnection() failure that happens to carry the same code
   250|		// (unlikely but possible for wrapped errors) must not be silently
   251|		// swallowed - it indicates a real db-close failure worth logging.
   252|		let mod: { closeConnection?: () => Promise<void> | void } | null = null;
   253|		try {
   254|			const dbClient = "./db/client" + ".js";
   255|			mod = await import(/* @vite-ignore */ dbClient);
   256|		} catch (error: unknown) {
   257|			const code = (error as { code?: string } | null)?.code;
   258|			if (code !== "ERR_MODULE_NOT_FOUND") {
   259|				console.error("ssr.shutdown.db-import-failed", {
   260|					error: error instanceof Error ? error.message : String(error),
   261|				});
   262|			}
   263|		}
   264|		if (mod && typeof mod.closeConnection === "function") {
   265|			try {
   266|				await mod.closeConnection();
   267|				console.log("Database connections closed");
   268|			} catch (error: unknown) {
   269|				console.error("ssr.shutdown.db-close-failed", {
   270|					error: error instanceof Error ? error.message : String(error),
   271|				});
   272|			}
   273|		}
   274|		process.exit(0);
   275|	};
   276|
   277|	(["SIGTERM", "SIGINT"] as const).forEach((signal) => {
   278|		process.once(signal, () => {
   279|			void shutdown(signal);
   280|		});
   281|	});
   282|
   283|	const rawPort = process.env.PORT || "3000";
   284|	const port = parseInt(rawPort, 10);
   285|	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
   286|		// parseInt("abc") returns NaN; passing that to app.listen throws
   287|		// synchronously before the server.on("error") handler below can catch
   288|		// it. Fail fast with an actionable log rather than a cryptic crash.
   289|		console.error("ssr.server.invalid-port", { rawPort });
   290|		process.exit(1);
   291|	}
   292|	const host = process.env.HOST || "0.0.0.0";
   293|	const server = app.listen(port, host, () => {
   294|		console.log(`Server listening on http://${host}:${port}`);
   295|	});
   296|	server.on("error", (err: NodeJS.ErrnoException) => {
   297|		console.error("ssr.server.listen-failed", {
   298|			port,
   299|			host,
   300|			code: err.code,
   301|			error: err.message,
   302|		});
   303|		process.exit(1);
   304|	});
   305|}
   306|
   307|export default app;
   308|