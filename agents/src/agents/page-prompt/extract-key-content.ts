/**
 * Regex-based key-content extractor for the rebuild user prompt.
 *
 * Mines a sanitized page text dump for headings, hero copy, feature/CTA
 * sentences, navigation hints, contact details (phone/email/address/social/
 * hours), and the trailing footer block — formatted as labeled markdown
 * sections the LLM can quote verbatim into the rebuild instructions.
 *
 * Heuristic: false negatives are preferred to false positives. Sites
 * without these patterns just yield shorter sections; we never invent
 * content that isn't in the source.
 */

/**
 * US phone number regex pattern.
 * Matches: (555) 123-4567, 555-123-4567, 555.123.4567, +1-555-..., +1 (555)...
 *
 * Word boundaries (\b) prevent matching numbers inside longer numeric
 * sequences (Facebook group IDs, product SKUs, etc.).
 */
const US_PHONE_NUMBER_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

export function extractKeyContent(content: string): string {
  const sections: string[] = [];

  // Headings
  const headingMatches = content.match(/(?:^|\n)([A-Z][^.!?\n]{5,60})\n/g) || [];
  if (headingMatches.length > 0) {
    sections.push('HEADINGS FOUND:');
    headingMatches.slice(0, 10).forEach(h => {
      sections.push(`- "${h.trim()}"`);
    });
  }

  // Hero (page beginning)
  const heroMatch = content.substring(0, 800);
  if (heroMatch) {
    sections.push('\nHERO SECTION (first 800 chars):');
    sections.push(heroMatch.trim());
  }

  // Feature/benefit sentences
  const featurePatterns = content.match(/(?:^|\n)([^.!?\n]*(?:explore|discover|connect|join|browse|enjoy|gain|experience)[^.!?\n]*[.!?])/gi) || [];
  if (featurePatterns.length > 0) {
    sections.push('\nFEATURE/BENEFIT STATEMENTS:');
    featurePatterns.slice(0, 6).forEach(f => {
      sections.push(`- "${f.trim()}"`);
    });
  }

  // CTA sentences
  const ctaPatterns = content.match(/(?:^|\n)([^.!?\n]*(?:shop|join|sign up|get started|learn more|contact|subscribe|buy)[^.!?\n]*[.!?]?)/gi) || [];
  if (ctaPatterns.length > 0) {
    sections.push('\nCALL-TO-ACTION TEXT:');
    ctaPatterns.slice(0, 4).forEach(c => {
      sections.push(`- "${c.trim()}"`);
    });
  }

  // Navigation links
  const navMatches = content.match(/\( - [^)]+\)/g) || [];
  if (navMatches.length > 0) {
    sections.push('\nNAVIGATION LINKS:');
    navMatches.slice(0, 8).forEach(n => {
      const cleanNav = n.replace(/\( - /g, '').replace(/\)/g, '');
      sections.push(`- ${cleanNav}`);
    });
  }

  // Contact info
  const contactInfo: string[] = [];

  // Strip URLs first so phone-number regex doesn't false-match against
  // numeric URL fragments (e.g. facebook.com/groups/2915198541841275).
  const contentWithoutUrls = content.replace(/https?:\/\/[^\s]+/g, '');

  const phonePatterns = contentWithoutUrls.match(US_PHONE_NUMBER_PATTERN) || [];
  if (phonePatterns.length > 0) {
    const uniquePhones = [...new Set(phonePatterns)];
    uniquePhones.slice(0, 3).forEach(p => {
      contactInfo.push(`Phone: ${p.trim()}`);
    });
  }

  const emailPatterns = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  if (emailPatterns.length > 0) {
    const uniqueEmails = [...new Set(emailPatterns)];
    uniqueEmails.slice(0, 3).forEach(e => {
      contactInfo.push(`Email: ${e.trim()}`);
    });
  }

  // Physical addresses
  const addressPatterns = content.match(/\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Court|Ct)[.,]?\s*(?:[A-Za-z\s]+,?\s*)?(?:[A-Z]{2}\s*)?\d{5}(?:-\d{4})?/gi) || [];
  if (addressPatterns.length > 0) {
    addressPatterns.slice(0, 2).forEach(a => {
      contactInfo.push(`Address: ${a.trim()}`);
    });
  }

  // City/state/zip — bounded quantifiers prevent ReDoS
  if (addressPatterns.length === 0) {
    const cityStateZip = content.match(/[A-Z][a-z]{1,20}(?:\s[A-Z][a-z]{1,20}){0,3},?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/g) || [];
    if (cityStateZip.length > 0) {
      cityStateZip.slice(0, 2).forEach(a => {
        contactInfo.push(`Location: ${a.trim()}`);
      });
    }
  }

  // Social links
  const socialPatterns = content.match(/(?:facebook|twitter|instagram|linkedin|youtube|tiktok)\.com\/[a-zA-Z0-9._-]+/gi) || [];
  if (socialPatterns.length > 0) {
    contactInfo.push('Social Media:');
    const uniqueSocial = [...new Set(socialPatterns)];
    uniqueSocial.slice(0, 5).forEach(s => {
      contactInfo.push(`  - ${s}`);
    });
  }

  // Hours
  const hoursPatterns = content.match(/(?:hours|open|mon|tue|wed|thu|fri|sat|sun)[^.!?\n]*(?:\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))[^.!?\n]*/gi) || [];
  if (hoursPatterns.length > 0) {
    contactInfo.push('Hours:');
    hoursPatterns.slice(0, 3).forEach(h => {
      contactInfo.push(`  - ${h.trim()}`);
    });
  }

  if (contactInfo.length > 0) {
    sections.push('\nCONTACT INFORMATION (for footer):');
    contactInfo.forEach(c => sections.push(`- ${c}`));
  }

  // Trailing footer
  const footerContent = content.slice(-1500);
  if (footerContent && footerContent !== content.substring(0, 800)) {
    sections.push('\nFOOTER SECTION (last 1500 chars):');
    sections.push(footerContent.trim());
  }

  return sections.join('\n');
}
