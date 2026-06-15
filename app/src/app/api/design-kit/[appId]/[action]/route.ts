import { NextRequest, NextResponse } from "next/server";

import { agentFetch } from "@/lib/agent-fetch";
import { getControlPlaneAdapter } from "@/lib/control-plane";
import {
  createCustomerAuthError,
  type CustomerAuthContext,
  customerHasAccount,
  withCustomerAuth,
} from "@/lib/customer-auth";
import { logger } from "@/lib/request-context";

const ALLOWED_ACTIONS = new Set([
  "colors",
  "fonts",
  "voice",
  "summary",
  "imagery",
  "wizard-step",
]);

async function proxy(
  request: NextRequest,
  authContext: CustomerAuthContext,
  params: Promise<{ appId: string; action: string }>,
  method: "PUT",
): Promise<NextResponse> {
  const { user } = authContext;
  const { appId, action } = await params;

  if (!customerHasAccount(user)) {
    return createCustomerAuthError(
      "Account required",
      403,
    ) as unknown as NextResponse;
  }
  if (!appId || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!authContext.jwt) {
    return NextResponse.json(
      { error: "Authentication token required" },
      { status: 401 },
    );
  }

  const site = await getControlPlaneAdapter().getSite(appId, authContext.jwt);
  if (!site?.agent_url) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const body = await request.text();
  const response = await agentFetch(
    `${site.agent_url}/apps/${appId}/design-kit/${action}`,
    {
      siteId: appId,
      method,
      body,
    },
  );
  if (!response.ok) {
    logger.error("design-kit.proxy.error", {
      appId,
      action,
      status: response.status,
    });
    return NextResponse.json(
      { error: "Design kit update failed", status: response.status },
      { status: response.status },
    );
  }
  return NextResponse.json(await response.json());
}

export const PUT = withCustomerAuth(
  (
    request: NextRequest,
    authContext: CustomerAuthContext,
    ctx: { params: Promise<{ appId: string; action: string }> },
  ) => proxy(request, authContext, ctx.params, "PUT"),
);
