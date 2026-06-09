import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import _generate from '@babel/generator';
import type { NodePath, types } from '@babel/core';
import type { Expression, JSXElement, Program } from '@babel/types';

export type BoundTextSourceKind = 'bound-expression' | 'content-key' | 'content-key-template';

export interface BoundTextCandidate {
  devId: string;
  file: string;
  tagName: string;
  sourceKind: BoundTextSourceKind;
  contentKey: string | null;
  contentKeyTemplate: string | null;
  expressionHash: string | null;
}

const SUPPORTED_TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'a',
  'label',
  'li',
  'blockquote',
]);
const FORMATTED_BOUND_TEXT_IMPORT = '@/components/FormattedBoundText';
const generate = ((_generate as unknown as { default?: typeof _generate }).default ?? _generate) as typeof _generate;
const FORMAT_BOUND_TEXT_RUNTIME_FILES = [
  'format-overrides-plugin.ts',
  'src/components/FormattedBoundText.tsx',
  'src/lib/format-overrides.ts',
  'src/lib/format-overrides-store.ts',
];
const VITE_CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];

export interface FormatBoundTextRuntimeOptions {
  enabled?: boolean;
  rootDir?: string;
}

export function getIntrinsicTextTagName(opening: JSXElement['openingElement'], t: typeof types): string | null {
  if (t.isJSXIdentifier(opening.name)) {
    const tagName = opening.name.name;
    return /^[a-z]/.test(tagName) && SUPPORTED_TEXT_TAGS.has(tagName) ? tagName : null;
  }

  if (t.isJSXMemberExpression(opening.name)) {
    let root: types.JSXMemberExpression['object'] = opening.name;
    while (t.isJSXMemberExpression(root)) root = root.object;
    const property = opening.name.property.name;
    return t.isJSXIdentifier(root) && /^[a-z]/.test(root.name) && SUPPORTED_TEXT_TAGS.has(property)
      ? property
      : null;
  }

  return null;
}

export function hashExpression(expression: Expression): string {
  const code = generate(expression, { comments: false, compact: true }).code;
  return `sha256:${createHash('sha256').update(code).digest('hex')}`;
}

function rootDirFromFilename(filename: string | undefined): string | null {
  if (!filename) return null;
  const normalized = filename.replace(/\\/g, '/');
  const srcIndex = normalized.lastIndexOf('/src/');
  return srcIndex === -1 ? null : normalized.slice(0, srcIndex);
}

function hasFormatOverridesPlugin(rootDir: string): boolean {
  return VITE_CONFIG_FILES.some((configFile) => {
    const path = join(rootDir, configFile);
    if (!existsSync(path)) return false;

    try {
      return readFileSync(path, 'utf8').includes('formatOverridesPlugin');
    } catch (error) {
      console.warn(
        '[source-mapper] Unable to read Vite config while checking format override runtime',
        {
          configFile: path,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  });
}

export function isFormatBoundTextRuntimeAvailable(
  filename: string | undefined,
  options: FormatBoundTextRuntimeOptions = {},
): boolean {
  if (typeof options.enabled === 'boolean') return options.enabled;

  const rootDir = options.rootDir ?? rootDirFromFilename(filename);
  if (!rootDir) return false;

  return FORMAT_BOUND_TEXT_RUNTIME_FILES.every((file) => existsSync(join(rootDir, file))) &&
    hasFormatOverridesPlugin(rootDir);
}

export function ensureFormattedBoundTextImport(programPath: NodePath<Program>, t: typeof types): void {
  const hasImport = programPath.node.body.some((node) =>
    t.isImportDeclaration(node) &&
    node.source.value === FORMATTED_BOUND_TEXT_IMPORT &&
    node.specifiers.some((spec) =>
      t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: 'FormattedBoundText' }),
    ),
  );
  if (hasImport) return;

  programPath.unshiftContainer(
    'body',
    t.importDeclaration(
      [t.importSpecifier(t.identifier('FormattedBoundText'), t.identifier('FormattedBoundText'))],
      t.stringLiteral(FORMATTED_BOUND_TEXT_IMPORT),
    ),
  );
}

export function buildGuardExpression(candidate: BoundTextCandidate, t: typeof types): types.JSXExpressionContainer {
  return t.jsxExpressionContainer(t.objectExpression([
    t.objectProperty(t.identifier('file'), t.stringLiteral(candidate.file)),
    t.objectProperty(t.identifier('tagName'), t.stringLiteral(candidate.tagName)),
    t.objectProperty(t.identifier('sourceKind'), t.stringLiteral(candidate.sourceKind)),
    t.objectProperty(t.identifier('contentKey'), candidate.contentKey ? t.stringLiteral(candidate.contentKey) : t.nullLiteral()),
    t.objectProperty(
      t.identifier('contentKeyTemplate'),
      candidate.contentKeyTemplate ? t.stringLiteral(candidate.contentKeyTemplate) : t.nullLiteral(),
    ),
    t.objectProperty(
      t.identifier('expressionHash'),
      candidate.expressionHash ? t.stringLiteral(candidate.expressionHash) : t.nullLiteral(),
    ),
  ]));
}
