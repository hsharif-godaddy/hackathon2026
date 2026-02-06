# Golden Dataset

A comprehensive collection of test scenarios for Airo Builder QA testing.

## Categories

### App Types (`app-types/`)
Test creating different types of websites and applications:
- Landing pages
- E-commerce stores
- Portfolio sites
- Restaurant websites
- Blog sites
- SaaS marketing pages

### Chat Interactions (`chat-interactions/`)
Test conversational flows with the AI:
- Feature requests
- Content modifications
- Design feedback
- Multi-turn conversations
- Clarification handling

### Design Changes (`design-changes/`)
Test visual customization:
- Color scheme changes
- Layout modifications
- Typography changes
- Component styling

### Navigation (`navigation/`)
Test basic app navigation:
- Page routing
- Menu interactions
- Modal handling
- Authentication flows

### Edge Cases (`edge-cases/`)
Test unusual inputs and error handling:
- Ambiguous prompts
- Very long inputs
- Special characters
- Error recovery
- Timeout handling

## Running the Golden Dataset

```bash
# Run all golden dataset scenarios
pnpm --filter agentic-qa test --all scenarios/golden-dataset/

# Run specific category
pnpm --filter agentic-qa test --all scenarios/golden-dataset/app-types/

# Run single scenario
pnpm --filter agentic-qa test scenarios/golden-dataset/app-types/landing-page.yaml
```

## Adding New Scenarios

1. Choose the appropriate category folder
2. Create a YAML file following the schema in `src/scenarios/types.ts`
3. Include clear goal instructions for the AI agent
4. Add appropriate timeout and maxSteps values
5. Document any dependencies on other scenarios
