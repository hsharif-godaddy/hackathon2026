import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // React/JSX rules
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/jsx-key": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-uses-vars": "error",
      "react/no-children-prop": "error",
      "react/no-unescaped-entities": "warn",
      
      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        { 
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/prefer-const": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      
      // General JavaScript rules
      "no-console": ["warn", { "allow": ["warn", "error"] }],
      "no-debugger": "error",
      "no-alert": "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-duplicate-imports": "error",
      "no-unused-expressions": "error",
      
      // Code style rules
      "semi": ["error", "always"],
      "quotes": ["error", "double", { "allowTemplateLiterals": true }],
      "comma-dangle": ["error", "es5"],
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      
      // Import/Export rules
      "import/order": [
        "error",
        {
          "groups": [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index"
          ],
          "newlines-between": "always",
          "alphabetize": {
            "order": "asc",
            "caseInsensitive": true
          }
        }
      ],
      "import/no-duplicates": "error",
      "import/no-unresolved": "off", // Handled by TypeScript
      
      // Next.js specific rules
      "@next/next/no-img-element": "error",
      "@next/next/no-html-link-for-pages": "error",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // Additional TypeScript-specific rules
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    rules: {
      // JavaScript-specific rules (if any JS files exist)
      "no-undef": "error",
    },
  },
  {
    // Config files don't need strict rules
    files: [
      "next.config.js",
      "tailwind.config.js",
      "postcss.config.js",
      "eslint.config.js",
    ],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
      "no-console": "off",
    },
  },
];

export default eslintConfig;
