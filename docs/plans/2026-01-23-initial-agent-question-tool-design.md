# Initial Agent Question Tool Design

**Date:** 2026-01-23
**Feature:** Structured question tool for InitialAgent to replace free-form questions
**Branch:** `jeichorn/chat-interview-improvements`

## Goals

1. **Stop condition**: Allow tool usage as a stop condition so agent never outputs text after asking questions
2. **Sequential presentation**: Enable asking multiple questions one at a time, even when generated in a single tool call
3. **Hybrid input**: Support suggested answers with "Other" free text fallback

## Architecture Overview

### Components

**Backend (agents/):**

- New tool: `askQuestionAITool` in `agents/src/tools/ai-lib-tools/ask-question.ts`
- Add to InitialAgent's tool list and `stopAfterTools` array
- Update InitialAgent prompt (`agents/src/prompts/initial/attributes.md`) to use the tool instead of asking directly

**Frontend (app/):**

- New renderer: `AskQuestionToolRenderer.tsx` in `app/src/app/develop/components/tool-renderers/`
- Register in tool renderer registry
- Displays current question with button options + "Other" text input
- Handles answer submission via `sendUserMessage`

### Data Flow

```
InitialAgent → askQuestion tool call → Backend returns structured Q&A data
→ WebSocket streams to frontend → AskQuestionToolRenderer displays
→ User selects/types answer → sendUserMessage → Agent continues
```

## Tool Schema

### Input Schema

```typescript
{
  questions: Array<{
    question: string; // "What's your business name?"
    suggestions: Array<{
      text: string; // "TechCorp"
      value?: string; // Optional: different value to send vs display
    }>;
    allowOther: boolean; // Default true - show "Other" option
    metadata?: Record<string, unknown>; // Optional tracking data
  }>;
}
```

### Output Schema

```typescript
{
  success: true,
  widgetType: 'ask-question',
  widgetData: {
    questions: [...],           // All questions from input
    currentQuestionIndex: 0,    // Start at first question
    answers: []                 // Populated as user responds
  },
  message: "Asked X question(s)"
}
```

## State Management: Stateless Approach

**Design Decision:** Use stateless approach (Option A)

**Why:**

- Simpler implementation
- Fewer round-trips to agent
- Better UX (instant question transitions)
- Agent gets all answers at once for better context

**How it works:**

- Tool returns ALL questions in one response
- Frontend tracks which question to display
- User's answer advances to next question locally
- When all answered, send combined message back to agent

## Frontend Implementation

### Component: `AskQuestionToolRenderer.tsx`

**State:**

```typescript
const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
const [answers, setAnswers] = useState<string[]>([]);
const [showOtherInput, setShowOtherInput] = useState(false);
const [otherValue, setOtherValue] = useState("");
```

**Rendering:**

- Only show current question (based on `currentQuestionIndex`)
- Display suggestion buttons in horizontal wrap layout (similar to `SuggestedResponseToolRenderer`)
- If `allowOther` is true, show "Other..." button that reveals text input
- Previous questions show as collapsed/answered with checkmark

**Answer Submission Flow:**

1. User clicks suggestion button OR submits "Other" text input
2. Store answer in `answers` array
3. If more questions remain: increment `currentQuestionIndex` (instant transition)
4. If all questions answered: call `sendUserMessage` with formatted answer string

**Message Format Sent to Agent:**

```
Question 1: What's your business name?
Answer: TechCorp

Question 2: Where are you located?
Answer: San Francisco, CA

Question 3: What's your main goal?
Answer: Generate leads
```

**Visual Design:**

- Active question: Large text, prominent buttons
- Answered questions: Small collapsed view with checkmark icon
- Progress indicator: "Question 1 of 3" at top
- Use UXCore components (Box, Button) matching existing tool renderers
- Match styling of `SuggestedResponseToolRenderer` for consistency

## Implementation Plan

### Backend Changes

1. **Create tool** (`agents/src/tools/ai-lib-tools/ask-question.ts`):
   - Define schema with zod
   - Implement tool function
   - Export as `askQuestionAITool`

2. **Update tool registry** (`agents/src/tools/ai-lib-tools/index.ts`):
   - Import and export new tool
   - Add to `allAILibTools` object

3. **Update InitialAgent** (`agents/src/agents/initial-agent.ts`):
   - Add `askQuestion` to tools object
   - Add `'askQuestion'` to `stopAfterTools` array

4. **Update InitialAgent prompt** (`agents/src/prompts/initial/attributes.md`):
   - Replace free-form question instructions with tool usage instructions
   - Add examples of calling the `askQuestion` tool
   - Emphasize using tool instead of directly asking

### Frontend Changes

1. **Create renderer** (`app/src/app/develop/components/tool-renderers/AskQuestionToolRenderer.tsx`):
   - Implement component with state management
   - Handle question progression
   - Handle answer submission
   - Style matching existing tool renderers

2. **Register renderer** (`app/src/app/develop/components/tool-renderers/index.ts`):
   - Import new component
   - Add to `toolRendererRegistry` as `askQuestion`
   - Export component

3. **Add translations** (if needed):
   - Progress indicator text
   - "Other" button text
   - Placeholder for other input

## Testing Plan

- [ ] Backend: Tool accepts valid input and returns expected output
- [ ] Backend: Tool added to InitialAgent and stops after execution
- [ ] Frontend: Renderer displays first question with suggestions
- [ ] Frontend: Clicking suggestion advances to next question
- [ ] Frontend: "Other" button reveals text input
- [ ] Frontend: Submitting "Other" text advances to next question
- [ ] Frontend: Final answer formatted correctly and sent to agent
- [ ] Frontend: Progress indicator updates correctly
- [ ] Frontend: Answered questions collapse with checkmark
- [ ] Integration: Agent receives formatted answer and continues conversation
- [ ] Integration: Agent prompt updated to use tool instead of free-form questions

## Future Enhancements

- Validation rules per question (e.g., email format, required length)
- Multi-select questions (checkboxes instead of radio)
- Conditional questions (show question 3 only if answer 2 is X)
- Edit previous answers before final submission
- Save partial progress if user navigates away
