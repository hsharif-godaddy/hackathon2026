# Design Guidelines - Category-Specific Patterns

<context>
This document provides detailed patterns for specific product categories. AI models default to the same generic patterns regardless of context—a SaaS tool and an artisan e-commerce site should NOT look the same. These guidelines prevent category-inappropriate designs.
</context>

## Visual Element Strategy

<context>
AI defaults to either stock photos everywhere OR abstract shapes everywhere. Neither is always correct. The visual element choice should be intentional and match the brand personality.
</context>

### When to Use Organic Shapes/Abstract Graphics

| Category                          | Why It Works                                         |
| --------------------------------- | ---------------------------------------------------- |
| **Wellness/yoga/meditation**      | Softness matches the calm, flowing brand personality |
| **Creative agencies**             | Shows creativity without relying on portfolio work   |
| **Startups without product shots**| Creates visual interest before product exists        |
| **Community/social platforms**    | Warmth and approachability                           |
| **Education/learning**            | Friendly, non-intimidating feel                      |
| **Personal brands**               | Distinctive without requiring photography            |
| **Tech with abstract concepts**   | Visualizes intangible services (AI, cloud, data)     |

### When to Use Photography

| Category                                 | Why It Works                            |
| ---------------------------------------- | --------------------------------------- |
| **E-commerce/retail**                    | Customers need to see actual products   |
| **Restaurants/food**                     | Food photography creates appetite appeal|
| **Real estate/architecture**             | The spaces ARE the product              |
| **Professional services (law, finance)** | Trust comes from showing real people    |
| **Travel/hospitality**                   | Destinations need to be seen            |
| **Portfolio sites**                      | The work itself is the visual           |
| **Local businesses**                     | Showing the actual place builds trust   |

### When to Use Illustrations

| Category                          | Why It Works                        |
| --------------------------------- | ----------------------------------- |
| **Children's products/education** | Playful, approachable, safe feeling |
| **Complex B2B explainers**        | Simplifies abstract concepts        |
| **Quirky/playful brands**         | Establishes unique personality      |
| **Onboarding flows**              | Guides users with friendly visuals  |

### Organic Shape Styles

When using abstract graphics, vary the style to match brand personality:

| Style               | Description                                          | Best For                             |
| ------------------- | ---------------------------------------------------- | ------------------------------------ |
| **Soft blobs**      | Rounded, overlapping, gradient fills, organic edges  | Wellness, community, friendly brands |
| **Geometric**       | Circles, polygons, clean edges, precise shapes       | Tech, modern, precise brands         |
| **Hand-drawn**      | Irregular, sketchy, imperfect lines                  | Artisan, creative, playful brands    |
| **Gradient meshes** | Flowing color transitions, aurora-like               | Premium, modern, sophisticated       |
| **Cutout shapes**   | Bold, flat, overlapping with hard edges              | Bold, confident, editorial           |
| **Flowing lines**   | Curved paths, wave patterns                          | Movement, flow, music, wellness      |

### Visual Element Implementation Notes

When specifying organic shapes or graphics:
- Use colors from the brand palette (not random colors)
- Create depth through layering and transparency
- Frame content rather than compete with it
- Apply consistently across multiple sections (hero, section breaks, footer)
- Vary sizes to create visual hierarchy
- Consider how they interact with text readability

---

## Animation Strategy

<context>
Static pages feel lifeless. Over-animated pages feel gimmicky. Motion should be intentional—adding personality and guiding attention without becoming a distraction. The right animation level depends on brand personality and user expectations.
</context>

### Animation Levels

| Level        | Description                         | Characteristics                                   |
| ------------ | ----------------------------------- | ------------------------------------------------- |
| **Static**   | No animation                        | Clean, fast, professional, content-focused        |
| **Subtle**   | Gentle, almost invisible motion     | Refined, sophisticated, doesn't demand attention  |
| **Dynamic**  | Noticeable, personality-driven motion | Energetic, playful, memorable, engaging         |

### When to Use Each Level

| Level        | Best For                                         | Why                                                                      |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| **Static**   | Legal, medical, government, news, documentation  | Trust and credibility come from stability; animation feels frivolous     |
| **Static**   | Text-heavy content sites                         | Animation distracts from reading                                         |
| **Subtle**   | Professional services, B2B SaaS, finance         | Adds polish without undermining trust                                    |
| **Subtle**   | E-commerce product pages                         | Focus stays on products, not effects                                     |
| **Subtle**   | Corporate sites                                  | Professional but not stiff                                               |
| **Dynamic**  | Creative agencies, portfolios                    | Showcases creativity and capability                                      |
| **Dynamic**  | Entertainment, games, media                      | Energy matches the product                                               |
| **Dynamic**  | Startups, apps targeting young users             | Modern, engaging, memorable                                              |
| **Dynamic**  | Wellness, lifestyle brands                       | Movement creates emotional response                                      |

### Animation Types by Purpose

**Entrance Animations** (elements appearing on page/scroll):

| Animation            | Feel                        | Best For                          |
| -------------------- | --------------------------- | --------------------------------- |
| Fade in              | Subtle, elegant             | Professional sites, text content  |
| Slide up             | Energetic, modern           | Cards, features, testimonials     |
| Scale in             | Playful, attention-grabbing | CTAs, important elements          |
| Stagger (sequential) | Sophisticated, intentional  | Lists, grids, multiple items      |

**Hover/Interaction Animations**:

| Animation                 | Feel                   | Best For                     |
| ------------------------- | ---------------------- | ---------------------------- |
| Color shift               | Subtle feedback        | Links, buttons (any site)    |
| Scale (grow)              | Engaging, interactive  | Cards, images, portfolios    |
| Lift (shadow + translate) | Premium, tactile       | Cards, products              |
| Underline draw            | Elegant, editorial     | Navigation, text links       |
| Background fill           | Bold, confident        | Buttons, CTAs                |

**Ambient/Continuous Animations**:

| Animation         | Feel                   | Best For                             |
| ----------------- | ---------------------- | ------------------------------------ |
| Floating elements | Dreamy, organic, alive | Wellness, creative, organic shapes   |
| Gradient shift    | Modern, dynamic        | Tech, premium brands                 |
| Parallax scroll   | Depth, immersion       | Storytelling, portfolios             |
| Rotating/spinning | Playful, energetic     | Playful brands, loading states       |
| Pulsing           | Attention, urgency     | CTAs, notifications (use sparingly)  |

**Scroll-Triggered Animations**:

| Animation            | Feel                      | Best For                        |
| -------------------- | ------------------------- | ------------------------------- |
| Fade in on scroll    | Reveals content naturally | Most sites (subtle level)       |
| Parallax layers      | Creates depth             | Visual storytelling, portfolios |
| Progress indicators  | Guides journey            | Long-form content, stories      |
| Section transitions  | Dramatic, memorable       | Creative sites, presentations   |

### Animation Speed Guidelines

| Speed         | Duration  | Use For                                        |
| ------------- | --------- | ---------------------------------------------- |
| **Fast**      | 150-200ms | Hovers, micro-interactions, button feedback    |
| **Medium**    | 300-400ms | Entrances, transitions, most animations        |
| **Slow**      | 500-800ms | Dramatic reveals, hero animations, emphasis    |
| **Very slow** | 1000ms+   | Ambient floating, background effects           |

### Animation Anti-Patterns

| Avoid                                    | Why                           | Instead                               |
| ---------------------------------------- | ----------------------------- | ------------------------------------- |
| Animation on everything                  | Overwhelming, loses impact    | Choose 2-3 animation types max        |
| Slow animations on interactions          | Feels laggy, frustrating      | Keep hovers/clicks under 200ms        |
| Bouncy/elastic on professional sites     | Undermines credibility        | Use ease-out or ease-in-out           |
| Animation blocking content               | Users wait to read            | Let content be readable immediately   |
| Different timing across similar elements | Feels inconsistent            | Use consistent duration/easing        |
| Continuous animation on text             | Distracting, hurts readability| Only animate decorative elements      |
| Auto-playing carousels                   | Frustrating, inaccessible     | Let users control or use static       |

### Animation Personality Mapping

| Brand Personality          | Animation Feel      | Specific Choices                                    |
| -------------------------- | ------------------- | --------------------------------------------------- |
| **Professional/Corporate** | Subtle, refined     | Fade-ins, gentle hovers, no bouncing                |
| **Playful/Fun**            | Bouncy, energetic   | Spring physics, scale effects, staggered reveals    |
| **Premium/Luxury**         | Slow, deliberate    | Smooth fades, elegant parallax, subtle hovers       |
| **Modern/Tech**            | Crisp, precise      | Quick transitions, geometric motion paths           |
| **Organic/Wellness**       | Flowing, gentle     | Floating elements, soft fades, wave motions         |
| **Bold/Creative**          | Dramatic, unexpected| Large-scale reveals, creative scroll effects        |

### Implementation Notes

When specifying motion in design direction:
- Name specific animations (e.g., "fade in on scroll" not just "animate")
- Specify timing personality (e.g., "quick and snappy" vs "slow and elegant")
- Note which elements should animate vs. remain static
- Ensure consistency across similar element types
- Consider reduced-motion preferences for accessibility
- Ambient animations should be slow enough to not distract from content

---

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
| Static hero with no motion           | Subtle entrance animations, floating elements        | Feels lifeless              |

**Direction template:** "NO dark mode with cyan/purple gradients. Light base with ONE bold accent (warm/earth tones, not blue). Show features through examples, not icon grids. Add subtle fade-in animations on scroll."

### Creative/Portfolio

| Avoid                        | Use Instead                         | Why                               |
| ---------------------------- | ----------------------------------- | --------------------------------- |
| Energy only in hero          | Maintain boldness throughout        | Quality degradation is common     |
| Bold colors fading to gray   | Bold choices in CTA/footer too      | Consistency creates impact        |
| Creative hero, boring footer | Footer as intentional as hero       | Footer often neglected            |
| No animation                 | Dynamic scroll effects, hover states| Portfolios should show capability |
| Generic hover effects        | Creative, memorable interactions    | Opportunity to showcase skills    |

**Direction template:** "CRITICAL: Maintain creative energy throughout. Footer/CTA must match hero boldness. Don't get safer as page progresses. Include dynamic animations—scroll reveals, creative hovers, micro-interactions."

### Minimal/Clean

| Avoid                        | Use Instead                  | Why                                   |
| ---------------------------- | ---------------------------- | ------------------------------------- |
| Minimal as excuse for boring | Layout innovation            | Minimal ≠ featureless                 |
| Identical whitespace         | Purposeful varied spacing    | Rhythm creates interest               |
| Safe centered layouts        | Asymmetric structures        | Center = default/lazy                 |
| No animation (too static)    | Subtle, refined motion       | Minimal can still feel alive          |
| Obvious animations           | Nearly invisible transitions | Heavy motion breaks minimal aesthetic |

**Direction template:** "Since minimal, layout must differentiate. Require asymmetric composition. Use varied whitespace purposefully. Include bold typographic element. Animation should be subtle—refined fades and gentle hovers, nothing bouncy."

### Professional/Trust/Finance

| Avoid                    | Use Instead                    | Why                            |
| ------------------------ | ------------------------------ | ------------------------------ |
| Navy blue + gray/gold    | Unexpected color with trust    | Corporate blue is generic      |
| Generic stock photos     | Premium execution              | Stock photos undermine trust   |
| Safe template layouts    | One distinctive element        | Memorability matters           |
| No animation             | Subtle, professional motion    | Adds polish without frivolity  |
| Playful/bouncy animation | Smooth, deliberate transitions | Maintains credibility          |

**Direction template:** "Avoid generic corporate blue-gray. Include ONE distinctive element (oversized typography, unusual grid, bold whitespace) for memorability. Animation should be subtle and professional—smooth fades, elegant hovers."

### Consumer/E-commerce

| Avoid                      | Use Instead                   | Why                           |
| -------------------------- | ----------------------------- | ----------------------------- |
| Colored circles with icons | Actual illustrations/graphics | Circles are placeholder       |
| Rounded corners everywhere | Purposeful corner radius      | Over-rounding is generic      |
| Pastel without personality | Vibrant colors with character | Pastels lack punch            |
| Static product displays    | Hover effects on products     | Interaction drives engagement |

**Direction template:** "NO colored circles with icons. Require actual illustrations or bold graphic shapes—not placeholder circles. Add engaging hover effects on product cards—lift, scale, or reveal additional info."

### Wellness/Lifestyle

| Avoid                      | Use Instead                      | Why                              |
| -------------------------- | -------------------------------- | -------------------------------- |
| Stock photos of yoga poses | Organic shapes, brand photography| Generic imagery                  |
| Static, lifeless pages     | Gentle floating animations       | Wellness should feel alive       |
| Hard geometric shapes      | Soft blobs, flowing curves       | Doesn't match calm personality   |
| Fast, jarring animations   | Slow, flowing motion             | Should feel calming              |

**Direction template:** "Use organic shapes (soft blobs, flowing curves) in brand colors. Photography should feel authentic, not stock. Add gentle ambient animation—floating elements, soft parallax. Motion should feel calming and fluid, never jarring."

---

## Visual Element Anti-Patterns

| Avoid                                        | Why                                          | Instead                                 |
| -------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| Stock photos for every site                  | Generic, doesn't match all brand personalities| Choose intentionally based on category  |
| Abstract shapes for every site               | Becomes its own cliché                       | Reserve for appropriate categories      |
| Graphics that don't use brand colors         | Feels disconnected                           | Pull from established palette           |
| Shapes that compete with content             | Should frame, not overwhelm                  | Shapes support, content leads           |
| Photography for brands without visual products| Forces generic stock usage                   | Use graphics/illustrations instead      |
| Mixing too many visual styles                | Feels chaotic                                | Commit to one primary approach          |

---

## Fullscreen Apps (Games, Dashboards, Interactive Tools)

<context>
Some apps need maximum screen space and traditional header/footer navigation gets in the way. Games, dashboards, data visualizations, canvas apps, and interactive tools should use fullscreen layout.
</context>

### When to Use Fullscreen Layout

| App Type                 | Layout     | Reason                                                         |
| ------------------------ | ---------- | -------------------------------------------------------------- |
| **Games**                | Fullscreen | Game canvas needs full viewport, navigation breaks immersion   |
| **Dashboards**           | Fullscreen | Data density requires maximum space, sidebar navigation preferred |
| **Interactive tools**    | Fullscreen | Tools like calculators, editors, canvas apps need the space    |
| **Data visualizations**  | Fullscreen | Charts and graphs benefit from larger display area             |
| **Canvas/drawing apps**  | Fullscreen | Drawing area should maximize available space                   |

### When to Keep Standard Layout

| App Type            | Layout   | Reason                                            |
| ------------------- | -------- | ------------------------------------------------- |
| **Marketing sites** | Standard | Need navigation to pricing, features, about pages |
| **E-commerce**      | Standard | Need cart, search, category navigation            |
| **Portfolios**      | Standard | Need navigation between projects, about, contact  |
| **Blogs**           | Standard | Need navigation, categories, search               |
| **Agency sites**    | Standard | Need services, portfolio, contact navigation      |

### Fullscreen Layout Patterns

| Component      | Approach                             | Example                            |
| -------------- | ------------------------------------ | ---------------------------------- |
| **Navigation** | Sidebar, floating menu, or in-app UI | Dashboard with collapsible sidebar |
| **Branding**   | Small logo in corner or toolbar      | Game with logo in top-left         |
| **Controls**   | Integrated into app UI               | Tool with floating control panel   |
| **Exit/back**  | Subtle button or menu option         | "Back to home" in settings menu    |

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
"This is a [game/dashboard/tool] that needs fullscreen layout. Remove header and footer from RootLayout. Navigation should be [sidebar/floating menu/integrated into app UI]. Maximize viewport for [game canvas/data display/interactive area]. Animation should be [responsive micro-interactions / smooth state transitions / playful feedback]."

---

## Section-Specific Patterns

### Hero Section

| Component        | Avoid                           | Include                                         |
| ---------------- | ------------------------------- | ----------------------------------------------- |
| **Composition**  | Text-left, empty-right          | Visual balance (product shot/graphic on right)  |
| **Background**   | Generic stock image             | Purpose-driven imagery or solid color           |
| **Structure**    | Centered text with button below | Distinctive composition (asymmetric, overlaid)  |
| **Social proof** | No credibility signals          | Logos, stats, or testimonial snippet below fold |
| **Animation**    | Static or over-animated         | Subtle entrance, floating elements if appropriate|

### Features Section

| Component           | Avoid                              | Include                                |
| ------------------- | ---------------------------------- | -------------------------------------- |
| **Layout**          | 3-4 column icon grid               | Staggered two-column or bento grid     |
| **Presentation**    | List of features with descriptions | Show through examples/screenshots      |
| **Icons**           | Generic icons for each feature     | Actual product UI or demonstrations    |
| **Visual interest** | Uniform repetition                 | Varied card sizes, alternating layouts |
| **Animation**       | No animation or all at once        | Staggered reveal on scroll             |

### CTA Section

| Component     | Avoid                         | Include                                          |
| ------------- | ----------------------------- | ------------------------------------------------ |
| **Layout**    | Centered text on colored band | Asymmetric layout with visual element            |
| **Content**   | Generic "Get Started"         | Specific value proposition                       |
| **Placement** | Afterthought at page end      | Integrated into distinctive section              |
| **Animation** | Static button                 | Subtle hover effect, possible entrance animation |

### Footer

| Component       | Avoid                    | Include                                      |
| --------------- | ------------------------ | -------------------------------------------- |
| **Quality**     | Degraded design energy   | Intentional design matching hero             |
| **Typography**  | Generic link lists       | Quality type treatment                       |
| **Consistency** | Different feel from page | Maintained design language                   |
| **Animation**   | None                     | Subtle hovers on links, consistent with site |

---

## Todo Item Templates

### 1. Design Direction Reference

```
Apply design direction: [aesthetic] with [layout approach] and [differentiation element]. Color: [emotional intent]. Typography: [mood]. Visual elements: [type and style]. Animation: [level and specific effects]. Avoid [specific clichés].
```

**Example:**
"Apply design direction: Clean, capable aesthetic for small teams with staggered layout and oversized hero typography. Color: Light base with ONE vibrant accent (not blue). Typography: Friendly but professional. Visual elements: Product screenshots, subtle geometric accents. Animation: Subtle—fade-in on scroll, gentle hover lifts. Avoid icon grids."

### 2. Image Search (Be Specific)

| ❌ Generic                   | ✅ Specific                                                         |
| ---------------------------- | ------------------------------------------------------------------- |
| "Search for hero background" | "Search for product UI screenshots showing the tool in action"      |
| "Find generic images"        | "Find portfolio project images with varied compositions"            |
| "Search for photos"          | "Search for artisanal ceramic product photos with natural lighting" |

### 3. Build Homepage (Include Design Specifics)

```
Build homepage (index.tsx) with [specific layout], [typography treatment], [section approach]. Visual elements: [graphics/photos approach]. Animation: [specific effects]. DO NOT use [specific cliché]. Include [differentiation element]. Maintain design energy through footer.
```

**Example:**
"Build homepage (index.tsx) with asymmetric hero (text left, product shot right), features via alternating screenshot sections (not icon grid), and integrated CTA section. Visual elements: Soft organic shapes in brand colors framing sections. Animation: Fade-in on scroll, floating shapes in hero, hover lifts on cards. Include oversized typography in hero."

---

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

---

## Template File Structure

```
src/
├── pages/
│   └── index.tsx          # Homepage (edit this only)
├── routes.tsx             # Route definitions (don't modify)
├── App.tsx                # App setup (don't modify)
├── layouts/
│   └── RootLayout.md      # Header/footer layout docs
└── components/
    └── ui/                # Reusable UI components
```

**CRITICAL:** Only edit `index.tsx` in the initial preview. Do not create additional page files or routes.
