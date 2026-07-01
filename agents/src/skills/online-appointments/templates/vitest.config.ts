import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    pool: "forks",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    maxConcurrency: 5,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "src/test/",
        "*.config.js",
        "*.config.ts",
        "src/server/entry.ts",
        "src/server/db/client.ts",
      ],
    },
  },
  resolve: {
    alias: {
      "virtual:format-overrides": path.resolve(__dirname, "./src/test/format-overrides-module.ts"),
      "drizzle-orm/mysql-core": path.resolve(
        __dirname,
        "./src/test/stubs/drizzle-orm-mysql-core.ts",
      ),
      "drizzle-orm": path.resolve(__dirname, "./src/test/stubs/drizzle-orm.ts"),
      "@date-fns/tz": path.resolve(__dirname, "./src/test/stubs/date-fns-tz.ts"),
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
});
