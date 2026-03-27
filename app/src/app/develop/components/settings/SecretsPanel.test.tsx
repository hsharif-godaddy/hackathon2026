/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import { SecretsPanel } from './SecretsPanel';

// Mock external dependencies only
vi.mock('@/utils/instrumentation', () => mockInstrumentation());
vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock the hooks
const mockMutateAsync = vi.fn();
const mockRefetch = vi.fn();

// Helper to create a mock UseQueryResult with all required properties
function createMockQueryResult(overrides: {
  data?: Array<{ name: string; systemManaged: boolean; syncStatus: string }>;
  isLoading?: boolean;
  error?: Error | null;
  dataUpdatedAt?: number;
} = {}) {
  const isLoading = overrides.isLoading ?? false;
  const error = overrides.error ?? null;
  const data = overrides.data ?? [];

  return {
    data,
    isLoading,
    error,
    refetch: mockRefetch,
    dataUpdatedAt: overrides.dataUpdatedAt ?? Date.now(),
    // Required UseQueryResult properties
    status: isLoading ? 'pending' : error ? 'error' : 'success',
    fetchStatus: 'idle',
    isError: !!error,
    isFetched: !isLoading,
    isFetchedAfterMount: !isLoading,
    isFetching: false,
    isPaused: false,
    isPending: isLoading,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: !isLoading && !error,
    isLoadingError: false,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    errorUpdatedAt: 0,
    promise: Promise.resolve(data),
    isInitialLoading: isLoading,
    isEnabled: true,
  } as unknown as ReturnType<typeof import('@/hooks/useSecrets').useSecrets>;
}

vi.mock('@/hooks/useSecrets', () => ({
  useSecrets: vi.fn(() => createMockQueryResult()),
}));

vi.mock('@/hooks/useSecretOperations', () => ({
  useSecretOperations: vi.fn(() => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  })),
}));

// Mock Growl static method
vi.mock('@ux/growl', () => ({
  default: Object.assign(
    function Growl() {
      return null;
    },
    {
      addGrowlMessage: vi.fn(),
    }
  ),
}));

// Import after mocking
import Growl from '@ux/growl';

import { useSecrets } from '@/hooks/useSecrets';

const defaultProps = {
  appId: 'test-app-id',
  variant: 'preview' as const,
};

describe('SecretsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSecrets).mockReturnValue(createMockQueryResult());
  });

  describe('loading state', () => {
    it('should display loading spinner when fetching secrets', async () => {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({ isLoading: true, dataUpdatedAt: 0 }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForSpinner() {
        expect(screen.getByText('builder_common_loading')).toBeInTheDocument();
      });
    });
  });

  describe('error state', function errorTests() {
    it('should display error state when loading fails', async function error() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({ error: new Error('Failed to load'), dataUpdatedAt: 0 }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForError() {
        expect(screen.getByText('builder_settings_secrets_error_loading_title')).toBeInTheDocument();
      });
    });

    it('should allow retry on error', async function retry() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({ error: new Error('Failed to load'), dataUpdatedAt: 0 }));

      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForRetry() {
        expect(screen.getByRole('button', { name: 'builder_common_retry' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_common_retry' }));

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('empty state', function emptyTests() {
    it('should display empty message when no secrets exist', async function empty() {
      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForEmpty() {
        expect(screen.getByText('builder_settings_secrets_no_secrets')).toBeInTheDocument();
      });
    });
  });

  describe('secrets list', function listTests() {
    it('should display existing secrets', async function displaySecrets() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [
          { name: 'API_KEY', systemManaged: false, syncStatus: 'synced' },
          { name: 'DATABASE_URL', systemManaged: false, syncStatus: 'synced' },
        ],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForSecrets() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
        expect(screen.getByDisplayValue('DATABASE_URL')).toBeInTheDocument();
      });
    });

    it('should display system-managed badge for system secrets', async function systemManaged() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' }],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForBadge() {
        expect(screen.getByText('builder_settings_secrets_tag_system')).toBeInTheDocument();
      });
    });

    it('should display deployed badge for synced secrets', async function deployedBadge() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForDeployed() {
        expect(screen.getByText('builder_settings_secrets_tag_deployed')).toBeInTheDocument();
      });
    });

    it('should display not deployed badge for added secrets', async function notDeployed() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'NEW_SECRET', systemManaged: false, syncStatus: 'added' }],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForNotDeployed() {
        expect(screen.getByText('builder_settings_secrets_tag_new')).toBeInTheDocument();
        expect(screen.getByText('builder_settings_secrets_tag_not_deployed')).toBeInTheDocument();
      });
    });
  });

  describe('adding new secrets', function addTests() {
    it('should show new secret input fields', async function newInputs() {
      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForInputs() {
        expect(screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_value')).toBeInTheDocument();
      });
    });

    it('should validate secret name format', async function validateName() {
      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      await user.type(nameInput, 'a');

      await waitFor(function waitForValidation() {
        expect(screen.getByText('builder_common_field_req_min_characters')).toBeInTheDocument();
      });
    });

    it('should auto-capitalize secret names', async function autoCapitalize() {
      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      await user.type(nameInput, 'my_secret');

      await waitFor(function waitForCapitalize() {
        expect(nameInput).toHaveValue('MY_SECRET');
      });
    });

    it('should show error when name starts with number', async function invalidStart() {
      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      await user.type(nameInput, '123ABC');

      await waitFor(function waitForError() {
        expect(screen.getByText('builder_common_field_req_start_with')).toBeInTheDocument();
      });
    });
  });

  describe('editing secrets', function editTests() {
    it('should enable edit mode when edit button is clicked', async function enableEdit() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      const editButton = screen.getByRole('button', { name: 'builder_common_edit' });
      await user.click(editButton);

      await waitFor(function waitForEdit() {
        // Both the new secret input and the edited secret input have the same placeholder
        const valueInputs = screen.getAllByPlaceholderText('builder_settings_secrets_placeholder_key_value');
        expect(valueInputs).toHaveLength(2);
      });
    });

    it('should not allow editing system-managed secrets', async function noSystemEdit() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' }],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('SYSTEM_SECRET')).toBeInTheDocument();
      });

      const editButton = screen.getByRole('button', { name: 'builder_common_edit' });
      expect(editButton).toBeDisabled();
    });
  });

  describe('deleting secrets', function deleteTests() {
    it('should mark secret for deletion when delete button is clicked', async function markDelete() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      const deleteButton = screen.getByRole('button', { name: 'builder_common_delete' });
      await user.click(deleteButton);

      await waitFor(function waitForDelete() {
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
      });
    });

    it('should not allow deleting system-managed secrets', async function noSystemDelete() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' }],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('SYSTEM_SECRET')).toBeInTheDocument();
      });

      const deleteButton = screen.getByRole('button', { name: 'builder_common_delete' });
      expect(deleteButton).toBeDisabled();
    });
  });

  describe('submit functionality', function submitTests() {
    it('should disable save button when no changes', async function noChanges() {
      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForButton() {
        const saveButton = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
        expect(saveButton).toBeDisabled();
      });
    });

    it('should enable save button when valid new secret is added', async function enableSave() {
      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      const valueInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_value');

      await user.type(nameInput, 'MY_NEW_SECRET');
      await user.type(valueInput, 'secret-value');

      await waitFor(function waitForEnable() {
        const saveButton = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
        expect(saveButton).not.toBeDisabled();
      });
    });

    it('should call mutateAsync on submit', async function submit() {
      mockMutateAsync.mockResolvedValue({});

      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      const valueInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_value');

      await user.type(nameInput, 'MY_NEW_SECRET');
      await user.type(valueInput, 'secret-value');

      const saveButton = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
      await user.click(saveButton);

      await waitFor(function waitForSubmit() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [],
            deletions: [],
            additions: [{ name: 'MY_NEW_SECRET', value: 'secret-value' }],
          },
        });
      });
    });

    it('should show success growl on successful submit', async function successGrowl() {
      mockMutateAsync.mockResolvedValue({});

      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      const valueInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_value');

      await user.type(nameInput, 'MY_NEW_SECRET');
      await user.type(valueInput, 'secret-value');

      const saveButton = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
      await user.click(saveButton);

      await waitFor(function waitForGrowl() {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith({
          id: 'secrets-success',
          title: 'builder_status_success',
          children: 'builder_settings_secrets_success_saving_description',
          emphasis: 'success',
          lifetime: 5000,
        });
      });
    });

    it('should show error growl on failed submit', async function errorGrowl() {
      mockMutateAsync.mockRejectedValue(new Error('API Error'));

      const { user } = renderWithProviders(<SecretsPanel {...defaultProps} />);

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      const valueInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_value');

      await user.type(nameInput, 'MY_NEW_SECRET');
      await user.type(valueInput, 'secret-value');

      const saveButton = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
      await user.click(saveButton);

      await waitFor(function waitForError() {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith({
          id: 'secrets-error',
          title: 'builder_status_failed',
          children: 'API Error',
          emphasis: 'critical',
        });
      });
    });
  });

  describe('info alert', function infoTests() {
    it('should display info alert when secrets are not deployed', async function infoAlert() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'NEW_SECRET', systemManaged: false, syncStatus: 'added' }],
      }));

      renderWithProviders(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForAlert() {
        expect(screen.getByText('builder_settings_secrets_alert_notdeployed_title')).toBeInTheDocument();
        expect(screen.getByText('builder_settings_secrets_alert_notdeployed_children')).toBeInTheDocument();
      });
    });
  });
});
