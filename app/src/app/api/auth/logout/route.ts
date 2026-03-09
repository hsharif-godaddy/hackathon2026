import { NextResponse } from "next/server";

import { logger } from "@/lib/request-context";

export async function POST() {
  try {
    // For Gasket auth, we just need to acknowledge the logout
    // The actual logout happens via SSO redirect in the client
    logger.info(
      "auth.logout.start",
      { message: "Logout API called" },
      { tags: ["security"] },
    );

    return NextResponse.json(
      { success: true, message: "Logout acknowledged" },
      { status: 200 },
    );
  } catch (error) {
    logger.error(
      "auth.logout.error",
      {
        message: "Logout API failed",
        error: error instanceof Error ? error.message : String(error),
      },
      { tags: ["security"] },
    );
    return NextResponse.json(
      { success: false, error: "Logout failed" },
      { status: 500 },
    );
  }
}
