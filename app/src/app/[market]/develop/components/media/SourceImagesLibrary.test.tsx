// @vitest-environment jsdom
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { SourceImagesLibrary } from './SourceImagesLibrary';

const mockAppId = 'app-123';

vi.mock('@/config/dynamic-api', () => ({
  dynamicApiConfigService: {
    getConfigForSite: vi.fn().mockResolvedValue({ agentUrl: 'https://agent.example.com/apps/app-123' }),
  },
}));

vi.mock('@/lib/jwt-regeneration', () => ({
  regenerateToken: vi.fn().mockResolvedValue({ token: 'mock-token' }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn().mockReturnValue(() => {}),
  generateClickEID: vi.fn().mockReturnValue(''),
}));

const file = (overrides: Record<string, unknown>) => ({
  id: overrides.filename as string,
  filename: 'f.jpg',
  originalName: 'F',
  mimeType: 'image/jpeg',
  size: 1024,
  signedUrl: '/files/uploads/app-123/f.jpg',
  ...overrides,
});

const mockFetchList = (files: Array<Record<string, unknown>>) => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files }) });
};

describe('SourceImagesLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders only crawled images under the Source images section', async () => {
    mockFetchList([
      file({ filename: 'crawled-a.jpg', originalName: 'Crawled A', signedUrl: '/files/uploads/app-123/crawled-a.jpg', source: 'crawled' }),
      file({ filename: 'user-b.jpg', originalName: 'User B', signedUrl: '/files/uploads/app-123/user-b.jpg' }),
    ]);

    renderWithProviders(<SourceImagesLibrary appId={mockAppId} />);

    await waitFor(() => expect(screen.getByTestId('source-images-library')).toBeInTheDocument());
    expect(screen.getByAltText('Crawled A')).toBeInTheDocument();
    expect(screen.queryByAltText('User B')).not.toBeInTheDocument();
  });

  it('excludes crawled images already placed into a media slot', async () => {
    mockFetchList([
      file({ filename: 'placed.jpg', originalName: 'Placed', signedUrl: '/files/uploads/app-123/placed.jpg', source: 'crawled' }),
      file({ filename: 'unplaced.jpg', originalName: 'Unplaced', signedUrl: '/files/uploads/app-123/unplaced.jpg', source: 'crawled' }),
    ]);

    // A rebuild slot (AIROBUILD-2104) references placed.jpg by its content-hash basename.
    const manifest = { 'pages/home/hero': { currentUrl: '/airo-assets/uploads/placed.jpg', alternatives: [] } };

    renderWithProviders(<SourceImagesLibrary appId={mockAppId} mediaManifest={manifest} />);

    await waitFor(() => expect(screen.getByTestId('source-images-library')).toBeInTheDocument());
    expect(screen.getByAltText('Unplaced')).toBeInTheDocument();
    expect(screen.queryByAltText('Placed')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no crawled images', async () => {
    mockFetchList([file({ filename: 'user-b.jpg', originalName: 'User B', signedUrl: '/files/uploads/app-123/user-b.jpg' })]);

    renderWithProviders(<SourceImagesLibrary appId={mockAppId} />);

    // Give the fetch a tick to resolve, then assert the section never appears.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('source-images-library')).not.toBeInTheDocument());
  });

  it('renders a delete control for each crawled image', async () => {
    mockFetchList([file({ filename: 'crawled-a.jpg', originalName: 'Crawled A', signedUrl: '/files/uploads/app-123/crawled-a.jpg', source: 'crawled' })]);

    renderWithProviders(<SourceImagesLibrary appId={mockAppId} />);

    await waitFor(() => expect(screen.getByTestId('source-images-library')).toBeInTheDocument());
    expect(screen.getByTestId('uploaded-image-delete-crawled-a.jpg')).toBeInTheDocument();
  });

  it('opens the confirmation modal and deletes everywhere', async () => {
    mockFetchList([file({ filename: 'crawled-a.jpg', originalName: 'Crawled A', signedUrl: '/files/uploads/app-123/crawled-a.jpg', source: 'crawled' })]);

    renderWithProviders(<SourceImagesLibrary appId={mockAppId} mediaManifest={null} />);

    await waitFor(() => expect(screen.getByTestId('uploaded-image-delete-crawled-a.jpg')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('uploaded-image-delete-crawled-a.jpg'));

    const card = await screen.findByTestId('upload-delete-confirmation-card');
    // The card has a Cancel (icon-only) button and a confirm button with text.
    const confirm = within(card).getAllByRole('button').find((b) => (b.textContent ?? '').trim().length > 0);
    expect(confirm).toBeDefined();
    fireEvent.click(confirm!);

    await waitFor(() => {
      const deleteCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleteCall?.[0]).toContain('/media/app-123/uploads/crawled-a.jpg');
    });
    await waitFor(() => expect(screen.queryByAltText('Crawled A')).not.toBeInTheDocument());
  });
});
