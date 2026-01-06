# Component Generator Prompt Refactoring

## Overview

Refactored the component generator to use a modular prompt system (like other agents) and added comprehensive theming documentation.

## Changes Made

### 1. Created Modular Prompt Files

**Location:** `agents/src/prompts/component-generator/`

#### `core.md`
- Core component generation guidelines
- Import patterns with `@/` alias
- Component structure patterns
- State management rules
- Best practices

#### `theming.md`
- Complete CSS variable reference from `globals.css`
- Tailwind class mappings to CSS variables
- Theme-aware component examples
- Color usage patterns and anti-patterns
- shadcn/ui component integration

#### `output-format.md`
- Critical output format requirements
- Examples of correct vs incorrect output
- Ensures LLM outputs raw code without markdown wrappers

### 2. Updated Component Generator Tool

**File:** `agents/src/tools/component-generator.ts`

**Changes:**
- Replaced inline string prompt with modular `buildSystemPrompt()` function
- Uses `createPromptBuilder()` from `@airo/ai-lib`
- Loads prompt files in order:
  1. `core.md` - Basic component guidelines
  2. `v8.md` (template description) - Template-specific details
  3. `theming.md` - Theme system reference
  4. `output-format.md` - Output requirements

### 3. Created Shared Theme Documentation

**File:** `agents/src/prompts/shared/theme-system.md`

Comprehensive reference documentation for the v8 template's theming system:
- All available CSS variables from `globals.css`
- Complete Tailwind class reference table
- Usage examples for common patterns
- Important rules and best practices
- When to use semantic vs arbitrary colors

### 4. Integrated Theme Docs into Develop Agent

**File:** `agents/src/agents/develop-agent.ts`

Added `theme-system.md` to the develop agent's prompt after `design.md` so it has access to the full theme reference when building components.

## Benefits

### For Component Generator
1. **Modular & Maintainable** - Easy to update specific sections without touching code
2. **Comprehensive Theme Awareness** - Full CSS variable reference ensures theme-compatible components
3. **Consistent Output** - Clear format requirements reduce markdown wrapper issues
4. **Template Alignment** - Uses same patterns as other agents

### For Develop Agent
1. **Enhanced Theme Knowledge** - Complete reference to all available CSS variables
2. **Better Color Choices** - Clear examples of correct semantic color usage
3. **Consistent Styling** - Same theming info as component generator ensures consistency

## File Structure

```
agents/src/prompts/
├── component-generator/
│   ├── core.md              # Component generation basics
│   ├── theming.md           # Theme system (CSS variables, Tailwind classes)
│   └── output-format.md     # Output requirements
└── shared/
    └── theme-system.md      # Shared theme reference (used by develop agent)
```

## Usage

The modular prompt system automatically assembles these files when the component generator is called. No manual action required - the tool handles loading and combining all sections.

## Testing

All components generated should:
- Use semantic color classes (`bg-primary`, `text-foreground`, etc.)
- Avoid hard-coded colors (`bg-blue-500`, `text-gray-900`)
- Pair backgrounds with correct foreground colors
- Work with theme changes automatically




