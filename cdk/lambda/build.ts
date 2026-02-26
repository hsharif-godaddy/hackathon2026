#!/usr/bin/env npx tsx
/**
 * Lambda build script - builds Lambda functions using esbuild
 *
 * Usage:
 *   npx tsx lambda/build.ts                    # Build all lambdas
 *   npx tsx lambda/build.ts qdrant-tls-bootstrap  # Build specific lambda
 *   npx tsx lambda/build.ts --all              # Build all lambdas (explicit)
 */

import * as esbuild from "esbuild";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

interface LambdaConfig {
  name: string;
  entry: string;
  external: string[];
  format: "esm" | "cjs";
  installDeps?: boolean;
}

const LAMBDAS: LambdaConfig[] = [
  {
    name: "qdrant-tls-bootstrap",
    entry: "index.ts",
    external: ["@aws-sdk/*"], // Only AWS SDK is available at runtime
    format: "esm",
    installDeps: true, // Has node-forge dependency
  },
  // Add more lambdas here as they are migrated
  // {
  //   name: 'key-rotation',
  //   entry: 'index.ts',
  //   external: ['@aws-sdk/*'],
  //   format: 'esm',
  // },
];

async function buildLambda(config: LambdaConfig): Promise<void> {
  const lambdaDir = path.join(__dirname, config.name);
  const srcDir = path.join(lambdaDir, "src");
  const distDir = path.join(lambdaDir, "dist");

  // Check if src directory exists
  if (!fs.existsSync(srcDir)) {
    console.error(`Source directory not found: ${srcDir}`);
    process.exit(1);
  }

  // Install dependencies if needed
  if (config.installDeps) {
    const lockFile = path.join(lambdaDir, "package-lock.json");
    if (fs.existsSync(lockFile)) {
      console.log(`Installing dependencies for ${config.name}...`);
      execSync("npm ci --ignore-scripts", { cwd: lambdaDir, stdio: "inherit" });
    } else {
      console.log(`No package-lock.json found for ${config.name}, skipping npm ci`);
    }
  }

  // Ensure dist directory exists
  fs.mkdirSync(distDir, { recursive: true });

  const entryPoint = path.join(srcDir, config.entry);
  console.log(`Building ${config.name} from ${entryPoint}...`);

  // Bundle with esbuild
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "node",
    target: "node22",
    outfile: path.join(distDir, "index.mjs"),
    format: config.format,
    external: config.external,
    minify: true,
    sourcemap: true,
    banner:
      config.format === "esm"
        ? {
            js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          }
        : undefined,
  });

  console.log(`Built ${config.name} -> ${distDir}/index.mjs`);
}

async function main(): Promise<void> {
  const target = process.argv[2];

  // Determine which lambdas to build
  let lambdasToBuild: LambdaConfig[];

  if (!target || target === "--all") {
    lambdasToBuild = LAMBDAS;
  } else if (target.startsWith("--")) {
    console.error(`Unknown option: ${target}`);
    console.error("Usage: build.ts [lambda-name|--all]");
    process.exit(1);
  } else {
    const found = LAMBDAS.find((l) => l.name === target);
    if (!found) {
      console.error(`Unknown lambda: ${target}`);
      console.error(`Available lambdas: ${LAMBDAS.map((l) => l.name).join(", ")}`);
      process.exit(1);
    }
    lambdasToBuild = [found];
  }

  console.log(`Building ${lambdasToBuild.length} lambda(s)...`);

  // Build all selected lambdas in parallel
  await Promise.all(lambdasToBuild.map(buildLambda));

  console.log("All builds complete!");
}

main().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
