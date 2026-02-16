import '@testing-library/jest-dom';

import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import FileReferenceBadge, { FileReferenceList } from './FileReferenceBadge';

describe('FileReferenceBadge', () => {
  it('should render badge with filename from path', () => {
    const file = {
      path: 'src/components/Button.tsx',
      content: 'export default function Button() { return <button>Click</button> }',
    };

    renderWithProviders(<FileReferenceBadge file={file} />);

    expect(screen.getByText('Button.tsx')).toBeInTheDocument();
  });

  it('should extract filename from nested path', () => {
    const file = {
      path: 'src/app/develop/components/chat/ChatInput.tsx',
      content: 'content',
    };

    renderWithProviders(<FileReferenceBadge file={file} />);

    expect(screen.getByText('ChatInput.tsx')).toBeInTheDocument();
  });

  it('should display full path when no slashes present', () => {
    const file = {
      path: 'README.md',
      content: 'content',
    };

    renderWithProviders(<FileReferenceBadge file={file} />);

    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('should render page icon', () => {
    const file = {
      path: 'test.txt',
      content: 'content',
    };

    const { container } = renderWithProviders(<FileReferenceBadge file={file} />);

    // Check that an icon is rendered (UXCore icons render as SVGs)
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const file = {
      path: 'test.txt',
      content: 'content',
    };

    const { container } = renderWithProviders(
      <FileReferenceBadge file={file} className="custom-class" />
    );

    const badge = container.firstChild;
    expect(badge).toHaveClass('custom-class');
  });

  it('should truncate long filenames', () => {
    const file = {
      path: 'very-long-filename-that-should-be-truncated-for-display.tsx',
      content: 'content',
    };

    const { container } = renderWithProviders(<FileReferenceBadge file={file} />);

    const filenameElement = screen.getByText('very-long-filename-that-should-be-truncated-for-display.tsx');
    expect(filenameElement).toHaveClass('truncate');
    expect(filenameElement).toHaveClass('max-w-[120px]');
  });
});

describe('FileReferenceList', () => {
  it('should render multiple file reference badges', () => {
    const files = [
      { path: 'src/App.tsx', content: 'content1' },
      { path: 'src/utils/helpers.ts', content: 'content2' },
    ];

    renderWithProviders(<FileReferenceList files={files} />);

    expect(screen.getByText('App.tsx')).toBeInTheDocument();
    expect(screen.getByText('helpers.ts')).toBeInTheDocument();
  });

  it('should return null for empty files array', () => {
    const { container } = renderWithProviders(<FileReferenceList files={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('should apply custom className', () => {
    const files = [
      { path: 'test.txt', content: 'content' },
    ];

    const { container } = renderWithProviders(
      <FileReferenceList files={files} className="custom-list-class" />
    );

    const list = container.firstChild;
    expect(list).toHaveClass('custom-list-class');
  });

  it('should handle files with duplicate filenames but different paths', () => {
    const files = [
      { path: 'src/components/Button.tsx', content: 'content1' },
      { path: 'src/ui/Button.tsx', content: 'content2' },
    ];

    renderWithProviders(<FileReferenceList files={files} />);

    const badges = screen.getAllByText('Button.tsx');
    expect(badges).toHaveLength(2);
  });
});
