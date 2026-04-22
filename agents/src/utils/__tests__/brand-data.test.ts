import { describe, it, expect } from "vitest";

import {
  parseBrandPersonality,
  parseBrandVoice,
  extractTagline,
  parseBrandIconography,
  parseBrandLayout,
  parseBrandAudience,
} from "../brand-data-parsers.js";

describe("brand-data-parsers", () => {
  describe("parseBrandPersonality", () => {
    it("should parse traits from bold markdown", () => {
      const md = `# Brand Personality

Modern healthcare brand.

**Trustworthy** — Security-focused and reliable
**Innovative** - Cutting-edge technology`;

      const result = parseBrandPersonality(md);
      expect(result.description).toBe("Modern healthcare brand.");
      expect(result.traits).toHaveLength(2);
      expect(result.traits![0]).toEqual({
        name: "Trustworthy",
        description: "Security-focused and reliable",
      });
      expect(result.traits![1]).toEqual({
        name: "Innovative",
        description: "Cutting-edge technology",
      });
    });

    it("should return undefined for empty input", () => {
      const result = parseBrandPersonality("");
      expect(result.description).toBeUndefined();
      expect(result.traits).toBeUndefined();
    });
  });

  describe("parseBrandVoice", () => {
    it("should parse we are / we are not sections", () => {
      const md = `# Voice

## We Are
- Warm and welcoming
- Professional

## We Are Not
- Stuffy
- Overly casual`;

      const result = parseBrandVoice(md);
      expect(result.weAre).toEqual(["Warm and welcoming", "Professional"]);
      expect(result.weAreNot).toEqual(["Stuffy", "Overly casual"]);
    });

    it("should return undefined for empty input", () => {
      const result = parseBrandVoice("");
      expect(result.weAre).toBeUndefined();
      expect(result.weAreNot).toBeUndefined();
    });
  });

  describe("extractTagline", () => {
    it("should extract tagline from markdown", () => {
      const md = `Tagline: "Cook with confidence"`;
      expect(extractTagline(md)).toBe("Cook with confidence");
    });

    it("should return undefined when no tagline present", () => {
      expect(extractTagline("Just some general voice notes")).toBeUndefined();
    });
  });

  describe("parseBrandIconography", () => {
    it("should parse style and tags", () => {
      const md = `# Iconography

Minimal line icons

- food
- utensils
- restaurant`;

      const result = parseBrandIconography(md);
      expect(result.style).toBe("Minimal line icons");
      expect(result.tags).toEqual(["food", "utensils", "restaurant"]);
    });

    it("should return undefined for empty input", () => {
      const result = parseBrandIconography("");
      expect(result.style).toBeUndefined();
      expect(result.tags).toBeUndefined();
    });
  });

  describe("parseBrandVoice - sampleCopy", () => {
    it("should extract sample copy from markdown", () => {
      const md = `# Voice

## We Are
- Warm and welcoming
- Professional

## We Are Not
- Stuffy

## Sample Copy
**Welcome to a better way to eat.**
Discover locally sourced ingredients prepared with care, served in a space designed for connection.`;

      const result = parseBrandVoice(md);
      expect(result.weAre).toEqual(["Warm and welcoming", "Professional"]);
      expect(result.weAreNot).toEqual(["Stuffy"]);
      expect(result.sampleCopy).toEqual({
        headline: "Welcome to a better way to eat.",
        body: "Discover locally sourced ingredients prepared with care, served in a space designed for connection.",
      });
    });

    it("should return undefined sampleCopy when no sample section", () => {
      const md = `## We Are
- Friendly`;
      const result = parseBrandVoice(md);
      expect(result.sampleCopy).toBeUndefined();
    });
  });

  describe("parseBrandPersonality - multi-line description", () => {
    it("should capture multi-sentence description before traits", () => {
      const md = `# Brand Personality

A bold, modern brand for creative professionals.
We blend innovation with approachability.

**Creative** — Pushing boundaries in design
**Approachable** — Making complex things simple`;

      const result = parseBrandPersonality(md);
      expect(result.description).toBe(
        "A bold, modern brand for creative professionals. We blend innovation with approachability."
      );
      expect(result.traits).toHaveLength(2);
    });
  });

  describe("parseBrandLayout", () => {
    it("should parse grid, spacing, and components", () => {
      const md = `# Layout

## Grid
12-column grid with 24px gutters

## Spacing
8px base unit, consistent scale

## Components
Rounded cards with 16px border-radius, pill-shaped buttons`;

      const result = parseBrandLayout(md);
      expect(result.grid).toBe("12-column grid with 24px gutters");
      expect(result.spacing).toBe("8px base unit, consistent scale");
      expect(result.components).toBe("Rounded cards with 16px border-radius, pill-shaped buttons");
    });

    it("should return undefined for empty input", () => {
      const result = parseBrandLayout("");
      expect(result.grid).toBeUndefined();
      expect(result.spacing).toBeUndefined();
      expect(result.components).toBeUndefined();
    });
  });

  describe("parseBrandAudience", () => {
    it("should parse description and segments", () => {
      const md = `Tech-savvy millennials who value clean digital experiences.

- Young professionals (25-35)
- Mobile-first users
- Design-conscious consumers`;

      const result = parseBrandAudience(md);
      expect(result.description).toBe(
        "Tech-savvy millennials who value clean digital experiences."
      );
      expect(result.segments).toEqual([
        "Young professionals (25-35)",
        "Mobile-first users",
        "Design-conscious consumers",
      ]);
    });

    it("should return undefined for empty input", () => {
      const result = parseBrandAudience("");
      expect(result.description).toBeUndefined();
      expect(result.segments).toBeUndefined();
    });
  });
});
