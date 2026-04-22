/**
 * Brand Data Parsers
 *
 * Parse design-agent markdown memory entries into structured brand data.
 * Used by the brand-data route to assemble BrandData from memory.
 *
 * Type definitions live in @airo/shared/brand-data and are re-exported here
 * for backward compatibility with existing consumers.
 */

export type {
  BrandData,
  BrandDataAudience,
  BrandDataColors,
  BrandDataIconography,
  BrandDataLayout,
  BrandDataLogo,
  BrandDataLogoVariant,
  BrandDataMission,
  BrandDataPalette,
  BrandDataPersonality,
  BrandDataPhotography,
  BrandDataToneMatrix,
  BrandDataTypography,
  BrandDataVoice,
} from '@airo/shared/brand-data'

import type {
  BrandDataAudience,
  BrandDataIconography,
  BrandDataLayout,
  BrandDataPersonality,
  BrandDataVoice,
} from '@airo/shared/brand-data'

/**
 * Parse brand personality markdown into structured data
 */
export function parseBrandPersonality(markdown: string): BrandDataPersonality {
  const lines = markdown.split("\n").filter((l) => l.trim());
  const traits: Array<{ name: string; description: string }> = [];
  const descriptionLines: string[] = [];

  for (const line of lines) {
    const traitMatch = line.match(/\*\*(.+?)\*\*\s*[—:-]\s*(.+)/);
    if (traitMatch?.[1] && traitMatch[2]) {
      traits.push({
        name: traitMatch[1].trim(),
        description: traitMatch[2].trim(),
      });
    } else if (
      !line.startsWith("#") &&
      !line.startsWith("-") &&
      !line.startsWith("*") &&
      traits.length === 0
    ) {
      descriptionLines.push(line.trim());
    }
  }

  const description = descriptionLines.join(" ").trim();

  return {
    description: description || undefined,
    traits: traits.length > 0 ? traits : undefined,
  };
}

/**
 * Parse brand voice markdown into structured data
 */
export function parseBrandVoice(markdown: string): BrandDataVoice {
  const weAre: string[] = [];
  const weAreNot: string[] = [];
  let currentSection = "";
  let sampleCopy: { headline: string; body: string } | undefined;

  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();

    if (
      lower.includes("we are not") ||
      lower.includes("we aren't") ||
      lower.includes("avoid")
    ) {
      currentSection = "not";
    } else if (
      lower.includes("sample") ||
      lower.includes("example cop") ||
      lower.includes("writing example")
    ) {
      currentSection = "sample";
    } else if (
      lower.includes("we are") ||
      lower.includes("tone") ||
      lower.includes("voice")
    ) {
      currentSection = "are";
    }

    const listItem = line.match(/^[-*]\s+(.+)/);
    if (listItem?.[1]) {
      if (currentSection === "are") weAre.push(listItem[1].trim());
      else if (currentSection === "not") weAreNot.push(listItem[1].trim());
    }

    // Extract sample copy: look for a bold headline followed by body text
    if (currentSection === "sample" && !sampleCopy) {
      const headlineMatch = line.match(/\*\*(.+?)\*\*/);
      if (headlineMatch?.[1]) {
        const bodyLines: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j]!.trim();
          if (!nextLine || nextLine.startsWith("#")) break;
          if (nextLine.startsWith("**")) break;
          bodyLines.push(nextLine);
        }
        if (bodyLines.length > 0) {
          sampleCopy = {
            headline: headlineMatch[1].trim(),
            body: bodyLines.join(" ").trim(),
          };
        }
      }
    }
  }

  return {
    weAre: weAre.length > 0 ? weAre : undefined,
    weAreNot: weAreNot.length > 0 ? weAreNot : undefined,
    sampleCopy,
  };
}

/**
 * Extract tagline from voice/messaging markdown
 */
export function extractTagline(markdown: string): string | undefined {
  const match = markdown.match(/tagline[:\s]*["']?([^"'\n]+)["']?/i);
  return match?.[1] ? match[1].trim() : undefined;
}

/**
 * Parse iconography markdown into structured data
 */
export function parseBrandIconography(markdown: string): BrandDataIconography {
  const lines = markdown.split("\n").filter((l) => l.trim());
  const tags: string[] = [];
  let style = "";

  for (const line of lines) {
    if (!line.startsWith("#") && !style) {
      style = line.replace(/^[-*]\s+/, "").trim();
    } else {
      const tagMatch = line.match(/^[-*]\s+(.+)/);
      if (tagMatch?.[1]) {
        tags.push(tagMatch[1].trim());
      }
    }
  }

  return {
    style: style || undefined,
    tags: tags.length > 0 ? tags : undefined,
  };
}

/**
 * Parse layout markdown into structured data
 */
export function parseBrandLayout(markdown: string): BrandDataLayout {
  const lines = markdown.split("\n");
  let grid: string | undefined;
  let spacing: string | undefined;
  let components: string | undefined;

  for (const line of lines) {
    // Skip headings — we want the content lines, not section titles
    if (line.trimStart().startsWith("#")) continue;

    const lower = line.toLowerCase();
    const content = line.replace(/^[-*\s]+/, "").trim();
    if (!content) continue;

    if (lower.includes("grid") || lower.includes("column")) {
      if (!grid) grid = content;
    } else if (lower.includes("spacing") || lower.includes("base unit") || lower.includes("gap")) {
      if (!spacing) spacing = content;
    } else if (
      lower.includes("component") ||
      lower.includes("card") ||
      lower.includes("button") ||
      lower.includes("border-radius") ||
      lower.includes("rounded")
    ) {
      if (!components) components = content;
    }
  }

  return {
    grid: grid || undefined,
    spacing: spacing || undefined,
    components: components || undefined,
  };
}

/**
 * Parse audience markdown into structured data
 */
export function parseBrandAudience(markdown: string): BrandDataAudience {
  const lines = markdown.split("\n").filter((l) => l.trim());
  const segments: string[] = [];
  let description = "";

  for (const line of lines) {
    const listItem = line.match(/^[-*]\s+(.+)/);
    if (listItem?.[1]) {
      segments.push(listItem[1].trim());
    } else if (!line.startsWith("#") && !description) {
      description = line.trim();
    }
  }

  return {
    description: description || undefined,
    segments: segments.length > 0 ? segments : undefined,
  };
}
