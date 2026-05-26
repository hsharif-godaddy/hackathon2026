// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { UploadDeleteConfirmationModal } from './UploadDeleteConfirmationModal';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => `translated:${key}`,
}));

describe('UploadDeleteConfirmationModal', () => {
  it('rounds and clips only the top-right corner of the panel overlay', () => {
    render(
      <UploadDeleteConfirmationModal
        otherUsageLocations={[]}
        canRemoveFromCurrentSlot={false}
        isDeleting={false}
        bounds={{ top: 20, left: 10, width: 300, height: 500, bottomOffset: 40 }}
        onCancel={vi.fn()}
        onRemoveFromCurrentSlot={vi.fn()}
        onDeleteEverywhere={vi.fn()}
      />
    );

    expect(screen.getByTestId('upload-delete-panel-overlay')).toHaveClass(
      'overflow-hidden',
      'rounded-tr-lg'
    );
    expect(screen.getByTestId('upload-delete-panel-overlay')).not.toHaveClass(
      'rounded-t-lg',
      'rounded-tl-lg'
    );
  });

  it('keeps the confirmation card inset from the media detail bounds', () => {
    render(
      <UploadDeleteConfirmationModal
        otherUsageLocations={[]}
        canRemoveFromCurrentSlot={false}
        isDeleting={false}
        bounds={{ top: 20, left: 10, width: 300, height: 500, bottomOffset: 40 }}
        onCancel={vi.fn()}
        onRemoveFromCurrentSlot={vi.fn()}
        onDeleteEverywhere={vi.fn()}
      />
    );

    expect(screen.getByTestId('upload-delete-confirmation-card')).toHaveStyle({
      left: '26px',
      bottom: '56px',
      width: '268px',
    });
  });

  it('renders delete confirmation copy through translations', () => {
    render(
      <UploadDeleteConfirmationModal
        otherUsageLocations={['Footer Logo']}
        canRemoveFromCurrentSlot
        isDeleting={false}
        onCancel={vi.fn()}
        onRemoveFromCurrentSlot={vi.fn()}
        onDeleteEverywhere={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog', {
      name: 'translated:builder_common_confirm',
    });

    expect(
      within(dialog).getByText('translated:builder_mediaslot_delete_confirm_title')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('translated:builder_mediaslot_delete_confirm_description')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('translated:builder_mediaslot_delete_confirm_also_used_in')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('translated:builder_mediaslot_delete_confirm_choose_proceed')
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', {
        name: 'translated:builder_mediaslot_delete_confirm_only_this_slot',
      })
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', {
        name: 'translated:builder_mediaslot_delete_confirm_everywhere',
      })
    ).toBeInTheDocument();
  });
});
