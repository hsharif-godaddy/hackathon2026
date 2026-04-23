/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

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
  data?: Array<{ name: string; systemManaged: boolean; syncStatus: string; value?: string }>;
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

const clipboardWriteTextMock = vi.fn(() => Promise.resolve());

const defaultProps = {
  appId: 'test-app-id',
  variant: 'preview' as const,
};

/** Menu trigger uses defaultMessage when the i18n key is not in the test bundle. */
const rowMenuButton = () =>
  screen.getByRole('button', { name: /Secret actions|builder_settings_secrets_row_actions/ });
const queryRowMenuButton = () =>
  screen.queryByRole('button', { name: /Secret actions|builder_settings_secrets_row_actions/ });

const showValueButton = () =>
  screen.getByRole('button', { name: /Show value|builder_settings_secrets_show_value/ });
const hideValueButton = () =>
  screen.getByRole('button', { name: /Hide value|builder_settings_secrets_hide_value/ });
const copySecretButton = () =>
  screen.getByRole('button', { name: /Copy to clipboard|builder_common_copy_clipboard/ });

/** Re-bind after render: jsdom/happy-dom can replace `navigator.clipboard` when the document mounts. */
function renderSecretsPanel(ui: ReactElement = <SecretsPanel {...defaultProps} />) {
  const result = renderWithProviders(ui);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteTextMock },
    configurable: true,
    writable: true,
  });
  return result;
}

describe('SecretsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clipboardWriteTextMock.mockClear();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue({});
    vi.mocked(useSecrets).mockReset();
    vi.mocked(useSecrets).mockReturnValue(createMockQueryResult());
  });

  describe('loading state', () => {
    it('should display skeleton when fetching secrets', async () => {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({ isLoading: true, dataUpdatedAt: 0 }));

      renderSecretsPanel();

      await waitFor(function waitForSkeleton() {
        expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument();
      });
    });
  });

  describe('error state', function errorTests() {
    it('should display error state when loading fails', async function error() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({ error: new Error('Failed to load'), dataUpdatedAt: 0 }));

      renderSecretsPanel();

      await waitFor(function waitForError() {
        expect(screen.getByText('builder_settings_secrets_error_loading_title')).toBeInTheDocument();
      });
    });

    it('should allow retry on error', async function retry() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({ error: new Error('Failed to load'), dataUpdatedAt: 0 }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRetry() {
        expect(screen.getByRole('button', { name: 'builder_common_retry' })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: 'builder_common_retry' }));

      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('empty state', function emptyTests() {
    it('should display empty message when no secrets exist', async function empty() {
      renderSecretsPanel();

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

      renderSecretsPanel();

      await waitFor(function waitForSecrets() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
        expect(screen.getByDisplayValue('DATABASE_URL')).toBeInTheDocument();
      });
    });

    it('should list user-managed secrets before system-managed secrets', async function userSecretsFirst() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [
          { name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' },
          { name: 'API_KEY', systemManaged: false, syncStatus: 'synced' },
        ],
      }));

      renderSecretsPanel();

      await waitFor(function waitForOrder() {
        const userSecret = screen.getByDisplayValue('API_KEY');
        const systemSecret = screen.getByDisplayValue('SYSTEM_SECRET');
        expect(
          userSecret.compareDocumentPosition(systemSecret) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
      });
    });

    it('should display system-managed badge for system secrets', async function systemManaged() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForBadge() {
        expect(screen.getByText('builder_settings_secrets_tag_system')).toBeInTheDocument();
      });
    });

    it('should display deployed badge for synced secrets', async function deployedBadge() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForDeployed() {
        expect(screen.getByText('builder_settings_secrets_tag_deployed')).toBeInTheDocument();
      });
    });

    it('should display not deployed badge for added secrets', async function notDeployed() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'NEW_SECRET', systemManaged: false, syncStatus: 'added' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForNotDeployed() {
        expect(screen.getByText('builder_settings_secrets_tag_new')).toBeInTheDocument();
        expect(screen.getByText('builder_settings_secrets_tag_not_deployed')).toBeInTheDocument();
      });
    });
  });

  describe('adding new secrets', function addTests() {
    it('should show new secret input fields', async function newInputs() {
      renderSecretsPanel();

      await waitFor(function waitForInputs() {
        expect(screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_value')).toBeInTheDocument();
      });
    });

    it('should validate secret name format', async function validateName() {
      const { user } = renderSecretsPanel();

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      await user.type(nameInput, 'a');

      await waitFor(function waitForValidation() {
        expect(screen.getByText('builder_common_field_req_min_characters')).toBeInTheDocument();
      });
    });

    it('should auto-capitalize secret names', async function autoCapitalize() {
      const { user } = renderSecretsPanel();

      const nameInput = screen.getByPlaceholderText('builder_settings_secrets_placeholder_key_name');
      await user.type(nameInput, 'my_secret');

      await waitFor(function waitForCapitalize() {
        expect(nameInput).toHaveValue('MY_SECRET');
      });
    });

    it('should show error when name starts with number', async function invalidStart() {
      const { user } = renderSecretsPanel();

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

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      const editItem = await screen.findByRole('menuitem', { name: 'builder_common_edit' });
      await user.click(editItem);

      await waitFor(function waitForEdit() {
        const valueInputs = screen.getAllByPlaceholderText('builder_settings_secrets_placeholder_key_value');
        expect(valueInputs).toHaveLength(1);
        expect(screen.getByRole('button', { name: /builder_common_save.*API_KEY/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'builder_common_cancel' })).toBeInTheDocument();
      });
    });

    it('auto-cancels edit on blur when value is empty', async function autoCancelEmptyBlur() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      const textarea = document.getElementById('secretValue-0');
      expect(textarea).not.toBeNull();

      fireEvent.blur(textarea as HTMLElement);
      document.body.setAttribute('tabindex', '-1');
      (document.body as HTMLBodyElement).focus();

      await waitFor(function waitForExitEdit() {
        expect(screen.queryByRole('button', { name: 'builder_common_cancel' })).not.toBeInTheDocument();
      });
    });

    it('should not allow editing system-managed secrets', async function noSystemEdit() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('SYSTEM_SECRET')).toBeInTheDocument();
      });

      expect(queryRowMenuButton()).not.toBeInTheDocument();
    });
  });

  describe('single-row save', function singleRowSaveTests() {
    it('should save a single edited secret from row save button', async function saveSingle() {
      mockMutateAsync.mockResolvedValue({});
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'QUOTE_RECIPIENT_EMAIL', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('QUOTE_RECIPIENT_EMAIL')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      const editedValueInput = document.getElementById('secretValue-0');
      expect(editedValueInput).not.toBeNull();
      await user.type(editedValueInput as HTMLElement, 'new@example.com');

      await user.click(screen.getByRole('button', { name: /builder_common_save.*QUOTE_RECIPIENT_EMAIL/ }));

      await waitFor(function waitForSubmit() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [{ name: 'QUOTE_RECIPIENT_EMAIL', value: 'new@example.com' }],
            deletions: [],
            additions: [],
          },
        });
      });
    });

    it('disables global save while a row save mutation is pending', async function globalSaveDisabledDuringRowSave() {
      let resolveRow!: (value: unknown) => void;
      mockMutateAsync.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRow = resolve;
          })
      );

      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'PENDING_ROW', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('PENDING_ROW')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      const editedValueInput = document.getElementById('secretValue-0');
      expect(editedValueInput).not.toBeNull();
      await user.type(editedValueInput as HTMLElement, 'new-row-value');

      await user.click(screen.getByRole('button', { name: /builder_common_save.*PENDING_ROW/ }));

      await waitFor(function waitForRowMutate() {
        expect(mockMutateAsync).toHaveBeenCalledTimes(1);
      });

      const bulkSave = screen.getByRole('button', {
        name: /builder_settings_secrets_(save|saving)/,
      });
      expect(bulkSave).toBeDisabled();

      resolveRow({});
      await waitFor(function waitForSavingLabelClear() {
        expect(screen.queryByText('builder_settings_secrets_saving')).not.toBeInTheDocument();
      });
      expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    });

    it('should preserve other staged row changes after single-row save refetch', async function preserveStaged() {
      mockMutateAsync.mockResolvedValue({});
      const queryState = {
        data: [
          { name: 'FIRST_SECRET', systemManaged: false, syncStatus: 'synced' },
          { name: 'SECOND_SECRET', systemManaged: false, syncStatus: 'synced' },
        ],
        dataUpdatedAt: 1000,
      };

      vi.mocked(useSecrets).mockImplementation(() => createMockQueryResult(queryState));

      const { user, rerender } = renderSecretsPanel();

      await waitFor(function waitForSecrets() {
        expect(screen.getByDisplayValue('FIRST_SECRET')).toBeInTheDocument();
        expect(screen.getByDisplayValue('SECOND_SECRET')).toBeInTheDocument();
      });

      const rowMenus = screen.getAllByRole('button', { name: /Secret actions|builder_settings_secrets_row_actions/ });
      await user.click(rowMenus[1]);
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_delete' }));

      await waitFor(function waitForDeleteTag() {
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
      });

      const rowMenusAgain = screen.getAllByRole('button', { name: /Secret actions|builder_settings_secrets_row_actions/ });
      await user.click(rowMenusAgain[0]);
      const editFirstRowMenuItem = document.getElementById('secret-edit-0');
      expect(editFirstRowMenuItem).not.toBeNull();
      await user.click(editFirstRowMenuItem as HTMLElement);

      const firstValueInput = document.getElementById('secretValue-0');
      expect(firstValueInput).not.toBeNull();
      await user.type(firstValueInput as HTMLElement, 'updated-first-secret');

      await user.click(screen.getByRole('button', { name: /builder_common_save.*FIRST_SECRET/ }));

      await waitFor(function waitForSingleSave() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [{ name: 'FIRST_SECRET', value: 'updated-first-secret' }],
            deletions: [],
            additions: [],
          },
        });
      });

      queryState.dataUpdatedAt = 2000;
      rerender(<SecretsPanel {...defaultProps} />);

      await waitFor(function waitForStagedState() {
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
        expect(screen.getByDisplayValue('SECOND_SECRET')).toBeInTheDocument();
      });
    });

    it('should show error growl and keep row in edit mode when row save fails', async function saveSingleError() {
      mockMutateAsync.mockRejectedValue(new Error('Row save failed'));
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'QUOTE_RECIPIENT_EMAIL', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('QUOTE_RECIPIENT_EMAIL')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      const editedValueInput = document.getElementById('secretValue-0');
      expect(editedValueInput).not.toBeNull();
      await user.type(editedValueInput as HTMLElement, 'new@example.com');
      await user.click(screen.getByRole('button', { name: /builder_common_save.*QUOTE_RECIPIENT_EMAIL/ }));

      await waitFor(function waitForErrorGrowl() {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith({
          id: 'secrets-row-error-QUOTE_RECIPIENT_EMAIL',
          title: 'builder_status_failed',
          children: 'Row save failed',
          emphasis: 'critical',
        });
      });

      await waitFor(function waitForStillEditing() {
        expect(screen.getByRole('button', { name: /builder_common_save.*QUOTE_RECIPIENT_EMAIL/ })).toBeInTheDocument();
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_edit')).toBeInTheDocument();
      });
    });

    it('should cancel row edit without saving', async function cancel() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'QUOTE_RECIPIENT_EMAIL', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('QUOTE_RECIPIENT_EMAIL')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      await waitFor(function waitForEditRow() {
        expect(screen.getByRole('button', { name: /builder_common_save.*QUOTE_RECIPIENT_EMAIL/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'builder_common_cancel' })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: 'builder_common_cancel' }));

      await waitFor(function waitForCancel() {
        expect(screen.queryByRole('button', { name: /builder_common_save.*QUOTE_RECIPIENT_EMAIL/ })).not.toBeInTheDocument();
        expect(mockMutateAsync).not.toHaveBeenCalled();
      });
    });

    it('should keep row save disabled when edited value is empty', async function disabledSave() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'QUOTE_RECIPIENT_EMAIL', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('QUOTE_RECIPIENT_EMAIL')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      await waitFor(function waitForEditRow() {
        expect(screen.getByRole('button', { name: 'builder_common_cancel' })).toBeInTheDocument();
      });
      const rowSave = screen.getByRole('button', {
        name: /builder_common_save.*QUOTE_RECIPIENT_EMAIL/,
      });
      expect(rowSave).toBeDisabled();
    });
  });

  describe('show, hide, and copy actions', function revealCopyTests() {
    it('reveals API value when show is clicked and masks again when hide is clicked', async function revealHide() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced', value: 'plain-from-api' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      expect(screen.queryByDisplayValue('plain-from-api')).not.toBeInTheDocument();

      await user.click(showValueButton());
      await waitFor(function waitForRevealed() {
        expect(screen.getByDisplayValue('plain-from-api')).toBeInTheDocument();
      });

      await user.click(hideValueButton());
      await waitFor(function waitForMasked() {
        expect(screen.queryByDisplayValue('plain-from-api')).not.toBeInTheDocument();
      });
    });

    it('copies plaintext via clipboard.writeText with the correct value', async function copyValue() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced', value: 'copy-me' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(copySecretButton());

      expect(clipboardWriteTextMock).toHaveBeenCalledWith('copy-me');
    });

    it('includes secret name in growl when copy to clipboard fails', async function copyFailureGrowl() {
      clipboardWriteTextMock.mockRejectedValueOnce(new Error('denied'));

      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'NAMED_KEY', systemManaged: false, syncStatus: 'synced', value: 'secret-val' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('NAMED_KEY')).toBeInTheDocument();
      });

      await user.click(showValueButton());
      await waitFor(function waitForReveal() {
        expect(screen.getByDisplayValue('secret-val')).toBeInTheDocument();
      });

      await user.click(copySecretButton());

      await waitFor(function waitForGrowl() {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'secret-copy-failed-NAMED_KEY',
            children: expect.stringContaining('NAMED_KEY'),
          })
        );
      });
    });

    it('disables show and copy when no API value and no session cache', async function disabledNoPlaintext() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      expect(showValueButton()).toBeDisabled();
      expect(copySecretButton()).toBeDisabled();
    });

    it('uses session plaintext after save for copy', async function sessionCopy() {
      mockMutateAsync.mockResolvedValue({});

      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      await waitFor(function waitForEditRow() {
        expect(screen.getByRole('button', { name: 'builder_common_cancel' })).toBeInTheDocument();
      });
      const editedValueInput = document.getElementById('secretValue-0');
      expect(editedValueInput).not.toBeNull();
      await user.type(editedValueInput as HTMLElement, 'persisted-after-save');

      const rowSave = screen.getByRole('button', { name: /builder_common_save.*API_KEY/ });
      await user.click(rowSave);

      await waitFor(function waitForSubmit() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [{ name: 'API_KEY', value: 'persisted-after-save' }],
            deletions: [],
            additions: [],
          },
        });
      });

      clipboardWriteTextMock.mockClear();
      await user.click(copySecretButton());

      expect(clipboardWriteTextMock).toHaveBeenCalledWith('persisted-after-save');
    });
  });

  describe('deleting secrets', function deleteTests() {
    it('should mark secret for deletion when delete button is clicked', async function markDelete() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      const deleteItem = await screen.findByRole('menuitem', { name: 'builder_common_delete' });
      await user.click(deleteItem);

      await waitFor(function waitForDelete() {
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
      });
    });

    it('should not allow deleting system-managed secrets', async function noSystemDelete() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'SYSTEM_SECRET', systemManaged: true, syncStatus: 'synced' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForSecret() {
        expect(screen.getByDisplayValue('SYSTEM_SECRET')).toBeInTheDocument();
      });

      expect(queryRowMenuButton()).not.toBeInTheDocument();
    });
  });

  describe('submit functionality', function submitTests() {
    it('should disable save button when no changes', async function noChanges() {
      renderSecretsPanel();

      await waitFor(function waitForButton() {
        const saveButton = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
        expect(saveButton).toBeDisabled();
      });
    });

    it('should enable save button when valid new secret is added', async function enableSave() {
      const { user } = renderSecretsPanel();

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

      const { user } = renderSecretsPanel();

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

      const { user } = renderSecretsPanel();

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

      const { user } = renderSecretsPanel();

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

    it('should call mutateAsync with operations.updates when global save after editing an existing secret', async function globalSaveUpdates() {
      mockMutateAsync.mockResolvedValue({});

      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_edit' }));

      await waitFor(function waitForEditRow() {
        expect(screen.getByRole('button', { name: 'builder_common_cancel' })).toBeInTheDocument();
      });
      await user.type(document.getElementById('secretValue-0') as HTMLElement, 'rotated-global');

      const globalSave = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
      expect(globalSave).not.toBeDisabled();
      await user.click(globalSave);

      await waitFor(function waitForMutate() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [{ name: 'API_KEY', value: 'rotated-global' }],
            deletions: [],
            additions: [],
          },
        });
      });
    });

    it('should call mutateAsync with operations.deletions when global save after marking a secret for deletion', async function globalSaveDeletions() {
      mockMutateAsync.mockResolvedValue({});

      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'API_KEY', systemManaged: false, syncStatus: 'synced' }],
      }));

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRow() {
        expect(screen.getByDisplayValue('API_KEY')).toBeInTheDocument();
      });

      await user.click(rowMenuButton());
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_delete' }));

      await waitFor(function waitForDeleteTag() {
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
      });

      const globalSave = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
      expect(globalSave).not.toBeDisabled();
      await user.click(globalSave);

      await waitFor(function waitForMutate() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [],
            deletions: ['API_KEY'],
            additions: [],
          },
        });
      });
    });

    it('should leave edit mode and deletion marks unchanged when global save fails', async function globalSaveFailurePreservesState() {
      mockMutateAsync.mockRejectedValue(new Error('Batch save failed'));

      vi.mocked(useSecrets).mockReturnValue(
        createMockQueryResult({
          data: [
            { name: 'FIRST_SECRET', systemManaged: false, syncStatus: 'synced' },
            { name: 'SECOND_SECRET', systemManaged: false, syncStatus: 'synced' },
          ],
        })
      );

      const { user } = renderSecretsPanel();

      await waitFor(function waitForRows() {
        expect(screen.getByDisplayValue('FIRST_SECRET')).toBeInTheDocument();
        expect(screen.getByDisplayValue('SECOND_SECRET')).toBeInTheDocument();
      });

      const rowMenus = screen.getAllByRole('button', { name: /Secret actions|builder_settings_secrets_row_actions/ });
      await user.click(rowMenus[1]);
      await user.click(await screen.findByRole('menuitem', { name: 'builder_common_delete' }));

      await waitFor(function waitForDeleteTag() {
        expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
      });

      const rowMenusAgain = screen.getAllByRole('button', { name: /Secret actions|builder_settings_secrets_row_actions/ });
      await user.click(rowMenusAgain[0]);
      const editFirst = document.getElementById('secret-edit-0');
      expect(editFirst).not.toBeNull();
      await user.click(editFirst as HTMLElement);

      await waitFor(function waitForEditFirst() {
        expect(screen.getByRole('button', { name: /builder_common_save.*FIRST_SECRET/ })).toBeInTheDocument();
      });
      await user.type(document.getElementById('secretValue-0') as HTMLElement, 'edited-via-global');

      const globalSave = screen.getByRole('button', { name: 'builder_settings_secrets_save' });
      await user.click(globalSave);

      await waitFor(function waitForErrorGrowl() {
        expect(Growl.addGrowlMessage).toHaveBeenCalledWith({
          id: 'secrets-error',
          title: 'builder_status_failed',
          children: 'Batch save failed',
          emphasis: 'critical',
        });
      });

      await waitFor(function waitForMutatePayload() {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          appId: 'test-app-id',
          variant: 'preview',
          operations: {
            updates: [{ name: 'FIRST_SECRET', value: 'edited-via-global' }],
            deletions: ['SECOND_SECRET'],
            additions: [],
          },
        });
      });

      expect(screen.getByText('builder_settings_secrets_tag_unsaved_delete')).toBeInTheDocument();
      expect(screen.getByText('builder_settings_secrets_tag_unsaved_edit')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /builder_common_save.*FIRST_SECRET/ })).toBeInTheDocument();
    });
  });

  describe('info alert', function infoTests() {
    it('should display info alert when secrets are not deployed', async function infoAlert() {
      vi.mocked(useSecrets).mockReturnValue(createMockQueryResult({
        data: [{ name: 'NEW_SECRET', systemManaged: false, syncStatus: 'added' }],
      }));

      renderSecretsPanel();

      await waitFor(function waitForAlert() {
        expect(screen.getByText('builder_settings_secrets_alert_notdeployed_title')).toBeInTheDocument();
        expect(screen.getByText('builder_settings_secrets_alert_notdeployed_children')).toBeInTheDocument();
      });
    });
  });
});
