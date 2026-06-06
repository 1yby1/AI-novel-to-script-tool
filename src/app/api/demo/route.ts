import { NextResponse } from "next/server";
import { loadDemoNovel } from "../../../llm/fixture-provider";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ text: loadDemoNovel() });
}
