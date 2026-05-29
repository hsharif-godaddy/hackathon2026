src/server/entry.ts [1-30 of 308] (truncated — use startLine/numLines to read remaining)
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