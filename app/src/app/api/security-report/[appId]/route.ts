import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { VulnerabilityScannerResult } from '@/types/vulnerability-scanner';
import { transformVulnerabilityScanResult } from '../../security-analysis/transform-scan-result';

export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ appId: string }> }
) => {
  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
  }

  const { appId } = await params;
  if (!appId) {
    return NextResponse.json({ error: 'App ID is required' }, { status: 400 });
  }

  const adapter = getControlPlaneAdapter();
  const site = await adapter.getSite(appId, authContext.jwt);
  if (!site?.agent_url) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }

  const agentResponse = await agentFetch(`${site.agent_url}/apps/${appId}/security-report`, {
    siteId: appId,
    method: 'GET',
  });

  if (agentResponse.status === 404) {
    return NextResponse.json(null, { status: 404 });
  }

  if (!agentResponse.ok) {
    logger.error('security-report.bff.agent-fetch-failed', {
      appId,
      status: agentResponse.status,
    });
    return NextResponse.json({ error: 'Failed to fetch security report' }, { status: 500 });
  }

  let stored: { scannedAt: string; executionTime: number; result: VulnerabilityScannerResult };
  try {
    stored = await agentResponse.json() as { scannedAt: string; executionTime: number; result: VulnerabilityScannerResult };
  } catch {
    logger.error('security-report.bff.parse.failure', { appId });
    return NextResponse.json({ error: 'Failed to fetch security report' }, { status: 500 });
  }

  const results = transformVulnerabilityScanResult(stored.result);

  return NextResponse.json({
    scannedAt: stored.scannedAt,
    results,
    timedOut: false,
    taskId: '',
  });
});
