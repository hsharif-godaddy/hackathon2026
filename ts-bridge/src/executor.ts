import { getTool, NATIVE_GO_TOOLS } from './tool-registry.js';

export interface BridgeContext {
  appId: string;
  sessionId?: string;
  conversationId?: string;
  userId?: string;
}

/**
 * Execute a TypeScript tool by name with the provided input and bridge context.
 *
 * @param toolName - Name of the tool to execute
 * @param input - Parsed input object for the tool
 * @param bridgeContext - Context from the Go agent request
 * @returns The tool result as a string (objects are JSON.stringify'd)
 * @throws Error if the tool is not found, is a native Go tool, or execution fails
 */
export async function executeTool(
  toolName: string,
  input: unknown,
  bridgeContext: BridgeContext
): Promise<string> {
  if (NATIVE_GO_TOOLS.has(toolName)) {
    throw Object.assign(new Error(`tool not found: ${toolName}`), { statusCode: 404 });
  }

  const tool = getTool(toolName);
  if (!tool) {
    throw Object.assign(new Error(`tool not found: ${toolName}`), { statusCode: 404 });
  }

  if (typeof tool.execute !== 'function') {
    throw new Error(`tool "${toolName}" has no execute function`);
  }

  const agentContext = {
    sessionId: bridgeContext.sessionId,
    userId: bridgeContext.userId,
    metadata: {
      appId: bridgeContext.appId,
      conversationId: bridgeContext.conversationId,
      // Many TS tools read sessionId/userId from metadata (e.g., color-scheme,
      // font-theme, css-suggest). Mirror them here for compatibility.
      sessionId: bridgeContext.sessionId,
      userId: bridgeContext.userId,
    },
  };

  const toolCallId = `bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const result = await tool.execute(input, {
    toolCallId,
    messages: [],
    experimental_context: agentContext,
  });

  if (typeof result === 'string') {
    return result;
  }
  return JSON.stringify(result);
}
