import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import FileTree from './FileTree';

describe('FileTree', () => {
  const mockFiles = [
    { name: 'src', type: 'folder' as const, path: '/src', children: [] }
  ];

  it('should render files in tree view', () => {
    const filesWithContent = [
      {
        name: 'src',
        type: 'folder' as const,
        path: '/src',
        children: [
          { name: 'index.ts', type: 'file' as const, path: '/src/index.ts' }
        ]
      }
    ];

    render(
      <FileTree
        files={filesWithContent}
        onFileSelect={() => {}}
      />
    );

    expect(screen.getByText('src')).toBeInTheDocument();

    // Expand the src folder to see its children
    fireEvent.click(screen.getByText('src'));

    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });
});
