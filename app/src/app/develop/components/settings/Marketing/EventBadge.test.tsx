import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';
import EventBadge from './EventBadge';

describe('EventBadge', () => {
  beforeEach(() => {
    // No mocks needed for this component
  });

  describe('Calendar Event Rendering', () => {
    it('should render calendar event with name', () => {
      const event: CalendarEvent = {
        date: new Date('2026-02-16'),
        name: 'Presidents\' Day',
        category: 'inspiration',
        isCustom: false,
      };

      renderWithProviders(<EventBadge event={event} />);

      expect(screen.getByText('Presidents\' Day')).toBeInTheDocument();
    });

    it('should use event description as title when available', () => {
      const event: CalendarEvent = {
        date: new Date('2026-02-16'),
        name: 'Presidents\' Day',
        description: 'Federal holiday celebrating US presidents',
        category: 'inspiration',
        isCustom: false,
      };

      const { container } = renderWithProviders(<EventBadge event={event} />);
      const badge = container.querySelector('[title]');

      expect(badge).toHaveAttribute('title', 'Federal holiday celebrating US presidents');
    });

    it('should use event name as title when description not available', () => {
      const event: CalendarEvent = {
        date: new Date('2026-02-16'),
        name: 'Presidents\' Day',
        category: 'inspiration',
        isCustom: false,
      };

      const { container } = renderWithProviders(<EventBadge event={event} />);
      const badge = container.querySelector('[title]');

      expect(badge).toHaveAttribute('title', 'Presidents\' Day');
    });
  });

  describe('Social Post Rendering - Facebook', () => {
    const facebookPost: ScheduledPost = {
      slug: 'fb-post-1',
      title: 'Facebook post',
      publishedAt: '2026-02-16T10:00:00Z',
      status: 'scheduled',
      type: 'social',
      platform: 'facebook',
      postId: 'fb-123',
      message: 'Test Facebook post',
    };

    it('should render scheduled Facebook post', () => {
      renderWithProviders(<EventBadge scheduledPost={facebookPost} />);

      expect(screen.getByText('builder_marketing_facebook')).toBeInTheDocument();
    });

    it('should apply scheduled styling to Facebook post', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={facebookPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-intents-ux-warning-borderColor');
      expect(badge).toHaveClass('bg-intents-ux-warning-backgroundColor');
    });

    it('should apply published styling to published Facebook post', () => {
      const publishedPost = { ...facebookPost, status: 'published' as const };
      const { container } = renderWithProviders(<EventBadge scheduledPost={publishedPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-intents-ux-feedbackSuccess-borderColor');
      expect(badge).toHaveClass('bg-intents-ux-feedbackSuccess-backgroundColor');
    });

    it('should use solid border for social posts', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={facebookPost} />);
      const badge = container.firstChild;

      // Should NOT have dashed border
      expect(badge).not.toHaveClass('border-dashed');
    });

    it('should use message as title for Facebook post', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={facebookPost} />);
      const badge = container.querySelector('[title]');

      expect(badge).toHaveAttribute('title', 'Test Facebook post');
    });

    it('should fallback to title when no message', () => {
      const postWithoutMessage = { ...facebookPost, message: undefined };
      const { container } = renderWithProviders(<EventBadge scheduledPost={postWithoutMessage} />);
      const badge = container.querySelector('[title]');

      expect(badge).toHaveAttribute('title', 'Facebook post');
    });
  });

  describe('Social Post Rendering - Instagram', () => {
    const instagramPost: ScheduledPost = {
      slug: 'ig-post-1',
      title: 'Instagram post',
      publishedAt: '2026-02-16T10:00:00Z',
      status: 'scheduled',
      type: 'social',
      platform: 'instagram',
      postId: 'ig-123',
      message: 'Test Instagram post',
    };

    it('should render scheduled Instagram post', () => {
      renderWithProviders(<EventBadge scheduledPost={instagramPost} />);

      expect(screen.getByText('builder_marketing_instagram')).toBeInTheDocument();
    });

    it('should apply scheduled styling to Instagram post', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={instagramPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-intents-ux-warning-borderColor');
      expect(badge).toHaveClass('bg-intents-ux-warning-backgroundColor');
    });

    it('should apply published styling to published Instagram post', () => {
      const publishedPost = { ...instagramPost, status: 'published' as const };
      const { container } = renderWithProviders(<EventBadge scheduledPost={publishedPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-intents-ux-feedbackSuccess-borderColor');
      expect(badge).toHaveClass('bg-intents-ux-feedbackSuccess-backgroundColor');
    });
  });

  describe('Blog Post Rendering', () => {
    const blogPost: ScheduledPost = {
      slug: 'blog-post-1',
      title: 'Test Blog Post',
      publishedAt: '2026-02-16T10:00:00Z',
      status: 'scheduled',
      type: 'blog',
    };

    it('should render scheduled blog post', () => {
      renderWithProviders(<EventBadge scheduledPost={blogPost} />);

      // Blog posts render as "prefix: title" format
      expect(screen.getByText(/builder_marketing_blog_prefix.*Test Blog Post/)).toBeInTheDocument();
    });

    it('should apply dashed border to blog posts', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={blogPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-dashed');
    });

    it('should apply scheduled styling to blog post', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={blogPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-intents-ux-warning-borderColor');
      expect(badge).toHaveClass('bg-intents-ux-warning-backgroundColor');
    });

    it('should apply published styling to published blog post', () => {
      const publishedPost = { ...blogPost, status: 'published' as const };
      const { container } = renderWithProviders(<EventBadge scheduledPost={publishedPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-intents-ux-feedbackSuccess-borderColor');
      expect(badge).toHaveClass('bg-intents-ux-feedbackSuccess-backgroundColor');
      // Published blog should NOT have dashed border
      expect(badge).not.toHaveClass('border-dashed');
    });

    it('should use title as tooltip for blog post', () => {
      const { container } = renderWithProviders(<EventBadge scheduledPost={blogPost} />);
      const badge = container.querySelector('[title]');

      expect(badge).toHaveAttribute('title', 'Test Blog Post');
    });
  });

  describe('Visual Differences', () => {
    it('should render social posts with solid border', () => {
      const socialPost: ScheduledPost = {
        slug: 'post-1',
        title: 'Social',
        publishedAt: '2026-02-16T10:00:00Z',
        status: 'scheduled',
        type: 'social',
        platform: 'facebook',
      };

      const { container } = renderWithProviders(<EventBadge scheduledPost={socialPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-2');
      expect(badge).not.toHaveClass('border-dashed');
    });

    it('should render scheduled blog posts with dashed border', () => {
      const blogPost: ScheduledPost = {
        slug: 'post-1',
        title: 'Blog',
        publishedAt: '2026-02-16T10:00:00Z',
        status: 'scheduled',
        type: 'blog',
      };

      const { container } = renderWithProviders(<EventBadge scheduledPost={blogPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-2');
      expect(badge).toHaveClass('border-dashed');
    });

    it('should render published blog posts with solid border', () => {
      const blogPost: ScheduledPost = {
        slug: 'post-1',
        title: 'Blog',
        publishedAt: '2026-02-16T10:00:00Z',
        status: 'published',
        type: 'blog',
      };

      const { container } = renderWithProviders(<EventBadge scheduledPost={blogPost} />);
      const badge = container.firstChild;

      expect(badge).toHaveClass('border-2');
      expect(badge).not.toHaveClass('border-dashed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle event with empty name', () => {
      const event: CalendarEvent = {
        date: new Date('2026-02-16'),
        name: '',
        category: 'inspiration',
        isCustom: false,
      };

      const { container } = renderWithProviders(<EventBadge event={event} />);

      // Should still render without crashing - verify container structure exists
      const badge = container.querySelector('.flex.items-start.gap-1\\.5');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('title', '');
    });

    it('should handle social post without platform', () => {
      const socialPost: ScheduledPost = {
        slug: 'post-1',
        title: 'Social',
        publishedAt: '2026-02-16T10:00:00Z',
        status: 'scheduled',
        type: 'social',
        // platform is optional and undefined
      };

      renderWithProviders(<EventBadge scheduledPost={socialPost} />);

      // Should render generic "Social" label with ShareIcon fallback
      // This ensures posts remain visible even if platform is unknown/missing
      expect(screen.getByText('builder_marketing_social')).toBeInTheDocument();
    });

    it('should render when neither event nor scheduledPost provided', () => {
      const { container } = renderWithProviders(<EventBadge />);

      // Should render null/empty
      expect(container.firstChild).toBeNull();
    });
  });
});
