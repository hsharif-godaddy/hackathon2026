import fetch from 'node-fetch';

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

/**
 * Service for searching Getty Images and retrieving image URLs
 */
export class GettyImageTool {
  private apiUrl: string;
  private appKey: string;
  private ssoJwt: string;

  constructor() {
    // Get Getty Images API configuration
    this.apiUrl = process.env.GETTY_API_URL || 'https://getty-images-proxy.api.test-godaddy.com/v1/search';
    this.appKey = process.env.GETTY_APP_KEY || 'airo-app-builder';
    this.ssoJwt = process.env.SSO_JWT || '';
    
    if (!this.ssoJwt) {
      console.warn('⚠️ SSO JWT token not set. Getty Images API calls will fail.');
    }
  }

  /**
   * Search for Getty images using the provided phrase
   * @param options Search options
   * @returns Result with image URLs
   */
  async searchImages(options: GettyImageOptions): Promise<GettyImageResult> {
    try {
      const { phrase, page = 1, pageSize = 50, graphicalStyles = 'photography', sortOrder = 'best_match' } = options;
      
      // Validate input
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
      
      // Construct API URL with query parameters
      const queryParams = new URLSearchParams({
        phrase,
        page: page.toString(),
        page_size: pageSize.toString(),
        graphical_styles: graphicalStyles,
        sort_order: sortOrder
      });
      
      const url = `${this.apiUrl}?${queryParams.toString()}`;
      
      console.log(`🔍 Searching Getty Images with phrase: ${phrase}`);
      
      // Make API request to Getty Images
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `sso-jwt ${this.ssoJwt}`,
          'x-app-key': this.appKey,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Getty API request failed: ${response.status} ${errorText}`);
      }
      
      const data = await response.json() as GettyImageResponse;
      
      // Check if we have images
      if (!data || !data.images || !Array.isArray(data.images) || data.images.length === 0) {
        return {
          success: false,
          error: 'No images found matching your search criteria'
        };
      }
      
      // Process the image data to extract URLs
      const processedImages = data.images.map(image => {
        // Extract URLs for different sizes
        const urls: { preview?: string; thumbnail?: string; standard?: string; highRes?: string } = {};
        
        if (image.display_sizes && Array.isArray(image.display_sizes)) {
          // Find each size type
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
        
        return {
          id: image.id,
          urls,
          dimensions: image.max_dimensions,
          title: image.title,
          caption: image.caption
        };
      });
      
      return {
        success: true,
        images: processedImages,
        totalResults: data.result_count
      };
      
    } catch (error) {
      console.error('❌ Getty image search failed:', error);
      return {
        success: false,
        error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

/**
 * Tool interface for Getty image search
 * @param options Search options including phrase and optional parameters
 * @returns Result with image URLs
 */
export async function findGettyImage(options: GettyImageOptions): Promise<GettyImageResult> {
  try {
    const gettyImageTool = new GettyImageTool();
    return await gettyImageTool.searchImages(options);
  } catch (error) {
    console.error('❌ Getty image search failed:', error);
    return {
      success: false,
      error: `Getty image search failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}