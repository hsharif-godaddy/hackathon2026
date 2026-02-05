import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCalendarData } from './fetch-calendar-data';

// Mock fetch
global.fetch = vi.fn();

describe('fetch-calendar-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch calendar data successfully', async () => {
    const mockResponse = {
      events: [
        {
          date: '2024-02-14',
          name: "Valentine's Day",
          description: 'Day of love',
          contentIdeas: ['Gift guides', 'Romantic recipes'],
        },
      ],
      scheduledPosts: [
        {
          title: 'My Blog Post',
          publishedAt: '2024-02-15T10:00:00Z',
          status: 'scheduled',
        },
      ],
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await fetchCalendarData({
      appId: 'test-app',
      month: new Date(2024, 1, 1),
      market: 'en-US',
      timezone: 'America/New_York',
    });

    expect(result.events).toHaveLength(1);
    expect(result.scheduledPosts).toHaveLength(1);
    expect(result.events[0].name).toBe("Valentine's Day");
  });

  it('should handle API errors gracefully', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await fetchCalendarData({
      appId: 'test-app',
      month: new Date(2024, 1, 1),
      market: 'en-US',
      timezone: 'America/New_York',
    });

    // Should return empty arrays on error
    expect(result.events).toEqual([]);
    expect(result.scheduledPosts).toEqual([]);
  });

  it('should handle network errors gracefully', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    const result = await fetchCalendarData({
      appId: 'test-app',
      month: new Date(2024, 1, 1),
      market: 'en-US',
      timezone: 'America/New_York',
    });

    // Should return empty arrays on error
    expect(result.events).toEqual([]);
    expect(result.scheduledPosts).toEqual([]);
  });

  it('should format query parameters correctly', async () => {
    const mockResponse = { events: [], scheduledPosts: [] };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await fetchCalendarData({
      appId: 'test-app-123',
      month: new Date(2024, 5, 15), // June 15, 2024
      market: 'en-GB',
      timezone: 'Europe/London',
    });

    const fetchCall = (global.fetch as any).mock.calls[0][0];
    expect(fetchCall).toContain('siteId=test-app-123'); // API uses siteId, not appId
    expect(fetchCall).toContain('month=2024-06');
    expect(fetchCall).toContain('market=en-GB');
    expect(fetchCall).toContain('timezone=Europe%2FLondon');
  });

  it('should handle malformed JSON response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Malformed JSON');
      },
    });

    const result = await fetchCalendarData({
      appId: 'test-app',
      month: new Date(2024, 1, 1),
      market: 'en-US',
      timezone: 'America/New_York',
    });

    expect(result.events).toEqual([]);
    expect(result.scheduledPosts).toEqual([]);
  });

  it('should handle missing fields in response', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}), // Empty response
    });

    const result = await fetchCalendarData({
      appId: 'test-app',
      month: new Date(2024, 1, 1),
      market: 'en-US',
      timezone: 'America/New_York',
    });

    expect(result.events).toEqual([]);
    expect(result.scheduledPosts).toEqual([]);
  });

  it('should handle timezone with special characters', async () => {
    const mockResponse = { events: [], scheduledPosts: [] };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    await fetchCalendarData({
      appId: 'test-app',
      month: new Date(2024, 1, 1),
      market: 'en-US',
      timezone: 'America/Indiana/Indianapolis',
    });

    const fetchCall = (global.fetch as any).mock.calls[0][0];
    // Should properly encode the timezone
    expect(fetchCall).toContain('timezone=America%2FIndiana%2FIndianapolis');
  });
});
