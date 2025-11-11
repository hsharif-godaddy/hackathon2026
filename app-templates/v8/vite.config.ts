import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
import sourceMapperPlugin from "./source-mapper/src/index";
import { devToolsPlugin } from "./dev-tools/src/vite-plugin";
import { fullStoryPlugin } from "./fullstory-plugin";
import { errorInterceptorPlugin } from "./dev-tools/src/vite-error-interceptor";
import apiRoutes from "vite-plugin-api-routes";

let allowedHosts: string[] = [];
if (process.env.FRONTEND_DOMAIN) {
	allowedHosts.push(process.env.FRONTEND_DOMAIN, `http://${process.env.FRONTEND_DOMAIN}`, `https://${process.env.FRONTEND_DOMAIN}`);
}
if (process.env.ALLOWED_ORIGINS) {
	allowedHosts.push(...process.env.ALLOWED_ORIGINS.split(','));
}
if (process.env.VITE_PARENT_ORIGIN) {
	allowedHosts.push(process.env.VITE_PARENT_ORIGIN);
}
if (allowedHosts.length === 0) {
	allowedHosts.push('*');
}

export default defineConfig(({ mode }) => ({
	plugins: [
		react({
			babel: {
				plugins: [sourceMapperPlugin],
			},
		}),
		apiRoutes({
			mode: 'isolated',
      configure: 'src/server/configure.js',
			dirs: [{ dir: './src/server/api', route: '' }],
		}),
		...(mode === "development" ? [
			devToolsPlugin() as Plugin,
			fullStoryPlugin(),
			errorInterceptorPlugin()
		] : []),
	],

	resolve: {
		alias: {
			nothing: "/src/fallbacks/missingModule.ts",
			"@/": path.resolve(__dirname, "./src/"),
			"@/components": path.resolve(__dirname, "./src/components"),
			"@/lib": path.resolve(__dirname, "./src/lib"),
			"@/api": path.resolve(__dirname, "./src/server/api"),
      "@/db": path.resolve(__dirname, "./src/server/db"),
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
		strictPort: !!process.env.PORT,
		allowedHosts,
		https: (() => {
			const certPath = path.resolve(__dirname, ".ssl/cert.pem");
			const keyPath = path.resolve(__dirname, ".ssl/key.pem");

			if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
				try {
					return {
						cert: fs.readFileSync(certPath),
						key: fs.readFileSync(keyPath)
					};
				} catch (error) {
					console.warn('Failed to read SSL certificates, falling back to HTTP:', error);
					return undefined;
				}
			}

			return undefined;
		})(),
		cors: {
			origin: allowedHosts,
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'User-Agent']
		},
		hmr: {
			overlay: false
		}
	},

	build: {
		rollupOptions: {
			// No external dependencies - bundle everything
		}
	},
}));
