import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GettyMediaDriver } from '../getty-media-driver.js';

describe('GettyMediaDriver filter expansion', () => {
  let driver: GettyMediaDriver;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Set required env vars
    process.env.SSO_JWT = 'test-jwt';
    process.env.GETTY_API_URL = 'https://test-getty.example.com';

    driver = new GettyMediaDriver();

    // Override the get method
    fetchSpy = vi.fn().mockImplementation(async (_endpoint: string, _params: URLSearchParams) => {
      return {
        ok: true,
        json: async () => ({
          result_count: 1,
          images: [{
            id: '123',
            display_sizes: [
              { name: 'comp', uri: 'https://example.com/comp.jpg', is_watermarked: false },
              { name: 'preview', uri: 'https://example.com/preview.jpg', is_watermarked: false },
            ],
            title: 'Test Image',
            max_dimensions: { width: 1024, height: 768 }
          }]
        }),
        text: async () => ''
      };
    });

    (driver as any).get = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SSO_JWT;
    delete process.env.GETTY_API_URL;
  });

  it('should pass multiple orientation values as separate query params', async () => {
    await driver.search({
      query: 'sunset',
      orientations: ['horizontal', 'square'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('orientations=horizontal');
    expect(paramsStr).toContain('orientations=square');
  });

  it('should pass new Getty filter params', async () => {
    await driver.search({
      query: 'business meeting',
      moods: ['warm'],
      numberOfPeople: ['two', 'group'],
      ethnicity: ['east_asian'],
      ageOfPeople: ['adult'],
      minimumSize: 'large',
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('moods=warm');
    expect(paramsStr).toContain('number_of_people=two');
    expect(paramsStr).toContain('number_of_people=group');
    expect(paramsStr).toContain('ethnicity=east_asian');
    expect(paramsStr).toContain('age_of_people=adult');
    expect(paramsStr).toContain('minimum_size=large');
  });

  it('should pass graphical_styles as array', async () => {
    await driver.search({
      query: 'abstract art',
      graphicalStyles: ['illustration', 'vector'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('graphical_styles=illustration');
    expect(paramsStr).toContain('graphical_styles=vector');
  });

  it('should not pass image-only filters for video search', async () => {
    fetchSpy.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        result_count: 1,
        videos: [{
          id: '456',
          display_sizes: [
            { name: 'comp', uri: 'https://example.com/comp.mp4', is_watermarked: false },
            { name: 'preview', uri: 'https://example.com/preview.mp4', is_watermarked: false },
          ],
          title: 'Test Video',
          max_dimensions: { width: 1920, height: 1080 }
        }]
      }),
      text: async () => ''
    }));

    // Also mock uploadVideo to avoid secondary call
    (driver as any).uploadVideo = vi.fn().mockResolvedValue('https://example.com/video.mp4');

    await driver.search({
      query: 'sunset',
      mediaType: 'video',
      orientations: ['horizontal'],
      moods: ['warm'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).not.toContain('orientations=');
    expect(paramsStr).not.toContain('moods=');
  });

  it('should use query as phrase in Getty API params', async () => {
    await driver.search({
      query: 'sunset beach',
      orientations: ['horizontal'],
      graphicalStyles: ['photography'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('phrase=sunset+beach');
    expect(paramsStr).toContain('orientations=horizontal');
    expect(paramsStr).toContain('graphical_styles=photography');
  });
});
