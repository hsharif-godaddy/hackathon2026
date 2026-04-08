import { asSchema } from 'ai';
import { allAILibTools } from '@airo/agents/tools';

type Tool = (typeof allAILibTools)[string];

// Tools already implemented natively in the Go agent — exclude from bridge
// Tools already implemented natively in the Go agent — exclude from bridge.
// NOTE: terminalCommand is intentionally NOT listed here because the native Go
// implementation is not yet wired into registerNativeTools (pending supervisor
// integration). It remains bridged until then.
export const NATIVE_GO_TOOLS = new Set([
  'readFile',
  'directoryListing',
  'grepSearch',
  'str_replace_based_edit_tool',
  'fileEdit', // deprecated legacy tool
]);

export interface ToolDescriptor {
  name: string;
  description: string;
  input_schema: object;
}

export function getToolDescriptors(): ToolDescriptor[] {
  const descriptors: ToolDescriptor[] = [];

  for (const [name, tool] of Object.entries(allAILibTools)) {
    if (NATIVE_GO_TOOLS.has(name)) continue;

    try {
      // Use the AI SDK's public asSchema() to normalize the inputSchema into
      // the Schema interface, then read the .jsonSchema property.
      const normalized = asSchema(tool.inputSchema);
      const schema = normalized.jsonSchema;
      if (!schema || typeof schema !== 'object') {
        process.stderr.write(`ts-bridge: skipping tool "${name}" — no jsonSchema found\n`);
        continue;
      }

      descriptors.push({
        name,
        description: tool.description ?? '',
        input_schema: schema,
      });
    } catch (err) {
      process.stderr.write(`ts-bridge: skipping tool "${name}" — ${err}\n`);
    }
  }

  return descriptors;
}

export function getTool(name: string): Tool | undefined {
  return allAILibTools[name] as Tool | undefined;
}

export function getToolNames(): string[] {
  return Object.keys(allAILibTools).filter((name) => !NATIVE_GO_TOOLS.has(name));
}
