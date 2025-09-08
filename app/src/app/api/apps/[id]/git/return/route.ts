import { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: siteId } = await params

  try {
    // Get site data to find agent URL
    const siteResponse = await fetch(`http://localhost:3000/api/sites/${siteId}`)
    if (!siteResponse.ok) {
      throw new Error(`Failed to fetch site data: ${siteResponse.status}`)
    }
    
    const site = await siteResponse.json()
    if (!site?.agent_url) {
      throw new Error('Site does not have agent URL')
    }
    
    // Forward the request to the agent service
    const agentUrl = `${site.agent_url}/git/return`
    
    const body = await request.text()
    
    const response = await fetch(agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body
    })

    if (!response.ok) {
      console.error(`Agent git/return failed: ${response.status} ${response.statusText}`)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to return to latest commit',
          status: response.status 
        }),
        { 
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const data = await response.json()
    return Response.json(data)

  } catch (error) {
    console.error('Error in git/return route:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}