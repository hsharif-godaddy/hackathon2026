import { NextRequest, NextResponse } from 'next/server';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { CreateSiteParams } from '@/lib/control-plane/types';
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  setSpanAppId,
  setSpanJobId,
  withCustomerAuth} from '@/lib/customer-auth';
import { AIRO_PRODUCT_IDS,AiroHttpError } from '@/lib/mgmt-airo/types';
import { logger } from '@/lib/request-context';
import { detectLocale } from '@/lib/translations/server-intl';
import { getByteLength, MAX_PROMPT_BYTES } from '@/lib/waf-validation';

// POST /api/sites/quick-create - Fast site creation
// Level 3 auth: mgmt-airo's POST /apps requires HBI (recent heartbeat).
// Matching the level here lets the client's authPreflight trigger SSO before
// the downstream call fires, instead of surfacing a generic 500.
export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    const body = await request.json();
    const { prompt, initialPrompt, productId, itc: rawItc } = body;
    const validItc = typeof rawItc === 'string' && rawItc.length > 0 && rawItc.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(rawItc) ? rawItc : undefined;
    const { user } = authContext;

    // Validate productId if provided
    if (productId) {
      const validProductIds = Object.values(AIRO_PRODUCT_IDS);
      if (!validProductIds.includes(productId)) {
        return NextResponse.json(
          { error: `Invalid productId. Must be one of: ${validProductIds.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // Customer must have an account to create sites
    if (!customerHasAccount(user)) {
      return createCustomerAuthError('You must have an account to create sites. Please create an account first.', 403);
    }

    // Accept either prompt or initialPrompt
    const projectPrompt = prompt || initialPrompt;
    if (!projectPrompt) {
      return NextResponse.json(
        { error: 'prompt or initialPrompt is required' },
        { status: 400 }
      );
    }

    // Normalize and validate prompt size (WAF has 8KB limit, we enforce 7.4KB for safety)
    // Validate the same normalized value that will be sent downstream
    const normalizedPrompt = projectPrompt.trim();
    const promptByteLength = getByteLength(normalizedPrompt);
    if (promptByteLength > MAX_PROMPT_BYTES) {
      logger.warn('sites.quick-create.prompt-too-large', {
        promptByteLength,
        maxBytes: MAX_PROMPT_BYTES,
        promptCharLength: normalizedPrompt.length,
        accountId: user.accountId,
        customerId: user.customerId,
      });
      return NextResponse.json(
        {
          error: 'Prompt is too large',
          details: `Prompt must be less than ${MAX_PROMPT_BYTES} bytes (current: ${promptByteLength} bytes)`,
        },
        { status: 400 }
      );
    }

    // JWT required for authentication
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // Use authenticated user's account ID
    const account_id = user.accountId!;

    logger.info('sites.quick-create.start', { accountId: account_id });

    // Detect locale for datacenter selection
    const marketId = await detectLocale();

    // Use control plane adapter
    const adapter = getControlPlaneAdapter();

    const createSiteParams: CreateSiteParams = {
      accountId: account_id,
      prompt: normalizedPrompt,
      jwt: authContext.jwt,
      productId,
      marketId,
      headers: request.headers,
      ...(validItc && { itc: validItc }),
    };

    const result = await adapter.createSite(createSiteParams);
    if (!result.success) {
      throw new Error(result.error || 'Failed to create site');
    }

    logger.info('sites.quick-create.success', { appId: result.siteId, type: result.type });

    // Note: quick-create returns a jobId (type: 'job'), real appId is resolved later via polling
    if (result.type === 'job') {
      setSpanJobId(result.siteId!);
    } else {
      setSpanAppId(result.siteId!);
    }

    // Funnel event: App creation initiated - correlate with APM transactions
    logger.info('funnel.create_app.initiated', {
      jobId: result.type === 'job' ? result.siteId : undefined,
      appId: result.type !== 'job' ? result.siteId : undefined,
      customerId: user.customerId,
      promptLength: projectPrompt.trim().length,
    });

    return NextResponse.json({
      id: result.siteId,
      name: result.name,
      status: result.status,
      account_id: result.account_id,
      created_at: result.created_at?.toISOString() || new Date().toISOString(),
      updated_at: result.updated_at?.toISOString() || new Date().toISOString(),
      type: result.type // 'job' for V2 job IDs, 'site' for real site IDs
    }, { status: 201 });

  } catch (error) {
    // Propagate downstream 401 (e.g. mgmt-airo HBI rejection) so the client
    // opens SSO for a fresher business-level token. Route-level withCustomerAuth
    // and client-side authPreflight may each accept a token that mgmt-airo's
    // stricter gdhttp.High check still rejects. This is an expected business
    // condition, not an error -- log at info so it doesn't trip alerts on
    // sites.quick-create.error.
    if (error instanceof AiroHttpError && error.status === 401) {
      logger.info('sites.quick-create.hbi-expired', { accountId: authContext.user.accountId });
      return NextResponse.json(
        { error: 'Unauthorized', authReason: 2 },
        { status: 401 }
      );
    }

    logger.error('sites.quick-create.error', { message: 'Quick site creation failed', errorMessage: error instanceof Error ? error.message : 'Unknown error' });

    return NextResponse.json(
      {
        error: 'Failed to create site record',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}, { level: 3 });
