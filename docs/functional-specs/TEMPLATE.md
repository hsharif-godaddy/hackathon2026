# Feature Name

**Author:** [Name] - [Title]  
**Date last updated:** YYYY-MM-DD  
**Version:** [Current (vX) | Archive | Draft]

## Overview

[1-2 sentence description of what this feature does and its purpose.]

**Route:** `/[market]/path` (if applicable)

**Component:** `app/src/path/to/Component.tsx`

**Related Components:**
- `ComponentA.tsx` — [purpose]
- `ComponentB.tsx` — [purpose]

**Changes:** (for new features or updates)
- [Change 1]
- [Change 2]

**Feature Flag:** `appbuilder-feature-name` (if applicable)

## Wireframe

### [State/View Name]

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  [ASCII wireframe of the UI]                                     │
│                                                                  │
│  Use box-drawing characters:                                     │
│  ┌ ┐ └ ┘ │ ─ ├ ┤ ┬ ┴ ┼                                          │
│                                                                  │
│  Annotate with arrows and notes:                                 │
│  [Button]  ← Description of element                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
    Caption or dimensions below
```

### [Another State/View]

```
[Additional wireframes as needed]
```

## [Domain-Specific Section]

[Tables describing key concepts, e.g., Link Types, Card Types, etc.]

| Type | Icon | Visibility | Description |
| ---- | ---- | ---------- | ----------- |
| **Type A** | [icon] | [condition] | [description] |
| **Type B** | [icon] | [condition] | [description] |

### Subsection

[Detailed attribute tables for each type]

| Attribute | Value |
| --------- | ----- |
| **Label** | "Display text" |
| **Source** | `data.field` from [source] |
| **Behavior** | [what happens] |

## States

### [Component/Element] States

| State | Condition | Display |
| ----- | --------- | ------- |
| **State A** | [when this happens] | [what shows] |
| **State B** | [when this happens] | [what shows] |
| **State C** | [when this happens] | [what shows] |

### [Another Component] States

[State machine description if applicable]

| State | Condition | Icon | Disabled | Other Attributes |
| ----- | --------- | ---- | -------- | ---------------- |
| **ready** | [condition] | [icon] | No | [details] |
| **loading** | [condition] | Spinner | Yes | [details] |
| **success** | [condition] | Checkmark | No | [details] |
| **error** | [condition] | [icon] | Yes | [details] |

**State transitions:**
1. `state_a` → (trigger) → `state_b` → (trigger) → `state_c`
2. `state_b` → (error) → `state_error`

## Interactions

| Action | Result |
| ------ | ------ |
| Click [element] | [what happens] |
| Hover [element] | [what happens] |
| Press Escape | [what happens] |
| Submit form | [what happens] |

## Data Dependencies

| Data | Source | Update Trigger |
| ---- | ------ | -------------- |
| `field.name` | [store/hook/API] | [when it updates] |
| `another.field` | [store/hook/API] | [when it updates] |

**Implementation notes:**
- [Any special logic or data transformation details]

## Analytics Events

| Event | Trigger | Payload |
| ----- | ------- | ------- |
| `feature.action.name` | [when fired] | `{ field1, field2 }` |
| `feature.action.other` | [when fired] | `{ field1 }` |

## Accessibility

| Element | Requirement |
| ------- | ----------- |
| [Element] | `aria-label`, `aria-expanded`, etc. |
| [Element] | Focus management, keyboard navigation |
| External links | `target="_blank"` with `rel="noopener noreferrer"` |

## Test Scenarios

### [Category]

- [ ] [Test case 1]
- [ ] [Test case 2]
- [ ] [Test case 3]

### [Another Category]

- [ ] [Test case 1]
- [ ] [Test case 2]

### Integration

- [ ] [Cross-feature test case]
- [ ] Mobile layout maintains functionality
- [ ] State updates reflect across UI immediately

## Edge Cases

### [Edge Case Name]

[Description of the edge case and how it's handled]

- [Bullet point details]
- [More details]

### [Another Edge Case]

[Description and handling]

## i18n Keys

### New keys

| Key | Value |
| --- | ----- |
| `builder_feature_key_name` | "Display text" |
| `builder_feature_another_key` | "Text with {variable}" |

### Keys to remove (if updating existing feature)

| Key | Reason |
| --- | ------ |
| `builder_old_key` | [why it's being removed] |

## Data Test IDs

| Test ID | Element |
| ------- | ------- |
| `feature-element-name` | [Element description] |
| `feature-another-element` | [Element description] |

## Files

```
app/src/path/to/feature/
├── Component.tsx           # Main component
├── Component.test.tsx      # Tests
├── SubComponent.tsx        # Sub-component
├── hooks/
│   └── useFeatureHook.ts   # Custom hook
└── utils/
    └── helpers.ts          # Utility functions
```

## Related Components

| Component | Location | Purpose |
| --------- | -------- | ------- |
| `RelatedComponent` | `path/to/Component.tsx` | [purpose] |

## Migration Notes (if applicable)

[For features that replace or modify existing functionality]

| Current | New |
| ------- | --- |
| [Old behavior] | [New behavior] |
| [Old component] | [New component] |

**Implementation steps:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Breaking changes:**
- [Breaking change 1]
- [Breaking change 2]
