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

export const runtime = "nodejs";

export const GET = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ appId: string; tableName: string }> },
  ) => {
    try {
      const { user } = authContext;
      const { appId, tableName } = await params;

      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          "You must have an account to access database operations",
          403,
        );
      }

      if (!appId) {
        return NextResponse.json(
          { error: "App ID is required" },
          { status: 400 },
        );
      }

      if (!tableName) {
        return NextResponse.json(
          { error: "Table name is required" },
          { status: 400 },
        );
      }

      if (!authContext.jwt) {
        return NextResponse.json(
          { error: "Authentication token required" },
          { status: 401 },
        );
      }

      const searchParams = request.nextUrl.searchParams;
      const format = (searchParams.get("format") || "csv").toLowerCase();

      if (format !== "csv" && format !== "json") {
        return NextResponse.json(
          { error: 'Invalid format. Must be "csv" or "json"' },
          { status: 400 },
        );
      }

      const adapter = getControlPlaneAdapter();
      const site = await adapter.getSite(appId, authContext.jwt);

      if (!site) {
        return NextResponse.json(
          { error: "Site not found" },
          { status: 404 },
        );
      }

      if (!site?.agent_url) {
        throw new Error(
          `Site ${appId} does not have agent URL for table ${tableName}`,
        );
      }

      const agentUrl = `${site.agent_url}/apps/${appId}/database/tables/${encodeURIComponent(tableName)}/export?format=${format}`;

      const response = await agentFetch(agentUrl, {
        siteId: appId,
        method: "GET",
      });

      if (!response.ok) {
        logger.error("database.tables.export.agent.error", {
          message: "Agent database/tables/export request failed",
          status: response.status,
          statusText: response.statusText,
          appId,
          tableName,
          format,
        });
        return NextResponse.json(
          {
            error: "Failed to export table data",
            status: response.status,
          },
          { status: response.status },
        );
      }

      // Stream the response body directly to the client without buffering
      const headers = new Headers();
      const contentType = response.headers.get("Content-Type");
      const contentDisposition = response.headers.get("Content-Disposition");
      if (contentType) {headers.set("Content-Type", contentType);}
      if (contentDisposition)
        {headers.set("Content-Disposition", contentDisposition);}

      return new NextResponse(response.body, {
        status: 200,
        headers,
      });
    } catch (error) {
      logger.error("database.tables.export.error", {
        message: "Failed to export table data",
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to export table data" },
        { status: 500 },
      );
    }
  },
);
