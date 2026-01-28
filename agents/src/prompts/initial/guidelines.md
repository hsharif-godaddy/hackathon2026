# Design Guidelines - Category-Specific Patterns

<context>
This document provides detailed patterns for specific product categories. AI models default to the same generic patterns regardless of context—a SaaS tool and an artisan e-commerce site should NOT look the same. These guidelines prevent category-inappropriate designs.
</context>

## Color Direction Examples

Don't just specify colors—explain the emotional purpose:

| ❌ Bad                | ✅ Good                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| "Use blue and white"  | "Trustworthy blues that feel enterprise-ready without being stuffy, paired with crisp whites for clarity" |
| "Orange color scheme" | "Warm and inviting oranges that feel energetic but not aggressive, creating approachability"              |
| "Purple theme"        | "Rich purples that convey creativity and premium positioning without feeling generic-tech"                |

**Color direction should include:**

- Emotional intent (what feeling the colors create)
- Category positioning (how it fits the product type)
- Differentiation note (what makes it NOT the default choice)

## Typography Mood Options

| Mood                          | Description                                           | Best For                    |
| ----------------------------- | ----------------------------------------------------- | --------------------------- |
| **Friendly but professional** | Approachable without playful, clear without corporate | SaaS, small business        |
| **Bold and confident**        | Strong hierarchy, purposeful weight mixing            | Portfolios, agencies        |
| **Elegant and refined**       | Sophisticated, generous spacing, light weights        | Luxury, artisan             |
| **Technical and precise**     | Monospace accents, clear hierarchy                    | Developer tools, dashboards |
| **Creative and expressive**   | Distinctive display type, artistic flair              | Creative portfolios         |
| **Minimal and focused**       | Restrained type scale, consistent weights             | Minimalist brands           |

## Category-Specific Anti-Patterns

### Tech/SaaS

| Avoid                                | Use Instead                                          | Why                         |
| ------------------------------------ | ---------------------------------------------------- | --------------------------- |
| Dark mode with cyan/purple gradients | Light mode with unexpected accent (warm/earth tones) | Everyone uses dark+purple   |
| Blue as default color                | Warm tones, unexpected accents                       | Blue is the most overused   |
| Icon grids for features              | Inline examples, real UI screenshots                 | Icon grids are generic      |
| Generic screenshots                  | Actual product UI demonstrations                     | Real UI creates credibility |

**Direction template:** "NO dark mode with cyan/purple gradients. Light base with ONE bold accent (warm/earth tones, not blue). Show features through examples, not icon grids."

### Creative/Portfolio

| Avoid                        | Use Instead                    | Why                           |
| ---------------------------- | ------------------------------ | ----------------------------- |
| Energy only in hero          | Maintain boldness throughout   | Quality degradation is common |
| Bold colors fading to gray   | Bold choices in CTA/footer too | Consistency creates impact    |
| Creative hero, boring footer | Footer as intentional as hero  | Footer often neglected        |

**Direction template:** "CRITICAL: Maintain creative energy throughout. Footer/CTA must match hero boldness. Don't get safer as page progresses."

### Minimal/Clean

| Avoid                        | Use Instead               | Why                     |
| ---------------------------- | ------------------------- | ----------------------- |
| Minimal as excuse for boring | Layout innovation         | Minimal ≠ featureless   |
| Identical whitespace         | Purposeful varied spacing | Rhythm creates interest |
| Safe centered layouts        | Asymmetric structures     | Center = default/lazy   |

**Direction template:** "Since minimal, layout must differentiate. Require asymmetric composition. Use varied whitespace purposefully. Include bold typographic element."

### Professional/Trust/Finance

| Avoid                 | Use Instead                 | Why                          |
| --------------------- | --------------------------- | ---------------------------- |
| Navy blue + gray/gold | Unexpected color with trust | Corporate blue is generic    |
| Generic stock photos  | Premium execution           | Stock photos undermine trust |
| Safe template layouts | One distinctive element     | Memorability matters         |

**Direction template:** "Avoid generic corporate blue-gray. Include ONE distinctive element (oversized typography, unusual grid, bold whitespace) for memorability."

### Consumer/E-commerce

| Avoid                      | Use Instead                   | Why                      |
| -------------------------- | ----------------------------- | ------------------------ |
| Colored circles with icons | Actual illustrations/graphics | Circles are placeholder  |
| Rounded corners everywhere | Purposeful corner radius      | Over-rounding is generic |
| Pastel without personality | Vibrant colors with character | Pastels lack punch       |

**Direction template:** "NO colored circles with icons. Require actual illustrations or bold graphic shapes—not placeholder circles."

## Fullscreen Apps (Games, Dashboards, Interactive Tools)

<context>
Some apps need maximum screen space and traditional header/footer navigation gets in the way. Games, dashboards, data visualizations, canvas apps, and interactive tools should use fullscreen layout.
</context>

### When to Use Fullscreen Layout

| App Type | Layout | Reason |
| -------- | ------ | ------ |
| **Games** | Fullscreen | Game canvas needs full viewport, navigation breaks immersion |
| **Dashboards** | Fullscreen | Data density requires maximum space, sidebar navigation preferred |
| **Interactive tools** | Fullscreen | Tools like calculators, editors, canvas apps need the space |
| **Data visualizations** | Fullscreen | Charts and graphs benefit from larger display area |
| **Canvas/drawing apps** | Fullscreen | Drawing area should maximize available space |

### When to Keep Standard Layout

| App Type | Layout | Reason |
| -------- | ------ | ------ |
| **Marketing sites** | Standard | Need navigation to pricing, features, about pages |
| **E-commerce** | Standard | Need cart, search, category navigation |
| **Portfolios** | Standard | Need navigation between projects, about, contact |
| **Blogs** | Standard | Need navigation, categories, search |
| **Agency sites** | Standard | Need services, portfolio, contact navigation |

### Fullscreen Layout Patterns

| Component | Approach | Example |
| --------- | -------- | ------- |
| **Navigation** | Sidebar, floating menu, or in-app UI | Dashboard with collapsible sidebar |
| **Branding** | Small logo in corner or toolbar | Game with logo in top-left |
| **Controls** | Integrated into app UI | Tool with floating control panel |
| **Exit/back** | Subtle button or menu option | "Back to home" in settings menu |

### RootLayout Modification for Fullscreen

For fullscreen apps, the develop agent should modify `RootLayout.tsx` to remove Header and Footer:

```tsx
// Standard layout (default)
<Website>
  <Header />
  {children}
  <Footer />
</Website>

// Fullscreen layout (for games, dashboards, etc.)
<Website>
  {children}
</Website>
```

**Direction template for fullscreen apps:**
"This is a [game/dashboard/tool] that needs fullscreen layout. Remove header and footer from RootLayout. Navigation should be [sidebar/floating menu/integrated into app UI]. Maximize viewport for [game canvas/data display/interactive area]."

## Section-Specific Patterns

### Hero Section

| Component        | Avoid                           | Include                                         |
| ---------------- | ------------------------------- | ----------------------------------------------- |
| **Composition**  | Text-left, empty-right          | Visual balance (product shot/graphic on right)  |
| **Background**   | Generic stock image             | Purpose-driven imagery or solid color           |
| **Structure**    | Centered text with button below | Distinctive composition (asymmetric, overlaid)  |
| **Social proof** | No credibility signals          | Logos, stats, or testimonial snippet below fold |

### Features Section

| Component           | Avoid                              | Include                                |
| ------------------- | ---------------------------------- | -------------------------------------- |
| **Layout**          | 3-4 column icon grid               | Staggered two-column or bento grid     |
| **Presentation**    | List of features with descriptions | Show through examples/screenshots      |
| **Icons**           | Generic icons for each feature     | Actual product UI or demonstrations    |
| **Visual interest** | Uniform repetition                 | Varied card sizes, alternating layouts |

### CTA Section

| Component     | Avoid                         | Include                               |
| ------------- | ----------------------------- | ------------------------------------- |
| **Layout**    | Centered text on colored band | Asymmetric layout with visual element |
| **Content**   | Generic "Get Started"         | Specific value proposition            |
| **Placement** | Afterthought at page end      | Integrated into distinctive section   |

### Footer

| Component       | Avoid                    | Include                          |
| --------------- | ------------------------ | -------------------------------- |
| **Quality**     | Degraded design energy   | Intentional design matching hero |
| **Typography**  | Generic link lists       | Quality type treatment           |
| **Consistency** | Different feel from page | Maintained design language       |

## Todo Item Templates

### 1. Design Direction Reference

```
Apply design direction: [aesthetic] with [layout approach] and [differentiation element]. Color: [emotional intent]. Typography: [mood]. Avoid [specific clichés].
```

**Example:**
"Apply design direction: Clean, capable aesthetic for small teams with staggered layout and oversized hero typography. Color: Light base with ONE vibrant accent (not blue). Typography: Friendly but professional. Avoid icon grids."

### 2. Image Search (Be Specific)

| ❌ Generic                   | ✅ Specific                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| "Search for hero background" | "Search for product UI screenshots showing the tool in action"      |
| "Find generic images"        | "Find portfolio project images with varied compositions"            |
| "Search for photos"          | "Search for artisanal ceramic product photos with natural lighting" |

### 3. Build Homepage (Include Design Specifics)

```
Build homepage (index.tsx) with [specific layout], [typography treatment], [section approach]. DO NOT use [specific cliché]. Include [differentiation element]. Maintain design energy through footer.
```

**Example:**
"Build homepage (index.tsx) with asymmetric hero (text left, product shot right), features via alternating screenshot sections (not icon grid), and integrated CTA section. Include oversized typography in hero."

## What to Always Defer

**ALWAYS defer to future phases:**

| Category            | Specific Features                                     |
| ------------------- | ----------------------------------------------------- |
| **Multiple pages**  | About, contact, services, blog posts, product details |
| **Authentication**  | Login, signup, user accounts, profiles                |
| **Data submission** | Contact forms, newsletter signup, surveys             |
| **E-commerce**      | Shopping cart, checkout, payment processing           |
| **Dynamic data**    | Database queries, real-time data, search with backend |
| **Integrations**    | Third-party APIs, file uploads, external services     |

<rationale>
These are deferred because they require backend work that significantly delays the initial preview. A beautiful single-page preview creates user delight faster than a feature-complete but generic multi-page site.
</rationale>

## Template File Structure

```
src/
├── pages/
│   └── index.tsx          # Homepage (edit this only)
├── routes.tsx             # Route definitions (don't modify)
├── App.tsx                # App setup (don't modify)
├── layouts/
│   └── RootLayout.md      # Header/footer config docs
└── components/
    └── ui/                # Reusable UI components
```

**CRITICAL:** Only edit `index.tsx` in the initial preview. Do not create additional page files or routes.
