# Design Section Specifications

Detailed guidance for each of the 8 design sections.

## 1. Brand Personality (1-2 Paragraphs)

**Purpose:** Define the brand's character and emotional attributes

**Content:**

- 1-2 paragraph overview describing the brand's essence
- 3-5 core values or attributes
- Brief visual expression notes

**Example:**

```markdown
# Brand Personality

## Overview

The healthcare patient portal embodies trust, care, and empowerment - creating a calming digital experience that helps patients feel confident managing their health.

## Core Values

- **Trustworthy** - Security and privacy are paramount
- **Caring** - Empathetic approach to patient needs
- **Empowering** - Putting health information in patients' hands
```

## 2. Color Palette

**Purpose:** Define primary, secondary, and semantic colors with accessibility

**Content:**

- Primary color with hex code
- Secondary/accent colors
- Semantic colors (success, warning, error)
- Brief WCAG accessibility notes

**Keep it simple:** Just the essential colors, not every shade variation.

## 3. Typography

**Purpose:** Define font families and basic type hierarchy

**Content:**

- Primary font family (UI/body text)
- Secondary font family (headings) if different
- Monospace font if needed
- Basic type scale (H1, H2, Body, etc.)

**Keep it brief:** Just the main fonts and sizes, not exhaustive specifications.

## 4. Iconography & Graphics

**Purpose:** Define icon style and visual approach

**Content:**

- Icon style description (e.g., "Rounded line icons, 2px stroke")
- Icon sizes (standard, small, large)
- Brief notes on photography or illustration style

**Keep it brief:** General style guidance only.

## 5. Layout & UI Elements

**Purpose:** Define spacing system and component basics

**Content:**

- Grid system basics (columns, gutters)
- Spacing scale (e.g., 8px base unit)
- Brief component patterns (cards, buttons, forms)

**Keep it focused:** Core patterns only, not every UI state.

## 6. Voice & Messaging (1-2 Paragraphs)

**Purpose:** Define tone and writing style

**Content:**

- 1-2 paragraph overview of voice attributes
- 3-5 voice characteristics
- A few writing examples (buttons, errors, confirmations)

**Keep it concise:** Brief overview, not a comprehensive style guide.

## 7. Features

**Purpose:** High-level inventory of application features

**Structure:**

```markdown
## Overview

Brief description of the application's core capabilities (1-2 paragraphs)

## Core Features

- **Feature Name:** One-line description
- **Feature Name:** One-line description

## Additional Features

- **Feature Name:** One-line description
```

**Important:**

- NO priorities (no must-have/should-have/nice-to-have)
- NO user stories
- NO acceptance criteria
- NO complexity ratings
- Just feature name and brief description

## 8. Site Map

**Purpose:** Simple page hierarchy

**Structure:**

```markdown
## Overview

Brief description of page organization (1-2 sentences)

## Page Hierarchy

### Public Pages

- Home (/)
- About (/about)
- Features (/features)

### Authenticated Pages

- Dashboard (/dashboard)
  - Profile (/dashboard/profile)
  - Settings (/dashboard/settings)

### Admin Pages (if applicable)

- Admin Dashboard (/admin)
```

**Important:**

- NO user flows
- NO page details (purpose, components, etc.)
- NO navigation structure details
- Just the page hierarchy with paths

## General Guidelines for All Sections

### Length Guidelines

- **Text sections** (Brand, Voice): 1-2 paragraphs maximum
- **List sections** (Colors, Typography): 5-10 items maximum
- **Hierarchical sections** (Features, Site Map): 10-20 items maximum

### Formatting

- Use clear headings
- Use bullet points for lists
- Use bold for emphasis
- Keep it scannable

### Storage

Each section is stored in memory with these keys:

- `design.brand-personality`
- `design.color-palette`
- `design.typography`
- `design.iconography`
- `design.layout`
- `design.voice-messaging`
- `design.features`
- `design.site-map`
