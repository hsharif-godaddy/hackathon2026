import * as t from '@babel/types';
import { ASTEditorBase, BaseEditContext, BaseEditResult } from './ast-editor-base.js';

export interface TextEditContext extends BaseEditContext {}

export interface TextEditRequest {
  selector: string;
  oldText: string;
  newText: string;
  devContext: TextEditContext;
}

export interface TextEditResult extends BaseEditResult {
  oldText: string;
  newText: string;
}

export class ASTTextEditor extends ASTEditorBase {
  private lastProcessResult: { oldText: string; newText: string } | null = null;

  /**
   * Check if a JSX element matches our target criteria
   */
  protected isTargetElement(element: t.JSXElement, targetInfo: { tagName: string; className?: string; lineNumber: number; textContent: string }): boolean {
    // Must be on the correct line (using base class helper)
    if (!this.isOnTargetLine(element, targetInfo.lineNumber)) {
      return false;
    }
    
    // Must have the correct tag name (using base class helper)
    const tagName = this.getTagName(element);
    if (!tagName || tagName !== targetInfo.tagName) {
      return false;
    }
    
    // Check if className matches (if provided)
    if (targetInfo.className) {
      const currentClassName = this.getClassName(element);
      // Check if all classes in targetInfo.className are present
      const targetClasses = targetInfo.className.split(/\s+/).filter(Boolean);
      const currentClasses = currentClassName.split(/\s+/).filter(Boolean);
      
      const hasAllClasses = targetClasses.every(cls => currentClasses.includes(cls));
      if (!hasAllClasses) {
        return false;
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
      if (this.t.isJSXText(child)) {
        textContent += child.value;
      } else if (this.t.isJSXExpressionContainer(child)) {
        if (this.t.isStringLiteral(child.expression)) {
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
      const textNode = this.t.jsxText(newText);
      element.children.push(textNode);
    }
  }

  /**
   * Process AST to make text changes (implementation of abstract method)
   */
  protected processAST(ast: t.File, request: TextEditRequest): {
    success: boolean;
    changes?: { oldText: string; newText: string };
    error?: string;
  } {
    const { selector, oldText, newText, devContext } = request;
    
    console.log(`🖊️ Processing AST for text edit:`, {
      selector,
      oldText: oldText.slice(0, 50),
      newText: newText.slice(0, 50),
      fileName: devContext.fileName,
      lineNumber: devContext.lineNumber
    });
    
    // Parse the CSS selector to get tagName and className
    const parsedSelector = this.parseCSSSelector(selector);
    
    // Find and update the element
    let elementFound = false;
    let actualOldText = '';
    
    console.log(`🔍 Starting AST traversal looking for ${parsedSelector.tagName} at line ${devContext.lineNumber}`);
    
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
          path.stop(); // Stop traversal once element is found and updated
        }
      }
    });

    if (!elementFound) {
      const errorMsg = `Element not found. Selector: ${selector}, Line: ${devContext.lineNumber}, Expected text: "${oldText.slice(0, 50)}..."`;
      console.log(`❌ ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }

    // Store the changes for later use
    this.lastProcessResult = { oldText: actualOldText, newText };

    return {
      success: true,
      changes: { oldText: actualOldText, newText }
    };
  }

  /**
   * Edit element text content using AST parsing and manipulation
   */
  async editElementText(
    appPath: string,
    request: TextEditRequest
  ): Promise<TextEditResult> {
    const baseResult = await this.editTemplate<TextEditRequest, TextEditResult>(
      appPath,
      request,
      (req) => req.devContext.fileName,
      false // Don't commit text changes
    );

    // Add text-specific data to the result using stored changes
    return {
      ...baseResult,
      oldText: this.lastProcessResult?.oldText || request.oldText,
      newText: this.lastProcessResult?.newText || request.newText
    };
  }
}
