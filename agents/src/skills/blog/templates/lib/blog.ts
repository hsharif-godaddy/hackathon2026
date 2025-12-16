/**
 * Blog Post Interface
 *
 * Defines the structure for blog posts in the application.
 */
export interface BlogPost {
  /** URL-friendly identifier */
  slug: string;
  /** Post title */
  title: string;
  /** Short description (160 chars max recommended) */
  excerpt: string;
  /** Full post content (markdown or HTML) */
  content: string;
  /** Author name */
  author?: string;
  /** Publication date (ISO 8601 format) */
  publishedAt: string;
  /** Last updated date (ISO 8601 format) */
  updatedAt?: string;
  /** Post tags for filtering */
  tags?: string[];
  /** Post category */
  category?: string;
  /** Featured image URL or path */
  featuredImage?: string;
  /** SEO-optimized title (60 chars max recommended) */
  seoTitle?: string;
  /** SEO meta description (160 chars max recommended) */
  seoDescription?: string;
  /** Whether post is published or draft */
  published: boolean;
}

/**
 * Blog posts data storage
 * Posts are loaded from markdown files with frontmatter
 */
let blogPosts: BlogPost[] = [];

/**
 * Initialize blog posts from markdown files
 * Loads all .md files from /src/content/blog/ directory
 *
 * @returns Array of blog posts
 */
export function initializeBlogPosts(): BlogPost[] {
  // This will be populated by the agent when creating blog posts
  // Posts are stored as markdown files in /src/content/blog/
  return blogPosts;
}

/**
 * Set blog posts data
 * Used by the loader to populate blog posts from markdown files
 *
 * @param posts - Array of blog posts to set
 */
export function setBlogPosts(posts: BlogPost[]): void {
  blogPosts = posts;
}

/**
 * Get all published blog posts, sorted by date (newest first)
 * Only returns posts with publishedAt date in the past or present (excludes scheduled posts)
 *
 * @returns Array of published blog posts
 */
export function getBlogPosts(): BlogPost[] {
  const now = new Date();
  return blogPosts
    .filter(post => post.published && new Date(post.publishedAt) <= now)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/**
 * Get a blog post by its slug
 * Only returns posts that are published and have publishedAt date in the past or present
 *
 * @param slug - URL-friendly post identifier
 * @returns Blog post or null if not found
 */
export function getPostBySlug(slug: string): BlogPost | null {
  const now = new Date();
  return blogPosts.find(post => post.slug === slug && post.published && new Date(post.publishedAt) <= now) || null;
}

/**
 * Get blog posts filtered by tag
 * Only returns posts that are published and have publishedAt date in the past or present
 *
 * @param tag - Tag to filter by
 * @returns Array of blog posts with the specified tag
 */
export function getPostsByTag(tag: string): BlogPost[] {
  const now = new Date();
  return blogPosts
    .filter(post => post.published && post.tags?.includes(tag) && new Date(post.publishedAt) <= now)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/**
 * Get blog posts filtered by category
 * Only returns posts that are published and have publishedAt date in the past or present
 *
 * @param category - Category to filter by
 * @returns Array of blog posts in the specified category
 */
export function getPostsByCategory(category: string): BlogPost[] {
  const now = new Date();
  return blogPosts
    .filter(post => post.published && post.category === category && new Date(post.publishedAt) <= now)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/**
 * Get related posts based on tags and category
 *
 * @param post - Current post to find related posts for
 * @param limit - Maximum number of related posts to return (default: 3)
 * @returns Array of related blog posts
 */
export function getRelatedPosts(post: BlogPost, limit: number = 3): BlogPost[] {
  const allPosts = getBlogPosts();

  // Calculate relevance score for each post
  const scoredPosts = allPosts
    .filter(p => p.slug !== post.slug) // Exclude current post
    .map(p => {
      let score = 0;

      // Same category = 3 points
      if (p.category === post.category) {
        score += 3;
      }

      // Shared tags = 1 point per tag
      if (p.tags && post.tags) {
        const sharedTags = p.tags.filter(tag => post.tags?.includes(tag));
        score += sharedTags.length;
      }

      return { post: p, score };
    })
    .filter(item => item.score > 0) // Only include posts with some relevance
    .sort((a, b) => {
      // Sort by score first, then by date
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.post.publishedAt).getTime() - new Date(a.post.publishedAt).getTime();
    });

  return scoredPosts.slice(0, limit).map(item => item.post);
}

/**
 * Get all unique tags from published posts
 * Only includes tags from posts with publishedAt date in the past or present
 *
 * @returns Array of unique tags
 */
export function getAllTags(): string[] {
  const now = new Date();
  const tags = new Set<string>();
  blogPosts
    .filter(post => post.published && new Date(post.publishedAt) <= now)
    .forEach(post => {
      post.tags?.forEach(tag => tags.add(tag));
    });
  return Array.from(tags).sort();
}

/**
 * Get all unique categories from published posts
 * Only includes categories from posts with publishedAt date in the past or present
 *
 * @returns Array of unique categories
 */
export function getAllCategories(): string[] {
  const now = new Date();
  const categories = new Set<string>();
  blogPosts
    .filter(post => post.published && new Date(post.publishedAt) <= now)
    .forEach(post => {
      if (post.category) {
        categories.add(post.category);
      }
    });
  return Array.from(categories).sort();
}

/**
 * Calculate estimated reading time for a post
 * Based on average reading speed of 200 words per minute
 *
 * @param content - Post content (HTML or markdown)
 * @returns Estimated reading time in minutes
 */
export function calculateReadingTime(content: string): number {
  // Strip HTML/markdown tags for word count
  const plainText = content.replace(/<[^>]*>/g, '').replace(/[#*_`]/g, '');
  const wordCount = plainText.split(/\s+/).filter(word => word.length > 0).length;
  const minutes = Math.ceil(wordCount / 200);
  return minutes;
}

/**
 * Format a date string for display
 *
 * @param dateString - ISO 8601 date string
 * @param format - Format type ('short', 'long', or 'full')
 * @returns Formatted date string
 */
export function formatPostDate(dateString: string, format: 'short' | 'long' | 'full' = 'long'): string {
  const date = new Date(dateString);

  const optionsMap: Record<'short' | 'long' | 'full', Intl.DateTimeFormatOptions> = {
    short: { month: 'short', day: 'numeric', year: 'numeric' },
    long: { month: 'long', day: 'numeric', year: 'numeric' },
    full: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }
  };

  const options = optionsMap[format];

  return date.toLocaleDateString('en-US', options);
}

/**
 * Paginate blog posts
 *
 * @param posts - Array of blog posts to paginate
 * @param page - Page number (1-indexed)
 * @param pageSize - Number of posts per page (default: 9)
 * @returns Object containing paginated posts and pagination info
 */
export function paginatePosts(posts: BlogPost[], page: number = 1, pageSize: number = 9) {
  const totalPosts = posts.length;
  const totalPages = Math.ceil(totalPosts / pageSize);
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    posts: posts.slice(startIndex, endIndex),
    pagination: {
      currentPage,
      totalPages,
      totalPosts,
      pageSize,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1
    }
  };
}
