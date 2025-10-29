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

        // Check if attributes already exist
        const hasSourceAttrs = openingElement.attributes.some((attr: JSXAttribute | any) =>
          t.isJSXAttribute(attr) &&
          t.isJSXIdentifier(attr.name) &&
          (attr.name.name === 'data-dev-file' || attr.name.name === 'data-dev-line')
        );

        if (hasSourceAttrs) {
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