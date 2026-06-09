import { resolveScale, type ScoreScale } from './scale.js';

export function defaultCriteria(params: {
  evaluatorId: string;
  siteType: string | null;
  /** The evaluator's declared score scale (from YAML scoreConfig). Defaults to 0–100. */
  scoreConfig?: { min?: number; max?: number };
}): Record<string, unknown> | null {
  // Inject the evaluator's REAL scale so that template placeholders like
  // {{criteria.minScore}}/{{criteria.maxScore}} match scoreConfig (e.g. 0–100), instead of a
  // hardcoded 1–10 that made content/visual-quality judges score on the wrong scale.
  const scale: ScoreScale = resolveScale(params.scoreConfig);

  switch (params.evaluatorId) {
    case 'airo-content-quality':
      return {
        dimensions: [
          { name: 'relevance', description: 'Content matches the business and user request', weight: 0.3 },
          { name: 'completeness', description: 'Key info a visitor needs is present', weight: 0.25 },
          { name: 'clarity', description: 'Copy is clear, scannable, and easy to understand', weight: 0.25 },
          { name: 'authenticity', description: 'Avoids placeholder/generic filler; feels real', weight: 0.2 },
        ],
        minScore: scale.min,
        maxScore: scale.max,
      };
    case 'airo-visual-quality':
      return {
        dimensions: [
          { name: 'professionalAppearance', description: 'Looks polished and trustworthy', weight: 0.3 },
          { name: 'noPlaceholders', description: 'No obvious placeholder text/images', weight: 0.25 },
          { name: 'layoutQuality', description: 'Spacing/alignment/hierarchy are strong', weight: 0.25 },
          { name: 'brandConsistency', description: 'Colors/typography feel consistent', weight: 0.2 },
        ],
        minScore: scale.min,
        maxScore: scale.max,
      };
    case 'airo-usability':
      return {
        heuristics: [
          { name: 'visibility_of_system_status', label: "Visibility of system status" },
          { name: 'match_between_system_and_real_world', label: "Match between system and the real world" },
          { name: 'user_control_and_freedom', label: "User control and freedom" },
          { name: 'consistency_and_standards', label: "Consistency and standards" },
          { name: 'error_prevention', label: "Error prevention" },
          { name: 'recognition_rather_than_recall', label: "Recognition rather than recall" },
          { name: 'flexibility_and_efficiency', label: "Flexibility and efficiency of use" },
          { name: 'aesthetic_and_minimalist_design', label: "Aesthetic and minimalist design" },
          { name: 'help_users_recognize_recover_errors', label: "Help users recognize, diagnose, and recover from errors" },
          { name: 'help_and_documentation', label: "Help and documentation" },
        ],
      };
    case 'airo-business-fit':
      // Keep this generic; the prompt is checklist-driven and this is only a fallback.
      return {
        siteType: params.siteType ?? 'unknown',
        requiredElements: [
          'Clear description of the business / offering',
          'A visible way to contact or take the next step (CTA)',
          'Basic trust / credibility cues appropriate to the business',
        ],
        optionalElements: ['Pricing or packages', 'FAQs', 'Testimonials or social proof'],
      };
    default:
      return null;
  }
}
