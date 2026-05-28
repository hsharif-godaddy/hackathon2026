# Theming and Intents

This reference covers the UXCore intent system for consistent theming across brands.

## What Are Intents?

An **intent** represents what a designer intends to convey when applying style. Themes use intents to render the correct color, text style, and other attributes within the context of a brand.

**Key principle**: Intent names describe purpose, not appearance.

```css
/* Good: Describes purpose */
color: $ux-actionPrimary-backgroundColor;

/* Bad: Describes appearance */
color: $color-blue-500;
```

## Intent Categories

### text

Font properties: `fontFamily`, `fontSize`, `lineHeight`, `fontWeight`

| Intent | Use Case |
|--------|----------|
| `text` | Body font (default for `<body>`) |
| `textParagraph` | Paragraph text |
| `textHeading` | Headings (h1-h6) |
| `textTitle` | Titles in confined spaces |
| `textLabel` | Form labels |
| `textAction` | Button/action text |
| `textInput` | Text input fields |
| `textCaption` | Help text, captions |

**Example**: `intents.ux.textTitle.fontSize`

### box

Non-interactive containers: `backgroundColor`, `foregroundColor`, `borderColor`, `outlineColor`, `borderRadius`

| Intent | Use Case |
|--------|----------|
| `box` | Default page/container background |
| `boxLowContrast` | Subtle background variation |
| `boxHighContrast` | Strong background variation |
| `boxLowContrastOverlay` | Semi-transparent low contrast overlay |
| `boxHighContrastOverlay` | Semi-transparent high contrast overlay |

**Example**: `intents.ux.boxLowContrast.backgroundColor`

### action

Interactive elements (buttons, clickable targets):

| Intent | Use Case |
|--------|----------|
| `action` | General clickable target |
| `actionPrimary` | Primary call-to-action |
| `actionSecondary` | Secondary actions |
| `actionControl` | Actions within form controls |

**Interaction modifiers**: Append `Hovered`, `Focused`, or `Chosen` (for selected/checked states).

**Example**: `intents.ux.actionPrimaryHovered.backgroundColor`

### navigate

Clickable navigation items (links, tabs):

| Intent | Use Case |
|--------|----------|
| `navigate` | General navigation link |
| `navigatePrimary` | Primary navigation |
| `navigateSecondary` | Secondary navigation |

**Example**: `intents.ux.navigatePrimary.foregroundColor`

### control

Form inputs and interactive controls:

| Intent | Use Case |
|--------|----------|
| `control` | Text inputs, selects |
| `controlKnob` | Toggle/slider handles |
| `controlVoid` | Placeholders, non-interactive parts |

**Example**: `intents.ux.controlChosenHovered.borderColor`

### feedback

Response/notification elements (alerts, error states):

| Intent | Use Case |
|--------|----------|
| `feedback` | General feedback (progress bars) |
| `feedbackCritical` | Errors, danger states |
| `feedbackWarning` | Warning states |
| `feedbackSuccess` | Success confirmations |
| `feedbackInfo` | Informational messages |

Each has a high contrast version (e.g., `feedbackHighContrastCritical`).

**Properties**: `feedbackColor` (accent), `onFeedbackColor` (foreground on accent background)

**Example**: `intents.ux.feedbackCritical.feedbackColor`

### figure

Data visualization and illustration colors:

Use `figureColor0` through `figureColor29` (30 colors total).

**Example**: `intents.ux.figure.figureColor12`

> Exhaust other intent categories before using figure colors.

## Using Intents

### PostCSS (@ux/postcss-intents)

```bash
npm install --save-dev @ux/postcss-intents
```

```js
// postcss.config.js
module.exports = {
  plugins: [
    require('@ux/postcss-intents')()
  ]
};
```

```css
.button {
  font-size: calc(intent('ux.textAction.fontSize') * 0.835);
  color: intent('ux.actionPrimary.foregroundColor');
  background-color: intent('ux.actionPrimary.backgroundColor');
}

/* Compiles to: */
.button {
  font-size: calc(var(--ux-cxbe8g, 1rem) * 0.835);
  color: var(--ux-abc123);
  background-color: var(--ux-def456);
}
```

### Tailwind (@ux/tailwind-intents)

```bash
npm install --save-dev @ux/tailwind-intents
```

```js
// tailwind.config.js
import { tailwindIntentsPreset } from '@ux/tailwind-intents';

export default {
  presets: [tailwindIntentsPreset]
};
```

```html
<div class="intents-ux-box" />
```

For full Tailwind intent class syntax, valid prefixes, and common mistakes, see `references/TAILWIND-INTENTS.md`.

### Sass/SCSS (@ux/intents)

```bash
npm install @ux/intents
```

```scss
@import '~@ux/intents/lib/index';

.example-card {
  color: $ux-box-foregroundColor;
  background-color: $ux-box-backgroundColor;
  border-color: $ux-box-borderColor;
  font-family: $ux-text-fontFamily;
  font-size: $ux-text-fontSize;
}
```

### JavaScript (@ux/intents)

```js
import Intents from '@ux/intents';
import { css } from 'your-css-in-js-solution';

const intents = new Intents();

const styles = css`
  .example-card {
    color: ${intents.ux.box.foregroundColor};
    background-color: ${intents.ux.box.backgroundColor};
  }
`;
```

## Complete Example

Building a gift card component without UXCore components:

```scss
@import '~@ux/intents/lib/index';

.gift-card {
  color: $ux-box-foregroundColor;
  background-color: $ux-box-backgroundColor;
  font-family: $ux-text-fontFamily;

  .card-title {
    font-family: $ux-textTitle-fontFamily;
    font-size: $ux-textTitle-fontSize;
    font-weight: $ux-textTitle-fontWeight;
  }

  .recipient-link {
    color: $ux-action-foregroundColor;
  }

  .card-divider {
    border-bottom: 2px solid $ux-box-borderColor;
  }

  .message-box {
    border: 1px solid $ux-control-borderColor;
    color: $ux-control-foregroundColor;
    background-color: $ux-control-backgroundColor;
    font-family: $ux-textInput-fontFamily;
  }

  .checkout-button {
    border: 1px solid $ux-actionPrimary-borderColor;
    color: $ux-actionPrimary-foregroundColor;
    background-color: $ux-actionPrimary-backgroundColor;
    font-family: $ux-textAction-fontFamily;
  }
}
```

## Theme Delivery

Intents require a theme loaded on the page. The most common and recommended way to load a theme onto the page is by using a header from **Presentation Central** to receive theme values. This works if your app is using a **Gasket** framework. To specify a theme, update the `presentationCentral.params` in your Gasket configuration like so:

```js
presentationCentral: {
  params: {
    app: 'app-name',
    theme: 'theme-name',
    manifest: 'sidebar-name',
    uxcore: false
  }
}
```

> **Note**: To use UXCore v2500 properly in your Gasket app, the `presentationCentral.params.uxcore` value must be set to `false` in order not to request a bundled version of UXCore.


Intents have basic default values, but themes provide complete coverage for all states and interactions.

To see a list of available themes and their values, use the [Theme UI](https://theme-ui.uxp.gdcorp.tools/) webapp.

## Brand Color Palette and Intents

The GoDaddy theme maps the official brand color palette (Everyday Teal, Cash Black, Space White, and all secondary colors) to semantic intents. When an agent or designer references a brand color like "Everyday Teal 400 (`#1BDBDB`)" from the brand guidelines, the correct implementation is through the appropriate intent — not the HEX value.

## Do Not Override UXCore Component Styles

All UXCore components include intents ready for theming. To customize appearance:

1. Use the theme and intent system
2. Contact #uxcore-support on Slack for guidance
3. Never override UXCore component colors or typography directly

## Local Intents

Local intents allow themes to override specific components differently from the base intent.

**Example**: Modal dialog uses `ux.box.backgroundColor` by default, but a theme can set `uxModal.backgroundColor` to override just modals.

If a local intent isn't defined in a theme, it falls back to the theme-level intent.
