import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createForWorkspace } from '../index.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';

describe('createForWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when createForApp returns null', () => {
    vi.spyOn(DevSupervisorClientFactory, 'createForApp').mockReturnValue(null);
    expect(createForWorkspace('wksp-1', 'preview')).toBeNull();
  });

  it('returns null when createForApp throws (unknown workspace)', () => {
    vi.spyOn(DevSupervisorClientFactory, 'createForApp').mockImplementation(() => {
      throw new Error('App with ID unknown not found');
    });
    expect(createForWorkspace('unknown', 'preview')).toBeNull();
  });

  it('returns null when createForPublishSupervisor throws', () => {
    vi.spyOn(DevSupervisorClientFactory, 'createForPublishSupervisor').mockImplementation(() => {
      throw new Error('App with ID unknown not found');
    });
    expect(createForWorkspace('unknown', 'publish')).toBeNull();
  });

  it('returns a WorkspaceClient bound to preview when the preview client exists', () => {
    const fakeClient = { isAvailable: () => true } as any;
    vi.spyOn(DevSupervisorClientFactory, 'createForApp').mockReturnValue(fakeClient);
    const client = createForWorkspace('wksp-1', 'preview');
    expect(client).not.toBeNull();
    expect(client?.workspaceId).toBe('wksp-1');
    expect(client?.variant).toBe('preview');
  });

  it('returns a WorkspaceClient bound to publish when the publish supervisor is reachable', () => {
    const fakeClient = { isAvailable: () => true } as any;
    const spy = vi
      .spyOn(DevSupervisorClientFactory, 'createForPublishSupervisor')
      .mockReturnValue(fakeClient);
    const client = createForWorkspace('wksp-1', 'publish');
    expect(client?.variant).toBe('publish');
    expect(spy).toHaveBeenCalledWith('wksp-1');
  });
});
