'use client';

import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import Box from '@ux/box';
import Button from '@ux/button';
import EditIcon from '@ux/icon/edit';
import MailIcon from '@ux/icon/mail';
import ShareIcon from '@ux/icon/share';
import Modal from '@ux/modal';
import text from '@ux/text';

import { ChatTab } from '@/app/develop/components/types';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';

interface EventModalProps {
  isOpen: boolean;
  onClose: () => void;
  date: Date;
  events: CalendarEvent[];
  scheduledPosts: ScheduledPost[];
  appId: string;
  initialEvent?: CalendarEvent | null;
}

interface BlogCreationContext {
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

type ContentType = 'blog' | 'social' | 'email' | null;

// Skill configuration for blog post creation
const BLOG_CREATION_SKILLS = {
  blogInstall: 'blog',
  blogWriting: 'blog-writing',
} as const;

const getBlogCreationInstructions = (publishedAtTimestamp: string): string => {
  return `First check if I have a blog set up. If not, use the ${BLOG_CREATION_SKILLS.blogInstall} skill to install it. Then use the ${BLOG_CREATION_SKILLS.blogWriting} skill to create this blog post. Set the publishedAt date in the frontmatter to ${publishedAtTimestamp}`;
};

export default function EventModal({
  isOpen,
  onClose,
  date,
  events,
  scheduledPosts: _scheduledPosts,
  appId: _appId,
  initialEvent = null
}: EventModalProps) {
  const t = useTranslations();
  const intl = useIntl();
  const [customInstructions, setCustomInstructions] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(initialEvent);
  const [showInstructionsInput, setShowInstructionsInput] = useState(false);
  const [selectedContentType, setSelectedContentType] = useState<ContentType>(null);
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const { sendMessage } = useWebSocketContext();
  const { setActiveChatTab } = useChatTabs();

  // Update state when initialEvent changes
  useEffect(() => {
    if (initialEvent) {
      setSelectedEvent(initialEvent);
      // Don't auto-select content type - let user choose
      setSelectedContentType(null);
      setShowInstructionsInput(false);
      setScheduledTime('10:00');
    }
  }, [initialEvent]);

  // Reset state when modal closes
  const handleClose = () => {
    setCustomInstructions('');
    setSelectedEvent(null);
    setShowInstructionsInput(false);
    setSelectedContentType(null);
    setScheduledTime('10:00');
    onClose();
  };

  const handleCreatePostClick = (event?: CalendarEvent) => {
    setSelectedEvent(event || null);
    setShowInstructionsInput(true);
  };

  const handleScheduleBlogPost = async () => {
    // Create a date object in the user's local timezone
    const [hours, minutes] = scheduledTime.split(':').map(Number);
    const localDateTime = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      hours,
      minutes,
      0,
      0
    );

    // Convert to ISO string (UTC)
    const publishedAtTimestamp = localDateTime.toISOString();
    const formattedDate = date.toISOString().split('T')[0];

    // Get timezone safely with fallback
    let timezone = t('builder_marketing_local_time');
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (_e) {
      // Fallback to offset if timezone detection fails
      const offset = -localDateTime.getTimezoneOffset();
      const offsetHours = Math.floor(Math.abs(offset) / 60);
      const offsetMinutes = Math.abs(offset) % 60;
      timezone = `UTC${offset >= 0 ? '+' : '-'}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
    }

    // Clean user-facing message with local time
    const formattedDateForDisplay = intl.formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
    const message = selectedEvent
      ? t('builder_marketing_chat_message_with_event', { date: formattedDateForDisplay, time: scheduledTime, timezone, eventName: selectedEvent.name })
      : t('builder_marketing_chat_message_without_event', { date: formattedDateForDisplay, time: scheduledTime, timezone });

    // Build context data
    const contextData: BlogCreationContext = {
      scheduledDate: formattedDate,
      scheduledTime: scheduledTime,
      contentType: 'blog',
      instructions: getBlogCreationInstructions(publishedAtTimestamp)
    };

    if (selectedEvent) {
      contextData.event = {
        name: selectedEvent.name,
        description: selectedEvent.description,
        emoji: selectedEvent.emoji,
        contentIdeas: selectedEvent.contentIdeas || []
      };
    }

    if (customInstructions.trim()) {
      contextData.customInstructions = customInstructions.trim();
    }

    // Navigate to chat tab first
    setActiveChatTab(ChatTab.CHAT);

    // Send message with context (same pattern as Go Live modal)
    await sendMessage(
      message,
      undefined, // aiEditContext
      undefined, // selectedAsset
      undefined, // todoListContext
      undefined, // isActionRequest
      {
        type: 'scheduled_content_creation',
        data: contextData,
        persistence: 'ephemeral',
        source: 'marketing-calendar'
      }
    );

    // Close modal and reset state
    handleClose();
  };

  // Compare dates only (ignore time) - normalize both to midnight local time
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const isPast = selectedDate < todayDate;

  const hasEvents = events.length > 0;

  // Early return before any JSX creation for optimization
  if (!isOpen) return null;

  const contentTypeOptions = [
    {
      type: 'blog' as ContentType,
      icon: <EditIcon className="w-4 h-4" />,
      title: t('builder_marketing_content_type_blog_post'),
      enabled: true,
      badge: null
    },
    {
      type: 'social' as ContentType,
      icon: <ShareIcon className="w-4 h-4" />,
      title: t('builder_marketing_content_type_social_post'),
      enabled: false,
      badge: t('builder_marketing_coming_soon')
    },
    {
      type: 'email' as ContentType,
      icon: <MailIcon className="w-4 h-4" />,
      title: t('builder_marketing_content_type_email'),
      enabled: false,
      badge: t('builder_marketing_coming_soon')
    }
  ];

  return (
    <Modal title={intl.formatDate(date, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })} onClose={handleClose}>
      <Box gap="md">
        {isPast && (
          <Box className="p-3 rounded bg-intents-ux-warning-backgroundColor border border-intents-ux-warning-borderColor">
            <text.p className="text-intents-ux-warning-textColor">
              {t('builder_marketing_past_date_warning')}
            </text.p>
          </Box>
        )}

        {/* Content Type Selection - Initial View */}
        {!selectedContentType && !isPast && (
          <Box gap="sm">
            <text.p className="text-sm font-semibold text-intents-ux-textStandard-textColor text-center">
              {t('builder_marketing_what_to_create')}
            </text.p>

            <div className="grid grid-cols-3 gap-2">
              {contentTypeOptions.map((option) => (
                <button
                  key={option.type}
                  onClick={() => {
                    if (option.enabled) {
                      setSelectedContentType(option.type);
                      // If we have a selectedEvent already (from clicking event card), skip to instructions
                      if (selectedEvent && option.type === 'blog') {
                        setShowInstructionsInput(true);
                      }
                    }
                  }}
                  disabled={!option.enabled}
                  className={cn(
                    'relative px-2 py-2 rounded-md border text-center transition-all duration-200 flex flex-col items-center gap-1',
                    option.enabled
                      ? 'border-intents-ux-boxLowContrast-borderColor hover:border-intents-ux-actionPrimary-backgroundColor hover:shadow cursor-pointer bg-intents-ux-boxStandard-backgroundColor'
                      : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor/30 cursor-not-allowed opacity-60'
                  )}
                >
                  <div className={cn(
                    'flex-shrink-0 w-7 h-7 rounded flex items-center justify-center transition-all duration-200',
                    option.enabled
                      ? 'bg-intents-ux-actionPrimary-backgroundColor/10 text-intents-ux-actionPrimary-textColor'
                      : 'bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubdued-textColor'
                  )}>
                    {option.icon}
                  </div>

                  <div className="flex flex-col items-center">
                    <span className="text-xs font-medium text-intents-ux-textStandard-textColor">
                      {option.title}
                    </span>
                    {option.badge && (
                      <span className="px-1 py-0 text-[10px] font-medium rounded-full bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-textSubdued-textColor mt-0.5">
                        {option.badge}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <Button
              onClick={handleClose}
              design="secondary"
              size="md"
              className="w-full"
            >
              {t('builder_marketing_close')}
            </Button>
          </Box>
        )}

        {/* Blog Post Creation Flow */}
        {selectedContentType === 'blog' && showInstructionsInput && !isPast && (
          <Box gap="md">
            {/* Event header - cleaner, less cluttered */}
            {selectedEvent && (
              <Box gap="sm" className="pb-3 border-b border-intents-ux-boxLowContrast-borderColor">
                <text.h4 size={1} className="font-semibold">
                  {selectedEvent.name}
                </text.h4>
                {selectedEvent.description && (
                  <text.p className="text-sm text-intents-ux-textSubdued-textColor">
                    {selectedEvent.description}
                  </text.p>
                )}
              </Box>
            )}

            {!selectedEvent && (
              <Box className="pb-3 border-b border-intents-ux-boxLowContrast-borderColor">
                <text.h4 size={1} className="font-semibold">
                  {t('builder_marketing_custom_blog_post')}
                </text.h4>
              </Box>
            )}

            {/* Time picker */}
            <Box gap="sm">
              <label className="text-sm font-medium text-intents-ux-textStandard-textColor">
                {t('builder_marketing_publish_time')}
              </label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-full p-3 border border-intents-ux-boxLowContrast-borderColor rounded-lg
                  text-intents-ux-textStandard-textColor
                  focus:outline-none focus:ring-2 focus:ring-intents-ux-actionPrimary-backgroundColor focus:border-transparent
                  transition-shadow"
              />
            </Box>

            {/* Simplified instructions - single clean section */}
            <Box gap="sm">
              <label className="text-sm font-medium text-intents-ux-textStandard-textColor">
                {t('builder_marketing_additional_instructions')} <span className="text-intents-ux-textSubdued-textColor font-normal">{t('builder_marketing_optional')}</span>
              </label>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder={t('builder_marketing_instructions_placeholder')}
                rows={4}
                className="w-full p-3 border border-intents-ux-boxLowContrast-borderColor rounded-lg resize-none
                  text-intents-ux-textStandard-textColor placeholder:text-intents-ux-textSubdued-textColor
                  focus:outline-none focus:ring-2 focus:ring-intents-ux-actionPrimary-backgroundColor focus:border-transparent
                  transition-shadow"
              />
            </Box>

            {/* Action buttons - better spacing */}
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="end" className="pt-2">
              <Button
                onClick={() => {
                  setShowInstructionsInput(false);
                  setCustomInstructions('');
                  setScheduledTime('10:00');
                  setSelectedEvent(null);
                }}
                design="secondary"
                size="md"
              >
                {t('builder_marketing_back')}
              </Button>
              <Button
                onClick={handleScheduleBlogPost}
                design="primary"
                size="md"
              >
                {t('builder_marketing_create_blog_post')}
              </Button>
            </Box>
          </Box>
        )}

        {/* Event Selection - shown after selecting Blog Post type */}
        {selectedContentType === 'blog' && !showInstructionsInput && hasEvents && (
          <Box gap="lg">
            {events.map((event, idx) => (
              <Box key={idx} gap="md" className="pb-4 border-b border-intents-ux-boxLowContrast-borderColor last:border-0 last:pb-0">
                <Box gap="sm">
                  <text.p className="font-semibold text-lg">{event.name}</text.p>
                  {event.description && (
                    <text.p className="text-sm text-intents-ux-textSubdued-textColor">
                      {event.description}
                    </text.p>
                  )}
                </Box>
                <Button
                  onClick={() => handleCreatePostClick(event)}
                  disabled={isPast}
                  design="primary"
                  size="md"
                  className="w-full"
                >
                  {isPast ? t('builder_marketing_past_date') : t('builder_marketing_schedule_post')}
                </Button>
              </Box>
            ))}

            {/* Custom post option */}
            <Box orientation="horizontal" gap="sm">
              <Button
                onClick={() => setSelectedContentType(null)}
                design="tertiary"
                size="md"
              >
                {t('builder_marketing_back')}
              </Button>
              <Button
                onClick={() => handleCreatePostClick()}
                disabled={isPast}
                design="secondary"
                size="md"
                className="flex-1"
              >
                {t('builder_marketing_schedule_custom_post')}
              </Button>
            </Box>
          </Box>
        )}

        {/* No events - show custom post option */}
        {selectedContentType === 'blog' && !showInstructionsInput && !hasEvents && !isPast && (
          <Box gap="md">
            <Box gap="sm" className="py-4 text-center">
              <text.p className="text-intents-ux-textSubdued-textColor">
                {t('builder_marketing_no_events_for_day')}
              </text.p>
            </Box>
            <Box orientation="horizontal" gap="sm">
              <Button
                onClick={() => setSelectedContentType(null)}
                design="tertiary"
                size="md"
              >
                {t('builder_marketing_back')}
              </Button>
              <Button
                onClick={() => handleCreatePostClick()}
                design="primary"
                size="md"
                className="flex-1"
              >
                {t('builder_marketing_schedule_blog_post')}
              </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Modal>
  );
}
