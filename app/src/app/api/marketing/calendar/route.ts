import { NextRequest, NextResponse } from 'next/server';

import { createCustomerAuthError, type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { generateMilestoneEvents, getMonthDateRange } from '@/lib/marketing/get-calendar-events';
import { getScheduledPostsForMonth } from '@/lib/marketing/scan-scheduled-posts';
import { getPrismaClient } from '@/lib/prisma';
import { logger } from '@/lib/request-context';
import { BusinessType, CalendarEvent } from '@/types/marketing';
import { getApiBaseUrl } from '@/utils/getServerRootDomain';

export const dynamic = 'force-dynamic';

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

// GET /api/marketing/calendar?siteId={id}&month={YYYY-MM}
export const GET = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext
  ): Promise<NextResponse> => {
    try {
      const { searchParams } = new URL(request.url);
      const siteId = searchParams.get('siteId');
      const monthParam = searchParams.get('month');
      const market = searchParams.get('market') || 'en-US';
      const timezone = searchParams.get('timezone') || 'America/New_York';

      if (!siteId) {
        return NextResponse.json(
          { error: 'siteId is required' },
          { status: 400 }
        );
      }

      // Validate siteId format (UUID)
      if (!/^[a-f0-9-]{36}$/i.test(siteId)) {
        return NextResponse.json(
          { error: 'Invalid siteId format' },
          { status: 400 }
        );
      }

      // Validate market format (e.g., en-US, es-MX)
      if (!/^[a-z]{2}-[A-Z]{2}$/.test(market)) {
        return NextResponse.json(
          { error: 'Invalid market format. Expected format: en-US' },
          { status: 400 }
        );
      }

      // Validate timezone format (e.g., America/New_York, Europe/London)
      if (!/^[A-Za-z_/]+$/.test(timezone)) {
        return NextResponse.json(
          { error: 'Invalid timezone format' },
          { status: 400 }
        );
      }

      // Parse month parameter (YYYY-MM format)
      // IMPORTANT: Parse as local date, not UTC, to avoid timezone shifts
      let month: Date;
      if (monthParam) {
        const [year, monthStr] = monthParam.split('-');
        const yearNum = parseInt(year, 10);
        const monthNum = parseInt(monthStr, 10);

        // Validate parsed values
        if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12 || yearNum < 1900 || yearNum > 2100) {
          return NextResponse.json(
            { error: 'Invalid month parameter. Expected format: YYYY-MM (e.g., 2024-01)' },
            { status: 400 }
          );
        }

        // Month is 0-indexed, so subtract 1. Create at noon to avoid timezone issues.
        month = new Date(yearNum, monthNum - 1, 1, 12, 0, 0, 0);

        // Verify the date was created successfully (handles invalid dates like 2024-13)
        if (month.getMonth() !== monthNum - 1) {
          return NextResponse.json(
            { error: 'Invalid month parameter. Expected format: YYYY-MM (e.g., 2024-01)' },
            { status: 400 }
          );
        }
      } else {
        month = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12, 0, 0, 0);
      }

      // Get site information and verify ownership
      const prisma = getPrismaClient();
      const site = await prisma.sites.findUnique({
        where: { id: siteId },
        select: {
          id: true,
          created_at: true,
          account_id: true,
        }
      });

      if (!site) {
        return NextResponse.json(
          { error: 'Site not found' },
          { status: 404 }
        );
      }

      // CRITICAL: Verify the authenticated user owns this site
      if (site.account_id !== authContext.user.accountId) {
        logger.warn('marketing.calendar.unauthorized_access_attempt', {
          siteId,
          requestedAccountId: site.account_id,
          authenticatedAccountId: authContext.user.accountId,
          customerId: authContext.user.customerId
        });

        return createCustomerAuthError(
          'You do not have permission to access this site',
          403
        );
      }

      // Default to 'general' business type for MVP
      const businessType: BusinessType = 'general';

      // Generate milestone events
      const milestoneEvents = generateMilestoneEvents(site.created_at, month);

      // Fetch content inspirations from our proxy API
      const categoryGroup = BUSINESS_TYPE_TO_CATEGORY[businessType] || 'generic';
      const { startDate, endDate } = getMonthDateRange(month);

      logger.debug('marketing.calendar.fetching_inspirations', {
        siteId,
        categoryGroup,
        market,
        startDate,
        endDate,
        timezone
      });

      let inspirationEvents: CalendarEvent[] = [];
      try {
        // Call Content Inspirations API directly (server-to-server)
        // Use JWT from our auth context instead of going through proxy
        if (!authContext.jwt) {
          logger.warn('marketing.calendar.no_jwt', {
            message: 'No JWT available, skipping content inspirations'
          });
        } else {
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

            if (inspirationsResponse.ok) {
            const data: ContentInspirationsResponse = await inspirationsResponse.json();

            logger.debug('marketing.calendar.inspirations_success', {
              count: data.inspirations?.length || 0
            });

            // Transform inspirations to CalendarEvent format
            inspirationEvents = (data.inspirations || [])
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
            } else {
              const errorText = await inspirationsResponse.text();
              logger.error('marketing.calendar.inspirations_error', {
                status: inspirationsResponse.status,
                statusText: inspirationsResponse.statusText,
                error: errorText
              });
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
              logger.warn('marketing.calendar.inspirations_timeout', {
                message: 'Content Inspirations API request timed out after 10s, continuing without external events'
              });
            } else {
              throw fetchError; // Re-throw non-timeout errors to outer catch
            }
          }
        }
      } catch (error) {
        logger.error('marketing.calendar.inspirations_fetch_error', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Combine all events: inspirations + milestone
      const allEvents = [...inspirationEvents, ...milestoneEvents];

      // Filter to only include events from the requested month
      const requestedYear = month.getFullYear();
      const requestedMonth = month.getMonth();

      const events = allEvents
        .filter(event => {
          const eventYear = event.date.getFullYear();
          const eventMonth = event.date.getMonth();
          return eventYear === requestedYear && eventMonth === requestedMonth;
        })
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      // Get scheduled posts for this month
      const scheduledPosts = await getScheduledPostsForMonth(siteId, month);

      logger.info('marketing.calendar.fetched', {
        eventCount: events.length,
        scheduledPostCount: scheduledPosts.length,
        month: monthParam
      });

      return NextResponse.json({
        events,
        scheduledPosts,
        businessType
      });
    } catch (error) {
      logger.error('marketing.calendar.error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return NextResponse.json(
        { error: 'Failed to fetch calendar data' },
        { status: 500 }
      );
    }
  }
);
