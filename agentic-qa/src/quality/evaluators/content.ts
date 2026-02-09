import type { PlaywrightPage } from '../playwright-types.js';
import type { ContentScore, EvaluatorResult } from '../types.js';
import { callAnthropic, parseJsonResponse } from '../utils/anthropic-client.js';

interface ContentAnalysisResult {
  relevance: number;
  coherence: number;
  completeness: number;
  professionalism: number;
  uniqueness: number;
  issues: string[];
}

/**
 * Evaluates content quality using LLM-as-Judge methodology
 * Requires Anthropic API key for meaningful evaluation
 */
export async function evaluate(
  page: PlaywrightPage,
  options: {
    originalPrompt?: string;
    anthropicApiKey?: string;
    anthropicModel?: string;
  } = {}
): Promise<EvaluatorResult<ContentScore>> {
  const startTime = Date.now();

  try {
    // Extract page text content
    const pageContent = await page.evaluate(() => {
      // Get main content, excluding scripts, styles, and navigation
      const clone = document.body.cloneNode(true) as HTMLElement;

      // Remove non-content elements
      const selectorsToRemove = ['script', 'style', 'nav', 'header', 'footer', 'noscript', 'iframe'];
      selectorsToRemove.forEach(selector => {
        clone.querySelectorAll(selector).forEach(el => el.remove());
      });

      // Get structured content
      const title = document.title || '';
      const h1 = document.querySelector('h1')?.textContent?.trim() || '';
      const headings = Array.from(document.querySelectorAll('h2, h3'))
        .map(h => h.textContent?.trim())
        .filter(Boolean)
        .slice(0, 10);

      const mainText = clone.innerText
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000); // Limit to 5000 chars

      return {
        title,
        h1,
        headings,
        mainText,
        wordCount: mainText.split(/\s+/).length,
      };
    });

    // If no API key, do basic content checks
    if (!options.anthropicApiKey) {
      return evaluateBasic(pageContent, options.originalPrompt, startTime);
    }

    // Use LLM for comprehensive evaluation
    const prompt = buildEvaluationPrompt(pageContent, options.originalPrompt);

    const response = await callAnthropic(prompt, {
      apiKey: options.anthropicApiKey,
      model: options.anthropicModel,
    });

    const result = parseJsonResponse<ContentAnalysisResult>(response);

    // Calculate overall score (average of all criteria, scaled to 100)
    const overall = (
      result.relevance +
      result.coherence +
      result.completeness +
      result.professionalism +
      result.uniqueness
    ) / 5 * 10;

    const data: ContentScore = {
      score: Math.round(overall),
      relevance: result.relevance,
      coherence: result.coherence,
      completeness: result.completeness,
      professionalism: result.professionalism,
      uniqueness: result.uniqueness,
      issues: result.issues || [],
    };

    return {
      success: true,
      data,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during content evaluation',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Build the evaluation prompt for Claude
 */
function buildEvaluationPrompt(
  pageContent: {
    title: string;
    h1: string;
    headings: (string | undefined)[];
    mainText: string;
    wordCount: number;
  },
  originalPrompt?: string
): string {
  const contextSection = originalPrompt
    ? `Original user request for this website:
"${originalPrompt}"

`
    : '';

  return `${contextSection}Evaluate the following website content quality.

Website Information:
- Title: ${pageContent.title}
- Main Heading (H1): ${pageContent.h1}
- Section Headings: ${pageContent.headings.join(', ') || 'None'}
- Word Count: ${pageContent.wordCount}

Content (truncated to 5000 chars):
---
${pageContent.mainText}
---

Score each criterion from 1-10:

1. **Relevance** (${originalPrompt ? 'Does the content match the user request?' : 'Is the content focused and on-topic?'})
2. **Coherence** (Is the text grammatically correct, logical, and well-organized?)
3. **Completeness** (Are all expected sections present for this type of website?)
4. **Professionalism** (Does it read like a real business website, not AI-generated filler?)
5. **Uniqueness** (Is the content original and not repetitive across sections?)

Also identify any issues with the content (placeholder text, generic phrases, missing information, etc.)

Respond with JSON only:
{
  "relevance": <1-10>,
  "coherence": <1-10>,
  "completeness": <1-10>,
  "professionalism": <1-10>,
  "uniqueness": <1-10>,
  "issues": ["<issue1>", "<issue2>"]
}`;
}

/**
 * Basic content evaluation without AI
 * Used when no API key is provided
 */
function evaluateBasic(
  pageContent: {
    title: string;
    h1: string;
    headings: (string | undefined)[];
    mainText: string;
    wordCount: number;
  },
  originalPrompt: string | undefined,
  startTime: number
): EvaluatorResult<ContentScore> {
  const issues: string[] = [];
  let score = 100;

  // Check for minimum content
  if (pageContent.wordCount < 100) {
    issues.push('Very little content (less than 100 words)');
    score -= 20;
  } else if (pageContent.wordCount < 300) {
    issues.push('Limited content (less than 300 words)');
    score -= 10;
  }

  // Check for title
  if (!pageContent.title || pageContent.title.length < 10) {
    issues.push('Missing or very short page title');
    score -= 10;
  }

  // Check for H1
  if (!pageContent.h1) {
    issues.push('Missing main heading (H1)');
    score -= 10;
  }

  // Check for section headings
  if (pageContent.headings.length < 2) {
    issues.push('Few section headings');
    score -= 5;
  }

  // Check for placeholder patterns
  const placeholderPatterns = [
    /lorem ipsum/i,
    /dolor sit amet/i,
    /placeholder/i,
    /\[your (?:name|company|text)\]/i,
    /coming soon/i,
    /under construction/i,
  ];

  placeholderPatterns.forEach(pattern => {
    if (pattern.test(pageContent.mainText)) {
      issues.push(`Contains placeholder text: ${pattern.source}`);
      score -= 15;
    }
  });

  // Check for repetitive content
  const sentences = pageContent.mainText.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
  if (sentences.length > 5 && uniqueSentences.size < sentences.length * 0.7) {
    issues.push('Content appears repetitive');
    score -= 15;
  }

  // Check relevance to prompt (basic keyword matching)
  if (originalPrompt) {
    const promptWords = originalPrompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const contentLower = pageContent.mainText.toLowerCase();
    const matchedWords = promptWords.filter(w => contentLower.includes(w));
    const matchRate = matchedWords.length / promptWords.length;

    if (matchRate < 0.3) {
      issues.push('Content may not match the original request');
      score -= 20;
    }
  }

  score = Math.max(0, score);

  // Estimate individual scores based on findings
  const relevance = originalPrompt ? Math.min(10, Math.round(score / 10)) : 7;
  const coherence = Math.min(10, Math.round((score + 20) / 12));
  const completeness = Math.min(10, Math.round((score + 10) / 11));
  const professionalism = issues.some(i => i.includes('placeholder')) ? 4 : 7;
  const uniqueness = issues.some(i => i.includes('repetitive')) ? 4 : 7;

  return {
    success: true,
    data: {
      score,
      relevance,
      coherence,
      completeness,
      professionalism,
      uniqueness,
      issues,
    },
    duration: Date.now() - startTime,
  };
}
