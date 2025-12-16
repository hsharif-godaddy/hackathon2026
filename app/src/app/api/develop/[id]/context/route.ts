import { NextRequest, NextResponse } from 'next/server'

import { agentFetch } from '@/lib/agent-fetch'
import { features } from '@/lib/features'
import { logger } from '@/lib/request-context'

interface ContextSection {
  type: 'template' | 'app' | 'visual' | 'element' | 'conversation' | 'hot_files'
  role: 'system' | 'user'
  content: string
  tokenCount: number
}

interface ContextDebugResponse {
  systemPrompt: string
  contextSections: ContextSection[]
  totalTokens: number
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  // Only allow in development mode
  if (!features.developmentMode) {
    return NextResponse.json(
      { error: 'Context debugging is only available in development mode' },
      { status: 403 }
    )
  }

  try {
    const appId = params.id
    const searchParams = request.nextUrl.searchParams

    // Get fake context injection parameters
    const injectFakeVisual = searchParams.get('injectFakeVisual') === 'true'
    const injectFakeAiEdit = searchParams.get('injectFakeAiEdit') === 'true'
    const userInput = searchParams.get('userInput') || ''

    // Forward request to agents service
    const agentsUrl = process.env.NEXT_PUBLIC_AGENTS_URL || 'http://localhost:4000'
    const agentsResponse = await agentFetch(`${agentsUrl}/debug/context/${appId}?` + new URLSearchParams({
      injectFakeVisual: injectFakeVisual.toString(),
      injectFakeAiEdit: injectFakeAiEdit.toString(),
      userInput
    }), { siteId: appId })

    if (!agentsResponse.ok) {
      const error = await agentsResponse.text()
      return NextResponse.json(
        { error: `Agents service error: ${error}` },
        { status: agentsResponse.status }
      )
    }

    const contextData: ContextDebugResponse = await agentsResponse.json()

    return NextResponse.json(contextData)
  } catch (error) {
    logger.error('api.context.debug.error', {
      message: 'Context debug API error',
      appId: params.id,
      errorMessage: error instanceof Error ? error.message : String(error)
    }, {
      error: error instanceof Error ? error : undefined
    })
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}