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

export const GET = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ appId: string }> },
  ) => {
    try {
      const { user } = authContext;
      const { appId } = await params;

      // Customer must have an account
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          "You must have an account to access database operations",
          403,
        );
      }

      // Validate appId
      if (!appId) {
        return NextResponse.json(
          { error: "App ID is required" },
          { status: 400 },
        );
      }

      // JWT required
      if (!authContext.jwt) {
        return NextResponse.json(
          { error: "Authentication token required" },
          { status: 401 },
        );
      }

      // Get site using control plane adapter
      const adapter = getControlPlaneAdapter();
      const site = await adapter.getSite(appId, authContext.jwt);

      if (!site) {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }

      // Ensure site has agent URL
      if (!site?.agent_url) {
        throw new Error(`Site ${appId} does not have agent URL`);
      }

      // Forward request to agent service
      const agentUrl = `${site.agent_url}/apps/${appId}/database/tables`;

      const response = await agentFetch(agentUrl, {
        siteId: appId,
        method: "GET",
      });

      if (!response.ok) {
        logger.error("database.tables.agent.error", {
          message: "Agent database/tables request failed",
          status: response.status,
          statusText: response.statusText,
          appId,
        });
        return NextResponse.json(
          {
            error: "Failed to retrieve database tables",
            status: response.status,
          },
          { status: response.status },
        );
      }

      const data = await response.json();
      return NextResponse.json(data);
    } catch (error) {
      logger.error("database.tables.get.error", {
        message: "Failed to fetch database tables",
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to retrieve database tables" },
        { status: 500 },
      );
    }
  },
);
