# Prompt Builder System

A flexible, TypeScript-first system for building complex AI system prompts with conditional logic, dynamic content, and file inclusion.

## 🎯 **Features**

- **📝 Text Sections**: Static text or dynamic functions
- **📁 File Inclusion**: Load content from markdown/text files
- **🔀 Conditional Logic**: Show/hide sections based on context
- **📊 Template Variables**: Simple `{{variable}}` interpolation
- **📋 Dynamic Lists**: Arrays with formatting (bullet, numbered, dash)
- **🎛️ Fluent API**: Chainable, readable configuration
- **🛡️ Type Safety**: Full TypeScript support with interfaces
- **⚡ Async Support**: All operations support async/await

## 🚀 **Quick Start**

### Basic Usage

```typescript
import { createPromptBuilder } from "@airo/ai-lib";

const prompt = await createPromptBuilder()
  .text("You are a helpful AI assistant.")
  .list([
    "Answer questions accurately",
    "Be concise and clear",
    "Ask for clarification when needed",
  ])
  .text("How can I help you today?")
  .build();
```

### File-Based Prompts

```typescript
const prompt = await createPromptBuilder()
  .file("./prompts/base-instructions.md")
  .file("./prompts/coding-guidelines.md")
  .file("./prompts/safety-rules.md")
  .build();
```

### Conditional Sections

```typescript
const prompt = await createPromptBuilder()
  .text("Welcome to the AI Assistant!")

  .when(when.exists("user.name"))
  .template("Hello {{user.name}}!")
  .template("I see you are a {{user.role}}.")
  .end()

  .when(when.equals("config.mode", "development"))
  .text("🔧 Development mode: Extra debug info enabled")
  .end()

  .build({
    user: { name: "John", role: "developer" },
    config: { mode: "development" },
  });
```

## 📖 **API Reference**

### Core Classes

#### `PromptBuilder`

Main class for building prompts with fluent API.

```typescript
const builder = createPromptBuilder();
```

#### Methods

- `text(content: string | DynamicTextFunction)` - Add text section
- `file(filePath: string)` - Add file content
- `template(template: string)` - Add template with `{{variables}}`
- `list(items: Array | DynamicListFunction, format?)` - Add formatted list
- `when(condition: ConditionFunction)` - Start conditional section
- `section(section: PromptSection)` - Add custom section
- `sections(...sections: PromptSection[])` - Add multiple sections
- `build(context?: PromptContext)` - Build final prompt string
- `clear()` - Clear all sections

### Helper Functions

#### `pb` - Section Helpers

```typescript
import { pb, when } from "@airo/ai-lib";

const sections = [
  pb.text("System Instructions"),
  pb.file("./instructions.md"),
  pb.when(when.env("NODE_ENV", "dev"), pb.text("Debug mode enabled")),
  pb.list(["Feature 1", "Feature 2"], "numbered"),
];

const prompt = await createPromptBuilder()
  .sections(...sections)
  .build();
```

#### `when` - Condition Helpers

```typescript
// Check if value exists
when.exists("user.preferences");

// Check equality
when.equals("user.role", "admin");

// Check environment variable
when.env("NODE_ENV", "production");

// Combine with logic
when.and(when.exists("user.id"), when.equals("features.beta", true));

when.or(
  when.equals("user.type", "premium"),
  when.equals("user.type", "enterprise"),
);

// Negate condition
when.not(when.equals("config.disabled", true));
```

### Dynamic Content

#### Dynamic Text

```typescript
.text((ctx) => {
  const time = new Date().toLocaleTimeString()
  return `Session started at: ${time}`
})
```

#### Dynamic Lists

```typescript
.list((ctx) => {
  return ctx.user?.projects || []
}, 'numbered')
```

#### Template Variables

```typescript
.template('User: {{user.name}} ({{user.role}})')
.template('Projects: {{user.projects.length}}')
.template('Last active: {{user.lastSeen}}')
```

## 🔧 **Advanced Examples**

### Agent System Prompt

```typescript
const agentPrompt = await createPromptBuilder()
  .file("./prompts/base-personality.md")

  // Conditional expertise areas
  .when(when.exists("user.role"))
  .template("\n## User Context\nRole: {{user.role}}")
  .template("Experience: {{user.experience}}")
  .end()

  // Dynamic capabilities based on features
  .text("\n## Available Capabilities")
  .list((ctx) => {
    const features = ctx.config?.features || {};
    const capabilities = [];

    if (features.codeReview) capabilities.push("Code review and analysis");
    if (features.debugging) capabilities.push("Debug assistance");
    if (features.architecture) capabilities.push("Architecture guidance");

    return capabilities;
  })

  // Environment-specific instructions
  .when(when.env("NODE_ENV", "development"))
  .file("./prompts/dev-instructions.md")
  .end()

  .when(when.env("NODE_ENV", "production"))
  .file("./prompts/prod-safety.md")
  .end()

  .build(context);
```

### Multi-Language Support

```typescript
const prompt = await createPromptBuilder()
  .when(when.equals("user.language", "spanish"))
  .file("./prompts/base-es.md")
  .end()

  .when(when.equals("user.language", "french"))
  .file("./prompts/base-fr.md")
  .end()

  .when(when.not(when.exists("user.language")))
  .file("./prompts/base-en.md")
  .end()

  .build({ user: { language: "spanish" } });
```


## 🏗️ **Custom Sections**

Create your own section types:

```typescript
class DatabaseSection implements PromptSection {
  type = "database";

  constructor(
    private query: string,
    public condition?: ConditionFunction,
  ) {}

  async build(context: PromptContext): Promise<string> {
    // Execute database query and format results
    const results = await executeQuery(this.query, context);
    return formatResults(results);
  }
}

const prompt = await createPromptBuilder()
  .section(new DatabaseSection("SELECT * FROM user_preferences"))
  .build();
```

## 🎮 **Usage with AI Agents**

### AgentFactory Integration

```typescript
import {
  createAgentFactory,
  createPromptBuilder,
  pb,
  when,
} from "@airo/ai-lib";

const systemPrompt = await createPromptBuilder()
  .file("./prompts/agent-base.md")
  .when(when.exists("config.features.advanced"))
  .file("./prompts/advanced-features.md")
  .end()
  .build(context);

const agentFactory = createAgentFactory();
const agents = agentFactory.defineAgents({
  assistant: {
    name: "Smart Assistant",
    system: systemPrompt,
    model: await getModel("gpt4o"),
    tools: {
      /* your tools */
    },
  },
});
```

### Context Messages

```typescript
const largeContext = await createPromptBuilder()
  .file("./knowledge/product-docs.md")
  .file("./knowledge/api-reference.md")
  .file("./knowledge/troubleshooting.md")
  .build();

const result = await agent.streamGenerate(userQuestion, {
  context: [
    {
      role: "user",
      content: largeContext,
    },
  ],
});
```

## 🛠️ **Error Handling**

```typescript
try {
  const prompt = await createPromptBuilder()
    .text("This works")
    .file("./missing-file.md") // Will throw error
    .build();
} catch (error) {
  console.error("Build failed:", error.message);

  // Recover with fallback
  const fallback = await createPromptBuilder()
    .clear()
    .text("Fallback prompt")
    .build();
}
```

## 📊 **Performance Tips**

1. **File Caching**: Files are read on each build - consider caching for repeated use
2. **Async Conditions**: Use `await` in condition functions for async operations
3. **Large Prompts**: Consider context/session management for repeated prompts
4. **Template Variables**: Prefer templates over string concatenation

## 🎯 **Best Practices**

1. **Organize Files**: Keep prompt files organized by feature/domain
2. **Use Conditions**: Leverage conditional logic for adaptive prompts
3. **Template Variables**: Use templates for dynamic personalization
4. **Error Handling**: Always handle file reading errors gracefully
5. **Testing**: Test prompts with different context scenarios
6. **Documentation**: Document your prompt structure and variables

## 🚀 **Integration Examples**

See `examples/prompt-builder-demo.ts` for comprehensive examples of all features.

Run the demo:

```bash
npm run example:prompt-builder
```

The prompt builder provides a powerful, flexible foundation for creating sophisticated AI system prompts! 🎉
