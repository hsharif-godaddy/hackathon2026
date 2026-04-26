import type { PluginObj, PluginPass, types, NodePath } from '@babel/core';
import type { JSXAttribute, JSXElement } from '@babel/types';

interface PluginOptions {
  excludePaths?: string[];
}

type PluginState = PluginPass & {
  opts?: PluginOptions;
};

/**
 *
 * @param babel - Babel instance with types API
 * @returns Babel plugin configuration object
 *
 * @example
 */
export default function jsxSourceMapper(babel: { types: typeof types }): PluginObj<PluginState> {
  const t = babel.types;

  return {
    name: 'jsx-source-mapper',
    visitor: {
      JSXElement(path: NodePath<JSXElement>, state: PluginState) {
        // Skip in production
        if (process.env.NODE_ENV === 'production') {
          return;
        }

        const openingElement = path.node.openingElement;

        // Skip fragments
        if (!openingElement.name || !('name' in openingElement.name)) {
          return;
        }

        // Get source information
        const fileName = state.filename || state.file.opts.filename || 'unknown';

        // Default excluded paths (component libraries)
        const defaultExcludePaths = [
          'components/ui/',
          '/components/ui/',
          'src/components/ui/',
          '/src/components/ui/'
        ];

        const excludePaths = state.opts?.excludePaths || defaultExcludePaths;

        // Skip if file is in excluded paths (component libraries)
        if (excludePaths.some(excludePath => fileName.includes(excludePath))) {
          return;
        }

        // Mark elements whose children include dynamic expressions
        const hasDynamic = path.node.children.some(child =>
          t.isJSXExpressionContainer(child) &&
          !t.isJSXEmptyExpression(child.expression) &&
          !t.isStringLiteral(child.expression) &&
          !(t.isTemplateLiteral(child.expression) && child.expression.expressions.length === 0)
        );
        const hasAttr = (name: string) => openingElement.attributes.some((attr) =>
          t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === name
        );

        if (hasDynamic && !hasAttr('data-dev-dynamic')) {
          openingElement.attributes.push(
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-dynamic'),
              t.stringLiteral('true')
            )
          );
        }

        // Only check data-dev-file; data-dev-line is always pushed alongside it
        if (hasAttr('data-dev-file')) {
          return;
        }

        const lineNumber = openingElement.loc ? openingElement.loc.start.line : 0;

        // Add source attributes
        openingElement.attributes.push(
          t.jsxAttribute(
            t.jsxIdentifier('data-dev-file'),
            t.stringLiteral(fileName)
          ),
          t.jsxAttribute(
            t.jsxIdentifier('data-dev-line'),
            t.jsxExpressionContainer(t.numericLiteral(lineNumber))
          )
        );
      }
    }
  };
}