# Button Styling Guide for AI-Generated Sites

## The Problem
When AI generates sites with buttons placed over non-white backgrounds, the second (and subsequent) buttons often become invisible or hard to see due to poor contrast. This happens because the default `outline` variant uses `bg-background` (white) which blends into light backgrounds.

## Button Variant Usage Guidelines

### 1. Primary Actions - Use `default` variant
```tsx
<Button variant="default">Primary Action</Button>
```
- **Use for**: Main call-to-action, submit buttons, primary navigation
- **Background**: Purple/blue gradient, high contrast
- **Works on**: All backgrounds

### 2. Secondary Actions on White/Light Backgrounds - Use `secondary` variant
```tsx
<Button variant="secondary">Secondary Action</Button>
```
- **Use for**: Secondary actions when background is light
- **Background**: Light gray
- **Works on**: White and very light backgrounds

### 3. Secondary Actions with Border - Use `outline` variant 
```tsx
<Button variant="outline">Secondary Action</Button>
```
- **Use for**: Secondary actions that need a visible border
- **Background**: Transparent with border
- **Works on**: ALL backgrounds (inherits text color from foreground)
- **Features**: Same as ghost but with border for better definition

### 4. Secondary Actions on Any Background - Use `contrast` variant ✨ 
```tsx
<Button variant="contrast">Secondary Action</Button>
```
- **Use for**: Secondary actions when you need guaranteed high contrast
- **Background**: Semi-transparent white/dark with backdrop blur
- **Works on**: ALL backgrounds (light, dark, colored, images)
- **Features**: High contrast, shadow, backdrop blur for readability

### 5. Subtle Actions - Use `ghost` variant
```tsx
<Button variant="ghost">Subtle Action</Button>
```
- **Use for**: Cancel buttons, subtle actions
- **Background**: Transparent, only hover background
- **Works on**: ALL backgrounds (inherits text color from foreground)

### 6. Navigation/Links - Use `link` variant
```tsx
<Button variant="link">Learn More</Button>
```
- **Use for**: Text links, navigation
- **Background**: Transparent
- **Works on**: ALL backgrounds (inherits text color from foreground)

## Recommended Patterns for AI Generation

### ✅ GOOD: Use these patterns
```tsx
{/* Primary + Secondary with border */}
<Button variant="default">Get Started</Button>
<Button variant="outline">Learn More</Button>

{/* Primary + High contrast secondary */}
<Button variant="default">Get Started</Button>
<Button variant="contrast">Learn More</Button>

{/* Primary + Subtle */}
<Button variant="default">Save Changes</Button>
<Button variant="ghost">Cancel</Button>

{/* Multiple outline buttons now work fine! */}
<Button variant="outline">Action 1</Button>
<Button variant="outline">Action 2</Button>
```

### ❌ BAD: Avoid these patterns
```tsx
{/* Secondary on unknown background - could be invisible */}
<Button variant="secondary">Button</Button> {/* Could be invisible on light bg */}
```

## Implementation Notes

1. **Always provide explicit text color**: The improved variants include explicit text colors
2. **Use backdrop-blur**: Creates separation from background elements
3. **Include shadows**: Helps buttons "float" above backgrounds
4. **Test on multiple backgrounds**: Dark, light, colorful, and image backgrounds

## For AI Developers

When generating button combinations:
1. First button: `variant="default"` (primary action)
2. Second button: `variant="outline"` (secondary action - now works on any background!)
3. Third button: `variant="ghost"` (subtle action)

The `outline` variant is now the recommended choice for secondary buttons as it:
- Works on all backgrounds (inherits proper text color)
- Provides clear visual hierarchy with the border
- Follows standard design patterns
- Is the variant AI systems naturally prefer to use

This ensures buttons are always visible and accessible regardless of the background.
