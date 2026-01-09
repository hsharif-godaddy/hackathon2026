import { NextResponse } from 'next/server';

const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL;
const LANGFUSE_PROJECT_ID = process.env.LANGFUSE_PROJECT_ID;

export async function GET() {
  return NextResponse.json({
    baseUrl: LANGFUSE_BASE_URL || null,
    projectId: LANGFUSE_PROJECT_ID || null,
    configured: !!(LANGFUSE_BASE_URL && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
  });
}
