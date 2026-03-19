'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import Box from '@ux/box';
import Modal from '@ux/modal';
import text from '@ux/text';

import { ChatTab } from '@/app/develop/components/types';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { useChatTabs } from '@/hooks/useChatTabs';
import { useTranslations } from '@/hooks/useTranslations';
import { CalendarEvent } from '@/types/marketing';
import BlogInstructionsForm from './event-modal/BlogInstructionsForm';
import ContentTypeSelector from './event-modal/ContentTypeSelector';
import EventList from './event-modal/EventList';
import {
  getBlogCreationInstructions,
  getInitialScheduleTime,
  getSocialPostCreationInstructions,
  getUserTimezone,
  parseTime,
  shouldDisableTime as shouldDisableTimeHelper,
  validateScheduledTime,
} from './event-modal/helpers';
import SocialInstructionsForm from './event-modal/SocialInstructionsForm';
import { BlogCreationContext, ContentType, EventModalProps } from './event-modal/types';

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
  const [scheduledTime, setScheduledTime] = useState('10:00 AM');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<'facebook' | 'instagram'>>(new Set(['facebook', 'instagram']));
  const { sendMessage } = useWebSocketContext();
  const { setActiveChatTab } = useChatTabs();

  // Check if selected date is today
  const isToday = useMemo(() => {
    const today = new Date();
    const selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return selectedDate.getTime() === todayDate.getTime();
  }, [date]);

  // Set default time to next available slot when date changes
  useEffect(() => {
    const locale = intl.locale || 'en-US';
    const defaultTime = getInitialScheduleTime(locale);
    setScheduledTime(defaultTime);
  }, [date, intl.locale]);

  // Get user's timezone for display
  const userTimezone = useMemo(() => getUserTimezone(), []);

  // Validate scheduled time
  const timeValidation = useMemo(() =>
    validateScheduledTime(scheduledTime, date, isToday),
    [scheduledTime, date, isToday]
  );

  // Disable time options that are in the past or too soon (only for today)
  const shouldDisableTime = useCallback(
    (timeString: string) => shouldDisableTimeHelper(timeString, date, isToday),
    [date, isToday]
  );

  // Update state when initialEvent changes
  useEffect(() => {
    // Early return if modal is not open to prevent updates during cleanup
    if (!isOpen) {
      return;
    }

    if (initialEvent) {
      setSelectedEvent(initialEvent);
      // Don't auto-select content type - let user choose
      setSelectedContentType(null);
      setShowInstructionsInput(false);
      setScheduledTime('10:00 AM');
    }
    // setState functions are stable and don't need to be in dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEvent, isOpen]);

  // Reset state when modal closes
  const handleClose = () => {
    setCustomInstructions('');
    setSelectedEvent(null);
    setShowInstructionsInput(false);
    setSelectedContentType(null);
    setScheduledTime('10:00 AM');
    setSelectedPlatforms(new Set(['facebook', 'instagram']));
    onClose();
  };

  const handleCreatePostClick = (event?: CalendarEvent) => {
    // Always set selectedEvent to event (or null if undefined)
    // This ensures previous event is cleared when creating custom post
    setSelectedEvent(event ?? null);
    setShowInstructionsInput(true);
  };

  const handleBackToContentTypeSelection = () => {
    setShowInstructionsInput(false);
    setCustomInstructions('');
    setScheduledTime('10:00 AM');
    setSelectedPlatforms(new Set(['facebook', 'instagram']));
    setSelectedEvent(null);
  };

  const handleScheduleBlogPost = async () => {
    // Create a date object in the user's local timezone
    const { hours, minutes } = parseTime(scheduledTime);
    // Use local date parts to create consistent local datetime
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
    } catch {
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

  const handleScheduleSocialPost = async () => {

    const { hours, minutes } = parseTime(scheduledTime);
    // Use local date parts to create consistent local datetime
    const localDateTime = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      hours,
      minutes,
      0,
      0
    );

    const scheduledAtISO = localDateTime.toISOString();
    const formattedDate = date.toISOString().split('T')[0];

    // Convert Set to array for context data
    const platforms = Array.from(selectedPlatforms);

    // Format platform names for user-facing message
    const platformText = platforms.length === 2
      ? t('builder_marketing_facebook_and_instagram')
      : platforms[0] === 'facebook'
        ? t('builder_marketing_facebook')
        : t('builder_marketing_instagram');

    // User-facing message for chat
    const formattedDateForDisplay = intl.formatDate(date, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const message = selectedEvent
      ? t('builder_marketing_chat_message_social_with_event_and_platform', {
          date: formattedDateForDisplay,
          time: scheduledTime,
          eventName: selectedEvent.name,
          platform: platformText
        })
      : t('builder_marketing_chat_message_social_without_event_and_platform', {
          date: formattedDateForDisplay,
          time: scheduledTime,
          platform: platformText
        });

    // Build context data
    const contextData: any = {
      scheduledDate: formattedDate,
      scheduledTime: scheduledTime,
      contentType: 'social',
      scheduledAtISO: scheduledAtISO,
      platforms: platforms,
      instructions: getSocialPostCreationInstructions(scheduledAtISO, platforms),
      event: selectedEvent ? {
        name: selectedEvent.name,
        description: selectedEvent.description,
        emoji: selectedEvent.emoji,
        hashtags: selectedEvent.hashtags,
        contentIdeas: selectedEvent.contentIdeas
      } : undefined
    };

    if (customInstructions.trim()) {
      contextData.customInstructions = customInstructions.trim();
    }

    // Navigate to chat tab
    setActiveChatTab(ChatTab.CHAT);

    // Send WebSocket message
    await sendMessage(
      message,
      undefined, // aiEditContext
      undefined, // selectedAsset
      undefined, // todoListContext
      undefined, // isActionRequest
      {
        type: 'social_post_from_calendar',
        data: contextData,
        persistence: 'ephemeral',
        source: 'marketing-calendar'
      }
    );

    handleClose();
  };

  // Compare dates only (ignore time) - normalize both to midnight local time
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const isPast = selectedDate < todayDate;

  // Early return before any JSX creation for optimization
  if (!isOpen) return null;

  return (
    <Modal title={intl.formatDate(date, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })} onClose={handleClose}>
      <Box gap="md">
        {isPast && (
          <Box gap="sm" inlinePadding='md' blockPadding='md' className="text-center border-0 intents-ux-boxLowContrast">
            <text.p>
              {t('builder_marketing_past_date_warning')}
            </text.p>
          </Box>
        )}

        {/* Content Type Selection - Initial View */}
        {!selectedContentType && !isPast && (
          <ContentTypeSelector
            onSelectType={(type) => {
              setSelectedContentType(type);
              // If we have a selectedEvent already (from clicking event card), skip to instructions
              if (selectedEvent && type === 'blog') {
                setShowInstructionsInput(true);
              }
            }}
            onClose={handleClose}
          />
        )}

        {/* Blog Post Creation Flow */}
        {selectedContentType === 'blog' && showInstructionsInput && !isPast && (
          <BlogInstructionsForm
            selectedEvent={selectedEvent}
            scheduledTime={scheduledTime}
            onScheduledTimeChange={setScheduledTime}
            customInstructions={customInstructions}
            onCustomInstructionsChange={setCustomInstructions}
            userTimezone={userTimezone}
            timeValidation={timeValidation}
            shouldDisableTime={shouldDisableTime}
            onBack={handleBackToContentTypeSelection}
            onSubmit={handleScheduleBlogPost}
          />
        )}

        {/* Social Post Creation Flow */}
        {selectedContentType === 'social' && showInstructionsInput && !isPast && (
          <SocialInstructionsForm
            selectedEvent={selectedEvent}
            selectedPlatforms={selectedPlatforms}
            onSelectedPlatformsChange={setSelectedPlatforms}
            scheduledTime={scheduledTime}
            onScheduledTimeChange={setScheduledTime}
            customInstructions={customInstructions}
            onCustomInstructionsChange={setCustomInstructions}
            userTimezone={userTimezone}
            timeValidation={timeValidation}
            shouldDisableTime={shouldDisableTime}
            onBack={handleBackToContentTypeSelection}
            onSubmit={handleScheduleSocialPost}
          />
        )}

        {/* Event Selection - shown after selecting Blog or Social Post type */}
        {selectedContentType && !showInstructionsInput && (
          <EventList
            events={events}
            contentType={selectedContentType}
            isPast={isPast}
            onSelectEvent={handleCreatePostClick}
            onCreateCustomPost={() => handleCreatePostClick()}
            onBack={() => setSelectedContentType(null)}
          />
        )}
      </Box>
    </Modal>
  );
}
