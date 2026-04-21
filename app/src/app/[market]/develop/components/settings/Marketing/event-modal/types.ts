import { CalendarEvent, ScheduledPost } from '@/types/marketing';

export interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: Date;
  events: CalendarEvent[];
  scheduledPosts: ScheduledPost[];
  appId: string;
  initialEvent?: CalendarEvent | null;
}

export interface BlogCreationContext {
  scheduledDate: string;
  scheduledTime: string;
  contentType: string;
  instructions: string;
  customInstructions?: string;
  event?: {
    name: string;
    description?: string;
    emoji?: string;
    contentIdeas: string[];
  };
}

export type ContentType = 'blog' | 'social' | 'email' | null;

export interface ContentTypeOption {
  type: ContentType;
  icon: React.ReactNode;
  title: string;
  enabled: boolean;
  badge: string | null;
}

// Skill configuration for blog post creation
export const BLOG_CREATION_SKILLS = {
  blogInstall: 'blog',
  blogWriting: 'blog-writing',
} as const;

export const SOCIAL_POST_SKILL = 'social-posts' as const;
