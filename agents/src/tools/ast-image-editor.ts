import * as t from '@babel/types';

import { logger } from '../logging/index.js';

import { ASTEditorBase, BaseEditResult } from './ast-editor-base.js';

export interface ImageElementInfo {
  tagName: string;
  className: string;
  id: string;
  selector: string;
  devContext: {
    fileName: string;
    componentName: string;
    lineNumber: number;
  };
}

export interface ImageInfo {
  type: 'img' | 'background' | 'contains-img' | 'sibling-img';
  currentUrl: string | null;
}

export interface ImageReplaceRequest {
  elementInfo: ImageElementInfo;
  imageInfo: ImageInfo;
  newImageUrl: string;
}

export interface ImageReplaceResult extends BaseEditResult {
  changes?: {
    oldUrl: string | null;
    newUrl: string;
    imageType: ImageInfo['type'];
  };
  commitHash?: string;
}

export class ASTImageEditor extends ASTEditorBase {
  private lastProcessResult: {
    oldUrl: string | null;
    newUrl: string;
    imageType: ImageInfo['type'];
  } | null = null;

  /**
   * Replace an image using AST parsing and manipulation
   */
  async replaceImage(
    appPath: string,
    request: ImageReplaceRequest,
    appId: string
  ): Promise<ImageReplaceResult> {
    const baseResult = await this.editTemplate<ImageReplaceRequest, ImageReplaceResult>(
      appPath,
      request,
      (req) => req.elementInfo.devContext.fileName,
      true,
      'component',
      appId
    );

    const changes = this.lastProcessResult || {
      oldUrl: request.imageInfo.currentUrl,
      newUrl: request.newImageUrl,
      imageType: request.imageInfo.type
    };

    return {
      ...baseResult,
      changes
    };
  }

  /**
   * Check if a JSX element matches the target element info
   */
  protected isTargetElement(element: t.JSXElement, elementInfo: ImageElementInfo): boolean {
    const tagName = this.getTagName(element);
    const className = this.getClassName(element);
    const targetLine = elementInfo.devContext.lineNumber;

    // Check if the element is on or near the target line
    if (!this.isOnTargetLine(element, targetLine, 3)) {
      return false;
    }

    // For image elements, match by tag name or by className if provided
    if (elementInfo.tagName?.toLowerCase() === 'img' && tagName?.toLowerCase() === 'img') {
      return true;
    }

    // Match by className if provided
    if (elementInfo.className && className) {
      const targetClasses = elementInfo.className.split(' ').filter(c => c.trim());
      const elementClasses = className.split(' ');
      const hasMatchingClass = targetClasses.some(tc => elementClasses.includes(tc));
      if (hasMatchingClass) {
        return true;
      }
    }

    // Match by tag name if provided
    if (elementInfo.tagName && tagName?.toLowerCase() === elementInfo.tagName.toLowerCase()) {
      return true;
    }

    return false;
  }

  /**
   * Get the src attribute from an img element
   */
  private getSrcAttribute(element: t.JSXElement): { value: string | null; attr: t.JSXAttribute | null } {
    const openingElement = element.openingElement;
    const srcAttr = openingElement.attributes.find(
      (attr): attr is t.JSXAttribute =>
        this.t.isJSXAttribute(attr) && attr.name.name === 'src'
    );

    if (!srcAttr) {
      return { value: null, attr: null };
    }

    if (this.t.isStringLiteral(srcAttr.value)) {
      return { value: srcAttr.value.value, attr: srcAttr };
    }

    if (this.t.isJSXExpressionContainer(srcAttr.value) &&
        this.t.isStringLiteral(srcAttr.value.expression)) {
      return { value: srcAttr.value.expression.value, attr: srcAttr };
    }

    return { value: null, attr: srcAttr };
  }

  /**
   * Update the src attribute of an img element
   */
  private updateSrcAttribute(element: t.JSXElement, newUrl: string): boolean {
    const openingElement = element.openingElement;
    const srcAttrIndex = openingElement.attributes.findIndex(
      (attr): attr is t.JSXAttribute =>
        this.t.isJSXAttribute(attr) && attr.name.name === 'src'
    );

    if (srcAttrIndex >= 0) {
      // Update existing src attribute
      const srcAttr = openingElement.attributes[srcAttrIndex] as t.JSXAttribute;
      srcAttr.value = this.t.stringLiteral(newUrl);
      return true;
    } else {
      // Add new src attribute
      openingElement.attributes.push(
        this.t.jsxAttribute(
          this.t.jsxIdentifier('src'),
          this.t.stringLiteral(newUrl)
        )
      );
      return true;
    }
  }

  /**
   * Get background image from style attribute
   */
  private getBackgroundImageFromStyle(element: t.JSXElement): string | null {
    const openingElement = element.openingElement;
    const styleAttr = openingElement.attributes.find(
      (attr): attr is t.JSXAttribute =>
        this.t.isJSXAttribute(attr) && attr.name.name === 'style'
    );

    if (!styleAttr || !this.t.isJSXExpressionContainer(styleAttr.value)) {
      return null;
    }

    const expr = styleAttr.value.expression;
    if (!this.t.isObjectExpression(expr)) {
      return null;
    }

    for (const prop of expr.properties) {
      if (!this.t.isObjectProperty(prop)) continue;

      const key = this.t.isIdentifier(prop.key) ? prop.key.name : null;
      if (key === 'backgroundImage' && this.t.isStringLiteral(prop.value)) {
        const urlMatch = prop.value.value.match(/url\(["']?([^"')]+)["']?\)/);
        return urlMatch?.[1] ?? null;
      }
    }

    return null;
  }

  /**
   * Update background image in style attribute
   */
  private updateBackgroundImage(element: t.JSXElement, newUrl: string): boolean {
    const openingElement = element.openingElement;
    const styleAttrIndex = openingElement.attributes.findIndex(
      (attr): attr is t.JSXAttribute =>
        this.t.isJSXAttribute(attr) && attr.name.name === 'style'
    );

    if (styleAttrIndex < 0) {
      // Add new style attribute with backgroundImage
      openingElement.attributes.push(
        this.t.jsxAttribute(
          this.t.jsxIdentifier('style'),
          this.t.jsxExpressionContainer(
            this.t.objectExpression([
              this.t.objectProperty(
                this.t.identifier('backgroundImage'),
                this.t.stringLiteral(`url('${newUrl}')`)
              )
            ])
          )
        )
      );
      return true;
    }

    const styleAttr = openingElement.attributes[styleAttrIndex] as t.JSXAttribute;
    if (!this.t.isJSXExpressionContainer(styleAttr.value)) {
      return false;
    }

    const expr = styleAttr.value.expression;
    if (!this.t.isObjectExpression(expr)) {
      return false;
    }

    // Find and update backgroundImage property
    let found = false;
    for (const prop of expr.properties) {
      if (!this.t.isObjectProperty(prop)) continue;

      const key = this.t.isIdentifier(prop.key) ? prop.key.name : null;
      if (key === 'backgroundImage') {
        prop.value = this.t.stringLiteral(`url('${newUrl}')`);
        found = true;
        break;
      }
    }

    if (!found) {
      // Add backgroundImage property
      expr.properties.push(
        this.t.objectProperty(
          this.t.identifier('backgroundImage'),
          this.t.stringLiteral(`url('${newUrl}')`)
        )
      );
    }

    return true;
  }

  /**
   * Find child img element with matching URL within a container
   */
  private findChildImgWithUrl(element: t.JSXElement, expectedUrl: string | null): t.JSXElement | null {
    for (const child of element.children) {
      if (this.t.isJSXElement(child)) {
        const tagName = this.getTagName(child);
        if (tagName?.toLowerCase() === 'img') {
          const { value: currentSrc } = this.getSrcAttribute(child);
          if (this.urlsMatch(currentSrc, expectedUrl)) {
            return child;
          }
        }
        // Recursively search in nested elements
        const nestedImg = this.findChildImgWithUrl(child, expectedUrl);
        if (nestedImg) {
          return nestedImg;
        }
      }
    }
    return null;
  }

  /**
   * Check if URLs match (handles path-only vs full URL comparisons)
   */
  private urlsMatch(currentUrl: string | null, expectedUrl: string | null): boolean {
    if (!expectedUrl) return true; // No expected URL means match any
    if (!currentUrl) return false;

    // Normalize URLs for comparison
    const normalize = (url: string): string => {
      // Extract just the path portion for comparison
      try {
        const parsed = new URL(url, 'http://localhost');
        return parsed.pathname;
      } catch {
        // If not a valid URL, just use the string as-is
        return url;
      }
    };

    const normalizedCurrent = normalize(currentUrl);
    const normalizedExpected = normalize(expectedUrl);

    // Check for exact match or path match
    return currentUrl === expectedUrl ||
           normalizedCurrent === normalizedExpected ||
           currentUrl.endsWith(normalizedExpected) ||
           normalizedCurrent.endsWith(normalizedExpected);
  }

  /**
   * Process AST to make image replacement changes
   */
  protected processAST(ast: t.File, request: ImageReplaceRequest): {
    success: boolean;
    changes?: { oldUrl: string | null; newUrl: string; imageType: ImageInfo['type'] };
    error?: string;
  } {
    const { elementInfo, imageInfo, newImageUrl } = request;
    const expectedOldUrl = imageInfo.currentUrl;

    logger.debug('ast.image-editor.process', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      imageType: imageInfo.type,
      expectedOldUrl,
      newImageUrl
    });

    let elementFound = false;
    let oldUrl: string | null = imageInfo.currentUrl;

    this.traverse(ast, {
      JSXElement: (path: any): void => {
        if (elementFound) return;

        const element = path.node as t.JSXElement;

        if (!this.isTargetElement(element, elementInfo)) {
          return;
        }

        logger.debug('ast.image-editor.candidate-found', {
          tagName: this.getTagName(element),
          line: element.loc?.start.line,
          imageType: imageInfo.type
        });

        switch (imageInfo.type) {
          case 'img': {
            // Direct img element - replace src attribute
            const { value: currentSrc } = this.getSrcAttribute(element);

            // Verify URL matches to handle multiple images on same line
            if (!this.urlsMatch(currentSrc, expectedOldUrl)) {
              logger.debug('ast.image-editor.url-mismatch', {
                currentSrc,
                expectedOldUrl,
                line: element.loc?.start.line
              });
              return; // Skip this element, look for next match
            }

            oldUrl = currentSrc;
            if (this.updateSrcAttribute(element, newImageUrl)) {
              elementFound = true;
              logger.debug('ast.image-editor.url-matched', { currentSrc, expectedOldUrl });
            }
            break;
          }

          case 'background': {
            // Element with background image
            const currentBg = this.getBackgroundImageFromStyle(element);

            // Verify URL matches
            if (!this.urlsMatch(currentBg, expectedOldUrl)) {
              logger.debug('ast.image-editor.bg-url-mismatch', {
                currentBg,
                expectedOldUrl,
                line: element.loc?.start.line
              });
              return;
            }

            oldUrl = currentBg;
            if (this.updateBackgroundImage(element, newImageUrl)) {
              elementFound = true;
              logger.debug('ast.image-editor.bg-url-matched', { currentBg, expectedOldUrl });
            }
            break;
          }

          case 'contains-img': {
            // Container with child img element - find the one with matching URL
            const childImg = this.findChildImgWithUrl(element, expectedOldUrl);
            if (childImg) {
              const { value: currentSrc } = this.getSrcAttribute(childImg);
              oldUrl = currentSrc;
              if (this.updateSrcAttribute(childImg, newImageUrl)) {
                elementFound = true;
              }
            }
            break;
          }

          case 'sibling-img': {
            // Look for sibling img with matching URL in the parent
            const parent = path.parentPath?.node;
            if (parent && this.t.isJSXElement(parent)) {
              for (const sibling of parent.children) {
                if (this.t.isJSXElement(sibling)) {
                  const tagName = this.getTagName(sibling);
                  if (tagName?.toLowerCase() === 'img') {
                    const { value: currentSrc } = this.getSrcAttribute(sibling);

                    // Verify URL matches
                    if (!this.urlsMatch(currentSrc, expectedOldUrl)) {
                      continue; // Check next sibling
                    }

                    oldUrl = currentSrc;
                    if (this.updateSrcAttribute(sibling, newImageUrl)) {
                      elementFound = true;
                    }
                    break;
                  }
                }
              }
            }
            break;
          }
        }
      }
    });

    if (!elementFound) {
      logger.warn('ast.image-editor.element-not-found', {
        fileName: elementInfo.devContext.fileName,
        lineNumber: elementInfo.devContext.lineNumber,
        imageType: imageInfo.type
      });

      return {
        success: false,
        error: `Could not find target ${imageInfo.type} element at line ${elementInfo.devContext.lineNumber}`
      };
    }

    const changes = {
      oldUrl,
      newUrl: newImageUrl,
      imageType: imageInfo.type
    };

    this.lastProcessResult = changes;

    logger.info('ast.image-editor.success', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      oldUrl,
      newUrl: newImageUrl,
      imageType: imageInfo.type
    });

    return { success: true, changes };
  }

  /**
   * Generate commit message for image replacement
   */
  protected generateCommitMessage(
    changes: ImageReplaceResult['changes'],
    _request: ImageReplaceRequest
  ): string {
    if (changes?.imageType && changes?.newUrl) {
      const filename = changes.newUrl.split('/').pop() || 'image';
      return `Replace ${changes.imageType} with ${filename}`;
    }
    return 'Replace image';
  }
}

// Singleton instance
export const astImageEditor = new ASTImageEditor();
