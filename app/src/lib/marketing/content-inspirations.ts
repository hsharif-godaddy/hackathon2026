import type { NextRequest } from 'next/server';

import type { CustomerAuthContext } from '@/lib/customer-auth';
import { getMonthDateRange } from '@/lib/marketing/get-calendar-events';
import { logger } from '@/lib/request-context';
import type { BusinessType, CalendarEvent } from '@/types/marketing';
import { getApiBaseUrl } from '@/utils/getServerRootDomain';

// Content Inspirations API response types
interface ContentInspiration {
  eventStartDate: string;
  eventEndDate?: string;
  displayTopic?: string;
  title?: string;
  emoji?: string;
  description?: string;
  hashtags?: string[];
  imageUrl?: string;
  overSearchTerm?: string;
  topicKey?: string;
  markets?: string[];
  categoryGroups?: string[];
  uiTreatment?: string;
}

interface ContentInspirationsResponse {
  inspirations: ContentInspiration[];
}

// Map business types to Content Inspirations category groups
const BUSINESS_TYPE_TO_CATEGORY: Record<BusinessType, string> = {
  retail: 'retail',
  saas: 'technology',
  restaurant: 'restaurant',
  service: 'services',
  blog: 'generic',
  health: 'health',
  general: 'generic',
};

/**
 * Fetch content inspirations from Content Inspirations API
 *
 * @param request - Next.js request object (for base URL generation)
 * @param businessType - The business type to fetch inspirations for
 * @param month - The month to fetch inspirations for
 * @param market - Market locale (e.g., 'en-US')
 * @param timezone - Timezone (e.g., 'America/New_York')
 * @param authContext - Customer authentication context
 * @returns Array of calendar events from content inspirations (empty array on error)
 */
export async function fetchContentInspirations(
  request: NextRequest,
  businessType: BusinessType,
  month: Date,
  market: string,
  timezone: string,
  authContext: CustomerAuthContext
): Promise<CalendarEvent[]> {
  try {
    // Check if JWT is available
    if (!authContext.jwt) {
      logger.warn('marketing.calendar.no_jwt', {
        message: 'No JWT available, skipping content inspirations'
      });
      return [];
    }

    const categoryGroup = BUSINESS_TYPE_TO_CATEGORY[businessType] || 'generic';
    const { startDate, endDate } = getMonthDateRange(month);

    logger.debug('marketing.calendar.fetching_inspirations', {
      categoryGroup,
      market,
      startDate,
      endDate,
      timezone
    });

    // Build API URL
    const baseUrl = getApiBaseUrl(request, 'content-inspirations.api');
    const apiUrl = new URL(`${baseUrl}/v1/inspirations`);
    apiUrl.searchParams.set('category_group', categoryGroup);
    apiUrl.searchParams.set('market', market);
    apiUrl.searchParams.set('start_date', startDate);
    apiUrl.searchParams.set('end_date', endDate);
    apiUrl.searchParams.set('timezone', timezone);
    apiUrl.searchParams.set('explicit_matches', 'false');
    apiUrl.searchParams.set('in_vertical_experiments', 'false');

    logger.debug('marketing.calendar.fetching_inspirations_direct', {
      categoryGroup,
      market,
      startDate,
      endDate,
      requestedMonth: `${month.getFullYear()}-${month.getMonth() + 1}`
    });

    // Add timeout to external API call (10 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const inspirationsResponse = await fetch(apiUrl.toString(), {
        headers: {
          'Cookie': `auth_idp=${authContext.jwt}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!inspirationsResponse.ok) {
        const errorText = await inspirationsResponse.text();
        logger.error('marketing.calendar.inspirations_error', {
          status: inspirationsResponse.status,
          statusText: inspirationsResponse.statusText,
          error: errorText
        });
        return [];
      }

      const data: ContentInspirationsResponse = await inspirationsResponse.json();

      logger.debug('marketing.calendar.inspirations_success', {
        count: data.inspirations?.length || 0
      });

      // Transform inspirations to CalendarEvent format
      const inspirationEvents = (data.inspirations || [])
        .map((inspiration: ContentInspiration) => {
          const eventDate = new Date(inspiration.eventStartDate + 'T12:00:00');

          // Skip invalid dates
          if (isNaN(eventDate.getTime())) {
            return null;
          }

          return {
            date: eventDate,
            name: inspiration.displayTopic || inspiration.title,
            emoji: inspiration.emoji || '📅',
            description: inspiration.description || undefined,
            category: 'inspiration',
            isCustom: false,
            hashtags: inspiration.hashtags?.filter((h: string) => h !== '') || [],
            imageUrl: inspiration.imageUrl || undefined,
            overSearchTerm: inspiration.overSearchTerm || undefined,
            topicKey: inspiration.topicKey || undefined,
            metadata: {
              markets: inspiration.markets,
              categoryGroups: inspiration.categoryGroups,
              uiTreatment: inspiration.uiTreatment,
              eventEndDate: inspiration.eventEndDate,
            },
          };
        })
        .filter((event: CalendarEvent | null): event is CalendarEvent => event !== null);

      return inspirationEvents;

    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logger.warn('marketing.calendar.inspirations_timeout', {
          message: 'Content Inspirations API request timed out after 10s, continuing without external events'
        });
        return [];
      }
      throw fetchError; // Re-throw non-timeout errors
    }

  } catch (error) {
    logger.error('marketing.calendar.inspirations_fetch_error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return [];
  }
}
