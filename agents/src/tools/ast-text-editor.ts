import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

// @ts-ignore - Handle ES module default exports
const traverse = _traverse.default || _traverse;
// @ts-ignore - Handle ES module default exports  
const generate = _generate.default || _generate;
import { GitTool } from './git-tool.js';
import { translateDockerPath } from '../utils/path-helper.js';

export interface TextEditContext {
  fileName: string;
  componentName: string;
  lineNumber: number;
}

export interface TextEditRequest {
  selector: string;
  oldText: string;
  newText: string;
  devContext: TextEditContext;
}

export interface TextEditResult {
  success: boolean;
  filePath: string;
  oldText: string;
  newText: string;
  diff?: string;
  error?: string;
}

export class ASTTextEditor {
  private gitTool = new GitTool();

  /**
   * Parse a CSS selector into tagName and className
   */
  private parseCSSSelector(selector: string): { tagName: string; className: string } {
    // Handle selectors like "p.text-xl.text-muted-foreground.max-w-2xl.mx-auto"
    const match = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)?\.?(.*)$/);
    if (!match) {
      return { tagName: 'div', className: '' };
    }
    
    const [, tagPart, classPart] = match;
    const tagName = tagPart || 'div';
    const className = classPart ? classPart.replace(/\./g, ' ').trim() : '';
    
    return { tagName, className };
  }

  /**
   * Resolve file path within the app directory
   */
  private resolveFilePath(appPath: string, fileName: string): string {
    // Handle Docker paths
    const translatedPath = translateDockerPath(fileName);
    const fullPath = resolve(appPath, translatedPath);
    
    console.log(`📁 Resolving file path:`, {
      appPath,
      fileName,
      translatedPath,
      fullPath
    });
    
    return fullPath;
  }

  /**
   * Check if a JSX element matches our target criteria
   */
  private isTargetElement(element: t.JSXElement, targetInfo: { tagName: string; className?: string; lineNumber: number; textContent: string }): boolean {
    const openingElement = element.openingElement;
    const elementLine = element.loc?.start.line;
    
    // Must be on the correct line (or close to it - within 2 lines)
    if (!elementLine || Math.abs(elementLine - targetInfo.lineNumber) > 2) {
      return false;
    }
    
    // Must have the correct tag name
    if (t.isJSXIdentifier(openingElement.name)) {
      const tagName = openingElement.name.name;
      if (tagName !== targetInfo.tagName) {
        return false;
      }
    } else {
      return false;
    }
    
    // Check if className matches (if provided)
    if (targetInfo.className) {
      const classNameAttr = openingElement.attributes.find(
        (attr: any) => t.isJSXAttribute(attr) && attr.name.name === 'className'
      ) as t.JSXAttribute | undefined;
      
      if (classNameAttr && t.isStringLiteral(classNameAttr.value)) {
        const currentClassName = classNameAttr.value.value;
        // Check if all classes in targetInfo.className are present
        const targetClasses = targetInfo.className.split(/\s+/).filter(Boolean);
        const currentClasses = currentClassName.split(/\s+/).filter(Boolean);
        
        const hasAllClasses = targetClasses.every(cls => currentClasses.includes(cls));
        if (!hasAllClasses) {
          return false;
        }
      } else if (targetInfo.className.trim()) {
        return false; // Expected className but element doesn't have one
      }
    }
    
    // Check if text content matches (fuzzy match for whitespace)
    const elementTextContent = this.extractTextContent(element);
    const normalizedElementText = elementTextContent.replace(/\s+/g, ' ').trim();
    const normalizedTargetText = targetInfo.textContent.replace(/\s+/g, ' ').trim();
    
    console.log(`🔍 Comparing text content:`, {
      elementText: normalizedElementText,
      targetText: normalizedTargetText,
      matches: normalizedElementText === normalizedTargetText
    });
    
    return normalizedElementText === normalizedTargetText;
  }

  /**
   * Extract text content from a JSX element
   */
  private extractTextContent(element: t.JSXElement): string {
    let textContent = '';
    
    for (const child of element.children) {
      if (t.isJSXText(child)) {
        textContent += child.value;
      } else if (t.isJSXExpressionContainer(child)) {
        if (t.isStringLiteral(child.expression)) {
          textContent += child.expression.value;
        }
      }
    }
    
    return textContent.trim();
  }

  /**
   * Update text content in a JSX element
   */
  private updateTextContent(element: t.JSXElement, newText: string): void {
    // Clear existing children
    element.children = [];
    
    // Add new text content
    if (newText.trim()) {
      const textNode = t.jsxText(newText);
      element.children.push(textNode);
    }
  }

  /**
   * Edit element text content using AST parsing and manipulation
   */
  async editElementText(
    appPath: string,
    request: TextEditRequest
  ): Promise<TextEditResult> {
    try {
      const { selector, oldText, newText, devContext } = request;
      
      console.log(`🖊️ Starting AST text edit:`, {
        selector,
        oldText: oldText.slice(0, 50),
        newText: newText.slice(0, 50),
        fileName: devContext.fileName,
        lineNumber: devContext.lineNumber
      });
      
      // Parse the CSS selector to get tagName and className
      const parsedSelector = this.parseCSSSelector(selector);
      
      const filePath = this.resolveFilePath(appPath, devContext.fileName);
      
      // Read the source file
      const sourceCode = await readFile(filePath, 'utf-8');
      
      // Parse the AST
      const ast = parse(sourceCode, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy']
      });

      // Find and update the element
      let elementFound = false;
      let actualOldText = '';
      
      console.log(`🔍 Starting AST traversal looking for ${parsedSelector.tagName} at line ${devContext.lineNumber}`);
      
      traverse(ast, {
        JSXElement: (path: any): void => {
          const element = path.node;
          const elementLine = element.loc?.start.line;
          const openingElement = element.openingElement;
          
          // Log every JSX element we encounter
          if (t.isJSXIdentifier(openingElement.name)) {
            const tagName = openingElement.name.name;
            console.log(`  - Found JSX element: ${tagName} at line ${elementLine}`);
          }
          
          // Check if this is the target element
          const targetInfo = {
            tagName: parsedSelector.tagName,
            className: parsedSelector.className,
            lineNumber: devContext.lineNumber,
            textContent: oldText
          };
          
          if (this.isTargetElement(element, targetInfo)) {
            console.log(`✅ Found target element at line ${elementLine}`);
            elementFound = true;
            actualOldText = this.extractTextContent(element);
            
            // Update the text content
            this.updateTextContent(element, newText);
            
            console.log(`📝 Updated text from "${actualOldText}" to "${newText}"`);
          }
        }
      });

      if (!elementFound) {
        const errorMsg = `Element not found. Selector: ${selector}, Line: ${devContext.lineNumber}, Expected text: "${oldText.slice(0, 50)}..."`;
        console.log(`❌ ${errorMsg}`);
        return {
          success: false,
          filePath,
          oldText,
          newText,
          error: errorMsg
        };
      }

      // Generate the updated code
      const { code: updatedCode } = generate(ast, {
        retainLines: true,
        compact: false
      });

      // Write the updated file
      await writeFile(filePath, updatedCode, 'utf-8');
      
      console.log(`✅ Text edit completed successfully`);

      return {
        success: true,
        filePath,
        oldText: actualOldText,
        newText,
        diff: `- ${actualOldText}\n+ ${newText}`
      };

    } catch (error) {
      console.error('❌ AST text edit failed:', error);
      return {
        success: false,
        filePath: '',
        oldText: request.oldText,
        newText: request.newText,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
}
