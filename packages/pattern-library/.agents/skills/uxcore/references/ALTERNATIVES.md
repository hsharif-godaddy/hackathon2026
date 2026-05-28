# Component Alternatives

When UXCore doesn't have a needed component, this guide shows how to build accessible alternatives using React Aria Components with UXCore styling.

## When to Use This Reference

Load this reference when:
- UXCore doesn't have the component you need
- You need to build a custom component not in the design system
- You're looking for accessible component primitives
- You need a Switch, ComboBox, or other interactive pattern

## When UXCore Doesn't Have the Component

If a needed component doesn't exist in UXCore, use **React Aria Components (RAC)** as accessible primitives and style them with UXCore intents.

### Why React Aria Components?

- **Accessibility built-in** - WCAG 2.1 AA compliant by default
- **Unstyled primitives** - No CSS to override, accepts UXCore styling
- **WAI-ARIA patterns** - Proper semantics, keyboard navigation, screen reader support
- **Composable** - Build complex components from simple primitives

### Pattern: RAC + UXCore Intents

```jsx
import { Button } from 'react-aria-components';
import Box from '@ux/box';
import text from '@ux/text';
import '@ux/box/styles';
import '@ux/text/styles';
import './custom-component.css';  // Your intent-based styles

// React Aria Component with UXCore styling
function CustomButton({ children, ...props }) {
  return (
    <Button {...props} className="custom-button">
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
        {children}
      </Box>
    </Button>
  );
}
```

**Styling with intents (custom-component.css):**
```css
.custom-button {
  background-color: intent('ux.action.backgroundColor');
  color: intent('ux.action.foregroundColor');
  border: 1px solid intent('ux.action.borderColor');
  padding-block: calc(intent('ux.box.density') * 1);
  padding-inline: calc(intent('ux.box.density') * 3);
}

.custom-button:hover {
  background-color: intent('ux.actionHovered.backgroundColor');
}

.custom-button:focus-visible {
  outline: 5px auto Highlight;
  outline: 5px auto -webkit-focus-ring-color;
  outline-offset: 2px;
}
```

## Common RAC Components

| RAC Component | Use Case | UXCore Alternative |
|---------------|----------|-------------------|
| `Switch` | Toggle controls | `@ux/toggle-button` |
| `Slider` | Range inputs | `@ux/range-input` |
| `ComboBox` | Autocomplete | None (use RAC) |
| `DatePicker` | Date selection | `@ux/date-input` |
| `Tabs` | Tab navigation | `@ux/tabs` |
| `Menu` | Dropdown menus | `@ux/menu` |
| `Dialog` | Modals, alerts | `@ux/modal`, `@ux/dialog` |
| `Tooltip` | Hover hints | `@ux/tooltip` |
| `Popover` | Floating content | `@ux/popover` |

## Decision Flow

When you need a component:

1. **Check UXCore first** - Use UXCore MCP to search for the component
2. **If not found** - Check if React Aria Components has it
3. **Use RAC + UXCore** - Import RAC primitive, style with UXCore intents
4. **Wrap in UXCore layout** - Use Box/Text for consistent spacing and typography

## Example: Switch Component

UXCore doesn't have a Switch component. Here's how to build one with RAC:

```jsx
import { Switch } from 'react-aria-components';
import Box from '@ux/box';
import text from '@ux/text';
import './switch.css';

function Toggle({ label, ...props }) {
  return (
    <Switch {...props} className="toggle-switch">
      {({ isSelected }) => (
        <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
          <div className="toggle-track">
            <div className="toggle-thumb" />
          </div>
          <text.span as="label" text={label} />
        </Box>
      )}
    </Switch>
  );
}
```

**switch.css:**
```css
.toggle-switch {
  display: inline-flex;
  cursor: pointer;
}

.toggle-track {
  width: 44px;
  height: 24px;
  background: intent('ux.feedbackPassive.feedbackColor');
  border-radius: 12px;
  position: relative;
  transition: background-color 200ms;
}

.toggle-switch[data-selected] .toggle-track {
  background: intent('ux.controlChosen.backgroundColor');
}

.toggle-thumb {
  width: 20px;
  height: 20px;
  background: intent('ux.control.backgroundColor');
  border-radius: 50%;
  position: absolute;
  inset-block-start: 2px;
  inset-inline-start: 2px;
  transition: transform 200ms;
}

.toggle-switch[data-selected] .toggle-thumb {
  transform: translateX(20px);
}

.toggle-switch:focus-visible {
  outline: 5px auto Highlight;
  outline: 5px auto -webkit-focus-ring-color;
  border-radius: 4px;
}
```

## Example: ComboBox with Autocomplete

```jsx
import { ComboBox, Input, Popover, ListBox, ListBoxItem } from 'react-aria-components';
import Box from '@ux/box';
import text from '@ux/text';
import './combobox.css';

function AutoComplete({ label, items, ...props }) {
  return (
    <ComboBox {...props} className="autocomplete">
      <Box orientation="vertical" gap="sm">
        <text.label as="label" text={label} />
        <Input className="autocomplete-input" />
        <Popover className="autocomplete-popover">
          <ListBox className="autocomplete-list">
            {items.map(item => (
              <ListBoxItem key={item.id} className="autocomplete-item">
                {item.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </Popover>
      </Box>
    </ComboBox>
  );
}
```

## Styling Strategy

When styling RAC with UXCore:

1. **Layout** - Use Box for spacing, alignment, and structure
2. **Typography** - Use text.* for consistent font styling
3. **Colors** - Use intents for all colors (backgrounds, borders, text)
4. **Spacing** - Use intent-based spacing values
5. **States** - Style hover, focus, active, disabled states with intents
6. **Logical properties** - Use inline/block properties for RTL support

## Available UXCore Intents

For complete intent documentation, see `THEMING.md`.

## Best Practices

### Do

- Check UXCore MCP first before using RAC
- Use RAC for accessibility and WAI-ARIA patterns
- Style with UXCore intents exclusively
- Use Box/Text for layout and typography
- Test with keyboard navigation and screen readers
- Use logical CSS properties (inline/block)

### Don't

- Don't hardcode colors, spacing, or fonts
- Don't skip accessibility testing
- Don't override RAC's built-in ARIA attributes
- Don't use non-UXCore styling (e.g., Tailwind, Bootstrap)
- Don't forget focus states and keyboard navigation

## Resources

- **React Aria Components**: https://react-aria.adobe.com/getting-started.md
- **UXCore Intents**: See `THEMING.md`
- **UXCore Layout**: See `LAYOUT.md`
- **UXCore Typography**: See `TYPOGRAPHY.md`
- **Accessibility Guidelines**: Use the `accessibility` skill

## Testing

After building a custom component:

1. **Use agent-browser** to visually verify
2. **Test keyboard navigation** (Tab, Enter, Space, Arrow keys)
3. **Test screen reader** announcements
4. **Verify focus states** are visible
5. **Check RTL support** if applicable
6. **Test responsive behavior** at different sizes

## Common Questions

**Q: What if React Aria doesn't have the component?**
A: Build it yourself using semantic HTML, UXCore Box/Text, and UXCore intents. Follow WAI-ARIA patterns for accessibility.

**Q: How do I know which intents to use?**
A: See `THEMING.md` for available intents, or check existing UXCore components for patterns.
