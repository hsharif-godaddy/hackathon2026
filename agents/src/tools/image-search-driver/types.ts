export interface ImageSearchResult {
  success: boolean;
  url?: string;
  urls?: string[];
  error?: string;
  results?: Array<{
    prompt: string;
    success: boolean;
    url?: string;
    urls?: string[];
    error?: string;
  }>;
}

export interface ImageSearchDriver {
  searchImage(prompt: string, count?: number): Promise<ImageSearchResult>;
  searchImagesParallel(prompts: string[], count?: number): Promise<ImageSearchResult>;
}
