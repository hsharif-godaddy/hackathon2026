export type BusinessType =
  | 'retail'
  | 'saas'
  | 'restaurant'
  | 'service'
  | 'blog'
  | 'health'
  | 'general';

export interface CalendarEvent {
  id?: string;
  date: Date;
  name: string;
  emoji?: string;
  description?: string;
  category?: string;
  contentIdeas?: string[];
  isCustom?: boolean;
  metadata?: Record<string, unknown>;
  // Content Inspirations API fields
  hashtags?: string[];
  imageUrl?: string;
  overSearchTerm?: string;
  topicKey?: string;
}

export interface ScheduledPost {
  slug: string;
  title: string;
  publishedAt: string; // ISO date string
  status: 'scheduled' | 'published';
  type: 'blog' | 'social';

  // Social-specific fields (optional, only when type='social')
  platform?: 'facebook' | 'instagram';
  postId?: string;        // Agents DB post ID
  message?: string;       // Preview of post content (truncated)
  imageUrls?: string[];   // Post images
}

export interface MarketingEventRequest {
  siteId: string;
  month: string; // YYYY-MM format
}

export interface ScheduledPostsRequest {
  siteId: string;
}

export interface CreateEventRequest {
  siteId: string;
  date: string; // ISO date string
  name: string;
  emoji?: string;
  description?: string;
  category?: string;
}
