import type { CustomerAuthContext } from '@/lib/customer-auth';
import { getErrorMessage } from '@/lib/errors';
import { getJWTService } from '@/lib/jwt-service';
import { logger } from '@/lib/request-context';
import type { ScheduledPost } from '@/types/marketing';

const AGENTS_API_TIMEOUT_MS = 10000; // 10 seconds, consistent with content-inspirations
const MESSAGE_TRUNCATION_LIMIT = 100;

// Supported social platforms
type ValidPlatform = 'facebook' | 'instagram';
const VALID_PLATFORMS: readonly string[] = ['facebook', 'instagram'];

/**
 * Helper function to truncate strings at word boundaries
 *
 * @param str - String to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated string with ellipsis, respecting word boundaries
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }

  // Find last space before maxLength
  const lastSpace = str.lastIndexOf(' ', maxLength);

  // If no space found or space is too far back (less than 80% of maxLength),
  // do a hard truncation to avoid losing too much content
  if (lastSpace === -1 || lastSpace < maxLength * 0.8) {
    return str.substring(0, maxLength) + '...';
  }

  return str.substring(0, lastSpace) + '...';
}

/**
 * Validate and normalize platform value
 *
 * @param platform - Raw platform string from API
 * @param postId - Post ID for logging
 * @returns Normalized platform or null if invalid
 */
function validatePlatform(platform: string, postId: string): ValidPlatform | null {
  const normalized = platform.toLowerCase();

  if (VALID_PLATFORMS.includes(normalized)) {
    return normalized as ValidPlatform;
  }

  logger.warn('calendar.social_posts.invalid_platform', {
    platform,
    postId,
    validPlatforms: VALID_PLATFORMS,
  });

  return null;
}

/**
 * Transform agents API social post to ScheduledPost format
 *
 * @param post - Raw post data from agents API
 * @returns Transformed ScheduledPost or null if invalid
 */
function transformSocialPost(post: any): ScheduledPost | null {
  // Validate platform
  const platform = validatePlatform(post.platform, post.id);
  if (!platform) {
    return null; // Skip posts with invalid platforms
  }

  // Parse payload with error handling
  let payload: any = {};
  try {
    payload = JSON.parse(post.payload || '{}');
  } catch (error) {
    logger.warn('calendar.social_posts.invalid_json', {
      postId: post.id,
      error: getErrorMessage(error),
    });
    // Continue with empty payload rather than failing
  }

  return {
    slug: post.id,
    title: `${post.platform} post`,
    publishedAt: post.scheduledAt || post.completedAt,
    status: post.state === 'SCHEDULED' ? 'scheduled' : 'published',
    type: 'social',
    platform,
    postId: post.id,
    message: payload.message ? truncate(payload.message, MESSAGE_TRUNCATION_LIMIT) : undefined,
    imageUrls: payload.imageUrls || [],
  };
}

/**
 * Fetch scheduled social posts from agents API
 *
 * @param appId - The app/site ID
 * @param month - The month to fetch posts for
 * @param authContext - Customer authentication context
 * @param agentUrl - Agent service URL from the control plane
 * @returns Array of scheduled social posts (empty array on error for graceful degradation)
 */
export async function fetchSocialPostsFromAgents(
  appId: string,
  month: Date,
  authContext: CustomerAuthContext,
  agentUrl: string
): Promise<ScheduledPost[]> {
  try {
    logger.info('calendar.social_posts.fetch_begin', {
      appId,
      month: month.toISOString(),
    });

    // Generate agent token for authentication
    const jwtService = getJWTService();
    const tokenResult = await jwtService.createToken({
      siteId: appId,
      canDownload: false,
      canPublish: false,
      authType: authContext.user.authType || 'basic',
      isE2S: authContext.user.isE2S ?? false,
    });

    logger.info('calendar.social_posts.token_created', {
      appId,
      tokenExpires: tokenResult.expires,
    });

    const url = `${agentUrl}/apps/${appId}/social/posts`;

    logger.info('calendar.social_posts.fetching', {
      appId,
      url,
    });

    // Create AbortController for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), AGENTS_API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`,
        },
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      logger.info('calendar.social_posts.response', {
        appId,
        status: response.status,
        ok: response.ok,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('calendar.social_posts.fetch_failed', {
          appId,
          status: response.status,
          error: errorText,
        });
        return [];
      }

      const data = await response.json();
      const posts = data.posts || [];

      logger.info('calendar.social_posts.data_received', {
        appId,
        totalPosts: posts.length,
        postStates: posts.map((p: any) => p.state),
      });

      // Transform and filter posts
      const filtered = posts
        .filter((post: any) => {
          // Only include scheduled or published posts
          if (post.state !== 'SCHEDULED' && post.state !== 'PUBLISHED') {
            return false;
          }

          // Filter by month
          const postDate = new Date(post.scheduledAt || post.completedAt);
          return postDate.getMonth() === month.getMonth() &&
                 postDate.getFullYear() === month.getFullYear();
        })
        .map((post: any) => transformSocialPost(post))
        .filter((post): post is ScheduledPost => post !== null); // Filter out invalid posts

      logger.info('calendar.social_posts.fetch_success', {
        appId,
        filteredCount: filtered.length,
      });

      return filtered;
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // Handle timeout specifically
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.warn('calendar.social_posts.timeout', {
          appId,
          timeoutMs: AGENTS_API_TIMEOUT_MS,
        });
      } else {
        throw fetchError; // Re-throw non-timeout errors to outer catch
      }

      return [];
    }
  } catch (error) {
    logger.error('calendar.social_posts.error', {
      appId,
      error: getErrorMessage(error),
    });
    return []; // Graceful degradation
  }
}
