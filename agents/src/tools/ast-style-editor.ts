import * as t from '@babel/types';
import { ASTEditorBase, BaseEditContext, BaseEditResult } from './ast-editor-base.js';
import { logger } from '../logging/index.js';

export type StyleEditContext = BaseEditContext;

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
      true, // Commit style changes
      'style' // editType
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
    // Highest confidence: match on stable structural ID
    if (elementInfo.dataId) {
      const devId = this.getDevId(element);
      if (devId && devId === elementInfo.dataId) {
        return true;
      }
    }

    // Check tag name — handle member expressions (motion.h1 → h1) since DOM only reports the base tag
    let baseTag = this.getTagName(element);
    if (!baseTag) {
      const name = element.openingElement.name;
      if (this.t.isJSXMemberExpression(name) && this.t.isJSXIdentifier(name.property)) {
        baseTag = name.property.name;
      }
    }
    if (!baseTag || baseTag.toLowerCase() !== elementInfo.tagName.toLowerCase()) {
      return false;
    }

    // Check line number (using base class helper with tolerance of 3 lines)
    if (!this.isOnTargetLine(element, elementInfo.devContext.lineNumber, 3)) {
      return false;
    }

    logger.debug('Target element found for AST style edit', {
      component: 'ASTStyleEditor',
      tagName: baseTag,
      line: element.loc?.start.line
    });

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
    // Only apply inline styles for color properties; fontWeight/fontStyle use className
    if (!newStyle && !['color', 'backgroundColor'].includes(property)) {
      return;
    }

    // Find existing style attribute
    const styleAttr = openingElement.attributes.find(
      (attr: any) => this.t.isJSXAttribute(attr) && attr.name.name === 'style'
    ) as t.JSXAttribute | undefined;

    // Parse existing styles or create new object
    const styleProperties: Record<string, string> = {};

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
      logger.debug('Applied inline styles to element', {
        component: 'ASTStyleEditor',
        styleProperties: Object.keys(parsedStyles)
      });
    } else {
      // Fallback: apply single property
      const cssPropertyMap: Record<string, string> = {
        'color': 'color',
        'backgroundColor': 'backgroundColor',
      };

      const reactProperty = cssPropertyMap[property];
      if (reactProperty) {
        styleProperties[reactProperty] = value;
        logger.debug('Applied inline style property to element', {
          component: 'ASTStyleEditor',
          property: reactProperty,
          value
        });
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
    value: string
  ): string {
    const classes = currentClassName.split(/\s+/).filter(Boolean);

    switch (property) {
      case 'fontSize': {
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
      }

      case 'fontWeight': {
        const filtered = classes.filter(c => c !== 'font-bold' && c !== 'font-normal');
        if (value === 'bold') {
          filtered.push('font-bold');
        }
        return filtered.join(' ');
      }

      case 'fontStyle': {
        const filtered = classes.filter(c => c !== 'italic' && c !== 'not-italic');
        if (value === 'italic') {
          filtered.push('italic');
        }
        return filtered.join(' ');
      }

      case 'textAlign': {
        const alignmentPattern = /^text-(left|center|right|justify)$/;
        const filtered = classes.filter(className => !alignmentPattern.test(className));

        if (value && alignmentPattern.test(`text-${value}`)) {
          filtered.push(`text-${value}`);
        }
        return filtered.join(' ');
      }

      case 'color': {
        // Remove existing text color classes (including responsive and state variants)
        const filteredColor = classes.filter(c => !c.match(/^(\w+:)*text-\w+-\d+$/));
        // We now use inline styles for colors, so don't add Tailwind classes
        return filteredColor.join(' ');
      }

      case 'backgroundColor': {
        // Remove existing background color classes
        const filteredBg = classes.filter(c => !c.match(/^bg-\w+-\d+$/) && c !== 'bg-transparent');
        // We now use inline styles for background colors, so don't add Tailwind classes
        return filteredBg.join(' ');
      }

      case 'marginBottom': {
        // Remove existing margin bottom classes
        const filteredMb = classes.filter(c => !c.startsWith('mb-'));
        if (value && value.startsWith('mb-')) {
          filteredMb.push(value);
        }
        return filteredMb.join(' ');
      }

      case 'padding': {
        // Remove existing padding classes
        const filteredP = classes.filter(c => !c.startsWith('p-'));
        if (value && value.startsWith('p-')) {
          filteredP.push(value);
        }
        return filteredP.join(' ');
      }

      default:
        return currentClassName;
    }
  }

  /**
   * Unwrap inline formatting elements when the parent gets the equivalent CSS class.
   * e.g., adding `italic` to parent → unwrap <em>/<i> children (replace with their contents).
   * Only runs when ADDING formatting, not when removing.
   */
  private normalizeInlineFormattingChildren(
    element: t.JSXElement,
    property: string,
    value: string
  ): void {
    const tagsToUnwrap: string[] = [];
    if (property === 'fontWeight' && value === 'bold') {
      tagsToUnwrap.push('strong', 'b');
    } else if (property === 'fontStyle' && value === 'italic') {
      tagsToUnwrap.push('em', 'i');
    }
    if (tagsToUnwrap.length === 0) return;

    const newChildren: typeof element.children = [];
    for (const child of element.children) {
      if (
        this.t.isJSXElement(child) &&
        this.t.isJSXIdentifier(child.openingElement.name) &&
        tagsToUnwrap.includes(child.openingElement.name.name)
      ) {
        // Replace the formatting element with its children
        newChildren.push(...child.children);
      } else {
        newChildren.push(child);
      }
    }
    element.children = newChildren;
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

    logger.debug('Starting AST traversal for style edit', {
      component: 'ASTStyleEditor',
      targetTagName: enhancedElementInfo.tagName,
      targetLine: enhancedElementInfo.devContext.lineNumber,
      selector
    });

    this.traverse(ast, {
      JSXElement: (path: any): void => {
        const element = path.node;
        const elementLine = element.loc?.start.line;
        const tagName = this.getTagName(element);

        // Log every JSX element we encounter (debug level)
        if (tagName) {
          logger.debug('Found JSX element during traversal', {
            component: 'ASTStyleEditor',
            tagName,
            line: elementLine
          });
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
            request.value
          );

          // Update the className attribute (always as string literal)
          classNameAttr.value = this.t.stringLiteral(newClassName);

          // Normalize inline formatting children when adding bold/italic
          this.normalizeInlineFormattingChildren(element, request.property, request.value);

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
      logger.warn('ast.style-editor.not-found', {
        fileName: enhancedElementInfo.devContext.fileName,
        lineNumber: enhancedElementInfo.devContext.lineNumber,
        componentName: enhancedElementInfo.devContext.componentName,
        tagName: enhancedElementInfo.tagName,
        className: enhancedElementInfo.className?.substring(0, 200),
        selector: selector?.substring(0, 200),
        property: request.property,
        value: request.value?.substring(0, 200),
      });
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
