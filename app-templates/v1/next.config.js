// Import environment validation
import("./src/lib/env.js").catch(() => {
	// Handle env validation in development
});

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	experimental: {
		// Enable Turbopack for faster development
		turbo: {
			resolveAlias: {
				"@": "./src",
			},
		},
		// Enable partial pre-rendering
		ppr: false, // Set to true when ready for production
		// Optimize bundling
		optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
		// SWC plugins for development context
		swcPlugins: [
			[
				"./swc-plugins/swc_plugin_dev_context.wasm",
				{
					enabled: process.env.NODE_ENV === "development",
				},
			],
		],
	},
	// Enhance TypeScript support
	typescript: {
		ignoreBuildErrors: false,
	},
	// Enhanced ESLint
	eslint: {
		ignoreDuringBuilds: false,
	},
	// Optimize images
	images: {
		formats: ["image/webp", "image/avif"],
		deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
		imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
	},
	// Optimize fonts
	optimizeFonts: true,
	// Bundle analyzer (set to true to analyze)
	analyzeBundle: false,
	// Security headers
	async headers() {
		const headers = [
			{
				key: "X-Content-Type-Options",
				value: "nosniff",
			},
			{
				key: "Referrer-Policy",
				value: "origin-when-cross-origin",
			},
		];

		// Only add X-Frame-Options in production to allow iframe embedding in development
		if (process.env.NODE_ENV === "production") {
			headers.unshift({
				key: "X-Frame-Options",
				value: "DENY",
			});
		}

		return [
			{
				source: "/(.*)",
				headers,
			},
		];
	},
};

module.exports = nextConfig;
