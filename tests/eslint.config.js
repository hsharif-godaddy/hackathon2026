// tests/eslint.config.js
//
// P3 guardrails for E2E test quality (AIROBUILD-3381). These flag the locator
// patterns that produced the bulk of the 140 test-quality findings. Introduced
// as `warn` (not `error`) so the currently-passing tree stays green while the
// remaining violations are burned down; flip to `error` after cleanup.
//
// Plain flat-config array (no `@eslint/js` / `typescript-eslint` imports):
// neither package is installed at the repo root and tests/ is not a workspace
// package, so this relies only on ESLint's core `no-restricted-syntax` rule —
// no plugin or parser dependency to declare. See tests/TESTID-CONVENTIONS.md.
export default [
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'Replace waitForTimeout with condition-based waits. See tests/TESTID-CONVENTIONS.md.',
        },
        {
          selector: "Literal[value=/data-slot|data-state|\\.ux-[a-z]|\\.airo-[a-z]/]",
          message:
            'Do not use library-internal CSS selectors. Add a data-testid to the component. See tests/TESTID-CONVENTIONS.md.',
        },
        {
          selector:
            "MemberExpression[object.callee.property.name='locator'][object.arguments.0.value='div']",
          message:
            "page.locator('div') is structurally fragile. Use getByTestId or a semantic role. See tests/TESTID-CONVENTIONS.md.",
        },
      ],
    },
  },
];
