import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { type AiroAttribute, AiroMgmtClient } from '@/lib/mgmt-airo';
import { getMgmtAiroBaseUrl } from '@/lib/mgmt-airo/base-url';
import { logger } from '@/lib/request-context';
import {
  AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY,
  applyWhatsNewModalAction,
  normalizeWhatsNewModalState,
  type WhatsNewModalAction,
  type WhatsNewModalDevice,
  type WhatsNewModalState,
} from '@/lib/whats-new-modal-state';

interface PatchBody {
  device?: unknown;
  action?: unknown;
}

function isWhatsNewModalDevice(value: unknown): value is WhatsNewModalDevice {
  return value === 'desktop' || value === 'mobile';
}

function isWhatsNewModalAction(value: unknown): value is WhatsNewModalAction {
  return value === 'viewed' || value === 'completed';
}

function createClient(jwt: string): AiroMgmtClient {
  return new AiroMgmtClient({ baseUrl: getMgmtAiroBaseUrl(), jwt });
}

async function readAttribute(
  client: AiroMgmtClient,
  customerId: string
): Promise<AiroAttribute | null> {
  return client.getAttribute('user', customerId, AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY);
}

export const GET = withCustomerAuth(async (
  _request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
  }

  try {
    const customerId: string = authContext.user.customerId;
    const client: AiroMgmtClient = createClient(authContext.jwt);
    const attribute: AiroAttribute | null = await readAttribute(client, customerId);
    const state: WhatsNewModalState = normalizeWhatsNewModalState(attribute?.value);

    return NextResponse.json(state);
  } catch (error: unknown) {
    logger.error('whats-new.airo-controls.get.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to fetch what is new state' }, { status: 500 });
  }
});

export const PATCH = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  if (!authContext.jwt) {
    return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid device or action' }, { status: 400 });
  }
  if (!isWhatsNewModalDevice(body.device) || !isWhatsNewModalAction(body.action)) {
    return NextResponse.json({ error: 'Invalid device or action' }, { status: 400 });
  }

  try {
    const customerId: string = authContext.user.customerId;
    const client: AiroMgmtClient = createClient(authContext.jwt);
    const attribute: AiroAttribute | null = await readAttribute(client, customerId);
    const currentState: WhatsNewModalState = normalizeWhatsNewModalState(attribute?.value);
    const nextState: WhatsNewModalState = applyWhatsNewModalAction(
      currentState,
      body.device,
      body.action,
      new Date().toISOString()
    );

    if (attribute) {
      await client.updateAttribute(attribute.id, { value: nextState });
    } else {
      await client.createAttribute('user', customerId, {
        key: AIRO_CONTROLS_WHATS_NEW_ATTRIBUTE_KEY,
        value: nextState,
      });
    }

    return NextResponse.json(nextState);
  } catch (error: unknown) {
    logger.error('whats-new.airo-controls.patch.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to update what is new state' }, { status: 500 });
  }
});
