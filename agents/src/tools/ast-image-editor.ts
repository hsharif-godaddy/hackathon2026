import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import * as t from '@babel/types';

import { logger } from '../logging/index.js';
import { imageSlotUrl } from '../utils/slot-reference-utils.js';

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
  /** img alt text — used to locate the matching record in data collections */
  alt?: string | null;
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
   * Extract the inner expression from a src JSX attribute, if it's an expression container.
   */
  private getSrcExpression(srcAttr: t.JSXAttribute | null): t.Expression | null {
    if (!srcAttr || !this.t.isJSXExpressionContainer(srcAttr.value)) {
      return null;
    }
    const expr = srcAttr.value.expression;
    return this.t.isExpression(expr) ? expr : null;
  }

  /**
   * Resolve the array literal bound to an identifier visible from the given path's
   * scope. Uses Babel's scope API so we honor lexical scoping (component-local
   * arrays don't leak across components, inner declarations shadow outer ones).
   * Returns the ArrayExpression node so callers can mutate its elements in place.
   */
  private resolveArrayBinding(imgPath: any, name: string): t.ArrayExpression | null {
    const binding = imgPath?.scope?.getBinding(name);
    if (!binding) return null;
    const declNode = binding.path?.node;
    if (!declNode || !this.t.isVariableDeclarator(declNode)) return null;
    if (!declNode.init || !this.t.isArrayExpression(declNode.init)) return null;
    return declNode.init;
  }

  /**
   * If src is a member expression on an array variable (arr[i] or arr[0]) whose
   * source array literal is reachable from the img's lexical scope, mutate the
   * matching element so all rendered instances stay in sync.
   *
   * Both index paths require URL match against expectedOldUrl: with only
   * line-proximity targeting in isTargetElement, blindly trusting the index
   * could overwrite the wrong slot when multiple imgs cluster on adjacent lines.
   *
   * Returns the previous URL on success, or null with a debug log when the
   * pattern isn't applicable (signals the caller to fall back).
   */
  private tryReplaceInSourceArray(
    imgPath: any,
    srcAttr: t.JSXAttribute | null,
    expectedOldUrl: string | null,
    newUrl: string
  ): { oldUrl: string } | null {
    const expr = this.getSrcExpression(srcAttr);
    if (!expr || !this.t.isMemberExpression(expr)) {
      logger.debug('ast.image-editor.array.src-not-member-expression');
      return null;
    }

    const obj = expr.object;
    if (!this.t.isIdentifier(obj)) {
      logger.debug('ast.image-editor.array.object-not-identifier');
      return null;
    }

    const array = this.resolveArrayBinding(imgPath, obj.name);
    if (!array) {
      logger.debug('ast.image-editor.array.binding-not-found', { name: obj.name });
      return null;
    }

    if (!expectedOldUrl) {
      logger.debug('ast.image-editor.array.no-expected-url');
      return null;
    }

    // arr[<numeric literal>] — direct index, but still require URL match.
    if (
      expr.computed &&
      this.t.isNumericLiteral(expr.property) &&
      Number.isInteger(expr.property.value)
    ) {
      const idx = expr.property.value;
      const element = array.elements[idx];
      if (!element || !this.t.isStringLiteral(element)) {
        logger.debug('ast.image-editor.array.index-not-string-literal', {
          name: obj.name,
          index: idx,
          arrayLength: array.elements.length
        });
        return null;
      }
      if (!this.urlsMatch(element.value, expectedOldUrl)) {
        logger.debug('ast.image-editor.array.index-url-mismatch', {
          name: obj.name,
          index: idx,
          elementUrl: element.value,
          expectedOldUrl
        });
        return null;
      }
      const oldUrl = element.value;
      element.value = newUrl;
      return { oldUrl };
    }

    // arr[<dynamic>] — locate by URL match against the expected URL
    let stringLiteralCount = 0;
    let nonStringElementCount = 0;
    for (const element of array.elements) {
      if (element && this.t.isStringLiteral(element)) {
        stringLiteralCount++;
        if (this.urlsMatch(element.value, expectedOldUrl)) {
          const oldUrl = element.value;
          element.value = newUrl;
          return { oldUrl };
        }
      } else {
        nonStringElementCount++;
      }
    }
    logger.debug('ast.image-editor.array.no-element-matches-url', {
      name: obj.name,
      arrayLength: array.elements.length,
      stringLiteralCount,
      nonStringElementCount,
      expectedOldUrl
    });
    return null;
  }

  /**
   * Replace an img's src, preferring array-element mutation for arr[i] / arr[0]
   * patterns so other rendered instances of the same expression stay correct.
   * Falls back to literal-src replacement; otherwise returns a discriminated
   * null so the caller can tell URL-mismatch from dynamic-src refusal.
   */
  private replaceImgSrc(
    imgPath: any,
    expectedOldUrl: string | null,
    newUrl: string
  ): { oldUrl: string | null } | { reason: 'url-mismatch' | 'dynamic-src-refused' } {
    const img = imgPath.node as t.JSXElement;
    const { value: currentSrc, attr: srcAttr } = this.getSrcAttribute(img);

    if (currentSrc !== null) {
      if (!this.urlsMatch(currentSrc, expectedOldUrl)) return { reason: 'url-mismatch' };
      if (!this.updateSrcAttribute(img, newUrl)) return { reason: 'url-mismatch' };
      return { oldUrl: currentSrc };
    }

    // Non-literal src: try to mutate the source array literal so shared expressions stay valid.
    const arrayResult = this.tryReplaceInSourceArray(imgPath, srcAttr, expectedOldUrl, newUrl);
    if (arrayResult) return arrayResult;

    // No safe edit — refuse rather than corrupt a shared dynamic expression.
    return { reason: 'dynamic-src-refused' };
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
    let dynamicSrcRefused = false;
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
            const replaceResult = this.replaceImgSrc(path, expectedOldUrl, newImageUrl);
            if ('reason' in replaceResult) {
              if (replaceResult.reason === 'dynamic-src-refused') {
                dynamicSrcRefused = true;
                logger.debug('ast.image-editor.dynamic-src-refused', {
                  expectedOldUrl,
                  line: element.loc?.start.line
                });
              } else {
                const { value: currentSrc } = this.getSrcAttribute(element);
                logger.debug('ast.image-editor.url-mismatch', {
                  currentSrc,
                  expectedOldUrl,
                  line: element.loc?.start.line
                });
              }
              return; // Skip this element, look for next match
            }

            oldUrl = replaceResult.oldUrl;
            elementFound = true;
            logger.debug('ast.image-editor.url-matched', { oldUrl, expectedOldUrl });
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
        imageType: imageInfo.type,
        dynamicSrcRefused
      });

      // Distinguish "located but refused due to dynamic src" from "not found".
      // The LLM should switch strategy (edit the array/prop declaration) instead
      // of retrying with adjusted selectors.
      const error = dynamicSrcRefused
        ? `Image src at line ${elementInfo.devContext.lineNumber} uses a dynamic expression that cannot be safely rewritten. Edit the source array or prop declaration directly.`
        : `Could not find target ${imageInfo.type} element at line ${elementInfo.devContext.lineNumber}`;

      return {
        success: false,
        error
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
   * Repoint a raw source URL (e.g. `/assets/eng.jpg`) to a new URL anywhere it
   * appears as a string literal in src/ — used as the import-slot fallback when
   * JSX-targeted replacement refuses a dynamic `src` (e.g. `arr.map(s => <img
   * src={s.image} />)`). The URL almost always lives as a literal in the backing
   * data array/object, so matching by the URL string (optionally disambiguated
   * by a sibling label property) repoints it without touching the dynamic JSX.
   *
   * Strategy order mirrors {@link replaceSharedSlotReference}: labeled record
   * first (when a label is known), then the Nth string-literal occurrence.
   */
  async replaceUrlInSource(
    appPath: string,
    options: {
      oldUrl: string;
      newUrl: string;
      label?: string | null;
      scopeFile?: string | null;
      occurrenceIndex?: number | null;
    },
    appId: string
  ): Promise<ImageReplaceResult> {
    const label = options.label?.trim() || null;
    if (label) {
      const labeledResult = await this.replaceSlotUrlInLabeledRecord(appPath, {
        label,
        oldUrl: options.oldUrl,
        newUrl: options.newUrl,
        scopeFile: options.scopeFile,
      }, appId);
      if (labeledResult.success) {
        return labeledResult;
      }
    }

    // This is the last-resort import fallback (no JSX path after it), so always
    // attempt the occurrence match — but normalize null/negative to 0 (match the
    // first occurrence) for parity with replaceSharedSlotReference's >= 0 gate; a
    // negative index would otherwise pass through and silently never match.
    const occurrenceIndex =
      options.occurrenceIndex != null && options.occurrenceIndex >= 0 ? options.occurrenceIndex : 0;
    return this.replaceSlotUrlOccurrenceInSource(appPath, {
      oldUrl: options.oldUrl,
      newUrl: options.newUrl,
      occurrenceIndex,
      scopeFile: options.scopeFile,
    }, appId);
  }

  /**
   * Replace a shared slot URL with a forked slot URL for one collection item.
   * Tries JSX targeting first, then falls back to the Nth string literal match in src/.
   */
  async replaceSharedSlotReference(
    appPath: string,
    request: ImageReplaceRequest & {
      oldSlotPath: string;
      newSlotPath: string;
      occurrenceIndex?: number | null;
    },
    appId: string
  ): Promise<ImageReplaceResult> {
    const oldUrl = imageSlotUrl(request.oldSlotPath);
    const newUrl = imageSlotUrl(request.newSlotPath);
    const collectionItemLabel = request.imageInfo.alt?.trim() || null;

    if (collectionItemLabel) {
      const labeledResult = await this.replaceSlotUrlInLabeledRecord(appPath, {
        label: collectionItemLabel,
        oldUrl,
        newUrl,
        scopeFile: request.elementInfo.devContext?.fileName,
      }, appId);
      if (labeledResult.success) {
        return labeledResult;
      }
    }

    if (request.occurrenceIndex != null && request.occurrenceIndex >= 0) {
      const occurrenceResult = await this.replaceSlotUrlOccurrenceInSource(appPath, {
        oldUrl,
        newUrl,
        occurrenceIndex: request.occurrenceIndex,
        scopeFile: request.elementInfo.devContext?.fileName,
      }, appId);
      if (occurrenceResult.success) {
        return occurrenceResult;
      }
    }

    const hasValidDevContext = Boolean(
      request.elementInfo.devContext?.fileName?.startsWith('src/')
      || request.elementInfo.devContext?.fileName?.startsWith('app/')
    );

    if (hasValidDevContext) {
      const jsxResult = await this.replaceImage(
        appPath,
        {
          elementInfo: request.elementInfo,
          imageInfo: { ...request.imageInfo, currentUrl: oldUrl },
          newImageUrl: newUrl,
        },
        appId
      );

      if (jsxResult.success) {
        return jsxResult;
      }
    }

    if (request.occurrenceIndex == null || request.occurrenceIndex < 0) {
      return {
        success: false,
        filePath: '',
        error: collectionItemLabel
          ? `Could not find data record for "${collectionItemLabel}" with shared slot URL`
          : 'Missing occurrence index for shared slot fork',
      };
    }

    return {
      success: false,
      filePath: '',
      error: hasValidDevContext
        ? 'Could not repoint shared slot reference'
        : 'Missing occurrence index for shared slot fork',
    };
  }

  private static readonly LABEL_PROPERTY_KEYS = new Set(['name', 'label', 'title']);
  private static readonly IMAGE_PROPERTY_KEYS = new Set(['image', 'photo', 'src', 'url', 'thumbnail']);

  private async collectSourceFilePaths(appPath: string): Promise<string[]> {
    const srcDir = path.join(appPath, 'src');
    const files: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = (await readdir(dir, { withFileTypes: true }))
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile() || !/\.(tsx?|jsx?)$/.test(entry.name)) {
          continue;
        }
        files.push(path.relative(appPath, fullPath).replace(/\\/g, '/'));
      }
    };

    await walk(srcDir);
    return files;
  }

  /** Data files first, then clicked element file, then remaining src files. */
  private orderSourceFilesForFork(files: string[], scopeFile?: string | null): string[] {
    const dataFiles = files.filter((filePath) => filePath.startsWith('src/data/')).sort();
    const scope = scopeFile && files.includes(scopeFile) ? scopeFile : null;
    const rest = files
      .filter((filePath) => !filePath.startsWith('src/data/') && filePath !== scope)
      .sort();
    const ordered = [...dataFiles];
    if (scope && !scope.startsWith('src/data/')) {
      ordered.push(scope);
    }
    ordered.push(...rest);
    return [...new Set(ordered)];
  }

  private replaceSlotUrlInLabeledRecord(
    appPath: string,
    options: {
      label: string;
      oldUrl: string;
      newUrl: string;
      scopeFile?: string | null;
    },
    appId: string
  ): Promise<ImageReplaceResult> {
    return this.collectSourceFilePaths(appPath).then(async (files) => {
      for (const relativePath of this.orderSourceFilesForFork(files, options.scopeFile)) {
        const fullPath = path.join(appPath, relativePath);
        const sourceCode = await readFile(fullPath, 'utf-8');
        const ast = this.parseAST(sourceCode);
        let replaced = false;

        this.traverse(ast, {
          ObjectExpression: (nodePath: { node: t.ObjectExpression }) => {
            if (replaced) {
              return;
            }

            let hasLabel = false;
            let imageProperty: t.ObjectProperty | null = null;

            for (const property of nodePath.node.properties) {
              if (this.t.isSpreadElement(property)) {
                continue;
              }
              if (!this.t.isObjectProperty(property)) {
                continue;
              }
              const keyName = this.getObjectPropertyKeyName(property.key);
              if (!keyName) {
                continue;
              }
              if (
                ASTImageEditor.LABEL_PROPERTY_KEYS.has(keyName)
                && this.t.isStringLiteral(property.value)
                && property.value.value === options.label
              ) {
                hasLabel = true;
              }
              if (
                ASTImageEditor.IMAGE_PROPERTY_KEYS.has(keyName)
                && this.t.isStringLiteral(property.value)
                && property.value.value === options.oldUrl
              ) {
                imageProperty = property;
              }
            }

            if (hasLabel && imageProperty && this.t.isStringLiteral(imageProperty.value)) {
              imageProperty.value.value = options.newUrl;
              replaced = true;
            }
          },
        });

        if (!replaced) {
          continue;
        }

        const { files: workspaceFiles } = this.getWorkspace(appId);
        const { code: newContent } = this.generateCode(ast);
        await this.writeSourceFile(workspaceFiles, relativePath, newContent);

        return {
          success: true,
          filePath: relativePath,
          changes: {
            oldUrl: options.oldUrl,
            newUrl: options.newUrl,
            imageType: 'img',
          },
        };
      }

      return {
        success: false,
        filePath: '',
        error: `Could not find data record for "${options.label}" with shared slot URL`,
      };
    });
  }

  private getObjectPropertyKeyName(key: t.ObjectProperty['key']): string | null {
    if (this.t.isIdentifier(key)) {
      return key.name;
    }
    if (this.t.isStringLiteral(key)) {
      return key.value;
    }
    return null;
  }

  private async replaceSlotUrlOccurrenceInSource(
    appPath: string,
    options: {
      oldUrl: string;
      newUrl: string;
      occurrenceIndex: number;
      scopeFile?: string | null;
    },
    appId: string
  ): Promise<ImageReplaceResult> {
    const files = await this.collectSourceFilePaths(appPath);
    let globalMatchIndex = 0;

    for (const relativePath of this.orderSourceFilesForFork(files, options.scopeFile)) {
      const fullPath = path.join(appPath, relativePath);
      const sourceCode = await readFile(fullPath, 'utf-8');
      const ast = this.parseAST(sourceCode);
      let replaced = false;

      this.traverse(ast, {
        StringLiteral: (nodePath: { node: t.StringLiteral }) => {
          if (replaced || nodePath.node.value !== options.oldUrl) {
            return;
          }
          if (globalMatchIndex !== options.occurrenceIndex) {
            globalMatchIndex += 1;
            return;
          }
          nodePath.node.value = options.newUrl;
          replaced = true;
        },
      });

      if (!replaced) {
        continue;
      }

      const { files: workspaceFiles } = this.getWorkspace(appId);
      const { code: newContent } = this.generateCode(ast);
      await this.writeSourceFile(workspaceFiles, relativePath, newContent);

      return {
        success: true,
        filePath: relativePath,
        changes: {
          oldUrl: options.oldUrl,
          newUrl: options.newUrl,
          imageType: 'img',
        },
      };
    }

    return {
      success: false,
      filePath: '',
      error: `Could not find shared slot URL occurrence ${options.occurrenceIndex + 1}`,
    };
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
