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
import { relative } from 'path';
import { translateDockerPath } from '../utils/path-helper.js';

export interface StyleEditContext {
  fileName: string;
  componentName: string;
  lineNumber: number;
}

export interface ElementInfo {
  tagName: string;
  className: string;
  id: string;
  textContent: string;
  selector: string;
  dataId: string;
  devContext: StyleEditContext;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  computedStyles: Record<string, string>;
}

export interface StyleEditRequest {
  selector: string;
  property: string;
  value: string;
  newClassName: string;
  newStyle?: string;
  elementInfo: ElementInfo;
}

export interface StyleEditResult {
  success: boolean;
  filePath: string;
  changes: {
    oldClassName: string;
    newClassName: string;
    property: string;
    value: string;
  };
  diff?: string;
  error?: string;
  commitHash?: string | undefined;
}

export class ASTStyleEditor {
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
   * Edit element styles using AST parsing and manipulation
   */
  async editElementStyle(
    appPath: string,
    request: StyleEditRequest
  ): Promise<StyleEditResult> {
    try {
      const { elementInfo, selector } = request;
      
      // Parse the CSS selector to get tagName and className if not provided
      const parsedSelector = this.parseCSSSelector(selector);
      
      // Enhance elementInfo with parsed selector data if missing
      const enhancedElementInfo = {
        ...elementInfo,
        tagName: elementInfo.tagName || parsedSelector.tagName,
        className: elementInfo.className || parsedSelector.className
      };
      
      const filePath = this.resolveFilePath(appPath, enhancedElementInfo.devContext.fileName);
      
      // Read the source file
      const sourceCode = await readFile(filePath, 'utf-8');
      
      // Parse the AST
      const ast = parse(sourceCode, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript', 'decorators-legacy']
      });

      // Find and update the element
      let elementFound = false;
      let oldClassName = '';
      let newClassName = '';
      let dynamicClassNameError: string | null = null;
      
      console.log(`🔍 Starting AST traversal looking for ${enhancedElementInfo.tagName} at line ${enhancedElementInfo.devContext.lineNumber}`);
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
          if (this.isTargetElement(element, enhancedElementInfo)) {
            elementFound = true;
            
            // Get the opening element
            const openingElement = element.openingElement;
            
            // Find or create className attribute
            let classNameAttr = openingElement.attributes.find(
              (attr: any) => t.isJSXAttribute(attr) && attr.name.name === 'className'
            ) as t.JSXAttribute | undefined;
            
            if (!classNameAttr) {
              // Create new className attribute
              classNameAttr = t.jsxAttribute(
                t.jsxIdentifier('className'),
                t.stringLiteral('')
              );
              openingElement.attributes.push(classNameAttr);
            }
            
            // Get current className value and ensure it's editable
            if (t.isStringLiteral(classNameAttr.value)) {
              oldClassName = classNameAttr.value.value;
            } else if (t.isJSXExpressionContainer(classNameAttr.value) && 
                      t.isStringLiteral(classNameAttr.value.expression)) {
              oldClassName = classNameAttr.value.expression.value;
            } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
              // Cannot edit dynamic classNames (template literals, expressions, etc.)
              dynamicClassNameError = `Cannot edit dynamic className at line ${elementInfo.devContext.lineNumber}. Only static className strings are supported.`;
              path.stop();
              return;
            }
            
            // Apply the style change
            newClassName = this.applyStyleChange(
              oldClassName,
              request.property,
              request.value,
              request.newStyle
            );
            
            // Update the className attribute (always as string literal)
            classNameAttr.value = t.stringLiteral(newClassName);
            
            // Apply inline styles for properties that use them
            this.applyInlineStyle(openingElement, request.property, request.value, request.newStyle);
            
            // Stop traversing once we find the element
            path.stop();
          }
        }
      });

      if (dynamicClassNameError) {
        return {
          success: false,
          filePath,
          changes: {
            oldClassName: '',
            newClassName: '',
            property: request.property,
            value: request.value
          },
          error: dynamicClassNameError
        };
      }

      if (!elementFound) {
        return {
          success: false,
          filePath,
          changes: {
            oldClassName: '',
            newClassName: '',
            property: request.property,
            value: request.value
          },
          error: `Element not found at line ${enhancedElementInfo.devContext.lineNumber} in ${enhancedElementInfo.devContext.fileName}`
        };
      }

      // Generate the updated code
      const result = generate(ast, {
        retainLines: true,
        compact: false
      });

      // Check if the file content actually changed
      const originalContent = await readFile(filePath, 'utf8');
      const hasChanges = originalContent !== result.code;
      
      if (!hasChanges) {
        console.log(`⚠️ No file changes detected - skipping commit`);
        return {
          success: true,
          filePath,
          changes: {
            oldClassName,
            newClassName,
            property: request.property,
            value: request.value
          },
          diff: 'No changes made'
        };
      }

      // Write the updated file
      await writeFile(filePath, result.code, 'utf-8');

      // Create git commit
      const commitHash = await this.commitChanges(
        appPath,
        filePath,
        request.property,
        request.value,
        enhancedElementInfo
      );

      // Summary log
      const changes = [];
      if (oldClassName !== newClassName) {
        changes.push(`className: "${oldClassName}" → "${newClassName}"`);
      }
      if (request.newStyle) {
        const styleCount = request.newStyle.split(';').filter(s => s.trim()).length;
        changes.push(`${styleCount} inline style(s)`);
      }
      console.log(`✅ Style edit completed: ${changes.join(', ')} | ${commitHash ? 'committed' : 'no commit'}`);

      return {
        success: true,
        filePath,
        changes: {
          oldClassName,
          newClassName,
          property: request.property,
          value: request.value
        },
        diff: this.generateDiff(sourceCode, result.code),
        commitHash
      };

    } catch (error) {
      return {
        success: false,
        filePath: '',
        changes: {
          oldClassName: '',
          newClassName: '',
          property: request.property,
          value: request.value
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check if a JSX element matches the target element info
   */
  private isTargetElement(element: t.JSXElement, elementInfo: ElementInfo): boolean {
    const openingElement = element.openingElement;
    
    // Check tag name
    let tagName = '';
    if (t.isJSXIdentifier(openingElement.name)) {
      tagName = openingElement.name.name.toLowerCase();
      if (tagName !== elementInfo.tagName.toLowerCase()) {
        return false;
      }
    } else {
      return false;
    }
    
    // Check line number (approximate match within a few lines)
    const elementLine = element.loc?.start.line;
    if (elementLine && Math.abs(elementLine - elementInfo.devContext.lineNumber) > 3) {
      return false;
    }
    
    console.log(`    ✅ Target element found: ${tagName} at line ${elementLine}`);
    
    // Check className if present
    const classNameAttr = openingElement.attributes.find(
      attr => t.isJSXAttribute(attr) && attr.name.name === 'className'
    ) as t.JSXAttribute | undefined;
    
    if (classNameAttr && elementInfo.className.trim()) {
      let currentClassName = '';
      
      if (t.isStringLiteral(classNameAttr.value)) {
        currentClassName = classNameAttr.value.value;
      } else if (t.isJSXExpressionContainer(classNameAttr.value) && 
                t.isStringLiteral(classNameAttr.value.expression)) {
        currentClassName = classNameAttr.value.expression.value;
      } else if (t.isJSXExpressionContainer(classNameAttr.value)) {
        // This is a dynamic className (template literal, expression, etc.)
        // We can't easily edit these, so return false unless it's a very specific match
        return false;
      }
      
      // Check if class names have significant overlap
      const currentClasses = new Set(currentClassName.split(/\s+/).filter(Boolean));
      const targetClasses = new Set(elementInfo.className.split(/\s+/).filter(Boolean));
      
      // Calculate intersection
      const intersection = new Set([...currentClasses].filter(x => targetClasses.has(x)));
      
      // Require at least 50% overlap or exact match
      if (intersection.size === 0 && currentClasses.size > 0 && targetClasses.size > 0) {
        return false;
      }
    }
    
    // Check data-id if present
    const dataIdAttr = openingElement.attributes.find(
      attr => t.isJSXAttribute(attr) && attr.name.name === 'data-id'
    ) as t.JSXAttribute | undefined;
    
    if (dataIdAttr && elementInfo.dataId) {
      let currentDataId = '';
      if (t.isStringLiteral(dataIdAttr.value)) {
        currentDataId = dataIdAttr.value.value;
      }
      
      if (currentDataId === elementInfo.dataId) {
        return true; // Exact match on data-id
      }
    }
    
    return true; // If we've passed all checks, consider it a match
  }

  /**
   * Apply inline styles to JSX element for properties that use them
   */
  private applyInlineStyle(
    openingElement: t.JSXOpeningElement,
    property: string,
    value: string,
    newStyle?: string
  ): void {
    // Only apply inline styles if we have them
    if (!newStyle && !['color', 'backgroundColor', 'fontWeight', 'fontStyle'].includes(property)) {
      return;
    }
    
    // Find existing style attribute
    let styleAttr = openingElement.attributes.find(
      (attr: any) => t.isJSXAttribute(attr) && attr.name.name === 'style'
    ) as t.JSXAttribute | undefined;
    
    // Parse existing styles or create new object
    let styleProperties: Record<string, string> = {};
    
    if (styleAttr && t.isJSXExpressionContainer(styleAttr.value)) {
      const expr = styleAttr.value.expression;
      if (t.isObjectExpression(expr)) {
        // Parse existing style object
        expr.properties.forEach((prop: any) => {
          if (t.isObjectProperty(prop) && 
              (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key)) &&
              t.isStringLiteral(prop.value)) {
            const key = t.isStringLiteral(prop.key) ? prop.key.value : prop.key.name;
            styleProperties[key] = prop.value.value;
          }
        });
      }
    }
    
    // Parse the full newStyle string if provided
    if (newStyle) {
      const parsedStyles = this.parseInlineStyles(newStyle);
      // Merge parsed styles into styleProperties
      Object.assign(styleProperties, parsedStyles);
      console.log(`    🎨 Applied inline styles: ${Object.keys(parsedStyles).join(', ')}`);
    } else {
      // Fallback: apply single property
      const cssPropertyMap: Record<string, string> = {
        'color': 'color',
        'backgroundColor': 'backgroundColor', 
        'fontWeight': 'fontWeight',
        'fontStyle': 'fontStyle'
      };
      
      const reactProperty = cssPropertyMap[property];
      if (reactProperty) {
        styleProperties[reactProperty] = value;
        console.log(`    🎨 Applied inline style: ${reactProperty}`);
      }
    }
    
    // Create new style object expression
    const styleObjectProperties = Object.entries(styleProperties).map(([key, val]) =>
      t.objectProperty(t.identifier(key), t.stringLiteral(val))
    );
    
    const newStyleExpr = t.objectExpression(styleObjectProperties);
    
    if (styleAttr) {
      // Update existing style attribute
      styleAttr.value = t.jsxExpressionContainer(newStyleExpr);
    } else {
      // Create new style attribute
      const newStyleAttr = t.jsxAttribute(
        t.jsxIdentifier('style'),
        t.jsxExpressionContainer(newStyleExpr)
      );
      openingElement.attributes.push(newStyleAttr);
    }
  }

  /**
   * Parse CSS style string into React style object
   */
  private parseInlineStyles(styleString: string): Record<string, string> {
    const styles: Record<string, string> = {};
    
    // Split by semicolons and process each declaration
    const declarations = styleString.split(';').filter(decl => decl.trim());
    
    for (const declaration of declarations) {
      const [property, value] = declaration.split(':').map(s => s.trim());
      if (property && value) {
        // Convert CSS property names to React camelCase
        const reactProperty = this.cssToReactProperty(property);
        styles[reactProperty] = value;
      }
    }
    
    return styles;
  }

  /**
   * Convert CSS property names to React camelCase property names
   */
  private cssToReactProperty(cssProperty: string): string {
    // Handle common CSS to React property mappings
    const propertyMap: Record<string, string> = {
      'font-weight': 'fontWeight',
      'font-style': 'fontStyle',
      'font-size': 'fontSize',
      'background-color': 'backgroundColor',
      'border-color': 'borderColor',
      'border-width': 'borderWidth',
      'border-radius': 'borderRadius',
      'margin-top': 'marginTop',
      'margin-bottom': 'marginBottom',
      'margin-left': 'marginLeft',
      'margin-right': 'marginRight',
      'padding-top': 'paddingTop',
      'padding-bottom': 'paddingBottom',
      'padding-left': 'paddingLeft',
      'padding-right': 'paddingRight',
      'text-align': 'textAlign',
      'line-height': 'lineHeight'
    };
    
    return propertyMap[cssProperty] || cssProperty;
  }

  /**
   * Apply a style change to a className string
   */
  private applyStyleChange(
    currentClassName: string,
    property: string,
    value: string,
    newStyle?: string
  ): string {
    const classes = currentClassName.split(/\s+/).filter(Boolean);
    
    switch (property) {
      case 'fontSize':
        // Replace existing font size classes while maintaining order
        const fontSizePattern = /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl)$/;
        let replacedFontSize = false;
        const updatedClasses = classes.map(c => {
          if (fontSizePattern.test(c)) {
            replacedFontSize = true;
            return value && value.startsWith('text-') ? value : '';
          }
          return c;
        }).filter(Boolean);
        
        // If no existing font size class was found, add the new one at the beginning
        if (!replacedFontSize && value && value.startsWith('text-')) {
          updatedClasses.unshift(value);
        }
        return updatedClasses.join(' ');
        
      case 'fontWeight':
        // For font weight, we rely on inline styles now, so no className changes needed
        return currentClassName;
        
      case 'fontStyle':
        // For font style (italic), we rely on inline styles now, so no className changes needed
        return currentClassName;
        
      case 'color':
        // Remove existing text color classes (including responsive and state variants)
        const filteredColor = classes.filter(c => !c.match(/^(\w+:)*text-\w+-\d+$/));
        // We now use inline styles for colors, so don't add Tailwind classes
        return filteredColor.join(' ');
        
      case 'backgroundColor':
        // Remove existing background color classes
        const filteredBg = classes.filter(c => !c.match(/^bg-\w+-\d+$/) && c !== 'bg-transparent');
        // We now use inline styles for background colors, so don't add Tailwind classes
        return filteredBg.join(' ');
        
      case 'marginBottom':
        // Remove existing margin bottom classes
        const filteredMb = classes.filter(c => !c.startsWith('mb-'));
        if (value && value.startsWith('mb-')) {
          filteredMb.push(value);
        }
        return filteredMb.join(' ');
        
      case 'padding':
        // Remove existing padding classes
        const filteredP = classes.filter(c => !c.startsWith('p-'));
        if (value && value.startsWith('p-')) {
          filteredP.push(value);
        }
        return filteredP.join(' ');
        
      default:
        return currentClassName;
    }
  }

  /**
   * Generate a simple diff between old and new content
   */
  private generateDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    const diff: string[] = [];
    const maxLines = Math.max(oldLines.length, newLines.length);
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';
      
      if (oldLine !== newLine) {
        if (oldLine) {
          diff.push(`- ${oldLine}`);
        }
        if (newLine) {
          diff.push(`+ ${newLine}`);
        }
      }
    }
    
    return diff.join('\n');
  }

  /**
   * Commit changes to git
   */
  private async commitChanges(
    appPath: string,
    filePath: string,
    property: string,
    value: string,
    elementInfo: ElementInfo
  ): Promise<string | undefined> {
    try {
      const relativePath = relative(appPath, filePath);
      
      // Add the file to git
      await this.gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: [relativePath]
      });
      
      // Create commit message
      const commitMessage = `Update ${elementInfo.tagName} ${property} to ${value} in ${elementInfo.devContext.componentName}`;
      
      // Commit the changes
      const commitResult = await this.gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: commitMessage
      });
      
      if (!commitResult.success) {
        console.warn('Failed to commit:', commitResult.error || 'Unknown error');
        return undefined;
      }
      
      // Get the last commit to retrieve the hash
      const logResult = await this.gitTool.executeGitOperation(appPath, {
        operation: 'log',
        options: { count: 1 }
      });
      
      if (logResult.success && logResult.commits && logResult.commits.length > 0) {
        return logResult.commits[0]?.hash;
      }
      
      return undefined;
    } catch (error) {
      console.warn('Failed to commit style changes:', error);
      return undefined;
    }
  }

  /**
   * Resolve file path safely within the app directory
   */
  private resolveFilePath(appPath: string, relativePath: string): string {
    const normalizedPath = translateDockerPath(relativePath);
    const resolved = resolve(appPath, normalizedPath);
    
    // Ensure the file is within the app directory
    if (!resolved.startsWith(appPath)) {
      throw new Error(`File path must be within the app directory. Resolved: ${resolved}, App path: ${appPath}`);
    }
    
    return resolved;
  }
}
