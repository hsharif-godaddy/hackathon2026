#!/usr/bin/env node

/**
 * i18n Translation Key Validation Script
 *
 * Validates that all translation keys used in staged TypeScript/JSX files
 * exist in the i18n API. Runs as part of pre-commit hook via lint-staged.
 *
 * Flags:
 * - --strict: Fail when the i18n API is unreachable (used in CI)
 *
 * Exit codes:
 * - 0: Validation passed, or API unreachable in non-strict mode
 * - 1: Validation failed (missing keys or API unreachable in strict mode)
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import parser from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

const REBUILD_INTAKE_DEFAULTS_PATH = new URL(
  "../app/src/lib/translations/rebuild-intake-defaults.ts",
  import.meta.url,
);

const CANVAS_STATUS_DEFAULTS_PATH = new URL(
  "../app/src/lib/translations/canvas-status-defaults.ts",
  import.meta.url,
);

const API_URL =
  "https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab";
const API_TIMEOUT_MS = 10000;

/**
 * Keys listed in rebuild-intake-defaults.ts have English dev fallbacks via
 * defaultMessageForRebuildIntakeKey() until published to @airo-app-builder/aab.
 * @returns {Set<string>}
 */
function loadFallbackKeysFromDefaultsFile(filePath, label) {
  try {
    const content = readFileSync(filePath, "utf-8");
    return new Set(
      [...content.matchAll(/\n\s+(builder_[a-z0-9_]+):/g)].map((match) => match[1]),
    );
  } catch (error) {
    console.warn(`Warning: Could not load ${label}: ${error.message}`);
    return new Set();
  }
}

function loadRebuildIntakeFallbackKeys() {
  return loadFallbackKeysFromDefaultsFile(REBUILD_INTAKE_DEFAULTS_PATH, "rebuild-intake-defaults.ts");
}

function loadCanvasStatusFallbackKeys() {
  return loadFallbackKeysFromDefaultsFile(CANVAS_STATUS_DEFAULTS_PATH, "canvas-status-defaults.ts");
}

/**
 * Get list of staged files from git
 * @returns {string[]} Array of staged file paths
 */
function getStagedFiles() {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    console.error("Error getting staged files:", error.message);
    process.exit(1);
  }
}

/**
 * Filter for app/src TypeScript/JSX files
 * @param {string[]} files - All staged files (may be absolute or relative paths)
 * @returns {string[]} Filtered files
 */
function filterAppSourceFiles(files) {
  return files.filter(
    (file) =>
      (file.startsWith("app/src/") || file.includes("/app/src/")) &&
      (file.endsWith(".ts") || file.endsWith(".tsx")),
  );
}

/**
 * Fetch available translation keys from i18n API
 * @returns {Promise<Set<string>|null>} Set of available keys, or null if fetch failed
 */
async function fetchTranslationKeys() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`API returned ${response.status}: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (typeof data !== "object" || data === null) {
      console.error("API returned invalid JSON format");
      return null;
    }

    return new Set(Object.keys(data).map((k) => k.trim()));
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === "AbortError") {
      console.error("API request timed out after 10 seconds");
    } else {
      console.error("Error fetching translation keys:", error.message);
    }

    return null;
  }
}

/**
 * Extract translation keys from file code
 * @param {string} code - File contents
 * @param {string} filePath - File path for error messages
 * @returns {Map<string, number[]>} Map of keys to line numbers
 */
function extractKeysFromCode(code, filePath) {
  const keysWithLines = new Map();

  try {
    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });

    traverse.default(ast, {
      // Pattern 1: t('key') calls
      CallExpression(path) {
        const { node } = path;

        // Check for t() calls
        const isTranslateCall =
          t.isIdentifier(node.callee) &&
          (node.callee.name === "t" || node.callee.name === "tr");
        if (
          isTranslateCall &&
          node.arguments.length > 0 &&
          t.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].value;
          const line = node.loc?.start.line || 0;

          if (!keysWithLines.has(key)) {
            keysWithLines.set(key, []);
          }
          keysWithLines.get(key).push(line);
        }

        // Check for intl.formatMessage({ id: 'key' }) calls
        if (
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.property, { name: "formatMessage" }) &&
          node.arguments.length > 0 &&
          t.isObjectExpression(node.arguments[0])
        ) {
          const idProp = node.arguments[0].properties.find(
            (prop) =>
              t.isObjectProperty(prop) &&
              t.isIdentifier(prop.key, { name: "id" }) &&
              t.isStringLiteral(prop.value),
          );

          if (idProp && t.isStringLiteral(idProp.value)) {
            const key = idProp.value.value;
            const line = node.loc?.start.line || 0;

            if (!keysWithLines.has(key)) {
              keysWithLines.set(key, []);
            }
            keysWithLines.get(key).push(line);
          }
        }
      },

      // Pattern 2: <FormattedMessage id="key" />
      JSXOpeningElement(path) {
        const { node } = path;

        if (t.isJSXIdentifier(node.name, { name: "FormattedMessage" })) {
          const idAttr = node.attributes.find(
            (attr) =>
              t.isJSXAttribute(attr) &&
              t.isJSXIdentifier(attr.name, { name: "id" }) &&
              t.isStringLiteral(attr.value),
          );

          if (idAttr && t.isStringLiteral(idAttr.value)) {
            const key = idAttr.value.value;
            const line = node.loc?.start.line || 0;

            if (!keysWithLines.has(key)) {
              keysWithLines.set(key, []);
            }
            keysWithLines.get(key).push(line);
          }
        }
      },
    });
  } catch (error) {
    // If parsing fails, log warning but don't fail entire validation
    console.warn(`Warning: Could not parse ${filePath}: ${error.message}`);
  }

  return keysWithLines;
}

/**
 * Extract all translation keys from files
 * @param {string[]} files - File paths to parse
 * @returns {Map<string, Array<{file: string, line: number}>>} Keys with locations
 */
function extractKeysFromFiles(files) {
  const allKeys = new Map();

  for (const file of files) {
    try {
      const code = readFileSync(file, "utf-8");
      const keysInFile = extractKeysFromCode(code, file);

      for (const [key, lines] of keysInFile) {
        if (!allKeys.has(key)) {
          allKeys.set(key, []);
        }

        for (const line of lines) {
          allKeys.get(key).push({ file, line });
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not read ${file}: ${error.message}`);
    }
  }

  return allKeys;
}

/**
 * Find missing keys by comparing extracted vs available
 * @param {Map<string, Array<{file: string, line: number}>>} extractedKeys
 * @param {Set<string>} availableKeys
 * @returns {Map<string, Array<{file: string, line: number}>>} Missing keys with locations
 */
function findMissingKeys(extractedKeys, availableKeys) {
  const missingKeys = new Map();

  for (const [key, locations] of extractedKeys) {
    if (!availableKeys.has(key)) {
      missingKeys.set(key, locations);
    }
  }

  return missingKeys;
}

/**
 * Report missing keys with formatted error message
 * @param {Map<string, Array<{file: string, line: number}>>} missingKeys
 */
function reportMissingKeys(missingKeys) {
  console.log("");
  console.log("❌ Translation Validation Failed");
  console.log("");
  console.log(
    `Found ${missingKeys.size} missing translation key${missingKeys.size === 1 ? "" : "s"}:`,
  );
  console.log("");

  let index = 1;
  for (const [key, locations] of missingKeys) {
    console.log(`  ${index}. ${key}`);

    for (const { file, line } of locations) {
      console.log(`     → ${file}:${line}`);
    }

    console.log("");
    index++;
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("To add these translation keys:");
  console.log(
    "1. Visit: https://i18n.int.gdcorp.tools/org/airo-app-builder/app/aab",
  );
  console.log(
    "2. Add yourself to the PARTNERSTRANSLATIONS AD group (if needed)",
  );
  console.log("3. Create the missing keys with appropriate translations");
  console.log("");
  console.log("For more information, see: app/src/lib/translations/README.md");
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
}

/**
 * Main execution function
 */
async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const fileArgs = args.filter((arg) => !arg.startsWith("--"));

  // Get files passed by lint-staged/CI, or use staged files for manual runs
  const stagedFiles = fileArgs.length > 0 ? fileArgs : getStagedFiles();

  const appFiles = filterAppSourceFiles(stagedFiles);

  if (appFiles.length === 0) {
    console.log("✓ No translation files to validate");
    process.exit(0);
  }

  const availableKeys = await fetchTranslationKeys();

  if (!availableKeys) {
    console.log("⚠️  Warning: Could not fetch translation keys from API");
    console.log("   " + API_URL);

    if (strict) {
      console.log("");
      console.log("❌ i18n validation failed in strict mode (CI requires API access)");
      process.exit(1);
    }

    console.log("   Skipping i18n validation (VPN required)");
    console.log("");
    console.log("   Missing keys will be caught in CI. Connect to VPN to validate locally.");
    process.exit(0);
  }

  const extractedKeys = extractKeysFromFiles(appFiles);

  for (const key of loadRebuildIntakeFallbackKeys()) {
    availableKeys.add(key);
  }

  for (const key of loadCanvasStatusFallbackKeys()) {
    availableKeys.add(key);
  }

  const missingKeys = findMissingKeys(extractedKeys, availableKeys);

  if (missingKeys.size > 0) {
    reportMissingKeys(missingKeys);
    process.exit(1);
  }

  console.log(
    `✓ Translation validation passed (checked ${extractedKeys.size} keys across ${appFiles.length} files)`,
  );
  process.exit(0);
}

// Run main function
main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
