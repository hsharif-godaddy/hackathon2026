import { User } from '@/types/inbox/local/user';

/**
 * Resolves the display name from conversation participants. Returns an empty
 * string when no name is available; callers supply a translated fallback (this
 * is a pure helper and cannot use the translation hook).
 */
export function primaryParticipantName(conversation: { c2: ReadonlyArray<User> }): string {
  const { c2 } = conversation;
  if (c2.length === 0) return '';
  if (c2.length === 1) return c2[0].name || '';
  return c2.map((user) => user.name).filter(Boolean).join(', ');
}
