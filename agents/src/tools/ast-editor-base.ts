import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import { GitTool } from './git-tool.js';
import { translateDockerPath } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { toolAstEditEvents } from '../logging/events/index.js';
import { createForWorkspace } from '../workspace/index.js';
import type { WorkspaceFiles } from '../workspace/files.js';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

export interface BaseEditContext {
  fileName: string;
  componentName: string;
  lineNumber: number;
  devId?: string;
}

export interface BaseEditResult {
  success: boolean;
  filePath: string;
  diff?: string;
  error?: string;
  commitHash?: string;
}

export abstract class ASTEditorBase {
  protected traverse = traverse;
  protected generate = generate;
  protected t = t;

  protected getWorkspace(appId: string): { files: WorkspaceFiles; gitTool: GitTool } {
    const workspace = createForWorkspace(appId, 'preview');
    if (!workspace) {
      throw new Error(`Workspace not found for app ${appId}`);
    }
    return { files: workspace.files, gitTool: new GitTool(workspace.tasks) };
  }

  /**
   * Parse a CSS selector into tagName and className
   */
  protected parseCSSSelector(selector: string): { tagName: string; className: string } {
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
   * Translate a file name (potentially Docker-pathed) to a workspace-relative path.
   * Path containment is enforced by the dev-supervisor.
   */
  protected resolveRelativePath(fileName: string): string {
    return translateDockerPath(fileName);
  }

  /**
   * Parse source code into AST
   */
  protected parseAST(sourceCode: string): t.File {
    return parse(sourceCode, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript', 'decorators-legacy']
    });
  }

  /**
   * Generate code from AST
   */
  protected generateCode(ast: t.File): { code: string } {
    return this.generate(ast, {
      retainLines: true,
      compact: false
    });
  }

  protected async readSourceFile(files: WorkspaceFiles, relativePath: string): Promise<string> {
    const result = await files.view({ path: relativePath });
    return result.content;
  }

  protected async writeSourceFile(files: WorkspaceFiles, relativePath: string, content: string): Promise<void> {
    await files.write({ path: relativePath, content });
  }

  /**
   * Check if a JSX element matches target criteria (must be implemented by subclasses)
   */
  protected abstract isTargetElement(element: t.JSXElement, targetInfo: any): boolean;

  /**
   * Process AST to make the required changes (must be implemented by subclasses)
   */
  protected abstract processAST(ast: t.File, request: any): {
    success: boolean;
    changes?: any;
    error?: string;
  };

  /**
   * Generate commit message for the changes (optional, can be overridden)
   */
  protected generateCommitMessage(changes: any, _request: any): string {
    return `AST edit: ${JSON.stringify(changes)}`;
  }

  /**
   * Generate a simple diff between old and new content
   */
  protected generateDiff(oldContent: string, newContent: string): string {
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
   * Check if element is on the target line (within reasonable tolerance)
   */
  protected isOnTargetLine(element: t.JSXElement, targetLine: number, tolerance = 2): boolean {
    const elementLine = element.loc?.start.line;
    return elementLine ? Math.abs(elementLine - targetLine) <= tolerance : false;
  }

  /**
   * Extract data-dev-id attribute value from a JSX element
   */
  protected getDevId(element: t.JSXElement): string | null {
    const attr = element.openingElement.attributes.find(
      (a) => this.t.isJSXAttribute(a) &&
        this.t.isJSXIdentifier(a.name) &&
        a.name.name === 'data-dev-id'
    ) as t.JSXAttribute | undefined;
    if (!attr) return null;
    if (this.t.isStringLiteral(attr.value)) return attr.value.value;
    if (this.t.isJSXExpressionContainer(attr.value) &&
        this.t.isStringLiteral(attr.value.expression)) {
      return attr.value.expression.value;
    }
    return null;
  }

  /**
   * Get tag name from JSX element
   */
  protected getTagName(element: t.JSXElement): string | null {
    const openingElement = element.openingElement;
    if (this.t.isJSXIdentifier(openingElement.name)) {
      return openingElement.name.name;
    }
    return null;
  }

  /**
   * Get className attribute value from JSX element
   */
  protected getClassName(element: t.JSXElement): string {
    const openingElement = element.openingElement;
    const classNameAttr = openingElement.attributes.find(
      (attr: any) => this.t.isJSXAttribute(attr) && attr.name.name === 'className'
    ) as t.JSXAttribute | undefined;

    if (classNameAttr) {
      if (this.t.isStringLiteral(classNameAttr.value)) {
        return classNameAttr.value.value;
      } else if (this.t.isJSXExpressionContainer(classNameAttr.value) &&
                this.t.isStringLiteral(classNameAttr.value.expression)) {
        return classNameAttr.value.expression.value;
      }
    }

    return '';
  }

  protected async editTemplate<TRequest, TResult extends BaseEditResult>(
    appPath: string,
    request: TRequest,
    getFilePath: (request: TRequest) => string,
    shouldCommit = false,
    editType: 'style' | 'component' | 'generic' = 'generic',
    appId: string,
  ): Promise<TResult> {
    const startTime = Date.now();
    const relativePath = this.resolveRelativePath(getFilePath(request));

    const logData = {
      toolName: 'ast-editor',
      appId,
      filePath: relativePath,
      editType,
    };

    toolAstEditEvents.begin(logger, logData);

    try {
      const { files, gitTool } = this.getWorkspace(appId);

      const sourceCode = await this.readSourceFile(files, relativePath);
      const ast = this.parseAST(sourceCode);
      const processResult = this.processAST(ast, request);

      if (!processResult.success) {
        toolAstEditEvents.failure(logger, new Error(processResult.error || 'AST processing failed'), logData);
        return {
          success: false,
          filePath: relativePath,
          error: processResult.error,
        } as TResult;
      }

      const { code: updatedCode } = this.generateCode(ast);
      const hasChanges = sourceCode !== updatedCode;

      if (!hasChanges) {
        return {
          success: true,
          filePath: relativePath,
          diff: 'No changes made',
        } as TResult;
      }

      await this.writeSourceFile(files, relativePath, updatedCode);

      let commitHash: string | undefined;
      if (shouldCommit) {
        commitHash = await this.commitChanges(
          appPath,
          relativePath,
          this.generateCommitMessage(processResult.changes, request),
          gitTool,
        );
      }

      const executionTime = Date.now() - startTime;
      const diff = this.generateDiff(sourceCode, updatedCode);
      const linesChanged = diff.split('\n').filter(line => line.startsWith('+') || line.startsWith('-')).length;

      toolAstEditEvents.success(logger, {
        ...logData,
        changes: processResult.changes,
        resultStats: {
          success: true,
          hasChanges,
          linesChanged,
          ...(commitHash && { commitHash }),
          executionTime,
        },
      });

      return {
        success: true,
        filePath: relativePath,
        diff,
        ...(commitHash && { commitHash }),
      } as TResult;
    } catch (error) {
      toolAstEditEvents.failure(logger, error as Error, logData);
      return {
        success: false,
        filePath: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      } as TResult;
    }
  }

  protected async commitChanges(
    appPath: string,
    relativePath: string,
    commitMessage: string,
    gitTool: GitTool,
  ): Promise<string | undefined> {
    try {
      const addResult = await gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: [relativePath],
      });

      if (!addResult.success) {
        logger.warn('Failed to add AST edited file to git', {
          component: 'ASTEditorBase',
          relativePath,
          error: addResult.error,
        });
        return undefined;
      }

      const commitResult = await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: commitMessage,
      });

      if (!commitResult.success) {
        logger.warn('Failed to commit AST changes', {
          component: 'ASTEditorBase',
          relativePath,
          error: commitResult.error,
        });
        return undefined;
      }

      const logResult = await gitTool.executeGitOperation(appPath, {
        operation: 'log',
        options: { count: 1 },
      });

      if (logResult.success && logResult.commits && logResult.commits.length > 0) {
        return logResult.commits[0]?.hash;
      }
      return undefined;
    } catch (error) {
      logger.warn('Failed to commit AST changes', {
        error: error instanceof Error ? error.message : String(error),
        relativePath,
      });
      return undefined;
    }
  }
}
