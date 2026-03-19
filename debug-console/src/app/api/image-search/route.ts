import { NextRequest, NextResponse } from "next/server";
import { gdAuthService } from "@/lib/gd-auth-service";

const IMAGE_SEARCH_SERVICE_URL =
  process.env.IMAGE_SEARCH_SERVICE_URL || "http://localhost:8080";

const isDevMode = process.env.NODE_ENV === "development";

// Basic JWT structure validation - checks format without decoding
function isValidJWTStructure(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  // Each part should be valid base64url (alphanumeric, -, _, no padding required)
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  return parts.every((part) => part.length > 0 && base64urlRegex.test(part));
}

export async function POST(request: NextRequest) {
  const token = gdAuthService.extractTokenFromRequest(request);

  if (!token && !isDevMode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate token structure before forwarding to backend (skip in dev mode)
  if (!isDevMode && token && !isValidJWTStructure(token)) {
    console.warn("[image-search] Invalid token structure");
    return NextResponse.json({ error: "Invalid token format" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // In dev mode, don't forward auth header (backend should use AUTH_TYPE=none)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!isDevMode && token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${IMAGE_SEARCH_SERVICE_URL}/api/v1/search`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const contentType = response.headers.get("content-type") || "";

    // Handle JSON responses (expected case)
    if (contentType.includes("application/json")) {
      try {
        const data = await response.json();

        if (!response.ok) {
          return NextResponse.json(data, { status: response.status });
        }

        return NextResponse.json(data);
      } catch {
        // Upstream claimed JSON but returned invalid JSON
        const textBody = await response.text();
        return new NextResponse(textBody, {
          status: response.status,
          headers: { "Content-Type": "text/plain" },
        });
      }
    }

    // Handle non-JSON responses (e.g., HTML error pages, 502/503)
    const textBody = await response.text();
    return new NextResponse(textBody, {
      status: response.status,
      headers: { "Content-Type": contentType || "text/plain" },
    });
  } catch (error) {
    console.error("[image-search] Proxy error:", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to connect to image search service" },
      { status: 503 }
    );
  }
}
