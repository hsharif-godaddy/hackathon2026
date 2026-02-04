import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import { GitTool } from './git-tool.js';
import { translateDockerPath } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { toolAstEditEvents } from '../logging/events/index.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

export interface BaseEditContext {
  fileName: string;
  componentName: string;
  lineNumber: number;
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

  /**
   * Create a GitTool instance for the specified app
   */
  protected createGitTool(appId: string): GitTool {
    const devSupervisor = DevSupervisorClientFactory.createForApp(appId)
    return new GitTool(devSupervisor || undefined)
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
   * Resolve file path within the app directory
   */
  protected resolveFilePath(appPath: string, fileName: string): string {
    // Handle Docker paths
    const translatedPath = translateDockerPath(fileName);
    const fullPath = resolve(appPath, translatedPath);

    logger.debug('Resolving AST edit file path', {
      component: 'ASTEditorBase',
      appPath,
      fileName,
      translatedPath,
      fullPath
    });

    // Ensure the file is within the app directory (security check)
    if (!fullPath.startsWith(appPath)) {
      throw new Error(`File path must be within the app directory. Resolved: ${fullPath}, App path: ${appPath}`);
    }

    return fullPath;
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

  /**
   * Read source file
   */
  protected async readSourceFile(filePath: string): Promise<string> {
    return await readFile(filePath, 'utf-8');
  }

  /**
   * Write source file
   */
  protected async writeSourceFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8');
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

  /**
   * Template method for editing operations
   */
  protected async editTemplate<TRequest, TResult extends BaseEditResult>(
    appPath: string,
    request: TRequest,
    getFilePath: (request: TRequest) => string,
    shouldCommit = false,
    editType: 'style' | 'component' | 'generic' = 'generic',
    appId?: string
  ): Promise<TResult> {
    const startTime = Date.now();
    const filePath = this.resolveFilePath(appPath, getFilePath(request));

    // Build logging data
    const logData = {
      toolName: 'ast-editor',
      ...(appId && { appId }),
      filePath,
      editType
    };

    // Log operation begin
    toolAstEditEvents.begin(logger, logData);

    try {
      // Read the source file
      const sourceCode = await this.readSourceFile(filePath);

      // Parse the AST
      const ast = this.parseAST(sourceCode);

      // Process the AST (implemented by subclasses)
      const processResult = this.processAST(ast, request);

      if (!processResult.success) {
        // Log failure
        toolAstEditEvents.failure(logger, new Error(processResult.error || 'AST processing failed'), logData);

        return {
          success: false,
          filePath,
          error: processResult.error
        } as TResult;
      }

      // Generate the updated code
      const { code: updatedCode } = this.generateCode(ast);

      // Check if the file content actually changed
      const hasChanges = sourceCode !== updatedCode;

      if (!hasChanges) {
        logger.debug('No changes detected in AST edit', {
          component: 'ASTEditorBase',
          filePath,
          editType
        });

        return {
          success: true,
          filePath,
          diff: 'No changes made'
        } as TResult;
      }

      // Write the updated file
      await this.writeSourceFile(filePath, updatedCode);

      // Optionally commit changes
      let commitHash: string | undefined;
      if (shouldCommit && appId) {
        commitHash = await this.commitChanges(
          appPath,
          filePath,
          this.generateCommitMessage(processResult.changes, request),
          appId
        );
      }

      const executionTime = Date.now() - startTime;
      const diff = this.generateDiff(sourceCode, updatedCode);
      const linesChanged = diff.split('\n').filter(line => line.startsWith('+') || line.startsWith('-')).length;

      // Log success
      toolAstEditEvents.success(logger, {
        ...logData,
        changes: processResult.changes,
        resultStats: {
          success: true,
          hasChanges,
          linesChanged,
          ...(commitHash && { commitHash }),
          executionTime
        }
      });

      return {
        success: true,
        filePath,
        diff,
        ...(commitHash && { commitHash })
      } as TResult;

    } catch (error) {
      // Log failure
      toolAstEditEvents.failure(logger, error as Error, logData);

      return {
        success: false,
        filePath: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      } as TResult;
    }
  }

  /**
   * Commit changes to git (optional, can be overridden)
   */
  protected async commitChanges(
    appPath: string,
    filePath: string,
    commitMessage: string,
    appId: string
  ): Promise<string | undefined> {
    const { relative } = await import('path');
    const relativePath = relative(appPath, filePath);

    try {

      logger.debug('Committing AST changes to git', {
        component: 'ASTEditorBase',
        relativePath,
        commitMessage
      });

      // Create git tool with dev-supervisor for this specific app
      const gitTool = this.createGitTool(appId)

      // Add the file to git
      const addResult = await gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: [relativePath]
      });

      if (!addResult.success) {
        logger.warn('Failed to add AST edited file to git', {
          component: 'ASTEditorBase',
          relativePath,
          error: addResult.error
        });
        return undefined;
      }

      // Commit the changes
      const commitResult = await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: commitMessage
      });

      if (!commitResult.success) {
        logger.warn('Failed to commit AST changes', {
          component: 'ASTEditorBase',
          relativePath,
          commitMessage,
          error: commitResult.error
        });
        return undefined;
      }

      // Get the last commit to retrieve the hash
      const logResult = await gitTool.executeGitOperation(appPath, {
        operation: 'log',
        options: { count: 1 }
      });

      if (logResult.success && logResult.commits && logResult.commits.length > 0) {
        const hash = logResult.commits[0]?.hash;
        logger.debug('AST changes committed successfully', {
          component: 'ASTEditorBase',
          relativePath,
          commitHash: hash
        });
        return hash;
      }

      logger.debug('AST commit succeeded but could not retrieve commit hash', {
        component: 'ASTEditorBase',
        relativePath
      });
      return undefined;
    } catch (error) {
      logger.warn('Failed to commit AST changes', {
        error: error instanceof Error ? error.message : String(error),
        relativePath
      });
      return undefined;
    }
  }
}
