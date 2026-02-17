/**
 * MCP Call Action Executor
 *
 * Proxies MCP (Model Context Protocol) tool calls through the browser.
 * This allows the browser to make the request with its auth_idp cookie,
 * avoiding the need to pass JWT tokens through the agent context.
 *
 * Security benefit: User credentials never leave the browser.
 *
 * The MCP server returns responses in Server-Sent Events (SSE) format,
 * so we use @microsoft/fetch-event-source to properly parse the stream.
 */

import { fetchEventSource } from '@microsoft/fetch-event-source'

import { logger } from '@/lib/request-context'
import type { ClientActionExecutor } from './types'

interface McpCallParams {
  serverUrl: string
  toolName: string
  input: Record<string, unknown>
}

interface McpJsonRpcResponse {
  jsonrpc: string
  id: number | string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/**
 * Execute an MCP tool call via the browser
 * The browser includes the auth_idp cookie automatically via credentials: 'include'
 *
 * MCP servers return SSE (Server-Sent Events) format responses, so we parse
 * the event stream and extract the final JSON-RPC result.
 */
export const mcpCallAction: ClientActionExecutor = async (params) => {
  const { serverUrl, toolName, input } = params as unknown as McpCallParams

  // Validate required parameters
  if (!serverUrl || typeof serverUrl !== 'string') {
    throw new Error('serverUrl is required and must be a string')
  }
  if (!toolName || typeof toolName !== 'string') {
    throw new Error('toolName is required and must be a string')
  }

  logger.info('mcp-call-action.start', {
    serverUrl,
    toolName,
    inputKeys: input ? Object.keys(input) : [],
  })

  return new Promise((resolve, reject) => {
    let finalResult: unknown = null
    let hasError = false
    const abortController = new AbortController()

    fetchEventSource(serverUrl, {
      method: 'POST',
      credentials: 'include', // Sends auth_idp cookie automatically
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-App-Key': 'airo-builder',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: input || {},
        },
        id: Date.now(),
      }),
      signal: abortController.signal,

      async onopen(response) {
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error')
          logger.error('mcp-call-action.http-error', {
            serverUrl,
            toolName,
            status: response.status,
            statusText: response.statusText,
            errorText: errorText.substring(0, 500),
          })
          hasError = true
          reject(new Error(`MCP call failed: ${response.status} ${response.statusText}`))
          abortController.abort()
        }
      },

      onmessage(event) {
        // MCP sends events with data containing JSON-RPC responses
        // Event format: event: message\ndata: {...json...}
        if (event.data) {
          try {
            const parsed = JSON.parse(event.data) as McpJsonRpcResponse

            // Check for JSON-RPC error in the response
            if (parsed.error) {
              logger.error('mcp-call-action.rpc-error', {
                serverUrl,
                toolName,
                errorCode: parsed.error.code,
                errorMessage: parsed.error.message,
              })
              hasError = true
              reject(new Error(`MCP error: ${parsed.error.message}`))
              abortController.abort()
              return
            }

            // Store the result - we'll return the last one received
            if (parsed.result !== undefined) {
              finalResult = parsed.result
            }
          } catch (parseError) {
            // Log parse errors but don't fail - might be a progress notification
            logger.warn('mcp-call-action.parse-warning', {
              serverUrl,
              toolName,
              data: event.data.substring(0, 200),
              error: parseError instanceof Error ? parseError.message : String(parseError),
            })
          }
        }
      },

      onclose() {
        // Stream closed - resolve with the final result
        if (!hasError) {
          if (finalResult !== null) {
            logger.info('mcp-call-action.success', {
              serverUrl,
              toolName,
            })
            resolve(finalResult)
          } else {
            logger.error('mcp-call-action.no-result', {
              serverUrl,
              toolName,
            })
            reject(new Error('MCP call completed but no result was received'))
          }
        }
      },

      onerror(error) {
        // Don't log/reject if we already handled an error
        if (hasError) return

        logger.error('mcp-call-action.unexpected-error', {
          serverUrl,
          toolName,
          error: error instanceof Error ? error.message : String(error),
        })

        hasError = true
        reject(
          new Error(
            `Failed to execute MCP tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`
          )
        )
      },
    }).catch((error) => {
      // Handle any errors from fetchEventSource itself
      if (!hasError) {
        logger.error('mcp-call-action.fetch-error', {
          serverUrl,
          toolName,
          error: error instanceof Error ? error.message : String(error),
        })
        reject(
          new Error(
            `Failed to execute MCP tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`
          )
        )
      }
    })
  })
}
