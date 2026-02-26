#!/usr/bin/env npx tsx
/**
 * Lambda verification script - verifies built Lambda functions can be loaded
 *
 * Usage:
 *   npx tsx lambda/verify.ts                    # Verify all lambdas
 *   npx tsx lambda/verify.ts qdrant-tls-bootstrap  # Verify specific lambda
 */

import * as path from "path";
import * as fs from "fs";
import { pathToFileURL } from "url";

const LAMBDAS = ["qdrant-tls-bootstrap"];

async function verifyLambda(name: string): Promise<boolean> {
  const distPath = path.join(__dirname, name, "dist", "index.mjs");

  // Check dist file exists
  if (!fs.existsSync(distPath)) {
    console.error(`FAIL: ${name} - dist/index.mjs not found (run build:lambdas first)`);
    return false;
  }

  try {
    // Import the module dynamically
    const moduleUrl = pathToFileURL(distPath).href;
    const module = await import(moduleUrl);

    // Check handler exists and is a function
    if (typeof module.handler !== "function") {
      console.error(`FAIL: ${name} - handler is not a function`);
      return false;
    }

    console.log(`OK: ${name} - handler loaded successfully`);
    return true;
  } catch (error) {
    console.error(`FAIL: ${name} - ${(error as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];

  const lambdasToVerify = target ? [target] : LAMBDAS;

  console.log(`Verifying ${lambdasToVerify.length} lambda(s)...\n`);

  const results = await Promise.all(lambdasToVerify.map(verifyLambda));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
