import type { PluginObj, PluginPass, types, NodePath } from '@babel/core';
import type { JSXIdentifier, JSXMemberExpression, JSXAttribute, JSXElement, JSXNamespacedName } from '@babel/types';

interface PluginOptions {
  wrapComponents?: boolean;
  onlyComponents?: boolean;
}

interface PluginState extends PluginPass {
  opts: PluginOptions & object;
}

export default function jsxSourceMapper(babel: { types: typeof types }): PluginObj<PluginState> {
  const t = babel.types;

  function isComponent(name: string): boolean {
    // Components start with uppercase, HTML elements with lowercase
    return /^[A-Z]/.test(name);
  }

  function getComponentName(node: JSXIdentifier | JSXMemberExpression | JSXNamespacedName): string {
    if (t.isJSXIdentifier(node)) {
      return node.name;
    } else if (t.isJSXMemberExpression(node)) {
      const parts: string[] = [];
      let current: JSXMemberExpression | JSXIdentifier = node;

      while (t.isJSXMemberExpression(current)) {
        if (t.isJSXIdentifier(current.property)) {
          parts.unshift(current.property.name);
        }
        current = current.object;
      }

      if (t.isJSXIdentifier(current)) {
        parts.unshift(current.name);
      }

      return parts.join('.');
    } else if (t.isJSXNamespacedName(node)) {
      // Handle JSX namespaced names like <namespace:component>
      return `${node.namespace.name}:${node.name.name}`;
    }

    return 'unknown';
  }

  return {
    name: 'jsx-source-mapper',
    visitor: {
      JSXElement(path: NodePath<JSXElement>, state: PluginState) {
        const openingElement = path.node.openingElement;

        // Skip fragments
        if (!openingElement.name || !('name' in openingElement.name)) {
          return;
        }

        // Only add in development mode
        if (process.env.NODE_ENV === 'production') {
          return;
        }

        const componentName = getComponentName(openingElement.name);
        const isComponentElement = isComponent(componentName);
        const onlyComponents = state.opts?.onlyComponents ?? false;

        // Skip HTML elements if onlyComponents is true
        if (onlyComponents && !isComponentElement) {
          return;
        }

        // Get source information
        const filename = state.filename || state.file.opts.filename || 'unknown';
        const line = openingElement.loc ? openingElement.loc.start.line : 0;

        // Check if attributes already exist
        const hasSourceAttrs = openingElement.attributes.some((attr: JSXAttribute | any) =>
          t.isJSXAttribute(attr) &&
          t.isJSXIdentifier(attr.name) &&
          attr.name.name.startsWith('data-dev-')
        );

        if (hasSourceAttrs) {
          return;
        }

        if (isComponentElement && (state.opts?.wrapComponents ?? true)) {
          // For components, wrap in a div with source attributes
          // This ensures we capture where the component is USED, not implemented

          const wrapperAttributes = [
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-file'),
              t.stringLiteral(filename)
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-line'),
              t.stringLiteral(String(line))
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-component'),
              t.stringLiteral(componentName)
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-wrapper'),
              t.stringLiteral('true')
            ),
            // Make wrapper invisible
            t.jsxAttribute(
              t.jsxIdentifier('style'),
              t.jsxExpressionContainer(
                t.objectExpression([
                  t.objectProperty(
                    t.identifier('display'),
                    t.stringLiteral('contents')
                  )
                ])
              )
            )
          ];

          // Create wrapper div with display: contents (invisible wrapper)
          const wrapper = t.jsxElement(
            t.jsxOpeningElement(
              t.jsxIdentifier('div'),
              wrapperAttributes,
              false
            ),
            t.jsxClosingElement(t.jsxIdentifier('div')),
            [path.node],
            false
          );

          // Replace the component with wrapped version
          path.replaceWith(wrapper);
          path.skip(); // Skip traversing into the wrapper we just created

        } else {
          // For HTML elements, add attributes directly
          const attributes = [
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-file'),
              t.stringLiteral(filename)
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-line'),
              t.stringLiteral(String(line))
            ),
            t.jsxAttribute(
              t.jsxIdentifier('data-dev-component'),
              t.stringLiteral(componentName)
            )
          ];

          openingElement.attributes.push(...attributes);
        }
      }
    }
  };
}