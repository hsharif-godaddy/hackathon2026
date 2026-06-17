export type DesignDirection = 'keep-similar' | 'modernize' | 'simplify' | 'bold';

export type RebuildDesignDirectionCase = {
  id: string;
  userMessage: string;
  /** Expected `websiteRebuild({ designDirection })` value; omit when the agent should not pass the arg. */
  expectedDirection?: DesignDirection;
  /** Substrings that must appear in `rebuild-intent.md` (static prompt contract). */
  promptAnchors: string[];
};

/**
 * Phrase matrix for headless rebuild design-direction inference.
 * Live cases drive Initial Agent; static anchors pin the prompt contract in CI.
 */
export const REBUILD_DESIGN_DIRECTION_MATRIX: RebuildDesignDirectionCase[] = [
  {
    id: 'semantic-modernize-en',
    userMessage:
      'Recreate my site at example.com — make it look less dated, like newer sites in 2026',
    expectedDirection: 'modernize',
    promptAnchors: ['less dated', '2026', 'modernize'],
  },
  {
    id: 'semantic-modernize-es',
    userMessage: 'Quiero reconstruir example.com con un diseño más moderno',
    expectedDirection: 'modernize',
    promptAnchors: ['non-English', 'modernize'],
  },
  {
    id: 'semantic-clone-en',
    userMessage: 'Rebuild example.com but keep the same look',
    expectedDirection: 'keep-similar',
    promptAnchors: ['keep-similar', 'same look', 'faithful clone'],
  },
  {
    id: 'semantic-clone-fr',
    userMessage: 'Recréer example.com en gardant le même style',
    expectedDirection: 'keep-similar',
    promptAnchors: ['non-English', 'keep-similar'],
  },
  {
    id: 'negated-clone-en',
    userMessage:
      "Recreate example.com — I don't want a faithful clone, make it feel current",
    expectedDirection: 'modernize',
    promptAnchors: ['modernize', 'faithful clone'],
  },
  {
    id: 'bare-rebuild',
    userMessage: 'Rebuild my site example.com',
    promptAnchors: ['defaults to modernize', 'Omit `designDirection`'],
  },
];

export const LIVE_EVAL_MIN_DETECTION_RATE = 0.9;
