import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { resolveAgentsBaseUrl } from '@/lib/agents-base-url';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

async function getAgentBindingUrl(appId: string, jwt: string): Promise<string | NextResponse> {
  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(appId, jwt);

  if (!site) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  const agentBaseUrl: string = resolveAgentsBaseUrl(site);
  return `${agentBaseUrl}/apps/${appId}/commerce/binding`;
}

async function proxyBindingRequest(
  request: NextRequest,
  authContext: CustomerAuthContext,
  appId: string,
  method: 'GET' | 'PATCH' | 'PUT' | 'DELETE',
): Promise<NextResponse> {
  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
  }

  if (!appId) {
    return NextResponse.json({ error: 'appId path parameter is required' }, { status: 400 });
  }

  try {
    const url = await getAgentBindingUrl(appId, authContext.jwt);
    if (url instanceof NextResponse) return url;

    const body = method === 'GET' ? undefined : await request.text();
    const response = await agentFetch(url, {
      siteId: appId,
      method,
      ...(body ? { body } : {}),
    });

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      logger.warn('commerce.binding.proxy.failure', {
        appId,
        method,
        status: response.status,
        error: responseText,
      });
    }

    if (contentType.includes('application/json')) {
      try {
        return NextResponse.json(JSON.parse(responseText), { status: response.status });
      } catch (parseError) {
        logger.error('commerce.binding.proxy.parse_failed', {
          appId,
          method,
          status: response.status,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
        return NextResponse.json({ error: 'Unexpected response from agents service' }, { status: 502 });
      }
    }

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to proxy Commerce binding request' }, { status: response.status });
    }

    return new NextResponse(responseText, { status: response.status });
  } catch (error) {
    logger.error('commerce.binding.proxy.error', {
      appId,
      method,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to proxy Commerce binding request' }, { status: 500 });
  }
}

export const GET = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  return proxyBindingRequest(request, authContext, appId, 'GET');
});

export const PATCH = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  return proxyBindingRequest(request, authContext, appId, 'PATCH');
});

export const PUT = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  return proxyBindingRequest(request, authContext, appId, 'PUT');
});

export const DELETE = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  const { id: appId } = await params;
  return proxyBindingRequest(request, authContext, appId, 'DELETE');
});
