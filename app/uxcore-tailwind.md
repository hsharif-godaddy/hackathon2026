# UXCore Tailwind Intents Reference

## Spacing Scale

This project uses an **8px base unit**. 1 Tailwind spacing unit = 8px (not the default 4px).

When translating Figma px values to Tailwind classes, divide the Figma px value by 8:

| Figma px | Tailwind unit | Example classes          |
| -------- | ------------- | ------------------------ |
| 4px      | 0.5           | `p-0.5`, `gap-0.5`       |
| 8px      | 1             | `p-1`, `gap-1`, `m-1`    |
| 16px     | 2             | `p-2`, `gap-2`, `m-2`    |
| 24px     | 3             | `p-3`, `gap-3`, `m-3`    |
| 32px     | 4             | `p-4`, `gap-4`, `m-4`    |
| 40px     | 5             | `p-5`, `gap-5`, `m-5`    |
| 48px     | 6             | `p-6`, `gap-6`, `m-6`    |
| 64px     | 8             | `p-8`, `gap-8`, `m-8`    |
| 80px     | 10            | `p-10`, `gap-10`, `m-10` |
| 96px     | 12            | `p-12`, `gap-12`, `m-12` |

❌ Figma `16px` → `p-4` (incorrect — assumes default 4px scale)
✅ Figma `16px` → `p-2` (correct — 16 ÷ 8 = 2)

## When to Use Tailwind Intent Classes

Prefer UXCore components over raw Tailwind intent classes when a component can achieve the desired UI. For example, use the `<Text>` component's `emphasis` prop for text color instead of applying `text-intents-ux-*` classes directly. Only reach for Tailwind intent classes when no UXCore component covers the need.

## Class Structure

UXCore intent classes come in two forms:

### Shorthand (sets multiple properties at once)

`intents-ux-[intentName]`

Applies multiple properties together (ex. color, background-color). Available for box, action, and control intents only. **Not available for feedback or navigate intents.**

### Explicit Property (targets a single CSS property)

`[prefix]-intents-ux-[intentName]-[property]`

Use when you need to set only one property, or when using feedback intents (which require this form).

### Valid Prefixes

Only three Tailwind utility prefixes are registered by the plugin:

| Prefix    | CSS Property       |
| --------- | ------------------ |
| `bg-`     | `background-color` |
| `text-`   | `color`            |
| `border-` | `border-color`     |

Other prefixes like `ring-`, `border-l-`, `outline-` do NOT work with intent values.

### Namespace

All classes must include `intents-ux-` as the namespace. Never omit `ux-`.

## Box Intents

Non-interactive containers. Properties: `backgroundColor`, `foregroundColor`, `borderColor`.

### Intent Names

| Intent Name              | Description                     |
| ------------------------ | ------------------------------- |
| `box`                    | Default page background         |
| `boxLowContrast`         | Low contrast (light gray)       |
| `boxHighContrast`        | High contrast (dark/black)      |
| `boxLowContrastOverlay`  | Low contrast with transparency  |
| `boxHighContrastOverlay` | High contrast with transparency |

### Shorthand (sets multiple properties together)

```
intents-ux-box
intents-ux-boxLowContrast
intents-ux-boxHighContrast
intents-ux-boxLowContrastOverlay
intents-ux-boxHighContrastOverlay
```

### Individual Properties

```
bg-intents-ux-boxLowContrast-backgroundColor
text-intents-ux-boxLowContrast-foregroundColor
border-intents-ux-boxLowContrast-borderColor
```

The default text color for the app uses `text-intents-ux-box-foregroundColor`.

## Action Intents

Interactive elements (buttons). Properties: `backgroundColor`, `foregroundColor`, `borderColor`.

### Intent Names

| Intent Name       | Description                  |
| ----------------- | ---------------------------- |
| `action`          | Generic action               |
| `actionPrimary`   | Primary call-to-action       |
| `actionSecondary` | Secondary action             |
| `actionCritical`  | Destructive/danger action    |
| `actionControl`   | Action within a form control |
| `actionOption`    | Selectable option            |

Each also has interaction variants by appending `Hovered`, `Focused`, or `Chosen` (e.g., `actionPrimaryHovered`).

### Shorthand

```
intents-ux-action
intents-ux-actionPrimary
```

### Individual Properties

```
bg-intents-ux-actionPrimary-backgroundColor
text-intents-ux-actionPrimary-foregroundColor
border-intents-ux-actionPrimary-borderColor
```

## Navigate Intents

Links and navigation items. Properties: `backgroundColor`, `foregroundColor`, `borderColor`.

### Intent Names

| Intent Name         | Description             |
| ------------------- | ----------------------- |
| `navigate`          | Generic navigation link |
| `navigatePrimary`   | Primary navigation      |
| `navigateSecondary` | Secondary navigation    |

Each also has interaction variants: `Hovered`, `Focused`, `Chosen` (e.g., `navigatePrimaryHovered`).

### Individual Properties

```
text-intents-ux-navigate-foregroundColor
text-intents-ux-navigatePrimary-foregroundColor
```

## Control Intents

Form inputs and interactive controls. Properties: `backgroundColor`, `foregroundColor`, `borderColor`.

### Intent Names

| Intent Name   | Description                         |
| ------------- | ----------------------------------- |
| `control`     | General input field                 |
| `controlKnob` | Toggle/slider handle                |
| `controlVoid` | Non-interactive parts (placeholder) |

Each has expression `Critical` and interaction variants: `Hovered`, `Focused`, `Chosen` (e.g., `controlKnobHovered`).

### Shorthand

```
intents-ux-control
intents-ux-controlKnob
```

## Feedback Intents

IMPORTANT: Feedback intents use DIFFERENT property names from box/action/control in their class names.

Feedback intent class names use only two property suffixes:

- `feedbackColor` — the accent/semantic color
- `onFeedbackColor` — accessible text color to use ON TOP of feedbackColor as a background

These can be combined with any valid prefix (`bg-`, `text-`, `border-`) to target the desired CSS property. For example, `bg-intents-ux-feedbackCritical-feedbackColor` sets `background-color`.

Feedback class names do NOT use the `-backgroundColor`, `-foregroundColor`, or `-borderColor` property suffixes that box/action/control use.

### Feedback Expressions

| Semantic Meaning | Default Intent      | HighContrast Intent             |
| ---------------- | ------------------- | ------------------------------- |
| Error/danger     | `feedbackCritical`  | `feedbackHighContrastCritical`  |
| Warning          | `feedbackWarning`   | `feedbackHighContrastWarning`   |
| Success          | `feedbackSuccess`   | `feedbackHighContrastSuccess`   |
| Information      | `feedbackInfo`      | `feedbackHighContrastInfo`      |
| Subdued          | `feedbackPassive`   | `feedbackHighContrastPassive`   |
| Promotion        | `feedbackHighlight` | `feedbackHighContrastHighlight` |
| Plan-related     | `feedbackPremium`   | `feedbackHighContrastPremium`   |
| Internal/CS      | `feedbackInternal`  | `feedbackHighContrastInternal`  |

### Text/Icon Only (use HighContrast)

```
text-intents-ux-feedbackHighContrastCritical-feedbackColor
text-intents-ux-feedbackHighContrastWarning-feedbackColor
text-intents-ux-feedbackHighContrastSuccess-feedbackColor
text-intents-ux-feedbackHighContrastInfo-feedbackColor
text-intents-ux-feedbackHighContrastPassive-feedbackColor
```

### Feedback as Background

Use `feedbackColor` with the `bg-` prefix, and `onFeedbackColor` for text on that background:

```
bg-intents-ux-feedbackInfo-feedbackColor
text-intents-ux-feedbackInfo-onFeedbackColor
```

### Feedback as Border

```
border-intents-ux-feedbackCritical-feedbackColor
```

### No Shorthand for Feedback

Unlike box/action/control, feedback intents do NOT have shorthand classes. Always use the prefixed individual-property form:

```
bg-intents-ux-feedbackCritical-feedbackColor
text-intents-ux-feedbackCritical-onFeedbackColor
```

## Text Intents (Font Only — NO Colors)

Text intents control typography (font family), not color. They have NO color properties.

These use the `font-` prefix and intentionally omit the `intents-ux-` namespace to align with Tailwind's `font-` prefix convention (per `@ux/tailwind-intents`):

```
font-paragraph
font-heading
font-title
font-label
font-action
font-input
font-caption
```

For text color, use box `foregroundColor` or feedback `feedbackColor` — never a text intent.

## Semantic Mapping

### Text/Icon on Normal Page Background

Use HighContrast feedback for colored text on a standard box background. Do NOT pair these with a feedback background.

| Concept           | WRONG                                  | CORRECT                                                      |
| ----------------- | -------------------------------------- | ------------------------------------------------------------ |
| Error text        | `text-intents-ux-error-textColor`      | `text-intents-ux-feedbackHighContrastCritical-feedbackColor` |
| Success text      | `text-intents-ux-success-textColor`    | `text-intents-ux-feedbackHighContrastSuccess-feedbackColor`  |
| Warning text      | `text-intents-ux-warning-textColor`    | `text-intents-ux-feedbackHighContrastWarning-feedbackColor`  |
| Info text         | `text-intents-ux-info-textColor`       | `text-intents-ux-feedbackHighContrastInfo-feedbackColor`     |
| Subtle/muted text | `text-intents-ux-textSubtle-textColor` | `text-intents-ux-feedbackHighContrastPassive-feedbackColor`  |
| Default text      | `text-intents-ux-text-textColor`       | `text-intents-ux-box-foregroundColor`                        |
| Link text         | `text-intents-ux-link-foregroundColor` | `text-intents-ux-navigate-foregroundColor`                   |
| Destructive text  | `text-intents-ux-text-destructive`     | `text-intents-ux-feedbackHighContrastCritical-feedbackColor` |

## Common Mistakes

### textColor does not exist

No intent has a `textColor` property. For text color use `foregroundColor` (box/action/navigate/control) or `feedbackColor` (feedback).

### Do not invent intent names

These are NOT valid intents: `textSubtle`, `textStandard`, `textSubdued`, `boxStandard`, `border`, `link`, `error`, `success`, `warning`, `info`, `critical`, `passive`, `alert`, `ring`, `highContrast`.

### Feedback intents do not have backgroundColor or borderColor

WRONG: `bg-intents-ux-feedbackSuccess-backgroundColor`
RIGHT: `bg-intents-ux-feedbackSuccess-feedbackColor`

WRONG: `border-intents-ux-feedbackCritical-borderColor`
RIGHT: `border-intents-ux-feedbackCritical-feedbackColor`

### Do not use shorthand semantic names

WRONG: `bg-intents-ux-success-backgroundColor`
RIGHT: `bg-intents-ux-feedbackSuccess-feedbackColor`

WRONG: `border-intents-ux-error-borderColor`
RIGHT: `border-intents-ux-feedbackCritical-feedbackColor`

### Only bg-, text-, border- prefixes work

WRONG: `ring-intents-ux-actionPrimary-backgroundColor`
WRONG: `border-l-intents-ux-box-borderColor`

### Always include the ux- namespace

WRONG: `border-intents-success-borderColor`
RIGHT: `border-intents-ux-feedbackSuccess-feedbackColor`
