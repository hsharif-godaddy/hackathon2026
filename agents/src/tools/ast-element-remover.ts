import * as t from '@babel/types';

import { logger } from '../logging/index.js';

import { ASTEditorBase, BaseEditContext, BaseEditResult } from './ast-editor-base.js';

export interface RemoveElementInfo {
  tagName: string;
  className?: string;
  id?: string;
  dataId?: string;
  selector: string;
  devContext: BaseEditContext;
}

export interface ElementRemoveRequest {
  selector: string;
  preciseSelector?: string;
  isVideo?: boolean;
  elementInfo: RemoveElementInfo;
}

export interface ElementRemoveResult extends BaseEditResult {
  changes?: {
    tagName: string;
    componentName: string;
  };
  commitHash?: string;
}

/**
 * Tags we consider safe to remove. We never remove a large container (div,
 * section, etc.) — only image/video-ish leaf elements — so a mis-targeted
 * delete can't wipe out a whole layout block.
 */
// `source` is intentionally excluded: it's never the user's target via the UI
// (hover resolves to the parent <picture>/<video>), and removing a lone <source>
// leaves silently-broken media. A <picture>'s <img> child is handled specially
// in processAST — we remove the whole <picture>, not the inner <img>.
const REMOVABLE_MEDIA_TAGS = new Set(['img', 'picture', 'svg', 'video']);

export class ASTElementRemover extends ASTEditorBase {
  /**
   * Remove a single image/video JSX element from a customer app source file.
   *
   * @param appId - The app whose workspace is edited; a successful removal
   *   produces a per-app git commit so users can revert via version history
   *   (same as the image editor).
   */
  async removeElement(
    appPath: string,
    request: ElementRemoveRequest,
    appId: string,
  ): Promise<ElementRemoveResult> {
    const baseResult = await this.editTemplate<ElementRemoveRequest, ElementRemoveResult>(
      appPath,
      request,
      (req) => req.elementInfo.devContext.fileName,
      true,
      'component',
      appId,
    );

    // The accurate, resolved tag goes into the commit message (built race-free
    // from processAST's local result inside editTemplate). This response field
    // is informational only (the builder ignores it), so deriving it from the
    // request avoids carrying mutable state on the singleton.
    return {
      ...baseResult,
      changes: {
        tagName: request.elementInfo.tagName,
        componentName: request.elementInfo.devContext.componentName,
      },
      commitHash: baseResult.commitHash,
    };
  }

  /**
   * Check if a JSX element matches the target element info. Mirrors the image
   * editor's resolution: line proximity plus tag/className matching.
   */
  protected isTargetElement(element: t.JSXElement, elementInfo: RemoveElementInfo): boolean {
    const tagName = this.getTagName(element);
    const className = this.getClassName(element);
    const targetLine = elementInfo.devContext.lineNumber;

    if (!this.isOnTargetLine(element, targetLine, 3)) {
      return false;
    }

    // When a className is provided, require an overlap. With line tolerance,
    // sibling media elements on adjacent lines all fall in range — className
    // is what disambiguates which one the user actually clicked.
    if (elementInfo.className?.trim()) {
      if (!className) {
        return false;
      }
      const targetClasses = elementInfo.className.split(' ').filter((c) => c.trim());
      const elementClasses = className.split(' ').filter((c) => c.trim());
      return targetClasses.some((tc) => elementClasses.includes(tc));
    }

    if (elementInfo.tagName && tagName?.toLowerCase() === elementInfo.tagName.toLowerCase()) {
      return true;
    }

    return false;
  }

  /**
   * Guard: only remove image/video-ish leaf tags, or a tag that matches the
   * client-provided tagName when that tagName is itself a media tag. Never
   * remove a generic container even if it matched on line + className.
   */
  private isRemovableTag(element: t.JSXElement, elementInfo: RemoveElementInfo): boolean {
    const tagName = this.getTagName(element)?.toLowerCase();
    if (tagName && REMOVABLE_MEDIA_TAGS.has(tagName)) {
      return true;
    }

    const requestedTag = elementInfo.tagName?.toLowerCase();
    if (requestedTag && REMOVABLE_MEDIA_TAGS.has(requestedTag) && tagName === requestedTag) {
      return true;
    }

    return false;
  }

  protected processAST(ast: t.File, request: ElementRemoveRequest): {
    success: boolean;
    changes?: { tagName: string; componentName: string };
    error?: string;
  } {
    const { elementInfo } = request;

    logger.debug('ast.element-remover.process', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      tagName: elementInfo.tagName,
      isVideo: request.isVideo,
    });

    let removed = false;
    let removedTagName = '';

    this.traverse(ast, {
      JSXElement: (path: { node: t.JSXElement; remove: () => void; parentPath?: { node: t.Node; remove: () => void } }): void => {
        if (removed) return;

        const element = path.node;

        if (!this.isTargetElement(element, elementInfo)) {
          return;
        }

        if (!this.isRemovableTag(element, elementInfo)) {
          logger.warn('ast.element-remover.refused-non-media', {
            tagName: this.getTagName(element),
            requestedTag: elementInfo.tagName,
            line: element.loc?.start.line,
          });
          return;
        }

        // Hover detection resolves a <picture> to its inner <img>, so the target
        // here is the <img>. Removing just the <img> would leave an empty,
        // broken <picture>; remove the whole <picture> instead.
        const parent = path.parentPath?.node;
        const removeTarget =
          this.getTagName(element)?.toLowerCase() === 'img' &&
          parent &&
          t.isJSXElement(parent) &&
          this.getTagName(parent)?.toLowerCase() === 'picture'
            ? path.parentPath!
            : path;
        const removedNode = removeTarget.node as t.JSXElement;

        removedTagName = this.getTagName(removedNode) || elementInfo.tagName;
        removeTarget.remove();
        removed = true;

        logger.debug('ast.element-remover.removed', {
          tagName: removedTagName,
          line: element.loc?.start.line,
        });
      },
    });

    if (!removed) {
      logger.warn('ast.element-remover.element-not-found', {
        fileName: elementInfo.devContext.fileName,
        lineNumber: elementInfo.devContext.lineNumber,
        tagName: elementInfo.tagName,
      });
      return {
        success: false,
        error: `Could not find removable ${elementInfo.tagName} element at line ${elementInfo.devContext.lineNumber} in ${elementInfo.devContext.fileName}`,
      };
    }

    const changes = {
      tagName: removedTagName,
      componentName: elementInfo.devContext.componentName,
    };

    logger.info('ast.element-remover.success', {
      fileName: elementInfo.devContext.fileName,
      lineNumber: elementInfo.devContext.lineNumber,
      tagName: removedTagName,
    });

    return { success: true, changes };
  }

  protected generateCommitMessage(
    changes: ElementRemoveResult['changes'],
    request: ElementRemoveRequest,
  ): string {
    const tagName = changes?.tagName || request.elementInfo.tagName;
    const componentName = changes?.componentName || request.elementInfo.devContext.componentName;
    const hasResolvedComponent = !!componentName && componentName !== 'unknown';
    const location = hasResolvedComponent
      ? componentName
      : (request.elementInfo.devContext.fileName.split('/').pop() || request.elementInfo.devContext.fileName);
    return `Remove <${tagName}> element in ${location}`;
  }
}

// Singleton instance
export const astElementRemover = new ASTElementRemover();
