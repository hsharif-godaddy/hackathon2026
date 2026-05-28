# Color

> Color breathes life into our brand. It both inspires joy and guides everyday entrepreneurs.

Our brand palette is bright, bold and expansive. While black, white and teal remain cornerstones, additional color options give us the design flexibility to match mood to context.

> **Implementation Notice — Do Not Hardcode Colors**
>
> The HEX/RGB values below are for **design reference only** (Figma, print, presentations). When implementing in code, **always use the UXCore intent system** — the GoDaddy theme maps these brand colors to semantic intents automatically. See the `uxcore` skill (`references/THEMING.md`) for details.
>
> ```css
> /* WRONG — hardcoded brand color */
> .button { background: #1BDBDB; }
>
> /* RIGHT — theme intent resolves to the correct brand color */
> .button { background: intent('ux.actionPrimary.backgroundColor'); }
> ```
>
> This ensures colors stay consistent across themes, support dark mode, and update automatically when the brand palette evolves.

## Primary Brand Palette

Our primary use of Everyday Teal presents our fresh design mood, while Cash Black and Space White remain cornerstones.

| Color Name | HEX | RGB | CMYK | Pantone |
|------------|-----|-----|------|---------|
| **Everyday Teal 400** | `#1BDBDB` | 27, 219, 219 | 88, 0, 0, 14 | 3125 C |
| **Cash Black** | `#111111` | 17, 17, 17 | 0, 0, 0, 93 | Black C |
| **Space White** | `#FFFFFF` | 255, 255, 255 | 0, 0, 0, 0 | N/A |

## Secondary Brand Palette

Our secondary brand palette continues our bright, bold, expansive approach. However, this palette remains ever secondary and should be used as accent colors only.

## Full Brand Palette — Everyday Teal

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Everyday Teal 100 | `#D8EFEF` | 216, 239, 239 | 10, 0, 0, 6 | 628 C |
| Everyday Teal 200 | `#A6FFF8` | 166, 255, 248 | 35, 0, 3, 0 | 318 C |
| Everyday Teal 300 | `#61EDEA` | 97, 237, 234 | 59, 0, 1, 7 | 3115 C |
| Everyday Teal 400 | `#1BDBDB` | 27, 219, 219 | 88, 0, 0, 14 | 3125 C |
| Everyday Teal 500 | `#00A4A6` | 0, 164, 166 | 100, 1, 0, 35 | 2228 C |
| Everyday Teal 600 | `#09757A` | 9, 117, 122 | 93, 4, 0, 52 | 3135 C |
| Everyday Teal 700 | `#004249` | 0, 66, 73 | 100, 10, 0, 71 | 3155 C |

## Full Brand Palette — Tech Gray

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Tech Gray 100 | `#F5F5F5` | 245, 245, 245 | 0, 0, 0, 4 | N/A |
| Tech Gray 200 | `#D6D6D6` | 214, 214, 214 | 0, 0, 0, 16 | N/A |
| Tech Gray 300 | `#AFAFAF` | 175, 175, 175 | 0, 0, 0, 31 | N/A |
| Tech Gray 400 | `#767676` | 118, 118, 118 | 0, 0, 0, 54 | 877 C |
| Tech Gray 500 | `#5E5E5E` | 94, 94, 94 | 0, 0, 0, 63 | N/A |
| Tech Gray 600 | `#444444` | 68, 68, 68 | 0, 0, 0, 73 | N/A |
| Tech Gray 700 | `#2B2B2B` | 43, 43, 43 | 0, 0, 0, 83 | N/A |

## Full Brand Palette — Go Green

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Go Green 100 | `#D9F2E2` | 217, 242, 226 | 10, 0, 7, 5 | 621 C |
| Go Green 200 | `#9FFFB8` | 159, 255, 184 | 38, 0, 28, 0 | 7478 C |
| Go Green 300 | `#00E356` | 0, 227, 86 | 100, 0, 62, 11 | 7480 C |
| Go Green 400 | `#02C54C` | 2, 197, 76 | 99, 0, 61, 23 | 354 C |
| Go Green 500 | `#00782E` | 0, 120, 46 | 100, 0, 62, 53 | 355 C |
| Go Green 600 | `#004F1E` | 0, 79, 30 | 100, 0, 62, 69 | 356 C |
| Go Green 700 | `#003A15` | 0, 58, 21 | 100, 0, 64, 77 | 3537 C |

## Full Brand Palette — Deep Sea

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Deep Sea 100 | `#DDEAF8` | 221, 234, 248 | 11, 6, 0, 3 | 304 C |
| Deep Sea 200 | `#A9EDFF` | 169, 237, 255 | 34, 7, 0, 0 | 2985 C |
| Deep Sea 300 | `#4095E8` | 64, 149, 232 | 72, 36, 0, 9 | 2191 C |
| Deep Sea 400 | `#1976D2` | 25, 118, 210 | 88, 44, 0, 18 | 2193 C |
| Deep Sea 500 | `#145FA9` | 20, 95, 169 | 88, 44, 0, 34 | 2195 C |
| Deep Sea 600 | `#104A85` | 16, 74, 133 | 88, 44, 0, 48 | 2196 C |
| Deep Sea 700 | `#0B3354` | 11, 51, 84 | 87, 39, 0, 67 | 2186 C |

## Full Brand Palette — Proud Purple

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Proud Purple 100 | `#E9E4F2` | 233, 228, 242 | 4, 6, 0, 5 | 270 C |
| Proud Purple 200 | `#D3C1F7` | 211, 193, 247 | 15, 22, 0, 3 | 2100 C |
| Proud Purple 300 | `#8E6BC6` | 142, 107, 198 | 28, 46, 0, 22 | 2101 C |
| Proud Purple 400 | `#744BC4` | 116, 75, 196 | 41, 62, 0, 23 | 2102 C |
| Proud Purple 500 | `#613EA3` | 97, 62, 163 | 40, 62, 0, 36 | 2103 C |
| Proud Purple 600 | `#462A72` | 70, 42, 114 | 39, 63, 0, 55 | 2105 C |
| Proud Purple 700 | `#2F1C4C` | 47, 28, 76 | 38, 63, 0, 70 | 2119 C |

## Full Brand Palette — Motivating Magenta

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Motivating Magenta 100 | `#FBD9ED` | 251, 217, 237 | 0, 14, 6, 2 | 670 C |
| Motivating Magenta 200 | `#FFB3E6` | 255, 179, 230 | 0, 30, 10, 0 | 223 C |
| Motivating Magenta 300 | `#FF20A5` | 255, 32, 165 | 0, 87, 35, 0 | 232 C |
| Motivating Magenta 400 | `#E20087` | 226, 0, 135 | 0, 100, 40, 11 | 225 C |
| Motivating Magenta 500 | `#B4006C` | 180, 0, 108 | 0, 100, 40, 29 | 226 C |
| Motivating Magenta 600 | `#8B0053` | 139, 0, 83 | 0, 100, 40, 45 | 227 C |
| Motivating Magenta 700 | `#58003B` | 88, 0, 59 | 0, 100, 33, 65 | 228 C |

## Full Brand Palette — Reliable Red

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Reliable Red 100 | `#FADCD9` | 250, 220, 217 | 0, 12, 13, 2 | 196 |
| Reliable Red 200 | `#FFBBBB` | 255, 187, 187 | 0, 27, 27, 0 | 197 |
| Reliable Red 300 | `#FD341D` | 253, 52, 29 | 0, 79, 89, 1 | RED 032 C |
| Reliable Red 400 | `#DB1802` | 219, 24, 2 | 0, 89, 99, 14 | 185 C |
| Reliable Red 500 | `#AE1302` | 174, 19, 2 | 0, 89, 99, 32 | 186 C |
| Reliable Red 600 | `#850F01` | 133, 15, 1 | 0, 89, 99, 48 | 187 C |
| Reliable Red 700 | `#600801` | 96, 8, 1 | 0, 92, 99, 62 | 188 C |

## Full Brand Palette — Active Orange

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Active Orange 100 | `#FDE9DB` | 253, 233, 219 | 0, 8, 13, 1 | 155 C |
| Active Orange 200 | `#FFCCA9` | 255, 204, 169 | 0, 20, 34, 0 | 156 C |
| Active Orange 300 | `#F38F48` | 243, 143, 72 | 0, 41, 70, 5 | 157 C |
| Active Orange 400 | `#EF6C0F` | 239, 108, 15 | 0, 55, 94, 6 | 158 C |
| Active Orange 500 | `#C4580C` | 196, 88, 12 | 0, 55, 94, 23 | 159 C |
| Active Orange 600 | `#9D470A` | 157, 71, 10 | 0, 55, 94, 38 | 160 C |
| Active Orange 700 | `#6D3209` | 109, 50, 9 | 0, 54, 92, 57 | 1685 C |

## Full Brand Palette — Joyous Yellow

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Joyous Yellow 100 | `#FFFAE3` | 255, 250, 227 | 0, 2, 11, 0 | P 1-2 C |
| Joyous Yellow 200 | `#FFEEA9` | 255, 238, 169 | 0, 7, 34, 0 | 938 C |
| Joyous Yellow 300 | `#FEDC45` | 254, 220, 69 | 0, 13, 73, 0 | 114 C |
| Joyous Yellow 400 | `#FED317` | 254, 211, 23 | 0, 17, 91, 0 | 109 C |
| Joyous Yellow 500 | `#EAB303` | 234, 179, 3 | 0, 24, 99, 8 | 7406 C |
| Joyous Yellow 600 | `#D19500` | 209, 149, 0 | 0, 29, 100, 18 | 2006 C |
| Joyous Yellow 700 | `#AA6D00` | 170, 109, 0 | 0, 36, 100, 33 | 124 C |

## Full Brand Palette — Intentional Tan

| Shade | HEX | RGB | CMYK | Pantone |
|-------|-----|-----|------|---------|
| Intentional Tan 100 | `#FFF1E1` | 255, 241, 225 | 0, 5, 12, 0 | 7506 C |
| Intentional Tan 200 | `#FED9B4` | 254, 217, 180 | 0, 15, 29, 0 | 7507 C |
| Intentional Tan 300 | `#FBB684` | 251, 182, 132 | 0, 27, 47, 2 | 7508 C |
| Intentional Tan 400 | `#BD8150` | 189, 129, 80 | 0, 32, 58, 26 | 2313 C |
| Intentional Tan 500 | `#A05932` | 160, 89, 50 | 0, 44, 69, 37 | 154 C |
| Intentional Tan 600 | `#823B25` | 130, 59, 37 | 0, 55, 72, 49 | 7586 C |
| Intentional Tan 700 | `#4F271C` | 79, 39, 28 | 0, 51, 65, 69 | 4695 C |

## Color Combos

Combos are for creative that uses our robust color palette. To maintain a coherent and audience-friendly brand presence, use harmonious color pairings:

- **Primary Brand Palette** — Combine primary brand colors with their respective tints and shades to craft impactful and cohesive brand visuals
- **Analogous** — Select a group of colors that are adjacent to each other on the palette, using up to three colors (moving left to right on the color palette chart)
- **Split Complementary** — Combine two to three colors that are direct complements on the color wheel (pairing a cool color with a warm color)

Combos play a secondary role in branding — black, white and teal retain their positions as the primary palette.

## Color Scale by Channel

### Advertising

Our advertising wants to connect with everyday entrepreneurs on an emotional level, so it gets to use more color than other channels. It makes full use of our color palette, especially the brights and bolds.

### Front of Site

Front of Site leans heavily on white. Secondary colors are reserved for accents and illustrations.

### Product

When we switch to the in-product experience, white and gray dominate with Everyday Teal following as a key accent. Any other color should be used in a restrained, thoughtful way.

## GoDaddy Registry Color Palette

The Registry color palette is simple and straightforward to appeal to a wide audience and easily align with the large number of TLDs in the Registry. Active Orange 200 is reserved for callouts.

## Best Practices

1. **Everyday Teal is the hero** — Use Everyday Teal 400 (`#1BDBDB`) as the primary brand color
2. **Cash Black and Space White are cornerstones** — They anchor every design
3. **Secondary colors are accents** — Never let secondary colors overpower the primary palette
4. **Match mood to context** — Use the color scale guidelines for your specific channel
5. **Product UI is restrained** — White and gray dominate; Teal is the accent; everything else is minimal
6. **In code, use intents — not HEX values** — The GoDaddy theme delivers these colors through `intent('ux.box.foregroundColor')` (PostCSS), `$ux-box-foregroundColor` (Sass), or UXCore components. See the `uxcore` skill for implementation patterns
