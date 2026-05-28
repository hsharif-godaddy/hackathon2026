# Typography

> Typography is how we deliver our message. It should be simultaneously logical and elegant.

> **Implementation Notice — Use `@ux/text` Components, Not Raw Font Names**
>
> The typeface names and sizing rules below are for **design reference** (Figma, print, advertising). When implementing in code, **use `@ux/text` and `@ux/text-lockup` components** — the GoDaddy theme supplies the correct fonts automatically. See the `uxcore` skill (`references/TYPOGRAPHY.md`) for details.
>
> ```jsx
> /* WRONG — hardcoded font family */
> <h1 style={{ fontFamily: 'GD Sherpa Display' }}>Title</h1>
>
> /* RIGHT — theme-aware component */
> <text.h1 as="heading" size={2} text="Title" />
> ```
>
> For custom CSS, use font intents: `intent('ux.text.fontFamily')` (PostCSS) or `$ux-text-fontFamily` (Sass).

## The Typography Family

GD Sherpa serves as our primary typeface. It is available in both **Display** and **Text** versions:

- **GD Sherpa Display** — Best suited for headlines and essential information
- **GD Sherpa Text** — Employed for all body copy and blocks of information

**GD Sage** remains a secondary typeface of the GoDaddy brand, although it is no longer used for headline purposes. Use GD Sage judiciously, specifically for call-out information or when it is necessary to emphasize content, especially in instances where GD Sherpa is prominently featured in the layout. GD Sage is mainly utilized by the advertising team.

## Typeface Sets

The GoDaddy typography system uses three typeface sets:

| Typeface | Role | Usage |
|----------|------|-------|
| **GD Sherpa Display** | Primary headline | Headlines, callouts (20pt+) |
| **GD Sherpa Text** | Primary body | Body copy, captions, all-caps captions |
| **GD Sage** | Secondary accent | Callouts in advertising only |

## Variable Typeface

GD Sherpa Display and Text have been built as our first variable typeface. A variable typeface allows you to scale the weight of the text to your design needs by using just one file. This allows us to utilize all type weights digitally while taking up less bandwidth.

**Availability:**
- The variable version of GD Sherpa is available to digital-first teams and should be utilized in all digital spaces
- TTF (True Typeface) versions of GD Sherpa are available to all employees and contractors for brand use in the font section of the Asset Library

## GD Sherpa Display

The GD Sherpa Display is our official headline typeface. Its structure and personality are a perfect match for our brand's fresh voice and tone, blending pragmatism and optimism.

**Usage Rules:**
- Best utilized for headlines and callouts at a **minimum of 20pt size and above**
- **Do not use for body copy**
- Always set tracking to **optical**
- For larger type sizes, opt for a lighter weight

**Leading Guide:** After selecting your typeface point size, multiply it by the provided leading factor to determine your final leading point.

**When to Use:** HEADLINES | CALLOUTS

## GD Sherpa Text

GD Sherpa Text is our official text typeface. It is the backbone of our typography system, meticulously crafted for effortless legibility across all channels and scales.

**Usage Rules:**
- Maintain correct leading and tracking within text blocks
- Multiply your chosen typeface point size by the provided leading factor for final leading point
- For larger type sizes, opt for a lighter weight
- Always set tracking to **optical**

**When to Use:** BODY COPY | CAPTIONS | ALL-CAPS CAPTIONS

## GD Sage

GD Sage has undergone a refined role and is now primarily reserved for callouts and specialty design applications. The advertising team is the primary user of this typeface.

**Restrictions:**
- GD Sage should **no longer be employed in digital channels** or for everyday use
- Reserved for targeted and distinctive design contexts only
- Primarily used by the advertising team

## Typeface Mistakes to Avoid

Please do not improvise implementation. The typefaces are designed to look and feel good when used correctly and in the right place.

**Common Mistakes:**
- Using GD Sage for headlines (use GD Sherpa Display instead)
- Using GD Sherpa Display for body copy (use GD Sherpa Text instead)
- Using GD Sage in digital channels (it is not approved for digital)
- Not setting tracking to optical
- Using incorrect leading values
- Mixing too many weights in a single layout
- Using non-brand typefaces

## Hierarchy Considerations

The GoDaddy brand typefaces offer endless opportunities for hierarchy:

- **GD Sherpa Display** — Headlines and main callouts
- **GD Sherpa Text** — Body copy and smaller callouts

Use typographic hierarchy to create clear visual structure and guide the reader's eye through content.

## Best Practices

1. **GD Sherpa Display for headlines** — Always 20pt or above; never for body copy
2. **GD Sherpa Text for body** — The workhorse for all body copy and smaller text
3. **GD Sage is advertising-only** — Callouts and specialty applications; never digital
4. **Always optical tracking** — Set tracking to optical in all applications
5. **Lighter weights at larger sizes** — Scale weight inversely with size for elegance
6. **Use the variable font digitally** — Better bandwidth performance with full weight range
7. **Follow the leading guide** — Multiply point size by the leading factor for proper spacing
8. **In code, use `@ux/text` components** — Never hardcode font-family; the GoDaddy theme provides fonts through UXCore's `text.*` components and font intents. See the `uxcore` skill for implementation patterns
