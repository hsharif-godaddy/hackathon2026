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

// Force dynamic rendering to ensure all HTTP methods work correctly
export const dynamic = "force-dynamic";

/**
 * POST /api/database/:appId/tables/:tableName/rows - Insert a new row
 */
export const POST = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ appId: string; tableName: string }> },
  ) => {
    try {
      const { user } = authContext;
      const { appId, tableName } = await params;

      // Customer must have an account
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          "You must have an account to access database operations",
          403,
        );
      }

      // Validate parameters
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

      // JWT required
      if (!authContext.jwt) {
        return NextResponse.json(
          { error: "Authentication token required" },
          { status: 401 },
        );
      }

      const body = await request.json();
      const { data } = body;

      if (!data || typeof data !== "object") {
        return NextResponse.json(
          { error: "Row data is required" },
          { status: 400 },
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
        throw new Error(
          `Site ${appId} does not have agent URL for table ${tableName}`,
        );
      }

      // Forward request to agent service
      const agentUrl = `${site.agent_url}/apps/${appId}/database/tables/${encodeURIComponent(tableName)}/rows`;

      const response = await agentFetch(agentUrl, {
        siteId: appId,
        method: "POST",
        body: JSON.stringify({ data }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          logger.error("database.tables.rows.insert.parse-error", {
            message: "Failed to parse agent error response",
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type"),
            parseError:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
            appId,
            tableName,
            agentUrl,
          });
          return {
            error: `Agent returned ${response.status} with non-JSON response`,
          };
        });

        logger.error("database.tables.rows.insert.agent.error", {
          message: "Agent insert row request failed",
          status: response.status,
          statusText: response.statusText,
          appId,
          tableName,
          error: errorData.message || errorData.error,
        });

        return NextResponse.json(
          {
            error:
              errorData.message || errorData.error || "Failed to insert row",
            status: response.status,
          },
          { status: response.status },
        );
      }

      const responseData = await response.json().catch((parseError) => {
        logger.error("database.tables.rows.insert.response-parse-error", {
          message: "Failed to parse agent success response",
          status: response.status,
          parseError:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          appId,
          tableName,
        });
        return null;
      });

      if (responseData === null) {
        return NextResponse.json(
          {
            error:
              "Agent service returned a malformed response that could not be parsed as JSON",
            status: 502,
          },
          { status: 502 },
        );
      }

      return NextResponse.json(responseData);
    } catch (error) {
      logger.error("database.tables.rows.insert.error", {
        message: "Failed to insert row",
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to insert row" },
        { status: 500 },
      );
    }
  },
  { level: 3 },
);

/**
 * PUT /api/database/:appId/tables/:tableName/rows - Update an existing row
 */
export const PUT = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ appId: string; tableName: string }> },
  ) => {
    try {
      const { user } = authContext;
      const { appId, tableName } = await params;

      // Customer must have an account
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          "You must have an account to access database operations",
          403,
        );
      }

      // Validate parameters
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

      // JWT required
      if (!authContext.jwt) {
        return NextResponse.json(
          { error: "Authentication token required" },
          { status: 401 },
        );
      }

      const body = await request.json();
      const { primaryKey, data } = body;

      if (!primaryKey || typeof primaryKey !== "object") {
        return NextResponse.json(
          { error: "Primary key is required" },
          { status: 400 },
        );
      }

      if (!data || typeof data !== "object") {
        return NextResponse.json(
          { error: "Row data is required" },
          { status: 400 },
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
        throw new Error(
          `Site ${appId} does not have agent URL for table ${tableName}`,
        );
      }

      // Forward request to agent service
      const agentUrl = `${site.agent_url}/apps/${appId}/database/tables/${encodeURIComponent(tableName)}/rows`;

      const response = await agentFetch(agentUrl, {
        siteId: appId,
        method: "PUT",
        body: JSON.stringify({ primaryKey, data }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          logger.error("database.tables.rows.update.parse-error", {
            message: "Failed to parse agent error response",
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type"),
            parseError:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
            appId,
            tableName,
            agentUrl,
          });
          return {
            error: `Agent returned ${response.status} with non-JSON response`,
          };
        });

        logger.error("database.tables.rows.update.agent.error", {
          message: "Agent update row request failed",
          status: response.status,
          statusText: response.statusText,
          appId,
          tableName,
          error: errorData.message || errorData.error,
        });

        return NextResponse.json(
          {
            error:
              errorData.message || errorData.error || "Failed to update row",
            status: response.status,
          },
          { status: response.status },
        );
      }

      const responseData = await response.json().catch((parseError) => {
        logger.error("database.tables.rows.update.response-parse-error", {
          message: "Failed to parse agent success response",
          status: response.status,
          parseError:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          appId,
          tableName,
        });
        return null;
      });

      if (responseData === null) {
        return NextResponse.json(
          {
            error:
              "Agent service returned a malformed response that could not be parsed as JSON",
            status: 502,
          },
          { status: 502 },
        );
      }

      return NextResponse.json(responseData);
    } catch (error) {
      logger.error("database.tables.rows.update.error", {
        message: "Failed to update row",
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to update row" },
        { status: 500 },
      );
    }
  },
  { level: 3 },
);

/**
 * DELETE /api/database/:appId/tables/:tableName/rows - Delete a row
 */
export const DELETE = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ appId: string; tableName: string }> },
  ) => {
    try {
      const { user } = authContext;
      const { appId, tableName } = await params;

      // Customer must have an account
      if (!customerHasAccount(user)) {
        return createCustomerAuthError(
          "You must have an account to access database operations",
          403,
        );
      }

      // Validate parameters
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

      // JWT required
      if (!authContext.jwt) {
        return NextResponse.json(
          { error: "Authentication token required" },
          { status: 401 },
        );
      }

      const body = await request.json();
      const { primaryKey } = body;

      if (!primaryKey || typeof primaryKey !== "object") {
        return NextResponse.json(
          { error: "Primary key is required" },
          { status: 400 },
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
        throw new Error(
          `Site ${appId} does not have agent URL for table ${tableName}`,
        );
      }

      // Forward request to agent service
      const agentUrl = `${site.agent_url}/apps/${appId}/database/tables/${encodeURIComponent(tableName)}/rows`;

      const response = await agentFetch(agentUrl, {
        siteId: appId,
        method: "DELETE",
        body: JSON.stringify({ primaryKey }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch((parseError) => {
          logger.error("database.tables.rows.delete.parse-error", {
            message: "Failed to parse agent error response",
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get("content-type"),
            parseError:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
            appId,
            tableName,
            agentUrl,
          });
          return {
            error: `Agent returned ${response.status} with non-JSON response`,
          };
        });

        logger.error("database.tables.rows.delete.agent.error", {
          message: "Agent delete row request failed",
          status: response.status,
          statusText: response.statusText,
          appId,
          tableName,
          error: errorData.message || errorData.error,
        });

        return NextResponse.json(
          {
            error:
              errorData.message || errorData.error || "Failed to delete row",
            status: response.status,
          },
          { status: response.status },
        );
      }

      const responseData = await response.json().catch((parseError) => {
        logger.error("database.tables.rows.delete.response-parse-error", {
          message: "Failed to parse agent success response",
          status: response.status,
          parseError:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          appId,
          tableName,
        });
        return null;
      });

      if (responseData === null) {
        return NextResponse.json(
          {
            error:
              "Agent service returned a malformed response that could not be parsed as JSON",
            status: 502,
          },
          { status: 502 },
        );
      }

      return NextResponse.json(responseData);
    } catch (error) {
      logger.error("database.tables.rows.delete.error", {
        message: "Failed to delete row",
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Failed to delete row" },
        { status: 500 },
      );
    }
  },
  { level: 3 },
);
