import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { createCustomerAuthError, type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { fetchContentInspirations } from '@/lib/marketing/content-inspirations';
import { generateMilestoneEvents } from '@/lib/marketing/get-calendar-events';
import { getScheduledPostsForMonth } from '@/lib/marketing/scan-scheduled-posts';
import { fetchSocialPostsFromAgents } from '@/lib/marketing/social-posts';
import { logger } from '@/lib/request-context';
import { BusinessType } from '@/types/marketing';

export const dynamic = 'force-dynamic';

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

      logger.info('marketing.calendar.request', {
        siteId,
        month: monthParam,
        market,
        timezone
      });

      // Validate required parameters
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

      // Get site information and verify ownership via control plane adapter
      const adapter = getControlPlaneAdapter();
      const site = await adapter.getSite(siteId, authContext.jwt);

      if (!site) {
        return NextResponse.json(
          { error: 'Site not found' },
          { status: 404 }
        );
      }

      // Verify the authenticated user owns this site
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

      // Fetch all data in parallel
      // Note: appId === siteId in our system
      const [inspirationEvents, scheduledBlogPosts, socialPosts] = await Promise.all([
        fetchContentInspirations(request, businessType, month, market, timezone, authContext),
        getScheduledPostsForMonth(siteId, month),
        site.agent_url
          ? fetchSocialPostsFromAgents(siteId, month, authContext, site.agent_url)
          : Promise.resolve([]),
      ]);

      // Generate milestone events
      const milestoneEvents = generateMilestoneEvents(site.created_at, month);

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

      // Merge blog posts and social posts, sort by date
      const allScheduledPosts = [...scheduledBlogPosts, ...socialPosts]
        .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());

      logger.info('marketing.calendar.fetched', {
        eventCount: events.length,
        scheduledPostCount: allScheduledPosts.length,
        blogPostCount: scheduledBlogPosts.length,
        socialPostCount: socialPosts.length,
        month: monthParam
      });

      return NextResponse.json({
        events,
        scheduledPosts: allScheduledPosts,
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
