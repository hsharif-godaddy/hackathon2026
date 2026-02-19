import { BLOG_CREATION_SKILLS, SOCIAL_POST_SKILL } from './types';

/**
 * Minimum time buffer before allowing scheduled posts
 * Used to ensure posts have adequate processing time
 */
export const MINIMUM_SCHEDULE_BUFFER_MINUTES = 20;

export const getBlogCreationInstructions = (publishedAtTimestamp: string): string => {
  return `First check if I have a blog set up. If not, use the ${BLOG_CREATION_SKILLS.blogInstall} skill to install it. Then use the ${BLOG_CREATION_SKILLS.blogWriting} skill to create this blog post. Set the publishedAt date in the frontmatter to ${publishedAtTimestamp}`;
};

export const getSocialPostCreationInstructions = (scheduledAtISO: string, platforms: string[]): string => {
  const platformList = platforms.join(' and ');
  return `Hand off to the marketing agent to handle this. The marketing agent should use the ${SOCIAL_POST_SKILL} skill to create and schedule social media posts for ${platformList}. Schedule the post to be published at ${scheduledAtISO}.`;
};

// Parse 12-hour time format (e.g., "10:00 AM", "2:30 PM") to hours and minutes
export const parseTime = (time: string): { hours: number; minutes: number } => {
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const period = timeMatch[3]?.toUpperCase();

    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    return { hours, minutes };
  }

  // Fallback for 24-hour format (shouldn't happen with TimePicker)
  const [hours, minutes] = time.split(':').map(Number);
  return { hours, minutes };
};

export const getInitialScheduleTime = (locale: string): string => {
  const now = new Date();
  const minimumDateTime = new Date(now.getTime() + MINIMUM_SCHEDULE_BUFFER_MINUTES * 60 * 1000);

  // Round up to next 15-minute interval
  const minutes = minimumDateTime.getMinutes();
  const roundedMinutes = Math.ceil(minutes / 15) * 15;

  if (roundedMinutes >= 60) {
    minimumDateTime.setHours(minimumDateTime.getHours() + 1);
    minimumDateTime.setMinutes(roundedMinutes - 60);
  } else {
    minimumDateTime.setMinutes(roundedMinutes);
  }

  return minimumDateTime.toLocaleTimeString(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

export const validateScheduledTime = (
  scheduledTime: string,
  date: Date,
  isToday: boolean
): { isValid: boolean; message: string | null } => {
  if (!isToday || !scheduledTime) {
    return { isValid: true, message: null };
  }

  const { hours, minutes } = parseTime(scheduledTime);

  // Create date in local timezone by using today's date
  const now = new Date();
  const scheduledDateTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );

  const minimumDateTime = new Date(now.getTime() + MINIMUM_SCHEDULE_BUFFER_MINUTES * 60 * 1000);

  if (scheduledDateTime <= now) {
    return { isValid: false, message: 'builder_marketing_time_in_past' };
  }

  if (scheduledDateTime <= minimumDateTime) {
    return { isValid: false, message: 'builder_marketing_time_too_soon' };
  }

  return { isValid: true, message: null };
};

export const shouldDisableTime = (timeString: string, date: Date, isToday: boolean): boolean => {
  if (!isToday) return false;

  const { hours, minutes } = parseTime(timeString);
  const now = new Date();
  const selectedDateTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );

  const minimumDateTime = new Date(Date.now() + MINIMUM_SCHEDULE_BUFFER_MINUTES * 60 * 1000);
  return selectedDateTime <= minimumDateTime;
};

export const getUserTimezone = (): string => {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short'
    });
    const parts = formatter.formatToParts(now);
    const timeZoneName = parts.find(part => part.type === 'timeZoneName')?.value || '';
    return `${timeZone}${timeZoneName ? ` (${timeZoneName})` : ''}`;
  } catch {
    return 'Local time';
  }
};
