import { NextRequest, NextResponse } from 'next/server';

import { enforceAabMultiUserVentureRelation } from '@/lib/authz-fga/enforce-venture-relation';
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations';
import type { SiteInfo } from '@/lib/control-plane/types';

/**
 * When Switchboard `aab-multi-user` is on and AUTHZ_FGA_* is configured, require OpenFGA
 * airo_app_build on venture:<teamVentureId> for non-owners. Owners bypass FGA (C1 ownership).
 * Missing team venture id logs and skips FGA (until control plane sets variables.aabTeamVentureId).
 */
export async function enforceAabMultiUserCanBuild(options: {
  request: NextRequest;
  siteId: string;
  customerId: string;
  siteInfo: SiteInfo | null;
}): Promise<NextResponse | null> {
  return enforceAabMultiUserVentureRelation({
    request: options.request,
    siteId: options.siteId,
    customerId: options.customerId,
    siteInfo: options.siteInfo,
    relation: AUTHZ_FGA_RELATIONS.canBuild,
    forbiddenMessage: 'You do not have permission to open a builder session for this app.',
  });
}
