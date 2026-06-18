// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { MediaDeleteConfirmationModal } from './MediaDeleteConfirmationModal';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, _values?: unknown, fallback?: string) =>
    fallback ? `translated:${key}` : `translated:${key}`,
}));

describe('MediaDeleteConfirmationModal', () => {
  it('renders image-variant copy and a thumbnail when given an imageUrl', () => {
    render(
      <MediaDeleteConfirmationModal
        isVideo={false}
        imageUrl="https://cdn.example.com/photo.jpg"
        alt="A photo"
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('translated:builder_media_delete_title')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('translated:builder_media_delete_body_image')
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'A photo' })).toBeInTheDocument();
  });

  it('renders video-variant copy', () => {
    render(
      <MediaDeleteConfirmationModal
        isVideo={true}
        imageUrl={null}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByText('translated:builder_media_delete_body_video')
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('fires onCancel when the Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <MediaDeleteConfirmationModal
        isVideo={false}
        imageUrl={null}
        isDeleting={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'translated:builder_common_cancel' })
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('fires onConfirm when the Delete button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <MediaDeleteConfirmationModal
        isVideo={false}
        imageUrl={null}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'translated:builder_common_delete' })
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(
      <MediaDeleteConfirmationModal
        isVideo={false}
        imageUrl={null}
        isDeleting={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while deleting and shows the deleting label', () => {
    render(
      <MediaDeleteConfirmationModal
        isVideo={false}
        imageUrl={null}
        isDeleting={true}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: 'translated:builder_common_cancel' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'translated:builder_common_deleting' })
    ).toBeDisabled();
  });

  it('shows an error alert when error is set', () => {
    render(
      <MediaDeleteConfirmationModal
        isVideo={false}
        imageUrl={null}
        isDeleting={false}
        error="Something went wrong"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
