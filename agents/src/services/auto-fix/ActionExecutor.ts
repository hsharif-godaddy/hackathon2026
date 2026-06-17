import { Logger } from '../../logging/index.js';
import { createForWorkspace } from '../../workspace/index.js';
import type { WorkspaceClient } from '../../workspace/client.js';
import type { DiagnoseAction } from '../diagnose/types.js';
import type { AppliedAction } from './types.js';

const logger = Logger.create({ component: 'auto-fix.executor' });

/**
 * Tail of stdout/stderr surfaced in AppliedAction.output, measured in UTF-16
 * code units (String.length / slice) — not bytes. ~2K chars keeps the response
 * payload bounded.
 */
const OUTPUT_TAIL_CHARS = 2048;
/** Per-command timeout. The diagnose pipeline already times out around ~60s upstream. */
const COMMAND_TIMEOUT_SECONDS = 60;

/**
 * Factory hook for tests. Tests pass a fake WorkspaceClient via the
 * constructor; production wiring uses the default `createForWorkspace`.
 */
export type WorkspaceFactory = (appId: string) => WorkspaceClient | null;

export interface ActionExecutor {
  /**
   * Apply the given actions in order. Stops on the first failure — remaining
   * actions are reported as 'skipped'. Errors from the workspace adapter are
   * captured into the AppliedAction.error field rather than thrown.
   */
  execute(appId: string, actions: DiagnoseAction[]): Promise<ActionExecutionResult>;
}

/**
 * Discriminated on `success` to match AutoFixResponse / DiagnoseResponse.
 * `workspaceUnavailable` only exists on the failure branch — the service uses
 * it to choose SUPERVISOR_UNAVAILABLE over APPLY_FAILED, and the union makes
 * that branch type-safe (you can't read it off a success result).
 */
export type ActionExecutionResult =
  | { success: true; applied: AppliedAction[] }
  | {
      success: false;
      applied: AppliedAction[];
      /**
       * True when we never even acquired a workspace client — the route maps
       * this to SUPERVISOR_UNAVAILABLE rather than APPLY_FAILED.
       */
      workspaceUnavailable?: boolean;
    };

/**
 * Concrete executor that maps DiagnoseAction[] onto WorkspaceClient calls:
 *
 *   - { type: 'command' }     → workspace.tasks.runCommandSync
 *   - { type: 'file_edit' }   → workspace.files.edit (if before+after)
 *                              workspace.files.write (if only after)
 *                              skipped                (if neither)
 *
 * Stop-on-first-failure semantics — a single bad action aborts the batch.
 * The service layer is responsible for git rollback after a failure;
 * this executor stays focused on per-action mechanics.
 */
export class WorkspaceActionExecutor implements ActionExecutor {
  private readonly workspaceFactory: WorkspaceFactory;

  constructor(workspaceFactory: WorkspaceFactory = (appId) => createForWorkspace(appId, 'preview')) {
    this.workspaceFactory = workspaceFactory;
  }

  async execute(appId: string, actions: DiagnoseAction[]): Promise<ActionExecutionResult> {
    const workspace = this.workspaceFactory(appId);
    if (!workspace) {
      logger.warn('auto-fix.executor.workspace_unavailable', { appId });
      return {
        success: false,
        workspaceUnavailable: true,
        applied: actions.map((action) => ({
          action,
          status: 'failed',
          error: 'Preview workspace unavailable',
        })),
      };
    }

    const applied: AppliedAction[] = [];
    let halted = false;

    for (const action of actions) {
      if (halted) {
        applied.push({ action, status: 'skipped', output: 'aborted after prior failure' });
        continue;
      }

      const outcome = await this.runOne(workspace, action, appId);
      applied.push(outcome);
      if (outcome.status === 'failed') {
        halted = true;
      }
    }

    return halted ? { success: false, applied } : { success: true, applied };
  }

  private async runOne(
    workspace: WorkspaceClient,
    action: DiagnoseAction,
    appId: string
  ): Promise<AppliedAction> {
    try {
      if (action.type === 'command') {
        return await this.runCommand(workspace, action, appId);
      }
      return await this.runFileEdit(workspace, action, appId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('auto-fix.executor.action.threw', {
        appId,
        actionType: action.type,
        error: message,
      });
      return { action, status: 'failed', error: message };
    }
  }

  private async runCommand(
    workspace: WorkspaceClient,
    action: Extract<DiagnoseAction, { type: 'command' }>,
    appId: string
  ): Promise<AppliedAction> {
    const result = await workspace.tasks.runCommandSync({
      command: action.command,
      ...(action.cwd !== undefined ? { workingDir: action.cwd } : {}),
      timeoutSeconds: COMMAND_TIMEOUT_SECONDS,
      captureOutput: true,
    });

    const output = tailOutput(result.stdout, result.stderr);
    if (result.exitCode !== 0 || result.timedOut) {
      logger.info('auto-fix.executor.command.failed', {
        appId,
        command: action.command,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
      return {
        action,
        status: 'failed',
        ...(output ? { output } : {}),
        error: result.timedOut
          ? `Command timed out after ${COMMAND_TIMEOUT_SECONDS}s`
          : `Command exited with code ${result.exitCode}`,
      };
    }

    return {
      action,
      status: 'applied',
      ...(output ? { output } : {}),
    };
  }

  private async runFileEdit(
    workspace: WorkspaceClient,
    action: Extract<DiagnoseAction, { type: 'file_edit' }>,
    appId: string
  ): Promise<AppliedAction> {
    const hasBefore = typeof action.before === 'string' && action.before.length > 0;
    const hasAfter = typeof action.after === 'string';

    if (hasBefore && hasAfter) {
      const result = await workspace.files.edit({
        path: action.path,
        oldString: action.before as string,
        newString: action.after as string,
      });
      if (result.applied === 0) {
        return {
          action,
          status: 'failed',
          error: `No occurrences of the 'before' snippet found in ${action.path}`,
        };
      }
      return {
        action,
        status: 'applied',
        output: `${result.applied} replacement(s) in ${action.path}`,
      };
    }

    if (hasAfter) {
      const result = await workspace.files.write({
        path: action.path,
        content: action.after as string,
      });
      return {
        action,
        status: 'applied',
        output: `wrote ${result.bytesWritten} byte(s) to ${action.path}`,
      };
    }

    logger.info('auto-fix.executor.file_edit.skipped', { appId, path: action.path });
    return {
      action,
      status: 'skipped',
      output: 'file_edit action had no patch content (neither before nor after)',
    };
  }
}

function tailOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  if (combined.length === 0) return '';
  if (combined.length <= OUTPUT_TAIL_CHARS) return combined;
  return `…${combined.slice(combined.length - OUTPUT_TAIL_CHARS)}`;
}
