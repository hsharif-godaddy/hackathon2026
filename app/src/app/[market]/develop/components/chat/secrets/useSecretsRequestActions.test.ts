/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { ActiveSecretsRequest } from './types';
import { useSecretsRequestActions } from './useSecretsRequestActions';

// Mock dependencies
const mockSendMessage = vi.fn();
const mockMutateAsync = vi.fn();
const mockResolveSecretsComposerToolCall = vi.fn();
const mockCancelSecretsComposerToolCall = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockT = vi.fn((key: string, _values?: unknown, fallback?: string) => fallback || key);
const mockSecretOperations = vi.hoisted(() => ({
  isPending: false,
}));
const mockStreamingState = vi.hoisted(() => ({ value: 'idle' as 'idle' | 'streaming' }));

vi.mock('@/contexts/WebSocketContext', () => ({
  useWebSocketContext: () => ({ sendMessage: mockSendMessage }),
}));

vi.mock('@/hooks/useSecretOperations', () => ({
  useSecretOperations: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockSecretOperations.isPending,
  }),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => mockT,
}));

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: vi.fn(),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useCurrentAppId: () => 'test-app-id',
  useStreamingState: () => mockStreamingState.value,
  useStreamingConversationStore: (selector: (state: any) => any) =>
    selector({
      resolveSecretsComposerToolCall: mockResolveSecretsComposerToolCall,
      cancelSecretsComposerToolCall: mockCancelSecretsComposerToolCall,
    }),
}));

function createRequest(overrides?: Partial<ActiveSecretsRequest>): ActiveSecretsRequest {
  return {
    secretKey: 'tool-123:SECRET_KEY',
    toolCallId: 'tool-123',
    allSecretNames: ['SECRET_KEY'],
    payload: {
      type: 'secrets_request',
      title: 'Test Secret',
      description: 'Test description',
      secrets: [{ name: 'SECRET_KEY', required: true }],
      mode: 'add',
      allowMultiple: false,
      showSettingsLink: true,
      autoSubmit: false,
      existingSecretNames: [],
    },
    ...overrides,
  };
}

describe('useSecretsRequestActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSecretOperations.isPending = false;
    mockStreamingState.value = 'idle';
    mockSendMessage.mockResolvedValue(true);
    mockMutateAsync.mockResolvedValue(undefined);
  });

  describe('submitOne', () => {
    it('persists a single new secret and resolves tool call', async () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('my-secret-value');

      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'test-app-id',
        variant: 'preview',
        operations: {
          additions: [{ name: 'SECRET_KEY', value: 'my-secret-value' }],
          updates: undefined,
        },
      });

      expect(mockResolveSecretsComposerToolCall).toHaveBeenCalledWith('tool-123:SECRET_KEY');
    });

    it('sends confirmation message after successful save', async () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('value');

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:added]] Secret added successfully: SECRET_KEY',
        });
      });
    });

    it('invalidates next-actions so Continue building can refetch suggestions', async () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('value');

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['next-actions', 'test-app-id'],
      });
    });

    it('uses "updated" message for update mode', async () => {
      const request = createRequest({
        payload: {
          ...createRequest().payload,
          mode: 'update',
          secrets: [{ name: 'SECRET_KEY', required: true, isExisting: true }],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('value');

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:updated]] Secret updated successfully: SECRET_KEY',
        });
      });
    });

    it('marks existing secrets as updates', async () => {
      const request = createRequest({
        payload: {
          ...createRequest().payload,
          secrets: [{ name: 'SECRET_KEY', required: true, isExisting: true }],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('value');

      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'test-app-id',
        variant: 'preview',
        operations: {
          additions: undefined,
          updates: [{ name: 'SECRET_KEY', value: 'value' }],
        },
      });
    });

    it('trims whitespace from values', async () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('  value-with-spaces  ');

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: {
            additions: [{ name: 'SECRET_KEY', value: 'value-with-spaces' }],
            updates: undefined,
          },
        }),
      );
    });

    it('does nothing when request is null', async () => {
      const { result } = renderHook(() => useSecretsRequestActions(null, 'conv-1'));

      await result.current.submitOne('value');

      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('does nothing while the assistant stream is still active', async () => {
      mockStreamingState.value = 'streaming';
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('value');

      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(mockResolveSecretsComposerToolCall).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('logs error and does not resolve on mutation failure', async () => {
      const error = new Error('Network error');
      mockMutateAsync.mockRejectedValue(error);
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await expect(result.current.submitOne('value')).rejects.toThrow('Network error');

      expect(mockResolveSecretsComposerToolCall).not.toHaveBeenCalled();
    });
  });

  describe('submitMulti', () => {
    it('persists multiple secrets and resolves all tool calls', async () => {
      const request = createRequest({
        displayMode: 'paginated',
        secretKey: 'tool-123:batch',
        allSecretNames: ['SECRET_KEY_1', 'SECRET_KEY_2'],
        payload: {
          ...createRequest().payload,
          secrets: [
            { name: 'SECRET_KEY_1', required: true },
            { name: 'SECRET_KEY_2', required: true },
          ],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({
        SECRET_KEY_1: 'value1',
        SECRET_KEY_2: 'value2',
      });

      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'test-app-id',
        variant: 'preview',
        operations: {
          additions: [
            { name: 'SECRET_KEY_1', value: 'value1' },
            { name: 'SECRET_KEY_2', value: 'value2' },
          ],
          updates: undefined,
        },
      });

      expect(mockResolveSecretsComposerToolCall).toHaveBeenCalledTimes(1);
      expect(mockResolveSecretsComposerToolCall).toHaveBeenCalledWith('tool-123:batch');
    });

    it('sends plural confirmation message for multiple secrets', async () => {
      const request = createRequest({
        allSecretNames: ['KEY_1', 'KEY_2'],
        payload: {
          ...createRequest().payload,
          secrets: [
            { name: 'KEY_1', required: true },
            { name: 'KEY_2', required: true },
          ],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({
        KEY_1: 'value1',
        KEY_2: 'value2',
      });

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:added]] Secrets added successfully: KEY_1, KEY_2',
        });
      });
    });

    it('sends singular confirmation message for one secret', async () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({ SECRET_KEY: 'value' });

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:added]] Secret added successfully: SECRET_KEY',
        });
      });
    });

    it('sends confirmation only for secrets that were actually persisted', async () => {
      const request = createRequest({
        allSecretNames: ['REQUIRED_KEY', 'OPTIONAL_KEY'],
        payload: {
          ...createRequest().payload,
          secrets: [
            { name: 'REQUIRED_KEY', required: true },
            { name: 'OPTIONAL_KEY', required: false },
          ],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({
        REQUIRED_KEY: 'value1',
        OPTIONAL_KEY: '',
      });

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:added]] Secret added successfully: REQUIRED_KEY',
        });
      });
    });

    it('splits existing vs new secrets correctly', async () => {
      const request = createRequest({
        allSecretNames: ['EXISTING_KEY', 'NEW_KEY'],
        payload: {
          ...createRequest().payload,
          secrets: [
            { name: 'EXISTING_KEY', required: true, isExisting: true },
            { name: 'NEW_KEY', required: true },
          ],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({
        EXISTING_KEY: 'updated-value',
        NEW_KEY: 'new-value',
      });

      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId: 'test-app-id',
        variant: 'preview',
        operations: {
          additions: [{ name: 'NEW_KEY', value: 'new-value' }],
          updates: [{ name: 'EXISTING_KEY', value: 'updated-value' }],
        },
      });
    });

    it('throws error when all values are empty (trimmed to empty)', async () => {
      const request = createRequest({
        payload: {
          ...createRequest().payload,
          secrets: [{ name: 'KEY', required: false }],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await expect(result.current.submitMulti({})).rejects.toThrow('No secret value to save');

      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('does nothing when request is null', async () => {
      const { result } = renderHook(() => useSecretsRequestActions(null, 'conv-1'));

      await result.current.submitMulti({ KEY: 'value' });

      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('does nothing while the assistant stream is still active', async () => {
      mockStreamingState.value = 'streaming';
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({ SECRET_KEY: 'value' });

      expect(mockMutateAsync).not.toHaveBeenCalled();
      expect(mockResolveSecretsComposerToolCall).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels all tool calls for the request', () => {
      const request = createRequest({
        allSecretNames: ['KEY_1', 'KEY_2'],
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      result.current.cancel();

      expect(mockCancelSecretsComposerToolCall).toHaveBeenCalledWith('tool-123', ['KEY_1', 'KEY_2']);
    });

    it('sends cancellation message', async () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      result.current.cancel();

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:cancel]]',
        });
      });
    });

    it('invalidates next-actions so Continue building can refetch suggestions', () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      result.current.cancel();

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ['next-actions', 'test-app-id'],
      });
    });

    it('does nothing when request is null', () => {
      const { result } = renderHook(() => useSecretsRequestActions(null, 'conv-1'));

      result.current.cancel();

      expect(mockCancelSecretsComposerToolCall).not.toHaveBeenCalled();
    });

    it('does nothing while a save is in flight', () => {
      mockSecretOperations.isPending = true;
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      result.current.cancel();

      expect(mockCancelSecretsComposerToolCall).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('still cancels while the assistant stream is still active', async () => {
      mockStreamingState.value = 'streaming';
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      result.current.cancel();

      expect(mockCancelSecretsComposerToolCall).toHaveBeenCalledWith('tool-123', ['SECRET_KEY']);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:cancel]]',
        });
      });
    });
  });

  describe('isPending', () => {
    it('returns false by default', () => {
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      expect(result.current.isPending).toBe(false);
      expect(result.current.isClosePending).toBe(false);
    });

    it('returns true while the assistant stream is still active', () => {
      mockStreamingState.value = 'streaming';
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      expect(result.current.isPending).toBe(true);
      expect(result.current.isClosePending).toBe(false);
    });
  });

  describe('error handling', () => {
    it('logs when continuation message delivery throws without showing growl', async () => {
      const { logger } = await import('@/lib/request-context');
      const Growl = (await import('@ux/growl')).default;
      mockSendMessage.mockRejectedValue(new Error('WebSocket disconnected'));
      const request = createRequest();
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitOne('value');

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          content: '[[secrets-composer-outcome:added]] Secret added successfully: SECRET_KEY',
        });
        expect(logger.error).toHaveBeenCalledWith(
          'secrets.panel.messageDeliveryFailed',
          expect.objectContaining({
            conversationId: 'conv-1',
            appId: 'test-app-id',
            toolCallId: 'tool-123',
            error: 'WebSocket disconnected',
          }),
        );
      });

      expect(Growl.addGrowlMessage).not.toHaveBeenCalled();
    });

    it('skips empty secret names and values in operations', async () => {
      const request = createRequest({
        payload: {
          ...createRequest().payload,
          secrets: [
            { name: 'VALID_KEY', required: true },
            { name: '', required: false }, // Empty name
          ],
        },
      });
      const { result } = renderHook(() => useSecretsRequestActions(request, 'conv-1'));

      await result.current.submitMulti({
        VALID_KEY: 'value',
        '': '', // Empty name with empty value
      });

      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: {
            additions: [{ name: 'VALID_KEY', value: 'value' }],
            updates: undefined,
          },
        }),
      );
    });
  });
});
