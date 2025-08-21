import type { Plugin } from 'vite';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export function sourceMapperPlugin(): Plugin {
  return {
    name: 'source-mapper',
    enforce: 'pre',
    
    transform(code: string, id: string) {
      // Only process React component files, not node_modules
      if (!id.match(/\.(tsx?|jsx?)$/) || id.includes('node_modules')) {
        return null;
      }
      
      try {
        // Parse the code into AST
        const ast = parse(code, {
          sourceType: 'module',
          plugins: ['jsx', 'typescript'],
          sourceFilename: id,
        });
        
        // Track if we made any changes
        let hasChanges = false;
        
        // Traverse and modify JSX elements
        const traverseFn = (traverse as any).default || traverse;
        traverseFn(ast, {
          JSXOpeningElement(path: NodePath<t.JSXOpeningElement>) {
            // Skip fragments or elements that already have source attributes
            if (!path.node.name || path.node.name.type !== 'JSXIdentifier') {
              return;
            }
            
            // Check if attributes already exist
            const hasSourceAttr = path.node.attributes.some(
              (attr) => t.isJSXAttribute(attr) && 
                       t.isJSXIdentifier(attr.name) &&
                       attr.name.name.startsWith('data-source')
            );
            
            if (hasSourceAttr) return;
            
            // Add source mapping attributes
            const lineNumber = path.node.loc?.start.line || 0;
            const componentName = findComponentName(path);
            
            const attributes = [
              t.jsxAttribute(
                t.jsxIdentifier('data-source-file'),
                t.stringLiteral(id.replace(process.cwd(), ''))
              ),
              t.jsxAttribute(
                t.jsxIdentifier('data-source-line'),
                t.stringLiteral(String(lineNumber))
              ),
            ];
            
            if (componentName) {
              attributes.push(
                t.jsxAttribute(
                  t.jsxIdentifier('data-source-component'),
                  t.stringLiteral(componentName)
                )
              );
            }
            
            path.node.attributes.push(...attributes);
            hasChanges = true;
          },
        });
        
        if (!hasChanges) {
          return null;
        }
        
        // Generate the modified code
        const generateFn = (generate as any).default || generate;
        const result = generateFn(ast, {
          sourceMaps: true,
          sourceFileName: id,
        }, code);
        
        return {
          code: result.code,
          map: result.map,
        };
      } catch (error) {
        console.warn(`Failed to process %s: %s`, id, error);
        return null;
      }
    },
  };
}

function findComponentName(path: NodePath<t.JSXOpeningElement>): string | null {
  let current: NodePath | null = path;
  
  while (current) {
    // Check if we're inside a function component
    if (current.isFunctionDeclaration() || 
        current.isFunctionExpression() || 
        current.isArrowFunctionExpression()) {
      const parent = current.parent;
      
      // Named function
      if ('id' in current.node && current.node.id?.name) {
        return current.node.id.name;
      }
      
      // Variable declaration
      if (t.isVariableDeclarator(parent)) {
        if (t.isIdentifier(parent.id)) {
          return parent.id.name;
        }
      }
      
      // Export default
      if (t.isExportDefaultDeclaration(parent)) {
        return 'default';
      }
    }
    
    current = current.parentPath;
  }
  
  return null;
}
