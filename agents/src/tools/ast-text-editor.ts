import * as t from '@babel/types';
import { parse } from '@babel/parser';
import { ASTEditorBase, BaseEditContext, BaseEditResult } from './ast-editor-base.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ component: 'ast-text-editor' });

const UNSUPPORTED_DYNAMIC_TEXT_CONTENT = 'UNSUPPORTED_DYNAMIC_TEXT_CONTENT';

const TEXT_CONTAINER_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'figcaption', 'pre', 'label',
]);

export type TextEditContext = BaseEditContext;

export interface TextEditRequest {
  selector: string;
  preciseSelector?: string;
  oldText: string;
  newText: string;
  newHtml?: string;
  devContext: TextEditContext;
}

export interface TextEditResult extends BaseEditResult {
  oldText: string;
  newText: string;
  code?: typeof UNSUPPORTED_DYNAMIC_TEXT_CONTENT;
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
  public lastDiagnostics: {
    candidatesCount: number;
    bestScore?: number;
    bestMatchType?: string;
    nearbyCandidates: Array<{ line: number; text: string }>;
  } | null = null;

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
  protected isTargetElement(element: t.JSXElement, targetInfo: { lineNumber: number; textContent: string; devId?: string }): boolean {
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
   * Check if an element has any JSXElement children (not just text/expressions)
   */
  private hasElementChildren(element: t.JSXElement): boolean {
    return element.children.some(child => this.t.isJSXElement(child));
  }

  private isStaticTextExpression(expression: t.Expression | t.JSXEmptyExpression): boolean {
    return this.t.isJSXEmptyExpression(expression) ||
      this.t.isStringLiteral(expression) ||
      (this.t.isTemplateLiteral(expression) && expression.expressions.length === 0);
  }

  private hasUnsupportedDynamicTextExpression(element: t.JSXElement): boolean {
    return element.children.some(child =>
      this.t.isJSXExpressionContainer(child) &&
      !this.isStaticTextExpression(child.expression)
    );
  }

  /**
   * Recursively extract ALL text content from a JSX element, including
   * text inside child JSXElements. This mirrors what the browser's
   * `textContent` property returns.
   */
  private extractFullTextContent(element: t.JSXElement): string {
    let text = '';
    for (const child of element.children) {
      if (this.t.isJSXText(child)) {
        text += child.value;
      } else if (this.t.isJSXExpressionContainer(child)) {
        if (this.t.isStringLiteral(child.expression)) {
          text += child.expression.value;
        } else if (this.t.isTemplateLiteral(child.expression)) {
          text += child.expression.quasis.map(q => q.value.raw).join('');
        }
      } else if (this.t.isJSXElement(child)) {
        text += this.extractFullTextContent(child);
      }
    }
    return text;
  }

  // ── Dev-ID computation (mirrors source-mapper's DJB2 hash) ──

  private hashStructuralKey(key: string): string {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) + key.charCodeAt(i);
      hash |= 0;
    }
    return (hash >>> 0).toString(16).slice(-6).padStart(6, '0');
  }

  private getFullTagName(element: t.JSXElement): string {
    const name = element.openingElement.name;
    if (t.isJSXIdentifier(name)) return name.name;
    if (t.isJSXMemberExpression(name)) {
      const parts: string[] = [];
      let cur: t.JSXMemberExpression | t.JSXIdentifier = name;
      while (t.isMemberExpression(cur) || t.isJSXMemberExpression(cur)) {
        if (t.isJSXMemberExpression(cur)) {
          parts.unshift(cur.property.name);
          cur = cur.object;
        } else break;
      }
      if (t.isJSXIdentifier(cur)) parts.unshift(cur.name);
      return parts.join('.');
    }
    if (t.isJSXNamespacedName(name)) {
      return `${name.namespace.name}:${name.name.name}`;
    }
    return 'unknown';
  }

  private computeDevIds(ast: t.File, fileName: string): Map<t.JSXElement, string> {
    const devIds = new Map<t.JSXElement, string>();
    const normalizedFile = this.normalizeFileName(fileName);

    // Mirror source-mapper's stack-based counter. Each frame represents a
    // JSXElement ancestor and tracks how many same-tag children have been
    // entered beneath it (including those inside expression wrappers).
    const ancestorStack: Array<{ tagName: string; ownIndex: number; sameTagChildCount: Map<string, number> }> = [];

    this.traverse(ast, {
      JSXElement: {
        enter: (path: any): void => {
          const node = path.node as t.JSXElement;
          const tagName = this.getFullTagName(node);

          const parentFrame = ancestorStack[ancestorStack.length - 1];
          let siblingIndex = 0;
          if (parentFrame) {
            siblingIndex = parentFrame.sameTagChildCount.get(tagName) || 0;
            parentFrame.sameTagChildCount.set(tagName, siblingIndex + 1);
          }

          ancestorStack.push({ tagName, ownIndex: siblingIndex, sameTagChildCount: new Map() });

          const ancestorChain = ancestorStack.slice(0, -1).map(f => `${f.tagName}#${f.ownIndex}`).join('>');
          const structuralKey = `${normalizedFile}:${ancestorChain}${ancestorChain ? '>' : ''}${tagName}#${siblingIndex}`;
          devIds.set(node, this.hashStructuralKey(structuralKey));
        },
        exit: (): void => {
          ancestorStack.pop();
        },
      },
    });

    return devIds;
  }

  private normalizeFileName(raw: string): string {
    const normalized = raw.replace(/\\/g, '/');
    const srcIdx = normalized.indexOf('/src/');
    if (srcIdx !== -1) return normalized.slice(srcIdx + 1);
    const appIdx = normalized.indexOf('/app/');
    if (appIdx !== -1) return normalized.slice(appIdx + 1);
    return normalized;
  }

  /**
   * Parse a JSX children string into AST nodes. Used by the newHtml path
   * to replace element children with structured content (preserving <br /> etc).
   */
  private parseJsxChildren(jsxString: string): t.JSXElement['children'] | null {
    try {
      const code = `const _x = <>${jsxString}</>`;
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'typescript'],
      });
      const decl = ast.program.body[0];
      if (!t.isVariableDeclaration(decl)) return null;
      const init = decl.declarations[0]?.init;
      if (!t.isJSXFragment(init)) return null;
      return init.children;
    } catch (err) {
      logger.warn('ast.text-editor.parse-jsx-children.failed', {
        error: err instanceof Error ? err.message : String(err),
        jsxString: jsxString.slice(0, 200),
      });
      return null;
    }
  }

  /**
   * Update text content in a JSX element.
   *
   * When the element has child JSXElements (e.g. styled spans), the browser
   * may send newText that includes the child element text (because textContent
   * is recursive). We split newText around child element text anchors and only
   * assign the non-child portions to JSXText/expression nodes, preventing
   * duplication.
   *
   * When it has only text/expression children, replace everything (simple case).
   */
  private updateTextContent(element: t.JSXElement, newText: string): void {
    if (!this.hasElementChildren(element)) {
      // Simple case: no child elements, safe to replace everything
      element.children = [];
      if (newText.trim()) {
        element.children.push(this.t.jsxText(newText));
      }
      return;
    }

    // Complex case: has child JSXElements.
    // Collect child element texts as ordered anchors.
    const childElementAnchors: string[] = [];
    for (const child of element.children) {
      if (this.t.isJSXElement(child)) {
        const text = this.extractFullTextContent(child).replace(/\s+/g, ' ').trim();
        if (text) childElementAnchors.push(text);
      }
    }

    const normalizedNew = newText.replace(/\s+/g, ' ').trim();

    // Try to split newText around child element text anchors.
    // This handles the case where the browser sends full textContent (recursive)
    // as newText — we need to strip the child element portions to avoid duplication.
    let remaining = normalizedNew;
    const textBetween: string[] = [];
    let splitOk = true;

    for (const anchor of childElementAnchors) {
      const idx = remaining.indexOf(anchor);
      if (idx === -1) { splitOk = false; break; }
      textBetween.push(remaining.substring(0, idx));
      remaining = remaining.substring(idx + anchor.length);
    }
    if (splitOk) textBetween.push(remaining);

    if (splitOk && childElementAnchors.length > 0) {
      // Successfully split. Group text/expression children by position
      // relative to text-bearing child JSXElements, then assign each segment.
      // Only text-bearing elements (those in childElementAnchors) act as group
      // boundaries — void elements like <br/>, <img/> are treated as regular
      // children within their group.
      const anchorSet = new Set(childElementAnchors);
      const groups: number[][] = [[]];
      let groupIdx = 0;

      for (let i = 0; i < element.children.length; i++) {
        const child = element.children[i];
        if (!child) continue;
        if (this.t.isJSXElement(child)) {
          const childText = this.extractFullTextContent(child).replace(/\s+/g, ' ').trim();
          if (anchorSet.has(childText)) {
            groupIdx++;
            groups[groupIdx] = [];
          }
          // Void/empty JSXElements stay in current group (not a boundary)
        } else {
          groups[groupIdx]!.push(i);
        }
      }

      for (let g = 0; g < groups.length && g < textBetween.length; g++) {
        const group = groups[g]!;
        const segText = textBetween[g] || '';
        let assigned = false;

        for (const childIdx of group) {
          const child = element.children[childIdx];
          if (!child) continue;

          if (this.t.isJSXText(child)) {
            if (!assigned) {
              child.value = segText;
              assigned = true;
            } else {
              child.value = '';
            }
          }
          // Leave expression containers ({' '} etc.) untouched
        }
      }
      return;
    }

    // Fallback: couldn't split around child element texts (child text was
    // also edited, or no child element anchors). Put newText in the first
    // substantial text node, clear the rest.
    let updated = false;
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      if (!child) continue;

      if (this.t.isJSXText(child)) {
        const trimmed = child.value.replace(/\s+/g, ' ').trim();
        if (trimmed.length === 0) continue;
        if (!updated) {
          child.value = newText;
          updated = true;
        } else {
          child.value = '';
        }
      } else if (this.t.isJSXExpressionContainer(child) &&
                 this.t.isStringLiteral(child.expression)) {
        const trimmed = child.expression.value.replace(/\s+/g, ' ').trim();
        if (trimmed.length === 0) continue;
        if (!updated) {
          child.expression.value = newText;
          updated = true;
        }
      }
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
    code?: typeof UNSUPPORTED_DYNAMIC_TEXT_CONTENT;
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
    const candidates: Array<{ element: t.JSXElement; line: number; text: string; isWrapper: boolean; isTextContainer: boolean }> = [];

    this.traverse(ast, {
      JSXElement: (path: any): void => {
        const element = path.node as t.JSXElement;
        const elementLine = element.loc?.start.line;

        if (elementLine) {
          const shallowText = this.extractTextContent(element);
          const elementChildCount = element.children.filter(c => this.t.isJSXElement(c)).length;
          const baseTag = this.getFullTagName(element).split('.').pop()!.toLowerCase();
          const isTextContainer = TEXT_CONTAINER_TAGS.has(baseTag);
          const isWrapper = shallowText.length === 0 && (
            elementChildCount >= 2 || (elementChildCount === 1 && isTextContainer)
          );
          const text = isWrapper
            ? this.extractFullTextContent(element).replace(/\s+/g, ' ').trim()
            : shallowText;
          candidates.push({ element, line: elementLine, text, isWrapper, isTextContainer });

          logger.debug('ast.text-editor.candidate', {
            line: elementLine,
            text: text.slice(0, 50),
            isWrapper,
            isTextContainer,
          });
        }
      }
    });

    // Compute structural dev-ids for all elements (mirrors source-mapper's hash)
    const devIdMap = devContext.devId
      ? this.computeDevIds(ast, devContext.fileName)
      : null;

    if (devContext.devId && devIdMap) {
      const dynamicTarget = candidates.find(candidate =>
        (devIdMap.get(candidate.element) ?? this.getDevId(candidate.element)) === devContext.devId &&
        this.hasUnsupportedDynamicTextExpression(candidate.element)
      );
      if (dynamicTarget) {
        return {
          success: false,
          error: 'Unsupported dynamic text content',
          code: UNSUPPORTED_DYNAMIC_TEXT_CONTENT,
        };
      }
    }

    // Find matches prioritizing text content over line number
    const normalizedOldText = oldText.replace(/\s+/g, ' ').trim();
    const exactMatches: Array<{ element: t.JSXElement; line: number; score: number }> = [];
    let bestMatch: { element: t.JSXElement; score: number; matchType: string } | null = null;

    for (const candidate of candidates) {
      const lineDiff = Math.abs(candidate.line - devContext.lineNumber);
      const normalizedCandidateText = candidate.text.replace(/\s+/g, ' ').trim();

      // Skip empty-text elements — they are containers, never valid edit targets.
      // Without this guard, any string "includes" empty string, causing container
      // divs to match via partial-text scoring and destroy their children.
      if (normalizedCandidateText.length === 0) {
        continue;
      }

      // Skip candidates too far from target line unless they have a text-based match
      // or a devId match. DevId matching is immune to line drift by design.
      const candidateDevId = devIdMap?.get(candidate.element) ?? this.getDevId(candidate.element);
      const hasDevIdMatch = devContext.devId
        ? candidateDevId === devContext.devId
        : false;
      const hasTextOverlap = normalizedCandidateText === normalizedOldText ||
        normalizedCandidateText.includes(normalizedOldText) ||
        normalizedOldText.includes(normalizedCandidateText);
      if (lineDiff > 30 && !hasTextOverlap && !hasDevIdMatch) {
        continue;
      }

      let score = 0;
      let matchType = 'no-match';

      // Structural ID matching (highest priority — immune to line shifts)
      if (devContext.devId && candidateDevId === devContext.devId) {
        score += 50000;
        matchType = 'dev-id';
      }

      if (normalizedCandidateText === normalizedOldText) {
        if (candidate.isWrapper) {
          score += candidate.isTextContainer ? 11000 : 8000;
          matchType = candidate.isTextContainer ? 'text-container-wrapper-exact' : 'wrapper-exact';
        } else {
          score += 10000;
          matchType = 'exact-text';
          exactMatches.push({ element: candidate.element, line: candidate.line, score });
        }
      } else if (normalizedCandidateText.includes(normalizedOldText)) {
        score += candidate.isWrapper ? 1500 : 5000;
        matchType = candidate.isWrapper ? 'wrapper-contains' : 'contains-text';
      } else if (normalizedOldText.includes(normalizedCandidateText) && normalizedCandidateText.length > 0) {
        score += 2500;
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

      if (request.newHtml) {
        const parsedChildren = this.parseJsxChildren(request.newHtml);
        if (parsedChildren) {
          targetElement.children = parsedChildren;
        } else {
          return {
            success: false,
            error: `Failed to parse newHtml for element at line ${devContext.lineNumber}`,
          };
        }
      } else {
        this.updateTextContent(targetElement, newText);
      }

      logger.debug('ast.text-editor.updated', {
        matchScore: bestMatch?.score,
        matchType: bestMatch?.matchType,
        exactMatchCount: exactMatches.length,
        usedOccurrenceIndex: exactMatches.length > 1 && targetOccurrenceIndex !== null,
        oldText: actualOldText.slice(0, 80),
        newText: newText.slice(0, 80),
        hasNewHtml: !!request.newHtml,
      });
    }

    if (!elementFound) {
      // Store diagnostics for the route-level failure log
      this.lastDiagnostics = {
        candidatesCount: candidates.length,
        bestScore: bestMatch?.score,
        bestMatchType: bestMatch?.matchType,
        nearbyCandidates: candidates
          .filter(c => Math.abs(c.line - devContext.lineNumber) <= 10 && c.text.trim().length > 0)
          .sort((a, b) => Math.abs(a.line - devContext.lineNumber) - Math.abs(b.line - devContext.lineNumber))
          .slice(0, 5)
          .map(c => ({ line: c.line, text: c.text.slice(0, 80) })),
      };

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
    return `Update text in ${request.devContext.fileName || 'component'}`;
  }

  /**
   * Edit element text content using AST parsing and manipulation.
   * For markdown files (.md), bypasses JSX AST and performs a plain-text
   * find-and-replace in the markdown body (after the frontmatter block).
   *
   * @param appPath - Path to the app directory
   * @param request - Text edit request
   * @param appId - Optional app ID for git operations
   * @returns Text edit result with old and new text
   */
  async editElementText(appPath: string, request: TextEditRequest, appId: string): Promise<TextEditResult> {
    this.lastProcessResult = null;
    this.lastDiagnostics = null;

    if (request.devContext.fileName.endsWith('.md')) {
      return this.editMarkdownText(appPath, request, appId);
    }

    const baseResult = await this.editTemplate<TextEditRequest, TextEditResult>(
      appPath,
      request,
      (req) => req.devContext.fileName,
      true,
      'generic',
      appId
    );

    const processResult = this.lastProcessResult as { oldText: string; newText: string } | null;
    return {
      ...baseResult,
      oldText: processResult?.oldText || request.oldText,
      newText: processResult?.newText || request.newText
    };
  }

  /**
   * Strips common inline markdown markers and normalizes soft-wrap newlines to spaces,
   * producing the plain text that a browser would render from the markdown source.
   */
  private static stripInlineMarkdown(text: string): string {
    return text
      .replace(/\*\*\*(.+?)\*\*\*/gs, '$1')
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/\*(.+?)\*/gs, '$1')
      .replace(/___(.+?)___/gs, '$1')
      .replace(/__(.+?)__/gs, '$1')
      .replace(/_(.+?)_/gs, '$1')
      .replace(/`(.+?)`/gs, '$1')
      .replace(/~~(.+?)~~/gs, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/gs, '$1')
      .replace(/\n/g, ' ')
      .trim();
  }

  /**
   * Edit text in a markdown file using plain-text find-and-replace.
   * Searches only the markdown body (content after the frontmatter separator).
   *
   * Two-pass strategy:
   *   1. Exact substring match (fast path for plain-text paragraphs).
   *   2. Paragraph-block match after stripping inline markdown markers
   *      (handles paragraphs that contain **bold**, *italic*, etc., where
   *      element.textContent strips the markers but the source retains them).
   */
  private async editMarkdownText(appPath: string, request: TextEditRequest, appId: string): Promise<TextEditResult> {
    const relativePath = this.resolveRelativePath(request.devContext.fileName);
    const { files, gitTool } = this.getWorkspace(appId);

    const content = await this.readSourceFile(files, relativePath);

    // Split at the closing frontmatter delimiter (---) to search only the body
    const frontmatterEndIndex = content.indexOf('\n---\n', 3);
    const bodyStart = frontmatterEndIndex >= 0 ? frontmatterEndIndex + 5 : 0;
    const body = content.slice(bodyStart);

    let newBody: string;

    if (body.includes(request.oldText)) {
      // Pass 1: exact match
      newBody = body.replace(request.oldText, request.newText);
    } else {
      // Pass 2: find the paragraph block whose stripped plain text matches oldText.
      // The regex splits on blank lines (one or more empty lines), preserving the
      // separating whitespace so we can do a targeted substring replacement rather
      // than re-joining (which would normalise multi-blank-line gaps).
      const blocks = body.split(/\n{2,}/);
      const normalizedOld = request.oldText.trim();
      const matchIndex = blocks.findIndex(
        b => ASTTextEditor.stripInlineMarkdown(b) === normalizedOld,
      );

      if (matchIndex === -1) {
        return {
          success: false,
          filePath: relativePath,
          error: `Text not found in markdown file: "${request.oldText.slice(0, 80)}${request.oldText.length > 80 ? '...' : ''}"`,
          oldText: request.oldText,
          newText: request.newText,
        };
      }

      // Replace the matched block in-place inside body to preserve surrounding whitespace.
      // matchIndex !== -1 guarantees a valid index; the non-null assertion is safe.
      newBody = body.replace(blocks[matchIndex]!, request.newText);
    }

    const newContent = content.slice(0, bodyStart) + newBody;

    if (newContent === content) {
      return {
        success: true,
        filePath: relativePath,
        diff: 'No changes made',
        oldText: request.oldText,
        newText: request.newText,
      };
    }

    await this.writeSourceFile(files, relativePath, newContent);

    const commitMessage = `Update blog content in ${relativePath}`;
    const commitHash = await this.commitChanges(appPath, relativePath, commitMessage, gitTool);

    return {
      success: true,
      filePath: relativePath,
      diff: this.generateDiff(content, newContent),
      oldText: request.oldText,
      newText: request.newText,
      ...(commitHash && { commitHash }),
    };
  }
}
