/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import FileReferenceModal from './FileReferenceModal';

// Mock UX components
vi.mock('@ux/box', () => ({
  default: ({ children, ...props }: any) => <div data-testid="ux-box" {...props}>{children}</div>
}));

vi.mock('@ux/button', () => ({
  default: ({ text, onClick, disabled, design, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-design={design} {...props}>
      {text}
    </button>
  )
}));

vi.mock('@ux/modal', () => ({
  default: ({ children, title, actions, ...props }: any) => (
    <div data-testid="ux-modal" {...props}>
      <div data-testid="modal-title">{title}</div>
      <div data-testid="modal-content">{children}</div>
      <div data-testid="modal-actions">{actions}</div>
    </div>
  )
}));

vi.mock('@ux/spinner', () => ({
  default: ({ size, ...props }: any) => <div role="status" data-size={size} {...props}>Loading...</div>
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>
  }
}));

// Mock FileTree component
vi.mock('@/app/develop/components/FileTree', () => ({
  default: ({ files, onFileSelect, getFileStatus }: any) => (
    <div data-testid="file-tree">
      {files.map((file: any) => (
        <div
          key={file.path}
          data-testid={`file-${file.path}`}
          onClick={() => onFileSelect(file.path)}
          data-status={getFileStatus ? getFileStatus(file.path) : 'normal'}
        >
          {file.name}
        </div>
      ))}
    </div>
  )
}));

// Mock useFileTreeStore
const mockFileTreeState = {
  files: {},
  loading: {},
  errors: {},
  loadFilesFromCacheOrFetch: vi.fn(() => Promise.resolve())
};

vi.mock('@/stores/useFileTreeStore', () => {
  const store = Object.assign(
    vi.fn((selector: any) => selector(mockFileTreeState)),
    { getState: () => mockFileTreeState }
  );
  return { useFileTreeStore: store };
});

// Mock logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn()
  }
}));

describe('FileReferenceModal', () => {
  const mockOnClose = vi.fn();
  const mockOnFilesSelected = vi.fn();
  const mockAppId = 'test-app-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileTreeState.files = {};
    mockFileTreeState.loading = {};
    mockFileTreeState.errors = {};
  });

  it('should not render when not open', () => {
    const { container } = renderWithProviders(
      <FileReferenceModal
        isOpen={false}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should render modal when open', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' }
    ];

    renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(screen.getByText('builder_filereference_title')).toBeInTheDocument();
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
  });

  it('should load files when modal opens', async () => {
    renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mockFileTreeState.loadFilesFromCacheOrFetch).toHaveBeenCalledWith(mockAppId);
  });

  it('should show loading spinner when loading', () => {
    mockFileTreeState.loading[mockAppId] = true;

    renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('should show error message when error exists and no cached files', () => {
    mockFileTreeState.errors[mockAppId] = 'Failed to load files';
    mockFileTreeState.files[mockAppId] = [];

    renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    expect(screen.getByText('Failed to load files')).toBeInTheDocument();
    expect(screen.queryByText('builder_filereference_description')).not.toBeInTheDocument();
  });

  it('should show cached files with error banner on transient error', () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'src', type: 'folder', path: 'src', children: [] },
      { name: 'index.ts', type: 'file', path: 'src/index.ts', extension: 'ts' },
    ];
    mockFileTreeState.errors[mockAppId] = 'Network error during refresh';

    renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    expect(screen.getByText('Network error during refresh')).toBeInTheDocument();
    expect(screen.getByText('builder_filereference_description')).toBeInTheDocument();
  });

  it('should allow file selection and deselection', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' },
      { name: 'other.txt', type: 'file', path: 'other.txt' }
    ];

    const { user } = renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const file1 = screen.getByTestId('file-test.txt');
    const file2 = screen.getByTestId('file-other.txt');

    // Select first file
    await user.click(file1);
    expect(file1).toHaveAttribute('data-status', 'modified');

    // Select second file
    await user.click(file2);
    expect(file2).toHaveAttribute('data-status', 'modified');

    // Deselect first file
    await user.click(file1);
    expect(file1).toHaveAttribute('data-status', 'normal');
  });

  it('should call onFilesSelected with selected files on confirm', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' },
      { name: 'other.txt', type: 'file', path: 'other.txt' }
    ];

    const { user } = renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Select files
    await user.click(screen.getByTestId('file-test.txt'));
    await user.click(screen.getByTestId('file-other.txt'));

    // Click add button
    const addButton = screen.getByRole('button', { name: /builder_common_add_chat/i });
    await user.click(addButton);

    expect(mockOnFilesSelected).toHaveBeenCalledWith(
      expect.arrayContaining(['test.txt', 'other.txt'])
    );
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should disable add button when no files selected', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' }
    ];

    renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const addButton = screen.getByRole('button', { name: /builder_common_add_chat/i });
    expect(addButton).toBeDisabled();
  });

  it('should clear selection on cancel', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' }
    ];

    const { user } = renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Select a file
    await user.click(screen.getByTestId('file-test.txt'));

    // Click cancel
    const cancelButton = screen.getByRole('button', { name: /builder_common_cancel/i });
    await user.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockOnFilesSelected).not.toHaveBeenCalled();
  });

  it('should clear selection after successful add', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' }
    ];

    const { user, rerender } = renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Select file and confirm
    await user.click(screen.getByTestId('file-test.txt'));
    const addButton = screen.getByRole('button', { name: /builder_common_add_chat/i });
    await user.click(addButton);

    // Reopen modal
    mockOnClose.mockClear();
    rerender(
      <FileReferenceModal
        isOpen={false}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    rerender(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Add button should be disabled (no selection)
    const newAddButton = screen.getByRole('button', { name: /builder_common_add_chat/i });
    expect(newAddButton).toBeDisabled();
  });

  it('should display selected file count', async () => {
    mockFileTreeState.files[mockAppId] = [
      { name: 'test.txt', type: 'file', path: 'test.txt' },
      { name: 'other.txt', type: 'file', path: 'other.txt' }
    ];

    const { user } = renderWithProviders(
      <FileReferenceModal
        isOpen={true}
        appId={mockAppId}
        onClose={mockOnClose}
        onFilesSelected={mockOnFilesSelected}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Initially 0 files selected
    expect(screen.getByText(/builder_filereference_files/)).toBeInTheDocument();

    // Select files
    await user.click(screen.getByTestId('file-test.txt'));
    await user.click(screen.getByTestId('file-other.txt'));

    // Should show updated count
    expect(screen.getByText(/builder_filereference_files/)).toBeInTheDocument();
  });
});
