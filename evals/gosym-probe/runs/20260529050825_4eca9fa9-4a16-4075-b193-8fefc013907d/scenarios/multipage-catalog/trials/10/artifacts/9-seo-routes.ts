src/lib/seo-routes.ts [32 lines]
     1|/**
     2| * Agent-editable registry of publicly-crawlable routes. Consumed by the
     3| * /sitemap.xml handler in src/server/entry.ts.
     4| *
     5| * Guidelines for maintaining this file:
     6| * - Add a new entry whenever you add a new publicly-crawlable page.
     7| * - Do not include dynamic-param routes like "/products/:id" directly.
     8| *   Instead, enumerate real values (e.g. "/products/desk-pro") or skip.
     9| * - `path` MUST start with "/".
    10| * - Priorities are between 0.0 and 1.0. Home = 1.0, main sections = 0.8,
    11| *   deep pages = 0.5.
    12| * - Dev-only or auth-required routes MUST NOT be listed.
    13| */
    14|
    15|export interface SeoRoute {
    16|	path: string;
    17|	changefreq?:
    18|		| "always"
    19|		| "hourly"
    20|		| "daily"
    21|		| "weekly"
    22|		| "monthly"
    23|		| "yearly"
    24|		| "never";
    25|	priority?: number;
    26|	lastmod?: string;
    27|}
    28|
    29|export const seoRoutes: SeoRoute[] = [
    30|	{ path: "/", changefreq: "weekly", priority: 1.0 },
    31|];
    32|