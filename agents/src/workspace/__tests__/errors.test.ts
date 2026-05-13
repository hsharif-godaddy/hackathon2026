import { describe, it, expect } from 'vitest';
import {
  WorkspaceUnavailableError,
  VariantNotApplicableError,
  WorkspaceNotImplementedError,
  WorkspaceTaskFailedError,
  WorkspaceValidationError,
} from '../errors.js';

describe('workspace errors', () => {
  it('WorkspaceUnavailableError carries workspaceId and variant', () => {
    const err = new WorkspaceUnavailableError('wksp-1', 'preview', 'socket not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WorkspaceUnavailableError');
    expect(err.workspaceId).toBe('wksp-1');
    expect(err.variant).toBe('preview');
    expect(err.message).toContain('wksp-1');
    expect(err.message).toContain('preview');
    expect(err.message).toContain('socket not found');
  });

  it('VariantNotApplicableError names the method and variant', () => {
    const err = new VariantNotApplicableError('imports.start', 'publish');
    expect(err.name).toBe('VariantNotApplicableError');
    expect(err.method).toBe('imports.start');
    expect(err.variant).toBe('publish');
    expect(err.message).toContain('imports.start');
    expect(err.message).toContain('publish');
  });

  it('WorkspaceNotImplementedError names the method', () => {
    const err = new WorkspaceNotImplementedError('files.tree');
    expect(err.name).toBe('WorkspaceNotImplementedError');
    expect(err.method).toBe('files.tree');
    expect(err.message).toContain('files.tree');
  });

  it('WorkspaceTaskFailedError carries taskId and optional exit code', () => {
    const err = new WorkspaceTaskFailedError('task-42', 'non-zero exit', 127);
    expect(err.name).toBe('WorkspaceTaskFailedError');
    expect(err.taskId).toBe('task-42');
    expect(err.exitCode).toBe(127);
  });

  it('WorkspaceValidationError optionally carries field', () => {
    const err = new WorkspaceValidationError('commitHash is required', 'commitHash');
    expect(err.name).toBe('WorkspaceValidationError');
    expect(err.field).toBe('commitHash');
  });
});
