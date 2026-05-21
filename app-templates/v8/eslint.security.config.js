// Security-only ESLint flat config used by the Airo Builder security quality
// scanner. Runs separately from the customer's eslint.config.js (--no-config-lookup
// at scan time) so this file is the *only* config that applies during a security scan.
//
// Plugin licenses (verified):
//   - eslint-plugin-security        Apache-2.0
//   - eslint-plugin-no-unsanitized  MPL-2.0
// Both are commercial-SaaS friendly. No anti-compete or "selling" restrictions.
//
// Coverage map -> Code Quality (SAST) category of the Security Quality Score:
//   security/*           -> RCE / weak crypto / injection / object pollution / timing-attack surface
//   no-unsanitized/*     -> XSS sinks (innerHTML =, dangerouslySetInnerHTML-equivalent DOM writes)

import tsParser from '@typescript-eslint/parser';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import security from 'eslint-plugin-security';

export default [
  {
    ignores: [
      'dist',
      'node_modules',
      '.next',
      '.vite',
      'build',
      'coverage',
      'public',
    ],
  },
  {
    // .ts/.tsx files need the typescript-eslint parser. Without it, ESLint's
    // default parser emits fatal parse errors on TS syntax, which our scanner
    // filters out as non-security findings — leaving the scan looking "clean"
    // even when rules would otherwise fire. Drop parser back to default for
    // plain JS so we don't pay the TS-parser cost there.
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'warn',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'warn',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'error',
      'security/detect-object-injection': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      // --- eslint-plugin-security recommended ruleset, opted in explicitly so a
      // future release tightening defaults can't surprise us at scan time. ---
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'warn',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'warn',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'error',
      'security/detect-object-injection': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',

      // --- eslint-plugin-no-unsanitized: DOM-XSS sinks ---
      'no-unsanitized/method': 'error', // document.write, insertAdjacentHTML, etc.
      'no-unsanitized/property': 'error', // innerHTML =, outerHTML =, srcdoc, etc.
    },
  },
];
