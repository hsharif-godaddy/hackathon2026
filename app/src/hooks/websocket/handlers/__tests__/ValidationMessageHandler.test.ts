import { beforeEach, describe, expect, it } from 'vitest'

import { createMockMessageContext } from './testUtils'
import type { MessageContext, WebSocketMessage } from '../types'
import { ValidationMessageHandler } from '../ValidationMessageHandler'

describe('ValidationMessageHandler', () => {
  let handler: ValidationMessageHandler
  let mockContext: MessageContext

  beforeEach(() => {
    handler = new ValidationMessageHandler()
    mockContext = createMockMessageContext()
  })

  it('should render validation diagnostics as a client-only tool segment', async function render() {
    const data: WebSocketMessage = {
      type: 'validation_message',
      content: 'Fix this TypeScript error',
      data: {
        validationId: 'validation-run-1',
        messageId: 'validation-msg-1',
        metadata: {
          validationStatus: 'failed'
        }
      }
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).toHaveBeenCalledWith({
      id: 'validation-run-1',
      name: 'validateCode',
      input: {},
      result: {
        status: 'failed',
        diagnostics: 'Fix this TypeScript error'
      },
      status: 'completed'
    })
    expect(mockContext.actions.addToolResultSegment).toHaveBeenCalledWith({
      id: 'validation-run-1',
      name: 'validateCode',
      input: {},
      result: {
        status: 'failed',
        diagnostics: 'Fix this TypeScript error'
      },
      status: 'completed'
    })
  })

  it('should show validation as running before diagnostics are available', async function running() {
    const data: WebSocketMessage = {
      type: 'validation_message',
      content: 'Validating code...',
      data: {
        validationId: 'validation-run-1',
        metadata: {
          validationStatus: 'running'
        }
      }
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).toHaveBeenCalledWith({
      id: 'validation-run-1',
      name: 'validateCode',
      input: {},
      status: 'running'
    })
    expect(mockContext.actions.addToolResultSegment).not.toHaveBeenCalled()
  })

  it('should render completed validation as a completed tool segment', async function completed() {
    const data: WebSocketMessage = {
      type: 'validation_message',
      content: 'No issues found.',
      data: {
        validationId: 'validation-run-1',
        metadata: {
          validationStatus: 'completed'
        }
      }
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolResultSegment).toHaveBeenCalledWith({
      id: 'validation-run-1',
      name: 'validateCode',
      input: {},
      result: {
        status: 'completed',
        diagnostics: 'No issues found.'
      },
      status: 'completed'
    })
  })

  it('should use messageId when validationId is not provided', async function messageId() {
    const data: WebSocketMessage = {
      type: 'validation_message',
      content: 'Fix this TypeScript error',
      data: {
        messageId: 'msg-from-db',
        metadata: {
          validationStatus: 'failed'
        }
      }
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolStartSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-from-db',
      name: 'validateCode'
    }))
    expect(mockContext.actions.addToolResultSegment).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-from-db',
      name: 'validateCode'
    }))
  })

  it('should render validator errors as an error tool segment', async function error() {
    const data: WebSocketMessage = {
      type: 'validation_message',
      content: 'Validator failed',
      data: {
        validationId: 'validation-run-1',
        metadata: {
          validationStatus: 'error'
        }
      }
    }

    await handler.handle(data, mockContext)

    expect(mockContext.actions.addToolResultSegment).toHaveBeenCalledWith({
      id: 'validation-run-1',
      name: 'validateCode',
      input: {},
      result: {
        status: 'error',
        diagnostics: 'Validator failed'
      },
      status: 'error',
      error: 'Validator failed'
    })
  })
})
