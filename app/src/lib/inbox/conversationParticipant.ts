import { User } from '@/types/inbox/local/user';

/**
 * Resolves the display name from conversation participants. Returns an empty
 * string when no name is available; callers supply a translated fallback (this
 * is a pure helper and cannot use the translation hook).
 */
export function primaryParticipantName(conversation: { c2: ReadonlyArray<User> }): string {
  const primaryParticipant = conversation.c2[0];
  const joinedNames = conversation.c2.map((user) => user.name).join(', ');
  return primaryParticipant?.name || joinedNames || '';
}
