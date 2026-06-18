/**
 * App structure constants shared between the app download (export) and
 * app import (upload) flows. Canonical source of truth for which files
 * and directories constitute an app-builder project.
 */

export const APP_DIRECTORIES = [
  'src',
  'public',
  'format-overrides',
] as const

export const APP_CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',
  'vitest.config.js',
  'vitest.config.ts',
  'jest.config.js',
  'jest.config.ts',
  'tailwind.config.js',
  'tailwind.config.ts',
  'postcss.config.js',
  'postcss.config.mjs',
  'eslint.config.js',
  'eslint.config.mjs',
  '.eslintrc.js',
  '.eslintrc.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  'drizzle.config.ts',
  'drizzle.config.js',
  'components.json',
  'index.html',
  '.env.example',
  'env.example',
  '.gitignore',
  '.npmrc',
  'README.md',
  'airo-media.json',
  '.airo/adsense.json',
] as const
