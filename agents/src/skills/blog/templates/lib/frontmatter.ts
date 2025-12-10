/**
 * Lightweight frontmatter parser
 * No dependencies, no Buffer polyfills needed
 */

export interface ParsedMarkdown {
  data: Record<string, any>;
  content: string;
}

/**
 * Parse YAML frontmatter from markdown
 *
 * @param markdown - Raw markdown string with frontmatter
 * @returns Parsed frontmatter data and content
 */
export function parseFrontmatter(markdown: string): ParsedMarkdown {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = markdown.match(frontmatterRegex);

  if (!match) {
    return { data: {}, content: markdown };
  }

  const [, frontmatterText, content] = match;
  const data: Record<string, any> = {};

  // Simple YAML parser for our needs
  const lines = frontmatterText.split('\n');

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Parse arrays
    if (value.startsWith('[') && value.endsWith(']')) {
      const arrayContent = value.slice(1, -1);
      data[key] = arrayContent
        .split(',')
        .map(item => item.trim().replace(/^["']|["']$/g, ''))
        .filter(item => item.length > 0);
      continue;
    }

    // Parse booleans
    if (value === 'true') {
      data[key] = true;
      continue;
    }
    if (value === 'false') {
      data[key] = false;
      continue;
    }

    // Parse numbers
    if (!isNaN(Number(value)) && value !== '') {
      data[key] = Number(value);
      continue;
    }

    // String value
    data[key] = value;
  }

  return { data, content: content.trim() };
}
