import { Logger, log } from '../../logging/index.js';
import { toolImageSearchEvents } from '../../logging/events/index.js';
import { ImageSearchDriver, ImageSearchResult } from './types.js';

const logger = Logger.create({ service: 'getty-image-driver' });

export interface GettyImageOptions {
  phrase: string;
  page?: number;
  pageSize?: number;
  graphicalStyles?: string;
  sortOrder?: string;
}

export interface GettyImageResult {
  success: boolean;
  images?: GettyImageData[];
  totalResults?: number;
  error?: string;
}

export interface GettyImageData {
  id: string;
  urls: {
    preview?: string;
    thumbnail?: string;
    standard?: string;
    highRes?: string;
  };
  dimensions?: {
    height?: number;
    width?: number;
  };
  title?: string;
  caption?: string;
}

export interface GettyImageResponse {
  result_count: number;
  images: GettyImage[];
}

export interface GettyImage {
  id: string;
  display_sizes: DisplaySize[];
  max_dimensions?: {
    height: number;
    width: number;
  };
  title?: string;
  caption?: string;
}

export interface DisplaySize {
  is_watermarked: boolean;
  name: string;
  uri: string;
}

export class GettyImageTool {
  private apiUrl: string;
  private appKey: string;
  private ssoJwt: string;

  constructor() {
    this.apiUrl = process.env.GETTY_API_URL || 'https://getty-images-proxy.api.test-godaddy.com/v1/search';
    this.appKey = process.env.GETTY_APP_KEY || 'airo-app-builder';

    if (process.env.GETTY_TOKEN) {
      this.ssoJwt = 'Bearer ' + process.env.GETTY_TOKEN;
    } else if (process.env.SSO_JWT) {
      this.ssoJwt = 'sso-jwt ' + process.env.SSO_JWT;
    } else {
      this.ssoJwt = '';
    }

    if (!this.ssoJwt) {
      logger.warn('getty-image.auth.missing', {
        message: 'Neither GETTY_TOKEN nor SSO_JWT is set',
      });
    }
  }

  async searchImages(options: GettyImageOptions): Promise<GettyImageResult> {
    try {
      const { phrase, page = 1, pageSize = 50, graphicalStyles = 'photography', sortOrder = 'best_match' } = options;

      if (!phrase || typeof phrase !== 'string' || phrase.trim().length === 0) {
        return {
          success: false,
          error: 'A valid search phrase is required'
        };
      }

      if (!this.ssoJwt) {
        return {
          success: false,
          error: 'SSO JWT token is not configured. Please add it to your .env file.'
        };
      }

      const queryParams = new URLSearchParams({
        phrase,
        page: page.toString(),
        page_size: pageSize.toString(),
        graphical_styles: graphicalStyles,
        sort_order: sortOrder
      });

      const url = `${this.apiUrl}?${queryParams.toString()}`;

      logger.info('getty-image.search.begin', {
        phrase,
        page,
        pageSize,
      });

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.ssoJwt,
          'x-app-key': this.appKey,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Getty API request failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as GettyImageResponse;

      if (!data || !data.images || !Array.isArray(data.images) || data.images.length === 0) {
        return {
          success: false,
          error: 'No images found matching your search criteria'
        };
      }

      const processedImages = data.images.map(image => {
        const urls: { preview?: string; thumbnail?: string; standard?: string; highRes?: string } = {};

        if (image.display_sizes && Array.isArray(image.display_sizes)) {
          const preview = image.display_sizes.find(size => size && size.name === 'preview');
          const thumbnail = image.display_sizes.find(size => size && size.name === 'thumb');
          const standard = image.display_sizes.find(size => size && size.name === 'comp');
          const midRes = image.display_sizes.find(size => size && size.name === 'mid_res_comp');
          const highRes = image.display_sizes.find(size => size && size.name === 'high_res_comp');

          if (preview && preview.uri) urls.preview = preview.uri;
          if (thumbnail && thumbnail.uri) urls.thumbnail = thumbnail.uri;
          if (standard && standard.uri) urls.standard = standard.uri;
          if (highRes && highRes.uri) {
            urls.highRes = highRes.uri;
          } else if (midRes && midRes.uri) {
            urls.highRes = midRes.uri;
          }
        }

        const result: GettyImageData = {
          id: image.id,
          urls
        };

        if (image.title !== undefined) {
          result.title = image.title;
        }

        if (image.caption !== undefined) {
          result.caption = image.caption;
        }

        if (image.max_dimensions) {
          result.dimensions = {
            height: image.max_dimensions.height,
            width: image.max_dimensions.width
          };
        }

        return result;
      });

      return {
        success: true,
        images: processedImages,
        totalResults: data.result_count
      };

    } catch (error) {
      log.error(logger, 'getty-image.search.error', error as Error, {
        phrase: options.phrase,
      });
      return {
        success: false,
        error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

export class GettyImageSearchDriver implements ImageSearchDriver {
  private gettyTool: GettyImageTool;

  constructor() {
    this.gettyTool = new GettyImageTool();
  }

  async searchImage(prompt: string, count = 1): Promise<ImageSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt,
        count,
        provider: 'getty',
      });

      const result = await this.gettyTool.searchImages({
        phrase: prompt.trim(),
        page: 1,
        pageSize: Math.min(count, 10),
        graphicalStyles: 'photography',
        sortOrder: 'best_match'
      });

      if (!result.success || !result.images || result.images.length === 0) {
        toolImageSearchEvents.failure(logger, new Error(result.error || 'No images found for this search query'), {
          toolName: 'GettyImageSearchDriver',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: result.error || 'No images found for this search query'
        };
      }

      const imageUrls: string[] = [];
      for (const image of result.images.slice(0, count)) {
        const imageUrl = image?.urls?.highRes || image?.urls?.standard || image?.urls?.preview || image?.urls?.thumbnail;
        if (imageUrl) {
          imageUrls.push(imageUrl);
        }
      }

      if (imageUrls.length === 0) {
        toolImageSearchEvents.failure(logger, new Error('No valid image URLs found in Getty response'), {
          toolName: 'GettyImageSearchDriver',
          prompt,
          count,
          provider: 'getty',
        });
        return {
          success: false,
          error: 'No valid image URLs found in Getty response'
        };
      }

      toolImageSearchEvents.success(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt,
        count,
        provider: 'getty',
        resultUrls: imageUrls,
        resultCount: imageUrls.length,
      });

      if (count === 1 && imageUrls.length > 0) {
        return {
          success: true,
          url: imageUrls[0]!
        };
      } else {
        return {
          success: true,
          urls: imageUrls
        };
      }
    } catch (error) {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'GettyImageSearchDriver',
        prompt,
        count,
        provider: 'getty',
      });
      return {
        success: false,
        error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async searchImagesParallel(prompts: string[], count = 1): Promise<ImageSearchResult> {
    try {
      toolImageSearchEvents.begin(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
      });

      const searchPromises = prompts.map(prompt => this.searchImage(prompt, count));
      const results = await Promise.all(searchPromises);

      const combinedResults = results.map((result, index) => {
        const combined: {
          prompt: string;
          success: boolean;
          url?: string;
          urls?: string[];
          error?: string;
        } = {
          prompt: prompts[index] || '',
          success: result.success,
        };
        if (result.url) combined.url = result.url;
        if (result.urls) combined.urls = result.urls;
        if (result.error) combined.error = result.error;
        return combined;
      });

      const hasAnySuccess = results.some(r => r.success);

      toolImageSearchEvents.success(logger, {
        toolName: 'GettyImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
        resultUrls: results.flatMap(r => r.urls || (r.url ? [r.url] : [])),
        resultCount: results.reduce((sum, r) => sum + (r.urls?.length || (r.url ? 1 : 0)), 0),
      });

      if (hasAnySuccess) {
        return {
          success: true,
          results: combinedResults
        };
      } else {
        return {
          success: false,
          results: combinedResults,
          error: 'All parallel searches failed'
        };
      }
    } catch (error) {
      toolImageSearchEvents.failure(logger, error as Error, {
        toolName: 'GettyImageSearchDriver',
        prompt: `Parallel search: ${prompts.join(', ')}`,
        count,
        provider: 'getty',
      });
      return {
        success: false,
        error: `Getty parallel image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

export async function findGettyImage(options: GettyImageOptions): Promise<GettyImageResult> {
  try {
    const gettyImageTool = new GettyImageTool();
    return await gettyImageTool.searchImages(options);
  } catch (error) {
    log.error(logger, 'getty-image.function.error', error as Error, {
      phrase: options.phrase,
    });
    return {
      success: false,
      error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
