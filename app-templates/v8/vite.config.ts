import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import sourceMapperPlugin from "./source-mapper/src/index";
import { devToolsPlugin } from "./dev-tools/src/vite-plugin";
import { fullStoryPlugin } from "./fullstory-plugin";

let allowedHosts: string[] = [];
if (process.env.FRONTEND_DOMAIN) {
	allowedHosts.push(process.env.FRONTEND_DOMAIN, `http://${process.env.FRONTEND_DOMAIN}`, `https://${process.env.FRONTEND_DOMAIN}`);
}
if (process.env.ALLOWED_ORIGINS) {
	allowedHosts.push(...process.env.ALLOWED_ORIGINS.split(','));
}
if (allowedHosts.length === 0) {
	allowedHosts.push('*');
}

// Simple API plugin that serves our API routes
function apiPlugin(): Plugin {
	return {
		name: "simple-api",
		configureServer(server) {
			server.middlewares.use("/api", async (req, res, _next) => {
				try {
					const url = new URL(req.url!, "http://localhost");
					const pathname = url.pathname;

					// Handle health endpoint
					if (pathname === "/health") {
						const health = {
							status: "ok",
							timestamp: new Date().toISOString(),
							message: "V7 Template API is running!",
						};
						res.setHeader("Content-Type", "application/json");
						res.end(JSON.stringify(health));
						return;
					}

					// Not found
					res.statusCode = 404;
					res.end(JSON.stringify({ error: "API endpoint not found" }));
				} catch (error) {
					console.error("API Error:", error);
					res.statusCode = 500;
					res.end(JSON.stringify({ error: "Internal server error" }));
				}
			});
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [
		react({
			babel: {
				plugins: [sourceMapperPlugin],
			},
		}),
		apiPlugin(),
		...(mode === "development" ? [
			devToolsPlugin() as Plugin,
			fullStoryPlugin()
		] : []),
	],

	resolve: {
		alias: {
			"@/": path.resolve(__dirname, "./src/"),
			"@/components": path.resolve(__dirname, "./src/components"),
			"@/lib": path.resolve(__dirname, "./src/lib"),
			"@/api": path.resolve(__dirname, "./src/api"),
			"@/layouts": path.resolve(__dirname, "./src/layouts"),
			"@/patterns": path.resolve(__dirname, "./src/patterns"),
			"@/pages": path.resolve(__dirname, "./src/pages"),
			"@/hooks": path.resolve(__dirname, "./src/hooks"),
			"@/styles": path.resolve(__dirname, "./src/styles"),
		},
	},

	server: {
		host: "0.0.0.0",
		port: parseInt(process.env.PORT || "5173"),
		strictPort: !!process.env.PORT, // Prevent auto-port selection when PORT is explicitly set
		allowedHosts,
		cors: {
			origin: allowedHosts,
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'User-Agent']
		}
	},

	build: {
		// Manual chunks will be configured later if needed
	},
}));
