const TRIVIAL_PHRASES = new Set([
  'again',
  'back',
  'cancel',
  'continue',
  'do it',
  'done',
  'go',
  'go ahead',
  'good',
  'great',
  'keep going',
  'looks good',
  'next',
  'no',
  'nope',
  'ok',
  'okay',
  'perfect',
  'please',
  'redo',
  'retry',
  'retry all',
  'run it',
  'start',
  'stop',
  'sure',
  'thanks',
  'thank you',
  'try again',
  'undo',
  'yeah',
  'yep',
  'yes',
]);

const MIN_WORD_COUNT = 4;

export function isMeaningful(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  if (TRIVIAL_PHRASES.has(trimmed.toLowerCase())) return false;

  const words = trimmed.split(/\s+/);
  if (words.length >= MIN_WORD_COUNT) return true;

  // Short messages (< 4 words) that aren't in the trivial set are treated
  // as not meaningful to avoid triggering on borderline inputs. Relax this
  // behavior in the future if a heuristic for "real requests" is added.
  return false;
}
