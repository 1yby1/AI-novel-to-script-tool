import { NextResponse } from "next/server";

export function jsonError(code: string, message: string, status = 400): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

export function stringArrayField(body: Record<string, unknown>, key: string): string[] | null {
  const value = body[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}
