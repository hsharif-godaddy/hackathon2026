import type { EvaluatorResult, UsabilityHeuristics, UsabilityIssue, UsabilityScore } from '../types.js';
import { callAnthropicVision, parseJsonResponse } from '../utils/anthropic-client.js';

interface ScreenshotInfo {
  path: string;
  type: string;
}

interface UsabilityAnalysisResult {
  h1: number;
  h2: number;
  h3: number;
  h4: number;
  h5: number;
  h6: number;
  h7: number;
  h8: number;
  h9: number;
  h10: number;
  issues: UsabilityIssue[];
}

/**
 * Nielsen's 10 Usability Heuristics
 */
const HEURISTIC_NAMES: Record<number, string> = {
  1: 'Visibility of system status',
  2: 'Match between system and real world',
  3: 'User control and freedom',
  4: 'Consistency and standards',
  5: 'Error prevention',
  6: 'Recognition rather than recall',
  7: 'Flexibility and efficiency of use',
  8: 'Aesthetic and minimalist design',
  9: 'Help users recognize and recover from errors',
  10: 'Help and documentation',
};

/**
 * Evaluates usability using Nielsen's 10 Heuristics
 * Uses AI vision analysis for comprehensive evaluation
 */
export async function evaluate(
  options: {
    screenshots?: ScreenshotInfo[];
    anthropicApiKey?: string;
    anthropicModel?: string;
  } = {}
): Promise<EvaluatorResult<UsabilityScore>> {
  const startTime = Date.now();

  try {
    // If no screenshots or API key, return default evaluation
    if (!options.screenshots?.length || !options.anthropicApiKey) {
      return {
        success: true,
        data: createDefaultScore(),
        duration: Date.now() - startTime,
      };
    }

    // Find the best screenshot for analysis (prefer preview, then final)
    const screenshot = options.screenshots.find(s => s.type === 'preview') ||
      options.screenshots.find(s => s.type === 'final') ||
      options.screenshots[0];

    const prompt = buildUsabilityPrompt();

    const response = await callAnthropicVision(screenshot.path, prompt, {
      apiKey: options.anthropicApiKey,
      model: options.anthropicModel,
    });

    const result = parseJsonResponse<UsabilityAnalysisResult>(response);

    // Calculate score from heuristic violations
    // Each heuristic can have severity 0-4
    // Total possible severity: 40 (10 heuristics * 4 max severity)
    const heuristics: Partial<UsabilityHeuristics> = {
      h1: result.h1,
      h2: result.h2,
      h3: result.h3,
      h4: result.h4,
      h5: result.h5,
      h6: result.h6,
      h7: result.h7,
      h8: result.h8,
      h9: result.h9,
      h10: result.h10,
    };

    const totalSeverity = Object.values(heuristics)
      .filter((v): v is number => typeof v === 'number')
      .reduce((sum, v) => sum + v, 0);

    // Score: 100 - (totalSeverity * 2.5)
    // This gives 0 for 40 total severity, 100 for 0 severity
    const score = Math.max(0, Math.round(100 - (totalSeverity * 2.5)));

    // Enrich issues with heuristic names
    const enrichedIssues = (result.issues || []).map(issue => ({
      ...issue,
      heuristicName: HEURISTIC_NAMES[issue.heuristic] || `Heuristic ${issue.heuristic}`,
    }));

    const data: UsabilityScore = {
      score,
      issues: enrichedIssues,
      heuristics,
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during usability evaluation',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Build the usability evaluation prompt
 */
function buildUsabilityPrompt(): string {
  return `Analyze this website screenshot using Nielsen's 10 Usability Heuristics.

For each heuristic, rate the severity of violations on a scale of 0-4:
- 0 = No usability problem
- 1 = Cosmetic problem only (fix if time)
- 2 = Minor usability problem (low priority)
- 3 = Major usability problem (high priority)
- 4 = Usability catastrophe (must fix before release)

The 10 Heuristics:
1. **Visibility of system status** - Does the system keep users informed?
2. **Match between system and real world** - Does it use familiar language/concepts?
3. **User control and freedom** - Can users undo/redo, navigate freely?
4. **Consistency and standards** - Does it follow conventions?
5. **Error prevention** - Does it prevent problems before they occur?
6. **Recognition rather than recall** - Are options visible, not memorized?
7. **Flexibility and efficiency** - Are there shortcuts for experts?
8. **Aesthetic and minimalist design** - Is information relevant and uncluttered?
9. **Help users recognize and recover from errors** - Are errors clear with solutions?
10. **Help and documentation** - Is help available when needed?

For a static website/landing page, focus on heuristics that apply:
- #1: Loading indicators, feedback
- #2: Natural language, familiar icons
- #4: Consistent design patterns
- #6: Clear navigation, visible options
- #8: Clean, focused design

Respond with JSON only:
{
  "h1": <0-4>,
  "h2": <0-4>,
  "h3": <0-4>,
  "h4": <0-4>,
  "h5": <0-4>,
  "h6": <0-4>,
  "h7": <0-4>,
  "h8": <0-4>,
  "h9": <0-4>,
  "h10": <0-4>,
  "issues": [
    {"heuristic": <1-10>, "severity": <0-4>, "description": "<brief description>"}
  ]
}`;
}

/**
 * Create a default score when evaluation cannot be performed
 */
function createDefaultScore(): UsabilityScore {
  return {
    score: 70, // Default moderate score
    issues: [],
    heuristics: {
      h1: 1,
      h2: 1,
      h3: 1,
      h4: 1,
      h5: 1,
      h6: 1,
      h7: 1,
      h8: 1,
      h9: 1,
      h10: 1,
    },
  };
}
