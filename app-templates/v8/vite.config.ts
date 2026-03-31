import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import * as esbuild from "esbuild";
import sourceMapperPlugin from "./source-mapper/src/index";
import { devToolsPlugin } from "./dev-tools/src/vite-plugin";
import { fullStoryPlugin } from "./fullstory-plugin";
import { errorInterceptorPlugin } from "./dev-tools/src/vite-error-interceptor";
import apiRoutes from "vite-plugin-api-routes";

function extractHostname(value: string): string {
	try {
		if (value.includes("://")) {
			return new URL(value).host;
		}
		return value;
	} catch {
		return value;
	}
}

function serverBundlePlugin(): Plugin {
	let built = false;
	return {
		name: "server-bundle",
		apply: "build",
		closeBundle: async () => {
			if (built) return;
			built = true;
			console.log("Bundling server code with esbuild...");
			await esbuild.build({
				entryPoints: [path.resolve(__dirname, "dist", "app.js")],
				bundle: true,
				platform: "node",
				target: "node22",
				format: "esm",
				outfile: path.resolve(__dirname, "dist", "server.bundle.mjs"),
				packages: "bundle",
				sourcemap: true,
				banner: {
					js: `import { createRequire } from 'module';
const require = createRequire(import.meta.url);`,
				},
			});
			console.log("Server bundle created at dist/server.bundle.mjs");
		},
	};
}

const allowedHosts: string[] = [];
const corsOrigins: string[] = [];

if (process.env.FRONTEND_DOMAIN) {
	const frontendHost = extractHostname(process.env.FRONTEND_DOMAIN);
	allowedHosts.push(frontendHost);
	corsOrigins.push(`http://${frontendHost}`, `https://${frontendHost}`);
}
if (process.env.ALLOWED_ORIGINS) {
	const origins = process.env.ALLOWED_ORIGINS.split(",");
	allowedHosts.push(...origins.map(extractHostname));
	corsOrigins.push(...origins);
}
if (process.env.VITE_PARENT_ORIGIN) {
	allowedHosts.push(extractHostname(process.env.VITE_PARENT_ORIGIN));
	corsOrigins.push(process.env.VITE_PARENT_ORIGIN);
}
if (allowedHosts.length === 0) {
	allowedHosts.push("*");
}
if (corsOrigins.length === 0) {
	corsOrigins.push("*");
}

export default defineConfig(({ mode }) => ({
	plugins: [
		react({
			babel: {
				plugins: [sourceMapperPlugin],
			},
		}),
		apiRoutes({
			mode: "isolated",
			configure: "src/server/configure.js",
			dirs: [{ dir: "./src/server/api", route: "" }],
			forceRestart: mode === "development",
		}),
		...(mode === "development"
			? [devToolsPlugin() as Plugin, fullStoryPlugin(), errorInterceptorPlugin()]
			: []),
		serverBundlePlugin(),
	],

	resolve: {
		dedupe: ["react", "react-dom"],
		alias: {
			nothing: "/src/fallbacks/missingModule.ts",
			"@/api": path.resolve(__dirname, "./src/server/api"),
			"@": path.resolve(__dirname, "./src"),
		},
	},

	server: {
		host: process.env.HOST || "0.0.0.0",
		port: parseInt(process.env.PORT || "5173"),
		strictPort: !!process.env.PORT,
		allowedHosts,
		cors: {
			origin: corsOrigins,
			credentials: true,
			methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization", "Accept", "User-Agent"],
		},
		hmr: {
			overlay: false,
		},
		watch: {
			ignored: ["**/dist/**", "**/.api/**"],
		},
	},

	preview: {
		host: process.env.HOST || "0.0.0.0",
		port: parseInt(process.env.PORT || "5173"),
		strictPort: !!process.env.PORT,
		allowedHosts,
		cors: {
			origin: corsOrigins,
			credentials: true,
			methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization", "Accept", "User-Agent"],
		},
	},

	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					"react-vendor": ["react", "react-dom"],
					"radix-ui": [
						"@radix-ui/react-accordion",
						"@radix-ui/react-alert-dialog",
						"@radix-ui/react-aspect-ratio",
						"@radix-ui/react-avatar",
						"@radix-ui/react-checkbox",
						"@radix-ui/react-collapsible",
						"@radix-ui/react-context-menu",
						"@radix-ui/react-dialog",
						"@radix-ui/react-dropdown-menu",
						"@radix-ui/react-hover-card",
						"@radix-ui/react-label",
						"@radix-ui/react-menubar",
						"@radix-ui/react-navigation-menu",
						"@radix-ui/react-popover",
						"@radix-ui/react-progress",
						"@radix-ui/react-scroll-area",
						"@radix-ui/react-select",
						"@radix-ui/react-separator",
						"@radix-ui/react-slider",
						"@radix-ui/react-slot",
						"@radix-ui/react-switch",
						"@radix-ui/react-tabs",
						"@radix-ui/react-toast",
						"@radix-ui/react-toggle",
						"@radix-ui/react-toggle-group",
						"@radix-ui/react-tooltip",
					],
					query: ["@tanstack/react-query"],
				},
			},
		},
	},
}));
