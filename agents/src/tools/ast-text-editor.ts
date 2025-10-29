import * as t from '@babel/types';
import { ASTEditorBase, BaseEditContext, BaseEditResult } from './ast-editor-base.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'ast-text-editor' });

export interface TextEditContext extends BaseEditContext {}

export interface TextEditRequest {
  selector: string;
  preciseSelector?: string;
  oldText: string;
  newText: string;
  devContext: TextEditContext;
}

export interface TextEditResult extends BaseEditResult {
  oldText: string;
  newText: string;
  commitHash?: string;
}

/**
 * AST-based text editor for JSX elements
 *
 * Finds JSX elements by line number and updates their text content.
 * Uses a simple matching strategy based on location and text content.
 */
export class ASTTextEditor extends ASTEditorBase {
  private lastProcessResult: { oldText: string; newText: string } | null = null;

  /**
   * Extract occurrence index from precise selector
   *
   * @param preciseSelector - nth-child based selector
   * @returns Occurrence index (0-based) or null
   */
  private extractOccurrenceIndex(preciseSelector?: string): number | null {
    if (!preciseSelector) return null;

    // Extract the last nth-child value from the selector
    // e.g., "div:nth-child(3) > p:nth-child(2)" -> 2
    const matches = preciseSelector.match(/:nth-child\((\d+)\)/g);
    if (!matches || matches.length === 0) return null;

    const lastMatch = matches[matches.length - 1];
    if (!lastMatch) return null;
    
    const index = parseInt(lastMatch.match(/\d+/)?.[0] || '0', 10);
    
    return index > 0 ? index - 1 : null; // Convert to 0-based
  }

  /**
   * Check if a JSX element matches our target criteria
   *
   * @param element - JSX element to check
   * @param targetInfo - Target criteria including line number and expected text
   * @returns True if element matches target criteria
   */
  protected isTargetElement(element: t.JSXElement, targetInfo: { lineNumber: number; textContent: string }): boolean {
    const elementLine = element.loc?.start.line;
    if (!elementLine) {
      return false;
    }

    // Check line number with tolerance
    const lineTolerance = 5;
    if (Math.abs(elementLine - targetInfo.lineNumber) > lineTolerance) {
      return false;
    }

    // Extract and compare text content
    const elementText = this.extractTextContent(element);
    const normalizedElementText = elementText.replace(/\s+/g, ' ').trim();
    const normalizedTargetText = targetInfo.textContent.replace(/\s+/g, ' ').trim();

    // Match if target text is a prefix of element text (handles truncated oldText)
    return normalizedElementText.startsWith(normalizedTargetText) || 
           normalizedElementText === normalizedTargetText;
  }

  /**
   * Extract text content from a JSX element
   *
   * @param element - JSX element to extract text from
   * @returns Extracted text content
   */
  private extractTextContent(element: t.JSXElement): string {
    let textContent = '';

    for (const child of element.children) {
      if (this.t.isJSXText(child)) {
        textContent += child.value;
      } else if (this.t.isJSXExpressionContainer(child)) {
        if (this.t.isStringLiteral(child.expression)) {
          textContent += child.expression.value;
        } else if (this.t.isTemplateLiteral(child.expression)) {
          textContent += child.expression.quasis.map(q => q.value.raw).join('');
        }
      }
    }

    return textContent.replace(/\s+/g, ' ').trim();
  }

  /**
   * Update text content in a JSX element
   *
   * @param element - JSX element to update
   * @param newText - New text content
   */
  private updateTextContent(element: t.JSXElement, newText: string): void {
    element.children = [];

    if (newText.trim()) {
      element.children.push(this.t.jsxText(newText));
    }
  }

  /**
   * Process AST to make text changes
   *
   * @param ast - Parsed AST
   * @param request - Text edit request
   * @returns Processing result with success status and changes
   */
  protected processAST(ast: t.File, request: TextEditRequest): {
    success: boolean;
    changes?: { oldText: string; newText: string };
    error?: string;
  } {
    const { oldText, newText, devContext, preciseSelector } = request;

    const targetOccurrenceIndex = this.extractOccurrenceIndex(preciseSelector);

    logger.debug('ast.text-editor.process', {
      fileName: devContext.fileName,
      lineNumber: devContext.lineNumber,
      oldTextLength: oldText.length,
      newTextLength: newText.length,
      targetOccurrenceIndex,
      hasPreciseSelector: !!preciseSelector
    });

    let elementFound = false;
    let actualOldText = '';
    const candidates: Array<{ element: t.JSXElement; line: number; text: string }> = [];

    // First pass: collect all JSX elements near the target line
    this.traverse(ast, {
      JSXElement: (path: any): void => {
        const element = path.node as t.JSXElement;
        const elementLine = element.loc?.start.line;

        if (elementLine) {
          const text = this.extractTextContent(element);
          candidates.push({ element, line: elementLine, text });

          logger.debug('ast.text-editor.candidate', {
            line: elementLine,
            text: text.slice(0, 50)
          });
        }
      }
    });

    // Find matches prioritizing text content over line number
    const normalizedOldText = oldText.replace(/\s+/g, ' ').trim();
    const exactMatches: Array<{ element: t.JSXElement; line: number; score: number }> = [];
    let bestMatch: { element: t.JSXElement; score: number; matchType: string } | null = null;

    for (const candidate of candidates) {
      const lineDiff = Math.abs(candidate.line - devContext.lineNumber);
      const normalizedCandidateText = candidate.text.replace(/\s+/g, ' ').trim();

      // Skip candidates too far from target line (unless exact text match)
      if (lineDiff > 10 && normalizedCandidateText !== normalizedOldText) {
        continue;
      }

      let score = 0;
      let matchType = 'no-match';

      // Text matching (highest priority)
      if (normalizedCandidateText === normalizedOldText) {
        score += 10000; // Exact text match dominates
        matchType = 'exact-text';
        
        // Track exact matches for occurrence-based selection
        exactMatches.push({ element: candidate.element, line: candidate.line, score });
      } else if (normalizedCandidateText.includes(normalizedOldText)) {
        score += 5000; // Contains target text
        matchType = 'contains-text';
      } else if (normalizedOldText.includes(normalizedCandidateText)) {
        score += 2500; // Target contains element text (partial)
        matchType = 'partial-text';
      }

      // Line proximity (secondary factor, small weight)
      if (lineDiff === 0) {
        score += 100; // Same line
      } else if (lineDiff <= 2) {
        score += 50; // Very close
      } else if (lineDiff <= 5) {
        score += 10; // Nearby
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { element: candidate.element, score, matchType };
      }
    }

    // Handle multiple exact matches using occurrence index
    let targetElement: t.JSXElement | null = null;
    
    if (exactMatches.length > 1 && targetOccurrenceIndex !== null) {
      // Multiple exact matches - use occurrence index to select the right one
      logger.debug('ast.text-editor.multiple-matches', {
        matchCount: exactMatches.length,
        targetOccurrenceIndex,
        selecting: `match ${targetOccurrenceIndex + 1} of ${exactMatches.length}`
      });
      
      if (targetOccurrenceIndex < exactMatches.length) {
        const matchedElement = exactMatches[targetOccurrenceIndex];
        if (matchedElement) {
          targetElement = matchedElement.element;
          elementFound = true;
        }
      } else {
        logger.warn('ast.text-editor.occurrence-out-of-bounds', {
          targetOccurrenceIndex,
          matchCount: exactMatches.length
        });
      }
    } else if (bestMatch && bestMatch.score >= 2500) {
      // Single best match or no occurrence index provided
      targetElement = bestMatch.element;
      elementFound = true;
    }

    // Update the target element if found
    if (elementFound && targetElement) {
      actualOldText = this.extractTextContent(targetElement);
      this.updateTextContent(targetElement, newText);

      logger.debug('ast.text-editor.updated', {
        matchScore: bestMatch?.score,
        matchType: bestMatch?.matchType,
        exactMatchCount: exactMatches.length,
        usedOccurrenceIndex: exactMatches.length > 1 && targetOccurrenceIndex !== null,
        oldText: actualOldText.slice(0, 80),
        newText: newText.slice(0, 80)
      });
    }

    if (!elementFound) {
      logger.warn('ast.text-editor.not-found', {
        lineNumber: devContext.lineNumber,
        candidatesCount: candidates.length,
        bestScore: bestMatch?.score,
        bestMatchType: bestMatch?.matchType,
        expectedText: normalizedOldText.slice(0, 80)
      });

      return {
        success: false,
        error: `No element found with matching text content at line ${devContext.lineNumber}`
      };
    }

    this.lastProcessResult = { oldText: actualOldText, newText };

    return {
      success: true,
      changes: { oldText: actualOldText, newText }
    };
  }

  /**
   * Generate commit message for text changes
   *
   * @param changes - Changes made
   * @param request - Original request
   * @returns Commit message
   */
  protected generateCommitMessage(changes: any, request: TextEditRequest): string {
    return `Update text in ${request.devContext.componentName || 'component'}`;
  }

  /**
   * Edit element text content using AST parsing and manipulation
   *
   * @param appPath - Path to the app directory
   * @param request - Text edit request
   * @returns Text edit result with old and new text
   */
  async editElementText(appPath: string, request: TextEditRequest): Promise<TextEditResult> {
    const baseResult = await this.editTemplate<TextEditRequest, TextEditResult>(
      appPath,
      request,
      (req) => req.devContext.fileName,
      true
    );

    return {
      ...baseResult,
      oldText: this.lastProcessResult?.oldText || request.oldText,
      newText: this.lastProcessResult?.newText || request.newText
    };
  }
}
