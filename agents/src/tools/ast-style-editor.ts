import * as t from '@babel/types';
import { relative } from 'path';
import { ASTEditorBase, BaseEditContext, BaseEditResult } from './ast-editor-base.js';

export interface StyleEditContext extends BaseEditContext {}

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

export interface StyleEditResult extends BaseEditResult {
  changes: {
    oldClassName: string;
    newClassName: string;
    property: string;
    value: string;
  };
  commitHash?: string | undefined;
}

export class ASTStyleEditor extends ASTEditorBase {
  private lastProcessResult: { 
    oldClassName: string; 
    newClassName: string; 
    property: string; 
    value: string; 
  } | null = null;

  /**
   * Edit element styles using AST parsing and manipulation
   */
  async editElementStyle(
    appPath: string,
    request: StyleEditRequest
  ): Promise<StyleEditResult> {
    const baseResult = await this.editTemplate<StyleEditRequest, StyleEditResult>(
      appPath,
      request,
      (req) => req.elementInfo.devContext.fileName,
      true // Commit style changes
    );

    // Add style-specific data to the result using stored changes
    const changes = this.lastProcessResult || {
            oldClassName: '',
            newClassName: '',
            property: request.property,
            value: request.value
    };

        return {
      ...baseResult,
      changes,
      commitHash: (baseResult as any).commitHash
    };
  }

  /**
   * Check if a JSX element matches the target element info
   */
  protected isTargetElement(element: t.JSXElement, elementInfo: ElementInfo): boolean {
    // Check tag name (using base class helper)
    const tagName = this.getTagName(element);
    if (!tagName || tagName.toLowerCase() !== elementInfo.tagName.toLowerCase()) {
      return false;
    }
    
    // Check line number (using base class helper with tolerance of 3 lines)
    if (!this.isOnTargetLine(element, elementInfo.devContext.lineNumber, 3)) {
      return false;
    }
    
    console.log(`    ✅ Target element found: ${tagName} at line ${element.loc?.start.line}`);
    
    // Check className if present (using base class helper)
    if (elementInfo.className.trim()) {
      const currentClassName = this.getClassName(element);
      
      // Check for dynamic className (can't edit these)
      const openingElement = element.openingElement;
          const classNameAttr = openingElement.attributes.find(
        (attr: any) => this.t.isJSXAttribute(attr) && attr.name.name === 'className'
      ) as t.JSXAttribute | undefined;
      
      if (classNameAttr && this.t.isJSXExpressionContainer(classNameAttr.value) && 
          !this.t.isStringLiteral(classNameAttr.value.expression)) {
        // This is a dynamic className (template literal, expression, etc.)
        return false;
      }
      
      // Check if class names have significant overlap
      const currentClasses = new Set(currentClassName.split(/\s+/).filter(Boolean));
      const targetClasses = new Set(elementInfo.className.split(/\s+/).filter(Boolean));
      
      // Calculate intersection
      const intersection = new Set([...currentClasses].filter(x => targetClasses.has(x)));
      
      // Require at least some overlap
      if (intersection.size === 0 && currentClasses.size > 0 && targetClasses.size > 0) {
        return false;
      }
    }
    
    // Check data-id if present
    const openingElement = element.openingElement;
    const dataIdAttr = openingElement.attributes.find(
      (attr: any) => this.t.isJSXAttribute(attr) && attr.name.name === 'data-id'
    ) as t.JSXAttribute | undefined;
    
    if (dataIdAttr && elementInfo.dataId) {
      let currentDataId = '';
      if (this.t.isStringLiteral(dataIdAttr.value)) {
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
      (attr: any) => this.t.isJSXAttribute(attr) && attr.name.name === 'style'
    ) as t.JSXAttribute | undefined;
    
    // Parse existing styles or create new object
    let styleProperties: Record<string, string> = {};
    
    if (styleAttr && this.t.isJSXExpressionContainer(styleAttr.value)) {
      const expr = styleAttr.value.expression;
      if (this.t.isObjectExpression(expr)) {
        // Parse existing style object
        expr.properties.forEach((prop: any) => {
          if (this.t.isObjectProperty(prop) && 
              (this.t.isStringLiteral(prop.key) || this.t.isIdentifier(prop.key)) &&
              this.t.isStringLiteral(prop.value)) {
            const key = this.t.isStringLiteral(prop.key) ? prop.key.value : prop.key.name;
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
      this.t.objectProperty(this.t.identifier(key), this.t.stringLiteral(val))
    );
    
    const newStyleExpr = this.t.objectExpression(styleObjectProperties);
    
    if (styleAttr) {
      // Update existing style attribute
      styleAttr.value = this.t.jsxExpressionContainer(newStyleExpr);
    } else {
      // Create new style attribute
      const newStyleAttr = this.t.jsxAttribute(
        this.t.jsxIdentifier('style'),
        this.t.jsxExpressionContainer(newStyleExpr)
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
   * Process AST to make style changes (implementation of abstract method)
   */
  protected processAST(ast: t.File, request: StyleEditRequest): {
    success: boolean;
    changes?: { oldClassName: string; newClassName: string; property: string; value: string };
    error?: string;
  } {
    const { elementInfo, selector } = request;
    
    // Parse the CSS selector to get tagName and className if not provided
    const parsedSelector = this.parseCSSSelector(selector);
    
    // Enhance elementInfo with parsed selector data if missing
    const enhancedElementInfo = {
      ...elementInfo,
      tagName: elementInfo.tagName || parsedSelector.tagName,
      className: elementInfo.className || parsedSelector.className
    };
    
    // Find and update the element
    let elementFound = false;
    let oldClassName = '';
    let newClassName = '';
    let dynamicClassNameError: string | null = null;
    
    console.log(`🔍 Starting AST traversal looking for ${enhancedElementInfo.tagName} at line ${enhancedElementInfo.devContext.lineNumber}`);
    this.traverse(ast, {
      JSXElement: (path: any): void => {
        const element = path.node;
        const elementLine = element.loc?.start.line;
        const tagName = this.getTagName(element);
        
        // Log every JSX element we encounter
        if (tagName) {
          console.log(`  - Found JSX element: ${tagName} at line ${elementLine}`);
        }
        
        // Check if this is the target element
        if (this.isTargetElement(element, enhancedElementInfo)) {
          elementFound = true;
          
          // Get the opening element
          const openingElement = element.openingElement;
          
          // Find or create className attribute
          let classNameAttr = openingElement.attributes.find(
            (attr: any) => this.t.isJSXAttribute(attr) && attr.name.name === 'className'
          ) as t.JSXAttribute | undefined;
          
          if (!classNameAttr) {
            // Create new className attribute
            classNameAttr = this.t.jsxAttribute(
              this.t.jsxIdentifier('className'),
              this.t.stringLiteral('')
            );
            openingElement.attributes.push(classNameAttr);
          }
          
          // Get current className value and ensure it's editable
          if (this.t.isStringLiteral(classNameAttr.value)) {
            oldClassName = classNameAttr.value.value;
          } else if (this.t.isJSXExpressionContainer(classNameAttr.value) && 
                    this.t.isStringLiteral(classNameAttr.value.expression)) {
            oldClassName = classNameAttr.value.expression.value;
          } else if (this.t.isJSXExpressionContainer(classNameAttr.value)) {
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
          classNameAttr.value = this.t.stringLiteral(newClassName);
          
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
        error: dynamicClassNameError
      };
    }

    if (!elementFound) {
      return {
        success: false,
        error: `Element not found at line ${enhancedElementInfo.devContext.lineNumber} in ${enhancedElementInfo.devContext.fileName}`
      };
    }

    // Store the changes for later use
    this.lastProcessResult = {
      oldClassName,
      newClassName,
      property: request.property,
      value: request.value
    };

    return {
      success: true,
      changes: { oldClassName, newClassName, property: request.property, value: request.value }
    };
  }

  /**
   * Generate commit message for style changes
   */
  protected generateCommitMessage(changes: any, request: StyleEditRequest): string {
    const { elementInfo } = request;
    return `Update ${elementInfo.tagName} ${request.property} to ${request.value} in ${elementInfo.devContext.componentName}`;
  }

}
